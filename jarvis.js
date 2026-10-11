// JARVIS - AI cofounder for Zayzana Tech
// Zero dependencies. Needs Node 18 or newer.
//
//   node jarvis.js                 morning briefing
//   node jarvis.js ask "question"  ask the cofounder anything about the business
//   node jarvis.js prep NAME       meeting prep, e.g.  node jarvis.js prep Treverton
//   node jarvis.js log "note"      save a note from a conversation
//   node jarvis.js log             show your recent notes
//   node jarvis.js help
//
// Flags: --no-ai (skip Gemini)   --show-prompt (print what would be sent to Gemini)
// AI needs a free key:  set GEMINI_API_KEY=your-key   (aistudio.google.com)
//
// Your trackers are read live from GitHub. Notes you log are saved next to this file.

const fs = require("fs");
const path = require("path");

const OWNER = "syedzayn296-ops";
const BRANCH = process.env.JARVIS_BRANCH || "main";
const LOCAL_DIR = process.env.JARVIS_REPOS_DIR || ""; // optional: read cloned repos instead of GitHub
const LOG_FILE = process.env.JARVIS_LOG_FILE || path.join(__dirname, "jarvis-log.jsonl");

const SOURCES = {
  actions:   ["zayzana-command-centre", "trackers/action-queue.csv"],
  master:    ["zayzana-command-centre", "trackers/master-tracker.csv"],
  workflow:  ["zayzana-command-centre", "trackers/workflow-validation-campaign.csv"],
  overseas:  ["zayzana-command-centre", "trackers/overseas-prospect-tracker.csv"],
  productMd: ["zayzana-command-centre", "trackers/ZAYZANA_PRODUCT_TRACKER.md"],
  schoolOut: ["Taalhuis-", "tracker/outreach-log.csv"],
  schoolFb:  ["Taalhuis-", "tracker/feedback-log.csv"],
  schoolAct: ["Taalhuis-", "tracker/action-queue.csv"]
};

const COMPANY =
  "You are JARVIS, the AI cofounder of Zayzana Tech, a small South African tech company run by Zayn " +
  "(25 years in warehousing and supply chain). Use ONLY the facts provided. Never invent prospects, numbers, " +
  "replies or meetings. If the facts do not say something, say you do not know.\n" +
  "Company rules: discover first, qualify second, recommend third, execute only after Zayn approves. " +
  "Do not sell generic AI, chatbots or CRMs. Do not build before a paid problem is identified. " +
  "If an item says a meeting is confirmed, treat it as MEETING PREP, not as a follow-up asking for a call.\n" +
  "Weaknesses or blockers listed for Zayzana's OWN products (for example pronunciation issues in Taalhuis) are NOT problems the prospect has. " +
  "Never present them as the prospect's problem or build leading questions on them. Ask neutral, open discovery questions about the prospect's own situation. " +
  "After a first meeting the right next step is a small free pilot or a second discovery conversation, never a paid deal.\n";

// ---------- helpers ----------

const flag = (f) => process.argv.includes(f);
const clip = (s, n = 150) => (s.length > n ? s.slice(0, n - 3) + "..." : s);
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, "-");
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());

function todaySAST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}
function nowSAST() {
  return new Date().toLocaleString("en-CA", { timeZone: "Africa/Johannesburg", hour12: false });
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayName(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
  });
}

async function readSource([repo, file]) {
  if (LOCAL_DIR) return fs.readFileSync(path.join(LOCAL_DIR, repo, file), "utf8");
  const url = `https://raw.githubusercontent.com/${OWNER}/${repo}/${BRANCH}/${file}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} for ${repo}/${file}`);
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"' && field === "") inQuotes = true; // quotes only count at the start of a field
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = (r[i] || "").trim()));
    return o;
  });
}

async function loadData() {
  const data = {}, warnings = [];
  for (const [key, src] of Object.entries(SOURCES)) {
    try {
      const text = await readSource(src);
      data[key] = key === "productMd" ? text : parseCsv(text);
    } catch (e) {
      warnings.push(`Could not read ${src[0]}/${src[1]} (${e.message})`);
      data[key] = key === "productMd" ? "" : [];
    }
  }
  return { data, warnings };
}

// ---------- notes log ----------

function readLog() {
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}
function addLog(text) {
  fs.appendFileSync(LOG_FILE, JSON.stringify({ when: nowSAST(), text }) + "\n");
}

// ---------- analysis (rule-based, no AI) ----------

function analyse(data, today) {
  const windowEnd = addDays(today, 2);
  const inWindow = (s) => (s.match(/\d{4}-\d{2}-\d{2}/g) || []).some((d) => d >= today && d <= windowEnd);
  const upcoming = [], detail = [];

  for (const key of ["workflow", "schoolOut", "schoolAct", "master", "actions"]) {
    for (const row of data[key]) {
      const vals = Object.values(row);
      if (vals.some(inWindow)) {
        const label = vals.filter((v) => v && !isDate(v) && !/^\d+$/.test(v)).slice(0, 3).join(" | ");
        const dates = vals.join(" ").match(/\d{4}-\d{2}-\d{2}/g).filter((d) => d >= today && d <= windowEnd);
        upcoming.push(`${dates[0]}  ${clip(ascii(label), 120)}`);
        detail.push(Object.entries(row).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; "));
      }
    }
  }
  for (const line of data.productMd.split("\n")) {
    if (inWindow(line)) {
      const d = line.match(/\d{4}-\d{2}-\d{2}/g).find((x) => x >= today && x <= windowEnd);
      const cleaned = line.replace(/[|#*]/g, " ").replace(/\s+/g, " ").trim();
      upcoming.push(`${d}  ${clip(ascii(cleaned), 120)}`);
      detail.push(cleaned);
    }
  }

  const ov = data.overseas;
  const wf = data.workflow;
  const wfCodes = wf.map((r) => ((r["Response_Code"] || "").match(/^R\d/) || [""])[0]).filter(Boolean);

  const open = [];
  for (const r of data.actions) {
    if (r["Priority"] === "High" && !/closed|parked|done/i.test(r["Status"])) open.push(`${r["Product"]}: ${r["Action"]}`);
  }
  for (const r of data.schoolAct) {
    if (r["Priority"] === "High" && !/closed|parked|done/i.test(r["Status"])) open.push(`Taalhuis: ${r["Action"]}`);
  }

  return {
    upcoming: [...new Set(upcoming)].sort(),
    detail: [...new Set(detail)],
    sent: ov.filter((r) => r["Outreach Status"] === "Sent").length,
    notSent: ov.filter((r) => r["Outreach Status"] === "Not sent").length,
    followUpsDue: ov.filter((r) => r["Outreach Status"] === "Sent" && /^follow up/i.test(r["Next Action"] || "")).length,
    dateInReply: ov.filter((r) => isDate(r["Reply"])).length,
    realReplies: ov.filter((r) => {
      const v = (r["Reply"] || "").trim();
      return v && !/^no reply/i.test(v) && !isDate(v);
    }).length,
    wfContacted: wf.filter((r) => r["Status"] === "Contacted").length,
    wfQueued: wf.filter((r) => r["Status"] === "Queued").length,
    problems: wfCodes.filter((c) => Number(c.slice(1)) >= 3).length,
    schoolFeedback: data.schoolFb.length,
    schoolContacts: data.schoolOut.length,
    open
  };
}

function factsText(a, notes) {
  const recent = notes.slice(-8).map((n) => `- ${n.when}: ${n.text}`).join("\n");
  return [
    "Dated items in the next 3 days (full detail):\n" +
      (a.detail.map((d) => "- " + clip(d, 450)).join("\n") || "none"),
    `Overseas plumbing: ${a.sent} sent, ${a.notSent} not sent, ${a.followUpsDue} follow-ups due, ${a.realReplies} real replies logged.`,
    `SA workflow campaign: ${a.wfContacted} contacted, ${a.wfQueued} queued, ${a.problems} problems identified (R3 or higher).`,
    `Taalhuis: ${a.schoolContacts} outreach rows, ${a.schoolFeedback} feedback entries logged.`,
    "High priority open actions:\n" + (a.open.join("\n") || "none"),
    "Notes Zayn logged from conversations (newest last):\n" + (recent || "none yet")
  ].join("\n\n");
}

// ---------- AI ----------

async function askAI(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(45000)
      });
      const json = await res.json();
      if (res.status === 429 || res.status === 503) {
        if (attempt === 1) { await new Promise((r) => setTimeout(r, 4000)); continue; }
      }
      if (!res.ok) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
      const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("");
      return text || "(no answer returned)";
    } catch (e) {
      if (attempt === 2 || e.name === "AbortError" || e.name === "TimeoutError") {
        if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error("Gemini took longer than 45 seconds. Try again.");
        throw e;
      }
    }
  }
}

async function aiSection(title, prompt) {
  if (flag("--show-prompt")) {
    console.log("\nPROMPT THAT WOULD BE SENT\n-------------------------\n" + prompt);
    return;
  }
  if (flag("--no-ai")) return;
  if (!process.env.GEMINI_API_KEY) {
    console.log("\n(Tip: set GEMINI_API_KEY to add the AI cofounder's view.)");
    return;
  }
  try {
    const text = await askAI(prompt);
    console.log("\n" + title + "\n" + "-".repeat(title.length));
    console.log(text.trim());
    console.log("\nSuggestions only. Nothing was sent or changed.");
  } catch (e) {
    console.log("\nAI step failed: " + e.message);
    console.log("Everything above still works without it. Check GEMINI_API_KEY, or set GEMINI_MODEL.");
  }
}

// ---------- commands ----------

async function cmdBrief() {
  const today = todaySAST();
  const { data, warnings } = await loadData();
  const a = analyse(data, today);
  const notes = readLog();
  const say = (l = "") => console.log(l);

  say("=================================================");
  say(" JARVIS MORNING BRIEFING");
  say(` ${dayName(today)}`);
  say("=================================================");

  say("\nCOMING UP (next 3 days)\n-----------------------");
  if (a.upcoming.length === 0) say("Nothing dated in the trackers for the next 3 days.");
  a.upcoming.forEach((u) => say(" * " + u));

  say("\nPIPELINE SNAPSHOT\n-----------------");
  say(` Overseas plumbing : ${a.sent} sent, ${a.notSent} not sent, ${a.followUpsDue} follow-ups due, ${a.realReplies} real replies logged`);
  if (a.dateInReply > 0) say(`   (${a.dateInReply} rows have a date in the Reply column - worth checking the tracker)`);
  say(` SA workflow test  : ${a.wfContacted} contacted, ${a.wfQueued} queued, ${a.problems} problems identified (R3+)`);
  say(` Taalhuis schools  : ${a.schoolContacts} outreach rows, ${a.schoolFeedback} feedback entries logged`);

  say("\nHIGH PRIORITY OPEN ACTIONS\n--------------------------");
  if (a.open.length === 0) say("None recorded.");
  a.open.forEach((o) => say(" * " + clip(ascii(o), 130)));

  say("\nYOUR RECENT NOTES\n-----------------");
  if (notes.length === 0) say(' None yet. After each conversation: node jarvis.js log "what they said"');
  notes.slice(-3).forEach((n) => say(` * ${n.when.slice(0, 10)}  ${clip(ascii(n.text), 120)}`));

  say("\nCOFOUNDER CHALLENGE\n-------------------");
  if (a.realReplies === 0 && a.problems === 0 && a.schoolFeedback === 0 && notes.length === 0) {
    say(" No customer evidence is logged yet (no replies, no problems, no feedback, no notes).");
    say(" Today's job is conversations, not building. Log what you learn from each one.");
  } else {
    say(` Evidence so far: ${a.realReplies} replies, ${a.problems} problems, ${a.schoolFeedback} school feedback entries, ${notes.length} notes.`);
    say(" Make sure each conversation ends with a logged next action.");
  }
  if (a.followUpsDue > 0) say(` ${a.followUpsDue} overseas follow-ups are due - batch them in one 30 minute block.`);

  if (warnings.length) {
    say("\nNOTES\n-----");
    warnings.forEach((w) => say(" ! " + w));
  }

  const prompt =
    COMPANY + "\nFACTS:\n" + factsText(a, notes) + "\n\n" +
    "Reply in plain text, under 200 words, with exactly these parts:\n" +
    "1. TOP 3 ACTIONS TODAY (most urgent first)\n" +
    "2. ONE THING I WOULD CHALLENGE\n" +
    "3. A SHORT DRAFT MESSAGE for the most urgent follow-up, written as Zayn, ending with one clear question.";
  await aiSection("JARVIS AI VIEW", prompt);
}

async function cmdAsk(question) {
  if (!question) {
    console.log('Use: node jarvis.js ask "your question"');
    return;
  }
  const today = todaySAST();
  const { data, warnings } = await loadData();
  const a = analyse(data, today);
  const prompt =
    COMPANY + `\nToday is ${dayName(today)}.\n\nFACTS:\n` + factsText(a, readLog()) + "\n\n" +
    `ZAYN ASKS: ${question}\n\n` +
    "Answer in plain text, under 150 words. Be direct. If a fact needed to answer is missing, say what is missing instead of guessing.";
  if (!process.env.GEMINI_API_KEY && !flag("--show-prompt")) {
    console.log("The ask command needs the AI. Set your free key first:  set GEMINI_API_KEY=your-key");
    return;
  }
  warnings.forEach((w) => console.log(" ! " + w));
  await aiSection("JARVIS SAYS", prompt);
}

const STANDARD_QUESTIONS = [
  "What repetitive or manual process costs you the most time, money or missed follow-ups?",
  "How is it handled today, and by whom? Which tools or channels are involved?",
  "How often does the problem happen, and what does it cost when it does?",
  "What would a good outcome look like?",
  "Who decides on something like this, and how does that decision get made?",
  "If we solved it, what would a small pilot be worth to you?"
];

async function cmdPrep(name) {
  if (!name) {
    console.log("Use: node jarvis.js prep NAME      for example: node jarvis.js prep Treverton");
    return;
  }
  const today = todaySAST();
  const { data, warnings } = await loadData();
  const needle = name.toLowerCase();
  const notes = readLog();

  const hits = [];
  for (const [key, rows] of Object.entries(data)) {
    if (key === "productMd") continue;
    for (const row of rows) {
      const vals = Object.values(row);
      if (vals.some((v) => v.toLowerCase().includes(needle))) {
        hits.push(`[${key}] ` + Object.entries(row).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; "));
      }
    }
  }
  const mdHits = data.productMd.split("\n").filter((l) => l.toLowerCase().includes(needle))
    .map((l) => l.replace(/[|#*]/g, " ").replace(/\s+/g, " ").trim());
  const noteHits = notes.filter((n) => n.text.toLowerCase().includes(needle));

  console.log("=================================================");
  console.log(` MEETING PREP: ${name}`);
  console.log(` ${dayName(today)}`);
  console.log("=================================================");

  if (hits.length + mdHits.length + noteHits.length === 0) {
    console.log(`\nNothing found for "${name}" in the trackers or your notes.`);
    console.log("Try another spelling, or log what you know:  node jarvis.js log \"" + name + ": ...\"");
    return;
  }

  console.log("\nWHAT THE TRACKERS SAY\n---------------------");
  hits.slice(0, 6).forEach((h) => console.log(" * " + clip(ascii(h), 300)));
  mdHits.slice(0, 4).forEach((h) => console.log(" * [product tracker] " + clip(ascii(h), 200)));
  if (hits.length > 6) console.log(` (${hits.length - 6} more rows not shown)`);

  if (noteHits.length) {
    console.log("\nYOUR NOTES ON THEM\n------------------");
    noteHits.slice(-5).forEach((n) => console.log(` * ${n.when.slice(0, 10)}  ${clip(ascii(n.text), 200)}`));
  }

  console.log("\nSTANDARD DISCOVERY QUESTIONS\n----------------------------");
  STANDARD_QUESTIONS.forEach((q, i) => console.log(` ${i + 1}. ${q}`));

  console.log("\nAFTER THE MEETING\n-----------------");
  console.log(` node jarvis.js log "${name}: what they said, what they need, agreed next step"`);

  if (warnings.length) warnings.forEach((w) => console.log(" ! " + w));

  const facts =
    "Everything known about " + name + ":\n" +
    hits.slice(0, 8).map((h) => "- " + clip(h, 500)).join("\n") + "\n" +
    mdHits.slice(0, 4).map((h) => "- " + clip(h, 300)).join("\n") + "\n" +
    "Notes Zayn logged:\n" + (noteHits.map((n) => `- ${n.when}: ${n.text}`).join("\n") || "none");
  const prompt =
    COMPANY + `\nToday is ${dayName(today)}.\n\nFACTS:\n${facts}\n\n` +
    "Write meeting prep for Zayn in plain text, under 250 words, with these parts:\n" +
    "1. GOAL of the meeting (one sentence)\n" +
    "2. AGENDA with minute timings (listen first, then show, then ask)\n" +
    "3. SIX QUESTIONS specific to what is known, no generic filler\n" +
    "4. THE ONE NEXT STEP to ask for at the end (a small free pilot or follow-up conversation, not a paid deal)\n" +
    "5. WHAT WE DO NOT KNOW yet\n" +
    "Never invent details that are not in the facts.";
  await aiSection("JARVIS PREP NOTES", prompt);
}

function cmdLog(text) {
  if (!text) {
    const notes = readLog();
    console.log("YOUR NOTES\n----------");
    if (notes.length === 0) console.log('None yet. Save one with: node jarvis.js log "what they said"');
    notes.slice(-10).forEach((n) => console.log(` ${n.when}  ${n.text}`));
    return;
  }
  addLog(text);
  console.log("Saved. It will appear in your next briefing and in prep for that name.");
  console.log("Reminder: copy important feedback into the Taalhuis feedback-log.csv on GitHub too.");
}

function cmdHelp() {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(0, 16).join("\n").replace(/^\/\/ ?/gm, ""));
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const cmd = (args[0] || "brief").toLowerCase();
  const rest = args.slice(1).join(" ").trim();

  if (cmd === "brief") return cmdBrief();
  if (cmd === "ask") return cmdAsk(rest);
  if (cmd === "prep") return cmdPrep(rest);
  if (cmd === "log") return cmdLog(rest);
  if (cmd === "help") return cmdHelp();
  console.log(`Unknown command "${cmd}".`);
  cmdHelp();
}

main().catch((e) => {
  console.error("JARVIS failed:", e.message);
  process.exit(1);
});
