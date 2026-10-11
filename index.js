const fs = require("fs");
const readline = require("readline");
const { exec } = require("child_process");

const memoryFile = "memory.json";
const tasksFile = "tasks.json";
const remindersFile = "reminders.json";
const businessFile = "business.json";

// --------------------------------------------------
// SAFE JSON HELPERS
// --------------------------------------------------

function loadJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
            return fallback;
        }

        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.log(`Could not load ${file}. Using safe defaults.`);
        return fallback;
    }
}

function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function resolveActiveProspect(data, options = {}) {
    const prospects = Array.isArray(data?.prospects) ? data.prospects : [];
    const open = prospects.filter(item => item.status !== "CLOSED");
    const announce = options.announce !== false;
    if (open.length === 0) return null;
    const selectedName = String(data.selectedProspectName || "").trim();
    if (selectedName) {
        const matches = open.filter(item => String(item.name || "").trim().toLowerCase() === selectedName.toLowerCase());
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
            if (announce) console.log("Multiple open prospects share that name. Select a unique name.");
            return null;
        }
    }
    if (open.length === 1) return open[0];
    if (announce) {
        console.log("Multiple open prospects found. Select one first:");
        open.forEach(item => console.log("- " + item.name));
        console.log("Command: select prospect <exact name>");
    }
    return null;
}


function classifyResearchResult(query, title, url) {
    const q = query.toLowerCase();
    const t = (title || "").toLowerCase();
    const u = (url || "").toLowerCase();

    const tokens = q.split(/\s+/).filter(token => token.length >= 4);
    const matches = tokens.filter(token => t.includes(token) || u.includes(token)).length;

    if (matches >= Math.min(2, tokens.length)) return "LIKELY MATCH";
    if (matches === 1) return "NAME COLLISION";
    return "IRRELEVANT";
}
function formatResearchClassification(query, result) {
    const lines = result.split(/\r?\n/);
    const output = [];
    let title = "";
    let url = "";

    for (const line of lines) {
        if (line.startsWith("Title: ")) {
            title = line.slice(7).trim();
        }

        if (line.startsWith("URL: ")) {
            url = line.slice(5).trim();
            const classification = classifyResearchResult(query, title, url);
            output.push("[" + classification + "] " + title);
            output.push("URL: " + url);
            output.push("");
        }
    }

    return output.length ? output.join("\n") : "No structured result titles/URLs detected.";
}
function saveResearchEntry(query, result, prospectName = null) {
    const state = loadJson("cofounder-state.json", {});
    if (!Array.isArray(state.research)) state.research = [];

    state.research.push({
        query,
        result,
        prospectName,
        status: "UNVERIFIED",
        createdAt: new Date().toISOString()
    });

    saveJson("cofounder-state.json", state);
}
function detectCommercialOpportunity(researchEntries) {
    const entries = Array.isArray(researchEntries) ? researchEntries : [];
    const uniqueEntries = [];
    const seenQueries = new Set();

    for (const entry of entries) {
        const queryKey = (entry.query || "").trim().toLowerCase();

        if (seenQueries.has(queryKey)) continue;

        seenQueries.add(queryKey);
        uniqueEntries.push(entry);
    }

    const commercialTerms = [
        "manual",
        "repetitive",
        "workflow",
        "automation",
        "customer enquiries",
        "customer support",
        "administration",
        "spreadsheet",
        "slow response",
        "bottleneck",
        "digital",
        "software",
        "ai",
        "process",
        "staff time",
        "operational"
    ];

    const signals = [];

    for (const entry of uniqueEntries) {
        const text = `${entry.query || ""}\n${entry.result || ""}`.toLowerCase();

        const matches = commercialTerms.filter(term => text.includes(term));

        if (matches.length >= 2) {
            signals.push({
                query: entry.query || "Unknown research query",
                matchedSignals: matches,
                status: entry.status || "UNVERIFIED",
                createdAt: entry.createdAt || null
            });
        }
    }

    return {
        researchItems: entries.length,
        uniqueResearchQueries: uniqueEntries.length,
        commercialSignals: signals.length,
        signals
    };
}
function showCommercialOpportunityDetector() {
    const state = loadJson("cofounder-state.json", {});
    const research = Array.isArray(state.research) ? state.research : [];
    const result = detectCommercialOpportunity(research);

    console.log("\nCOFOUNDER COMMERCIAL OPPORTUNITY DETECTOR");
    console.log("-----------------------------------------");
    console.log("Research items available: " + result.researchItems);
    console.log("Unique research queries: " + result.uniqueResearchQueries);
    console.log("Commercial signals found: " + result.commercialSignals);

    if (result.signals.length === 0) {
        console.log("\nNo sufficiently supported commercial signals found.");
    } else {
        result.signals.forEach((signal, index) => {
            console.log("\n" + (index + 1) + ". Research query: " + signal.query);
            console.log("   Signals: " + signal.matchedSignals.join(", "));
            console.log("   Evidence status: " + signal.status);
            console.log("   Created: " + (signal.createdAt || "Unknown"));
        });
    }

    console.log("\nDETECTOR RULE");
    console.log("Research is evidence for review, not confirmed prospect fact.");
    console.log("No prospect created.");
    console.log("No opportunity created.");
    console.log("No external action taken.");
}
function webResearch(query) {
    return new Promise((resolve, reject) => {
        const args = [
            "/c",
            "mcporter",
            "call",
            "exa.web_search_exa",
            "query=" + query,
            "numResults=5",
            "objective=Find reliable current information relevant to the query. Return useful facts and sources for Cofounder research only."
        ];

        exec("cmd.exe " + args.map(arg => `"${arg.replace(/"/g, '""')}"`).join(" "), (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
                return;
            }

            resolve(stdout);
        });
    });
}
// --------------------------------------------------
// MEMORY
// --------------------------------------------------

let memory = loadJson(memoryFile, []);

function remember(text) {
    if (!text) return;

    memory.push({
        text,
        savedAt: new Date().toISOString()
    });

    saveJson(memoryFile, memory);
    console.log(`JARVIS > Remembered: ${text}`);
}

function showMemory() {
    console.log("\nJARVIS MEMORY");
    console.log("-------------");

    if (memory.length === 0) {
        console.log("No memories stored.");
        return;
    }

    memory.forEach((item, index) => {
        console.log(`${index + 1}. ${item.text}`);
    });
}

// --------------------------------------------------
// TASKS
// --------------------------------------------------

let tasks = loadJson(tasksFile, []);

function addTask(text) {
    if (!text) return;

    tasks.push({
        text,
        completed: false,
        createdAt: new Date().toISOString()
    });

    saveJson(tasksFile, tasks);
    console.log(`JARVIS > Task added: ${text}`);
}

function showTasks() {
    console.log("\nJARVIS TASKS");
    console.log("------------");

    if (tasks.length === 0) {
        console.log("No tasks.");
        return;
    }

    tasks.forEach((task, index) => {
        const status = task.completed ? "DONE" : "OPEN";
        console.log(`${index + 1}. [${status}] ${task.text}`);
    });
}

function completeTask(number) {
    const index = Number(number) - 1;

    if (!Number.isInteger(index) || !tasks[index]) {
        console.log("JARVIS > Task not found.");
        return;
    }

    tasks[index].completed = true;
    saveJson(tasksFile, tasks);

    console.log(`JARVIS > Task completed: ${tasks[index].text}`);
}

function removeTask(number) {
    const index = Number(number) - 1;

    if (!Number.isInteger(index) || !tasks[index]) {
        console.log("JARVIS > Task not found.");
        return;
    }

    const removed = tasks.splice(index, 1)[0];
    saveJson(tasksFile, tasks);

    console.log(`JARVIS > Task removed: ${removed.text}`);
}

// --------------------------------------------------
// REMINDERS
// --------------------------------------------------

let reminders = loadJson(remindersFile, []);

function showReminders() {
    console.log("\nJARVIS REMINDERS");
    console.log("----------------");

    if (reminders.length === 0) {
        console.log("No reminders.");
        return;
    }

    reminders.forEach((reminder, index) => {
        const reminderTime = reminder.time || reminder.dueAt;
        const status = reminder.fired ? "FIRED" : "OPEN";

        console.log(
            `${index + 1}. [${status}] ${reminder.message} | ${new Date(reminderTime).toLocaleString()}`
        );
    });
}

function checkReminders() {
    reminders.forEach((reminder) => {
        const reminderTime = reminder.time || reminder.dueAt;

        if (!reminder.fired && reminderTime && Date.now() >= reminderTime) {
            console.log(
                `\nJARVIS REMINDER: ${reminder.message}\n`
            );

            reminder.fired = true;
            saveJson(remindersFile, reminders);
        }
    });
}

// Reminder checks should not keep an otherwise-idle CLI or test process alive.
const reminderInterval = setInterval(checkReminders, 1000);
reminderInterval.unref();

// --------------------------------------------------
// PROJECT BRAIN
// --------------------------------------------------

const projects = {
    ZAYZANA: {
        name: "Zayzana Tech",
        description:
            "Umbrella technology company. We find. We build. We solve.",
        status: "Active",
        link: "https://syedzayn296-ops.github.io/zayzana-tech/"
    },

    FISHING: {
        name: "Fishing Logbook",
        description:
            "South African fishing logbook and fish guide.",
        status: "Feedback and release validation",
        link: "https://syedzayn296-ops.github.io/Fishing---logbook/"
    },

    TAALHUIS: {
        name: "Taalhuis",
        description:
            "School-facing Afrikaans and education learning platform.",
        status: "Teacher and school validation",
        link: "https://syedzayn296-ops.github.io/Taalhuis-/"
    },

    SIZANI: {
        name: "Sizani",
        description:
            "Simple smartphone help for South African 50+ users.",
        status: "Buyer validation",
        link: "https://syedzayn296-ops.github.io/zayzana-command-centre/sizani/"
    },

    JARVIS: {
        name: "JARVIS",
        description:
            "Zayzana's local personal business assistant and agent foundation.",
        status: "Step 18 - Prospect Intelligence",
        link: ""
    },

    TAKE_N_PAY: {
        name: "Take n Pay",
        description:
            "Potential client opportunity and customer-journey demonstration.",
        status: "Future client experiment",
        link: ""
    }
};

function detectProject(text) {
    const lower = text.toLowerCase();

    if (lower.includes("fishing")) return "FISHING";
    if (lower.includes("taalhuis")) return "TAALHUIS";
    if (lower.includes("sizani")) return "SIZANI";
    if (lower.includes("zayzana")) return "ZAYZANA";
    if (lower.includes("take n pay")) return "TAKE_N_PAY";
    if (lower.includes("jarvis")) return "JARVIS";

    return null;
}

function showProject(key) {
    const project = projects[key];

    if (!project) {
        console.log("JARVIS > Project not found.");
        return;
    }

    console.log(`\n${project.name}`);
    console.log("----------------");
    console.log(`Description: ${project.description}`);
    console.log(`Status: ${project.status}`);

    if (project.link) {
        console.log(`Live link: ${project.link}`);
    }
}

// --------------------------------------------------
// WEBSITE / APPLICATION OPENING
// --------------------------------------------------

const websites = {
    fishing: "https://syedzayn296-ops.github.io/Fishing---logbook/",
    taalhuis: "https://syedzayn296-ops.github.io/Taalhuis-/",
    sizani:
        "https://syedzayn296-ops.github.io/zayzana-command-centre/sizani/",
    zayzana: "https://syedzayn296-ops.github.io/zayzana-tech/",
    github: "https://github.com/"
};

function openWebsite(name) {
    const url = websites[name];

    if (!url) {
        console.log("JARVIS > Website not found.");
        return;
    }

    console.log(`JARVIS > Opening ${name}.`);
    exec(`start "" "${url}"`);
}

// --------------------------------------------------
// BUSINESS BRAIN
// --------------------------------------------------

let business = loadJson(businessFile, {
    prospects: [],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
});

function showBusinessOverview() {
    console.log("\nJARVIS BUSINESS BRAIN");
    console.log("---------------------");
    console.log(`Prospects: ${business.prospects.length}`);
    console.log(`Opportunities: ${business.opportunities.length}`);
    console.log(`Offers: ${business.offers.length}`);
    console.log(`Follow-ups: ${business.followUps.length}`);
    console.log(`Revenue records: ${business.revenue.length}`);
}

function addProspect(name, details = "") {
    if (!name) return;

    business.prospects.push({
        name,
        details,
        status: "NEW",
        createdAt: new Date().toISOString()
    });

    saveJson(businessFile, business);

    console.log(`JARVIS > Prospect added: ${name}`);
}

function showProspects() {
    console.log("\nJARVIS PROSPECTS");
    console.log("----------------");

    if (business.prospects.length === 0) {
        console.log("No prospects.");
        return;
    }

    business.prospects.forEach((prospect, index) => {
        console.log(
            `${index + 1}. ${prospect.name} [${prospect.status}]`
        );
    });
}

function addOpportunity(text) {
    if (!text) return;

    business.opportunities.push({
        text,
        status: "OPEN",
        createdAt: new Date().toISOString()
    });

    saveJson(businessFile, business);

    console.log(`JARVIS > Opportunity recorded: ${text}`);
}

function showOpportunities() {
    console.log("\nJARVIS OPPORTUNITIES");
    console.log("--------------------");

    if (business.opportunities.length === 0) {
        console.log("No opportunities.");
        return;
    }

    business.opportunities.forEach((item, index) => {
        console.log(
            `${index + 1}. [${item.status}] ${item.text}`
        );
    });
}

function addOffer(text) {
    if (!text) return;

    business.offers.push({
        text,
        status: "AVAILABLE",
        createdAt: new Date().toISOString()
    });

    saveJson(businessFile, business);

    console.log(`JARVIS > Offer recorded: ${text}`);
}

function showOffers() {
    console.log("\nJARVIS OFFERS");
    console.log("-------------");

    if (business.offers.length === 0) {
        console.log("No offers.");
        return;
    }

    business.offers.forEach((item, index) => {
        console.log(
            `${index + 1}. [${item.status}] ${item.text}`
        );
    });
}

function addFollowUp(text) {
    if (!text) return;

    business.followUps.push({
        text,
        status: "OPEN",
        createdAt: new Date().toISOString()
    });

    saveJson(businessFile, business);

    console.log(`JARVIS > Follow-up recorded: ${text}`);
}

function showFollowUps() {
    console.log("\nJARVIS FOLLOW-UPS");
    console.log("-----------------");

    if (business.followUps.length === 0) {
        console.log("No follow-ups.");
        return;
    }

    business.followUps.forEach((item, index) => {
        console.log(
            `${index + 1}. [${item.status}] ${item.text}`
        );
    });
}

function addRevenue(amount, description) {
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount)) {
        console.log("JARVIS > Revenue amount must be a number.");
        return;
    }

    business.revenue.push({
        amount: numericAmount,
        description: description || "",
        recordedAt: new Date().toISOString()
    });

    saveJson(businessFile, business);

    console.log(
        `JARVIS > Revenue recorded: Amount ${numericAmount} | ${description || "No description"}`
    );
}

function showRevenue() {
    console.log("\nJARVIS REVENUE");
    console.log("--------------");

    if (business.revenue.length === 0) {
        console.log("No revenue recorded.");
        return;
    }

    let total = 0;

    business.revenue.forEach((item, index) => {
        total += Number(item.amount) || 0;

        console.log(
            `${index + 1}. Amount ${item.amount} | ${item.description || "No description"}`
        );
    });

    console.log(`\nTotal recorded revenue: ${total}`);
}

// --------------------------------------------------
// STEP 15: ACTION BRAIN
// --------------------------------------------------

function showActionBrain() {
    console.log("\nJARVIS ACTION BRAIN");
    console.log("-------------------");

    const openProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

    const activeProspect = resolveActiveProspect(business, { announce: false });

    const openOpportunities = business.opportunities.filter(
        (item) => item.status === "OPEN"
    );

    const availableOffers = business.offers.filter(
        (item) => item.status === "AVAILABLE"
    );

    const openFollowUps = business.followUps.filter(
        (item) => item.status === "OPEN"
    );

    const totalRevenue = business.revenue.reduce(
        (sum, item) => sum + (Number(item.amount) || 0),
        0
    );

    console.log(`Prospects needing attention: ${openProspects.length}`);
    console.log(`Open opportunities: ${openOpportunities.length}`);
    console.log(`Available offers: ${availableOffers.length}`);
    console.log(`Open follow-ups: ${openFollowUps.length}`);
    console.log(`Recorded revenue: ${totalRevenue}`);

    console.log("\nNEXT ACTION");

    if (openFollowUps.length > 0) {
        console.log(
            `Follow up: ${openFollowUps[0].text}`
        );
        return;
    }

    if (activeProspect) {
        console.log(`Work the selected prospect: ${activeProspect.name}`);
        return;
    }

    if (openProspects.length > 1) {
        console.log("Select a prospect before choosing the next prospect-specific action.");
        console.log("Command: select prospect <exact name>");
        return;
    }

    if (openOpportunities.length > 0) {
        console.log(
            `Develop the open opportunity: ${openOpportunities[0].text}`
        );
        return;
    }

    if (availableOffers.length > 0) {
        console.log(
            `Use the available offer: ${availableOffers[0].text}`
        );
        return;
    }

    console.log(
        "No immediate business action found. Add a prospect, opportunity, offer or follow-up."
    );
}

function showBusinessPriorities() {
    console.log("\nJARVIS BUSINESS PRIORITIES");
    console.log("--------------------------");

    const openFollowUps = business.followUps.filter(
        (item) => item.status === "OPEN"
    );

    const openProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

    const activeProspect = resolveActiveProspect(business, { announce: false });

    const openOpportunities = business.opportunities.filter(
        (item) => item.status === "OPEN"
    );

    if (openFollowUps.length > 0) {
        console.log(
            `1. Follow-up: ${openFollowUps[0].text}`
        );
    } else {
        console.log("1. No open follow-up.");
    }

    if (activeProspect) {
        console.log(`2. Selected prospect: ${activeProspect.name}`);
    } else if (openProspects.length > 0) {
        console.log("2. Selection required: use select prospect <exact name>.");
    } else {
        console.log("2. No active prospects.");
    }

    if (openOpportunities.length > 0) {
        console.log(
            `3. Opportunity: ${openOpportunities[0].text}`
        );
    } else {
        console.log("3. No open opportunities.");
    }
}

// --------------------------------------------------
// STEP 16: ZAYZANA OPERATING BRAIN
// --------------------------------------------------

function showOperatingBrain() {
    console.log("\nJARVIS ZAYZANA OPERATING BRAIN");
    console.log("-------------------------------");

    const openFollowUps = business.followUps.filter(
        (item) => item.status === "OPEN"
    );

    const openProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

    const activeProspect = resolveActiveProspect(business, { announce: false });

    const openOpportunities = business.opportunities.filter(
        (item) => item.status === "OPEN"
    );

    const availableOffers = business.offers.filter(
        (item) => item.status === "AVAILABLE"
    );

    const totalRevenue = business.revenue.reduce(
        (sum, item) => sum + (Number(item.amount) || 0),
        0
    );

    console.log("\nZAYZANA OPERATING PRINCIPLES");
    console.log("----------------------------");

    console.log("1. MAKE MONEY");
    if (
        openFollowUps.length > 0 ||
        openProspects.length > 0 ||
        openOpportunities.length > 0
    ) {
        console.log("Status: ACTIVE");
        console.log(
            `Commercial pipeline: ${openProspects.length} prospect(s), ${openOpportunities.length} opportunity(ies), ${openFollowUps.length} follow-up(s).`
        );
    } else {
        console.log("Status: NEEDS INPUT");
        console.log("Add prospects, opportunities or follow-ups.");
    }

    console.log("\n2. CREATE OWNED ASSET");
    if (availableOffers.length > 0) {
        console.log("Status: ACTIVE");
        console.log(
            `Reusable offer available: ${availableOffers[0].text}`
        );
    } else {
        console.log("Status: NEEDS DEVELOPMENT");
        console.log(
            "Turn a repeated client problem into a reusable offer or product."
        );
    }

    console.log("\n3. MAKE NEXT OPPORTUNITY EASIER");
    if (openOpportunities.length > 0) {
        console.log("Status: ACTIVE");
        console.log(
            `Current opportunity: ${openOpportunities[0].text}`
        );
    } else {
        console.log("Status: NEEDS INPUT");
        console.log(
            "Record the next opportunity or business problem discovered."
        );
    }

    console.log("\nRECORDED REVENUE");
    console.log(totalRevenue);

    console.log("\nOPERATING RECOMMENDATION");

    if (openFollowUps.length > 0) {
        console.log(
            `1. Execute the open follow-up: ${openFollowUps[0].text}`
        );
        console.log(
            "2. Convert the conversation into a concrete commercial opportunity."
        );
        console.log(
            "3. Capture anything reusable from the solution as an owned asset."
        );
        return;
    }

    if (activeProspect) {
        console.log(`1. Work the selected prospect: ${activeProspect.name}`);
        console.log("2. Identify the business problem.");
        console.log("3. Match it to a Zayzana offer.");
        console.log("4. Capture reusable components from the solution.");
        return;
    }

    if (openProspects.length > 1) {
        console.log("Select a prospect before choosing the next prospect-specific action.");
        console.log("Command: select prospect <exact name>");
        return;
    }

    if (openOpportunities.length > 0) {
        console.log(
            `1. Develop the opportunity: ${openOpportunities[0].text}`
        );
        console.log(
            "2. Define a paid solution."
        );
        console.log(
            "3. Identify what can become reusable."
        );
        return;
    }

    if (availableOffers.length > 0) {
        console.log(
            `1. Take the available offer to market: ${availableOffers[0].text}`
        );
        console.log(
            "2. Find a suitable prospect."
        );
        return;
    }

    console.log(
        "1. Find a real business problem."
    );
    console.log(
        "2. Record it as an opportunity."
    );
    console.log(
        "3. Build only after the problem is validated."
    );
}

// --------------------------------------------------
// STEP 17: OPPORTUNITY ACTION BRAIN
// --------------------------------------------------

function showOpportunityAction() {
    console.log("\nJARVIS OPPORTUNITY ACTION BRAIN");
    console.log("-------------------------------");

    const openFollowUps = business.followUps.filter(
        (item) => item.status === "OPEN"
    );

    const openProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

    const activeProspect = resolveActiveProspect(business, { announce: false });

    const openOpportunities = business.opportunities.filter(
        (item) => item.status === "OPEN"
    );

    const availableOffers = business.offers.filter(
        (item) => item.status === "AVAILABLE"
    );

    console.log("\nCURRENT BUSINESS STATE");
    console.log("----------------------");

    console.log(`Open follow-ups: ${openFollowUps.length}`);
    console.log(`Open prospects: ${openProspects.length}`);
    console.log(`Open opportunities: ${openOpportunities.length}`);
    console.log(`Available offers: ${availableOffers.length}`);

    console.log("\nNEXT COMMERCIAL ACTION");
    console.log("----------------------");

    if (openFollowUps.length > 0) {
        console.log(
            `1. Complete the follow-up: ${openFollowUps[0].text}`
        );
        console.log(
            "2. Identify the prospect's specific business problem."
        );
        console.log(
            "3. Match that problem to a Zayzana solution."
        );
        console.log(
            "4. Record the opportunity in JARVIS."
        );
        console.log(
            "5. Capture anything reusable for future clients."
        );
        return;
    }

    if (activeProspect) {
        console.log(`1. Contact the selected prospect: ${activeProspect.name}`);
        console.log("2. Discover the business problem.");
        console.log("3. Match the problem to a Zayzana offer.");
        console.log("4. Record the opportunity.");
        return;
    }

    if (openProspects.length > 1) {
        console.log("Select a prospect before choosing the next prospect-specific action.");
        console.log("Command: select prospect <exact name>");
        return;
    }

    if (openOpportunities.length > 0) {
        console.log(
            `1. Develop the opportunity: ${openOpportunities[0].text}`
        );
        console.log(
            "2. Define the paid solution."
        );
        console.log(
            "3. Prepare the next client action."
        );
        console.log(
            "4. Identify reusable components."
        );
        return;
    }

    if (availableOffers.length > 0) {
        console.log(
            `1. Take this offer to market: ${availableOffers[0].text}`
        );
        console.log(
            "2. Find a suitable prospect."
        );
        console.log(
            "3. Start the conversation."
        );
        return;
    }

    console.log(
        "1. Find a real business problem."
    );
    console.log(
        "2. Record it as an opportunity."
    );
    console.log(
        "3. Build only after validation."
    );
}

// --------------------------------------------------
// ZAYZANA FOCUS
// --------------------------------------------------

function showZayzanaFocus() {
    console.log("\nJARVIS ZAYZANA FOCUS");
    console.log("--------------------");

    const openFollowUps = business.followUps.filter(
        (item) => item.status === "OPEN"
    );

    const openProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

    const activeProspect = resolveActiveProspect(business, { announce: false });

    const openOpportunities = business.opportunities.filter(
        (item) => item.status === "OPEN"
    );

    if (openFollowUps.length > 0) {
        console.log(
            `CURRENT FOCUS: Follow-up | ${openFollowUps[0].text}`
        );
        return;
    }

    if (activeProspect) {
        console.log(`CURRENT FOCUS: Selected prospect | ${activeProspect.name}`);
        return;
    }

    if (openProspects.length > 1) {
        console.log("CURRENT FOCUS: Select a prospect before choosing prospect-specific work.");
        console.log("Command: select prospect <exact name>");
        return;
    }

    if (openOpportunities.length > 0) {
        console.log(
            `CURRENT FOCUS: Opportunity | ${openOpportunities[0].text}`
        );
        return;
    }

    console.log(
        "CURRENT FOCUS: Find and record the next real business opportunity."
    );
}

// --------------------------------------------------
// STEP 18: PROSPECT INTELLIGENCE
// --------------------------------------------------

function showProspectIntelligence() {
    console.log("\nJARVIS PROSPECT INTELLIGENCE");
    console.log("----------------------------");

    const activeProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

    if (activeProspects.length === 0) {
        console.log("\nNo active prospects.");
        console.log(
            "Add a prospect before running Prospect Intelligence."
        );
        return;
    }

    const prospect = resolveActiveProspect(business);
    if (!prospect) return;

    console.log("\nCURRENT PROSPECT");
    console.log("----------------");
    console.log(`Name: ${prospect.name}`);
    console.log(`Status: ${prospect.status}`);

    console.log("\nWHAT WE KNOW");
    console.log("------------");

    if (prospect.details && prospect.details.trim()) {
        console.log(prospect.details);
    } else {
        console.log(
            "No detailed business information recorded yet."
        );
    }

    console.log("\nWHAT WE DO NOT KNOW");
    console.log("-------------------");
    console.log("1. What specific business problem are they experiencing?");
    console.log("2. How is that problem affecting their business?");
    console.log("3. What are they currently doing to solve it?");
    console.log("4. What would a successful solution look like?");
    console.log("5. Who makes the buying decision?");
    console.log("6. What budget or commercial constraint exists?");

    console.log("\nPROBLEM HYPOTHESIS");
    console.log("------------------");

    if (prospect.details && prospect.details.trim()) {
        console.log(
            "Use the recorded prospect details to form a testable problem hypothesis."
        );
    } else {
        console.log(
            "INSUFFICIENT INFORMATION: do not assume the prospect's problem."
        );
    }

    console.log("\nPOSSIBLE ZAYZANA FIT");
    console.log("--------------------");
    console.log(
        "Potential areas: AI automation, business process automation, customer support tools, internal tools, websites or lightweight software solutions."
    );
    console.log(
        "Fit must be confirmed against the prospect's actual problem."
    );

    console.log("\nNEXT DISCOVERY ACTION");
    console.log("---------------------");
    console.log(
        "Ask the prospect what business process is currently costing them the most time, money or repeated manual effort."
    );

    const state = loadJson("cofounder-state.json", {});
    const research = Array.isArray(state.research) ? state.research : [];
    const prospectResearch = research.filter((entry) =>
        entry.prospectName === prospect.name
    );

    console.log("\nEVIDENCE");
    console.log("--------");
    if (prospectResearch.length === 0) {
        console.log("EVIDENCE: INSUFFICIENT");
    } else {
        prospectResearch.slice(-5).forEach((entry) => {
            console.log("- " + (entry.result || entry.query || "Research available"));
        });
    }

    const researchText = prospectResearch
        .map((entry) => `${entry.query || ""}\n${entry.result || ""}`)
        .join("\n")
        .toLowerCase();

    const matchedSignals = [
        "website",
        "whatsapp",
        "24/7",
        "customer enquiries",
        "customer support",
        "digital"
    ].filter((term) => researchText.includes(term));

    console.log("\nCOMMERCIAL SIGNALS:");
    if (matchedSignals.length === 0) {
        console.log("UNKNOWN");
    } else {
        matchedSignals.forEach((signal) => console.log("- " + signal));
    }

    console.log("\nHYPOTHESES:");
    if (researchText.includes("whatsapp")) {
        console.log("- Manual enquiry handling may consume staff time (HYPOTHESIS)");
        console.log("- Lead follow-up may be inconsistent (HYPOTHESIS)");
    } else {
        console.log("UNKNOWN");
    }

    console.log("\nUNKNOWN:");
    console.log("- Budget");
    console.log("- Timeline");
    console.log("- Confirmed business impact");
    console.log("- Expected return");

    console.log("\nJUDGEMENT: " + (prospectResearch.length === 0 ? "NOT ENOUGH EVIDENCE" : "INVESTIGATE"));
    console.log("External action: BLOCKED");
    console.log("\nJARVIS RULE");
    console.log("--------------------");
    console.log(
        "Do not invent facts about the prospect. Discover first, propose second."
    );
}

// --------------------------------------------------
 // --------------------------------------------------
    // STEP 19: PROSPECT DISCOVERY
 // --------------------------------------------------

 function showProspectWorkspace() {
    const businessData = loadJson("./business.json", {
        prospects: [],
        opportunities: [],
        offers: [],
        followUps: [],
        revenue: []
    });

    const prospect = resolveActiveProspect(businessData);

    console.log("\nJARVIS PROSPECT WORKSPACE");
    console.log("-------------------------");

    if (!prospect) {
        console.log("No active prospect found.");
        return;
    }

    console.log("IDENTITY");
    console.log("Name:", prospect.name);
    console.log("Status:", prospect.status || "UNKNOWN");
    console.log("Details:", prospect.details || "Not recorded");

    console.log("\nRESEARCH");
    if (prospect.research) {
        console.log(
            "Facts:",
            prospect.research.facts?.length
                ? prospect.research.facts.join(" | ")
                : "None recorded"
        );
        console.log(
            "Sources:",
            prospect.research.sources?.length
                ? prospect.research.sources.join(" | ")
                : "None recorded"
        );
        console.log(
            "Unknowns:",
            prospect.research.unknowns?.length
                ? prospect.research.unknowns.join(" | ")
                : "None recorded"
        );
    } else {
        console.log("Research layer not yet populated.");
    }

    console.log("\nDISCOVERY");
    const discovery = prospect.discovery || {};
    const fields = [
        ["Problem", discovery.problem],
        ["Impact", discovery.impact],
        ["Current solution", discovery.currentSolution],
        ["Desired outcome", discovery.desiredOutcome],
        ["Decision maker", discovery.decisionMaker],
        ["Budget", discovery.budget],
        ["Timeline", discovery.timeline],
        ["Notes", discovery.notes]
    ];

    for (const [label, value] of fields) {
        console.log(label + ":", value || "Not recorded");
    }

    console.log("\nEVIDENCE CHECK");
    const evidenceIssues = [];

    if (
        discovery.impact &&
        discovery.desiredOutcome &&
        /\d+/.test(discovery.impact) &&
        /\d+/.test(discovery.desiredOutcome)
    ) {
        const impactNumber = Number(discovery.impact.match(/\d+/)?.[0]);
        const outcomeNumber = Number(discovery.desiredOutcome.match(/\d+/)?.[0]);

        if (
            Number.isFinite(impactNumber) &&
            Number.isFinite(outcomeNumber) &&
            /hour/i.test(discovery.impact) &&
            /hour/i.test(discovery.desiredOutcome) &&
            outcomeNumber > impactNumber
        ) {
            evidenceIssues.push(
                "Desired outcome records more hours than current impact; verify whether this is intentional."
            );
        }
    }

    if (evidenceIssues.length) {
        for (const issue of evidenceIssues) {
            console.log("FLAG:", issue);
        }

        console.log("\nEVIDENCE RESOLUTION REQUIRED");
        console.log("Review the flagged discovery value before a recommendation can be generated.");
        console.log("Use the existing discovery command to correct it:");
        console.log("discovery impact <correct value>");
        console.log("or");
        console.log("discovery outcome <correct value>");
    } else {
        console.log("No obvious discovery consistency issues detected.");
    }

    console.log("\nOFFER FIT");
    const problemText = String(discovery.problem || "").toLowerCase();
    const currentSolutionText = String(discovery.currentSolution || "").toLowerCase();
    const combinedEvidence = problemText + " " + currentSolutionText;

    let fitStatus = "UNKNOWN";
    let fitReason = "Not enough evidence to map the prospect to a current Zayzana capability.";

    if (
        /manual|enquir|admin|staff time|repetitive|phone and email|email/.test(combinedEvidence)
    ) {
        fitStatus = "FIT";
        fitReason = "Evidence points to a manual business-support or AI/digital-tool opportunity.";
    }

    console.log("Status:", fitStatus);
    console.log("Reason:", fitReason);

    if (fitStatus === "FIT") {
        console.log("Capability:", "AI & Digital Tools");
        console.log("Evidence:", "Manual customer enquiries are consuming staff time.");
    }

    console.log("Gap:", "Exact enquiry volume, channels, response workflow and automation requirements are not yet verified.");
    console.log("Unknown:", "No evidence yet confirms which Zayzana implementation would be the best commercial route.");

    console.log("\nRECOMMENDATION GATE");
    const recommendationBlockers = [];

    if (evidenceIssues.length > 0) {
        recommendationBlockers.push("Discovery evidence contains unresolved consistency issues.");
    }

    if (!discovery.problem) {
        recommendationBlockers.push("Problem is not recorded.");
    }

    if (!discovery.impact) {
        recommendationBlockers.push("Impact is not recorded.");
    }

    if (!discovery.desiredOutcome) {
        recommendationBlockers.push("Desired outcome is not recorded.");
    }

    if (fitStatus !== "FIT") {
        recommendationBlockers.push("No confirmed Zayzana capability fit.");
    }

    if (recommendationBlockers.length) {
        console.log("Status:", "BLOCKED");
        console.log("Reason:", "Recommendation requires stronger evidence before a solution is proposed.");
        recommendationBlockers.forEach((item, index) => {
            console.log((index + 1) + ".", item);
        });
    } else {
        console.log("Status:", "READY FOR REVIEW");
        console.log("Reason:", "Core evidence is present and no unresolved recommendation blockers were detected.");
    }

    console.log("\nRECOMMENDATION");

    if (recommendationBlockers.length) {
        console.log("Status:", "NOT GENERATED");
        console.log("Reason:", "Recommendation remains blocked until the evidence issues are resolved.");
    } else {
        const recommendation = {
            service: "AI & Digital Tools",
            proposal: "Explore an enquiry-handling workflow that reduces manual staff effort.",
            why: "The prospect reports that customer enquiries are consuming staff time.",
            evidence: [
                discovery.problem,
                discovery.impact,
                discovery.currentSolution,
                discovery.desiredOutcome
            ].filter(Boolean),
            confidence: "MEDIUM",
            nextAction: "Confirm enquiry volume, channels, workflow, desired response process and commercial constraints.",
            approval: "PENDING ZAYN APPROVAL"
        };

        console.log("Status:", "READY FOR REVIEW");
        console.log("Service:", recommendation.service);
        console.log("Proposal:", recommendation.proposal);
        console.log("Why:", recommendation.why);
        console.log("Confidence:", recommendation.confidence);
        console.log("Next action:", recommendation.nextAction);
        console.log("Approval:", recommendation.approval);
    }

    console.log("\nQUALIFICATION");
    if (prospect.qualification) {
        console.log("Status:", prospect.qualification.status || "Not qualified");
        console.log("Checked:", prospect.qualification.checkedAt || "Not checked");
        console.log(
            "Missing:",
            prospect.qualification.missing?.length
                ? prospect.qualification.missing.join(" | ")
                : "None recorded"
        );
    } else {
        console.log("Not yet qualified.");
    }

    console.log("\nCOMMERCIAL PIPELINE");
    console.log(
        "Open opportunities:",
        businessData.opportunities.filter(item => item.status !== "CLOSED").length
    );
    console.log(
        "Available offers:",
        businessData.offers.filter(item => item.status !== "CLOSED").length
    );
    console.log(
        "Open follow-ups:",
        businessData.followUps.filter(item => item.status !== "CLOSED").length
    );
    console.log(
        "Recorded revenue:",
        businessData.revenue.reduce(
            (sum, item) => sum + (Number(item.amount) || 0),
            0
        )
    );

    console.log("\nNEXT STAGE");
    if (!prospect.discovery || !prospect.qualification) {
        console.log("Discovery");
    } else if (prospect.qualification.status !== "QUALIFIED") {
        console.log("Qualification");
    } else {
        console.log("Offer Fit / Recommendation");
    }

    console.log("\nRULE");
    console.log(
        "Evidence first. Qualification second. Recommendation third. Approval before consequential action."
    );
}

function showProspectDiscovery() {
     console.log("\nJARVIS PROSPECT DISCOVERY");
     console.log("-------------------------");

     const activeProspects = business.prospects.filter(
         (item) => item.status !== "CLOSED"
     );

     if (activeProspects.length === 0) {
         console.log("\nNo active prospects.");
         console.log("Add a prospect before running Prospect Discovery.");
         return;
     }

     const prospect = resolveActiveProspect(business);
    if (!prospect) return;

     if (!prospect.discovery) {
         prospect.discovery = {
             problem: "",
             impact: "",
             currentSolution: "",
             desiredOutcome: "",
             decisionMaker: "",
             budget: "",
             timeline: "",
             notes: ""
         };

         saveJson(businessFile, business);
     }

     const d = prospect.discovery;

     console.log("\nCURRENT PROSPECT");
     console.log("----------------");
     console.log(`Name: ${prospect.name}`);
     console.log(`Status: ${prospect.status}`);

     console.log("\nDISCOVERY STATUS");
     console.log("----------------");
     console.log(`Problem: ${d.problem || "NOT DISCOVERED"}`);
     console.log(`Impact: ${d.impact || "NOT DISCOVERED"}`);
     console.log(`Current solution: ${d.currentSolution || "NOT DISCOVERED"}`);
     console.log(`Desired outcome: ${d.desiredOutcome || "NOT DISCOVERED"}`);
     console.log(`Decision maker: ${d.decisionMaker || "NOT DISCOVERED"}`);
     console.log(`Budget: ${d.budget || "NOT DISCOVERED"}`);
     console.log(`Timeline: ${d.timeline || "NOT DISCOVERED"}`);
     console.log(`Notes: ${d.notes || "NONE"}`);

     console.log("\nNEXT DISCOVERY QUESTIONS");
     console.log("------------------------");
     console.log("1. What problem are you trying to solve?");
     console.log("2. What is that problem costing you in time, money or effort?");
     console.log("3. How are you handling it today?");
     console.log("4. What would a successful outcome look like?");
     console.log("5. Who makes the buying decision?");
     console.log("6. Is there a budget or commercial constraint?");
     console.log("7. When would you want this solved?");

     const state = loadJson("cofounder-state.json", {});
    const research = Array.isArray(state.research) ? state.research : [];
    const prospectResearch = research.filter((entry) =>
        entry.prospectName === prospect.name
    );

    console.log("\nEVIDENCE");
    console.log("--------");
    if (prospectResearch.length === 0) {
        console.log("EVIDENCE: INSUFFICIENT");
    } else {
        prospectResearch.slice(-5).forEach((entry) => {
            console.log("- " + (entry.result || entry.query || "Research available"));
        });
    }

    const researchText = prospectResearch
        .map((entry) => `${entry.query || ""}\n${entry.result || ""}`)
        .join("\n")
        .toLowerCase();

    const matchedSignals = [
        "website",
        "whatsapp",
        "24/7",
        "customer enquiries",
        "customer support",
        "digital"
    ].filter((term) => researchText.includes(term));

    console.log("\nCOMMERCIAL SIGNALS:");
    if (matchedSignals.length === 0) {
        console.log("UNKNOWN");
    } else {
        matchedSignals.forEach((signal) => console.log("- " + signal));
    }

    console.log("\nHYPOTHESES:");
    if (researchText.includes("whatsapp")) {
        console.log("- Manual enquiry handling may consume staff time (HYPOTHESIS)");
        console.log("- Lead follow-up may be inconsistent (HYPOTHESIS)");
    } else {
        console.log("UNKNOWN");
    }

    console.log("\nUNKNOWN:");
    console.log("- Budget");
    console.log("- Timeline");
    console.log("- Confirmed business impact");
    console.log("- Expected return");

    console.log("\nJUDGEMENT: " + (prospectResearch.length === 0 ? "NOT ENOUGH EVIDENCE" : "INVESTIGATE"));
    console.log("External action: BLOCKED");
    console.log("\nJARVIS RULE");
     console.log("--------------------");
     console.log("Discover first. Qualify second. Recommend third. Execute only after Zayn approves.");
 }

// SMART UNDERSTANDING
// --------------------------------------------------

function smartUnderstand(input) {
    const lower = input.toLowerCase();

    if (
        lower.includes("prospect intelligence") ||
        lower.includes("prospect analysis") ||
        lower.includes("what do we know about the prospect") ||
        lower.includes("what do we know about this prospect") ||
        lower.includes("what do we need to find out") ||
        lower.includes("how can zayzana help this prospect") ||
        lower.includes("what should we ask the prospect")
    ) {
        return "PROSPECT_INTELLIGENCE";
    }

    if (
        lower.includes("operating brain") ||
        lower.includes("zayzana strategy") ||
        lower.includes("zayzana operating") ||
        lower.includes("how is zayzana doing") ||
        lower.includes("how are we doing") ||
        lower.includes("business strategy")
    ) {
        return "OPERATING";
    }

    if (
        lower.includes("zayzana focus") ||
        lower.includes("what is the focus") ||
        lower.includes("what should zayzana focus on") ||
        lower.includes("what should zayzayna focus on") ||
        lower.includes("where should we focus")
    ) {
        return "FOCUS";
    }

    if (
        lower.includes("action brain") ||
        lower.includes("what should i do") ||
        lower.includes("what should we do") ||
        lower.includes("next action") ||
        lower.includes("next step") ||
        lower.includes("what next")
    ) {
        return "ACTION";
    }

    if (
        lower.includes("priorities") ||
        lower.includes("business priorities")
    ) {
        return "PRIORITIES";
    }

    if (
        lower === "business" ||
        lower === "business brain" ||
        lower.includes("business overview") ||
        lower.includes("show business")
    ) {
        return "BUSINESS";
    }

    if (
        lower.includes("prospect") ||
        lower.includes("client") ||
        lower.includes("customer") ||
        lower.includes("lead")
    ) {
        return "BUSINESS";
    }

    if (lower.includes("opportunit")) {
        return "BUSINESS";
    }

    if (
        lower.includes("offer") ||
        lower.includes("sell")
    ) {
        return "BUSINESS";
    }

    if (
        lower.includes("follow up") ||
        lower.includes("follow-up")
    ) {
        return "BUSINESS";
    }

    if (
        lower.includes("revenue") ||
        lower.includes("money")
    ) {
        return "BUSINESS";
    }

    return null;
}

// --------------------------------------------------
// DECISION LAYER
// --------------------------------------------------

function decide(input) {
    const lower = input.toLowerCase();

    if (
        lower.startsWith("continue with ") ||
        lower.startsWith("work on ")
    ) {
        const projectKey = detectProject(input);

        if (projectKey) {
            console.log(
                `Decision: WORK_ON | ${projectKey}`
            );

            console.log(
                `Let's work on ${projects[projectKey].name}.`
            );

            if (projects[projectKey].link) {
                openWebsite(
                    projectKey === "FISHING"
                        ? "fishing"
                        : projectKey === "TAALHUIS"
                        ? "taalhuis"
                        : projectKey === "SIZANI"
                        ? "sizani"
                        : projectKey === "ZAYZANA"
                        ? "zayzana"
                        : ""
                );
            }

            return true;
        }
    }

    return false;
}

function worldModel() {
    const state = loadJson("cofounder-state.json", {});
    const currentBusiness = loadJson(businessFile, {
        prospects: [],
        opportunities: [],
        offers: [],
        followUps: [],
        revenue: []
    });

    const research = Array.isArray(state.research) ? state.research : [];
    const facts = Array.isArray(state.facts) ? state.facts : [];
    const goals = Array.isArray(state.goals) ? state.goals : [];
    const decisions = Array.isArray(state.decisions) ? state.decisions : [];
    const approvals = Array.isArray(state.approvals) ? state.approvals : [];
    const executions = Array.isArray(state.executions) ? state.executions : [];

    return {
        generatedAt: new Date().toISOString(),
        company: (state.company && state.company.name) ? state.company.name : "Zayzana Tech",
        tagline: (state.company && state.company.tagline) ? state.company.tagline : "We find. We build. We solve.",
        goals,
        business: {
            openProspects: currentBusiness.prospects.length,
            openOpportunities: currentBusiness.opportunities.length,
            offers: currentBusiness.offers.length,
            followUps: currentBusiness.followUps.length,
            revenueRecords: currentBusiness.revenue.length
        },
        knowledge: {
            facts: facts.length,
            decisions: decisions.length,
            approvals: approvals.length,
            executions: executions.length,
            unverifiedResearch: research.length
        },
        priorities: {
            commercialPipelineEmpty:
                currentBusiness.prospects.length === 0 &&
                currentBusiness.opportunities.length === 0,
            followUpsPending: currentBusiness.followUps.length > 0,
            researchAvailable: research.length > 0
        }
    };
}

function founderDashboard() {
    const world = worldModel();
    const heartbeat = evaluateHeartbeat();
    const state = loadJson("cofounder-state.json", {});
    const executions = Array.isArray(state.executions) ? state.executions : [];

    return {
        generatedAt: new Date().toISOString(),
        company: world.company,
        heartbeatStatus: heartbeat.status,
        topSignal: heartbeat.signals.length > 0 ? heartbeat.signals[0] : null,
        business: world.business,
        knowledge: world.knowledge,
        pendingVerification: executions.filter(e => e.verificationStatus === "PENDING").length
    };
}
function showWorldModel() {
    const world = worldModel();

    console.log("\nZAYZANA WORLD MODEL");
    console.log("-------------------");
    console.log(`Generated: ${world.generatedAt}`);
    console.log(`Company: ${world.company}`);
    console.log(`Tagline: ${world.tagline}`);

    console.log("\nCOMMERCIAL STATE");
    console.log("----------------");
    console.log(`Open prospects: ${world.business.openProspects}`);
    console.log(`Open opportunities: ${world.business.openOpportunities}`);
    console.log(`Offers: ${world.business.offers}`);
    console.log(`Follow-ups: ${world.business.followUps}`);
    console.log(`Revenue records: ${world.business.revenueRecords}`);

    console.log("\nCOFOUNDER STATE");
    console.log("---------------");
    console.log(`Facts: ${world.knowledge.facts}`);
    console.log(`Decisions: ${world.knowledge.decisions}`);
    console.log(`Pending approvals: ${world.knowledge.approvals}`);
    console.log(`Executions: ${world.knowledge.executions}`);
    console.log(`Unverified research: ${world.knowledge.unverifiedResearch}`);

    console.log("\nCURRENT SIGNALS");
    console.log("---------------");

    if (world.priorities.commercialPipelineEmpty) {
        console.log("COMMERCIAL: Pipeline is currently empty.");
    }

    if (world.priorities.followUpsPending) {
        console.log("FOLLOW-UPS: Pending follow-ups exist.");
    }

    if (world.priorities.researchAvailable) {
        console.log("RESEARCH: Unverified research is available for review.");
    }

    if (
        !world.priorities.commercialPipelineEmpty &&
        !world.priorities.followUpsPending &&
        !world.priorities.researchAvailable
    ) {
        console.log("No immediate signals detected.");
    }
}
function evaluateHeartbeat() {
    const world = worldModel();
    const signals = [];

    if (world.business.followUps > 0) {
        signals.push({
            priority: 100,
            type: "FOLLOW_UP",
            message: `${world.business.followUps} open follow-up(s) require attention.`
        });
    }

    const state = loadJson("cofounder-state.json", {});
    const activeApprovals = Array.isArray(state.approvals) ? state.approvals.filter(a => a.status === "ACTIVE") : [];

    if (activeApprovals.length > 0) {
        signals.push({
            priority: 90,
            type: "APPROVAL",
            message: `${activeApprovals.length} active approval(s) are recorded.`
        });
    }

    if (world.priorities.commercialPipelineEmpty) {
        signals.push({
            priority: 70,
            type: "COMMERCIAL",
            message: "Commercial pipeline is currently empty."
        });
    }

    if (world.priorities.researchAvailable) {
        signals.push({
            priority: 40,
            type: "RESEARCH",
            message: "Unverified research is available for review."
        });
    }

    signals.sort((a, b) => b.priority - a.priority);

    return {
        generatedAt: new Date().toISOString(),
        status: signals.length > 0 ? "SIGNALS_FOUND" : "QUIET",
        signals
    };
}

function showHeartbeat() {
    const heartbeat = evaluateHeartbeat();

    console.log("\nCOFOUNDER HEARTBEAT");
    console.log("-------------------");
    console.log(`Generated: ${heartbeat.generatedAt}`);
    console.log(`Status: ${heartbeat.status}`);

    if (heartbeat.status === "QUIET") {
        console.log("No materially important signals detected.");
        console.log("No action taken.");
        return;
    }

    console.log("\nPRIORITY SIGNALS");
    console.log("----------------");

    heartbeat.signals.slice(0, 3).forEach((signal, index) => {
        console.log(`${index + 1}. [${signal.type}] ${signal.message}`);
    });

    console.log("\nHEARTBEAT RULE");
    console.log("This is advisory only. No external action was taken.");
    console.log("Zayn decides what to act on.");
}
// --------------------------------------------------
// DIRECT COMMANDS
// --------------------------------------------------

function handleCommand(input) {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("select prospect ")) {
        const requestedName = trimmed.slice("select prospect ".length).trim();
        const open = (business.prospects || []).filter(item => item.status !== "CLOSED");
        const matches = open.filter(item => String(item.name || "").trim().toLowerCase() === requestedName.toLowerCase());
        if (!requestedName || matches.length !== 1) {
            console.log(matches.length > 1 ? "More than one open prospect has that name; use a unique name." : "No unique open prospect matched that name.");
            console.log("Open prospects:");
            open.forEach(item => console.log("- " + item.name));
            return true;
        }
        business.selectedProspectName = matches[0].name;
        saveJson(businessFile, business);
        console.log("Selected prospect: " + matches[0].name);
        return true;
    }


    if (lower === "status" || lower === "founder status" || lower === "cofounder status") {
    const dashboard = founderDashboard();

    console.log("\nCOFOUNDER FOUNDER DASHBOARD");
    console.log("---------------------------");
    console.log("Company: " + dashboard.company);
    console.log("Heartbeat: " + dashboard.heartbeatStatus);

    console.log("\nBUSINESS");
    console.log("--------");
    console.log("Open prospects: " + dashboard.business.openProspects);
    console.log("Open opportunities: " + dashboard.business.openOpportunities);
    console.log("Offers: " + dashboard.business.offers);
    console.log("Follow-ups: " + dashboard.business.followUps);
    console.log("Revenue records: " + dashboard.business.revenueRecords);

    console.log("\nCONTROL & KNOWLEDGE");
    console.log("-------------------");
    console.log("Facts: " + dashboard.knowledge.facts);
    console.log("Decisions: " + dashboard.knowledge.decisions);
    console.log("Pending approvals: " + dashboard.knowledge.approvals);
    console.log("Executions: " + dashboard.knowledge.executions);
    console.log("Pending verification: " + dashboard.pendingVerification);
    console.log("Unverified research: " + dashboard.knowledge.unverifiedResearch);

    console.log("\nWHAT MATTERS NOW");
    console.log("----------------");
    if (dashboard.topSignal) {
        console.log("[" + dashboard.topSignal.type + "] " + dashboard.topSignal.message);
    } else {
        console.log("Nothing currently requires attention.");
    }

    const actionQueue = buildActionQueue();

    console.log("\nNEXT RECOMMENDED ACTION");
    console.log("------------------------");
    if (actionQueue.actions.length > 0) {
        const nextAction = actionQueue.actions[0];
        console.log("[" + nextAction.type + "] " + nextAction.action);
        console.log("Approval: " + (nextAction.approvalRequired ? "Zayn approval required" : "Not required"));
    } else {
        console.log("No recommended action.");
    }

    console.log("\nDASHBOARD RULE");
    console.log("Read-only founder view. No external action was taken.");
    return;
}
if (lower === "heartbeat" || lower === "cofounder heartbeat") {
        showHeartbeat();
        return;
    }

    if (lower === "actions" || lower === "action queue" || lower === "cofounder actions") {
        showActionQueue();
        return;
    }

    if (lower.startsWith("approve action ")) {
        const numberText = trimmed.slice("approve action ".length).trim();
        const decisionMatch = numberText.match(/^(\d+)\s+for\s+decision\s+(\d+)$/i);

        if (!decisionMatch) {
            console.log("");
            console.log("COFOUNDER ACTION APPROVAL BLOCKED");
            console.log("--------------------------------");
            console.log("An action must be linked to an active decision.");
            console.log("Use: approve action <number> for decision <number>");
            return;
        }

        const number = parseInt(decisionMatch[1], 10);
        const decisionNumber = parseInt(decisionMatch[2], 10);
        const queue = buildActionQueue();

        if (!Number.isInteger(number) || number < 1 || number > queue.actions.length) {
            console.log("");
            console.log("COFOUNDER ACTION APPROVAL");
            console.log("-------------------------");
            console.log("Invalid action number.");
            console.log("Use: approve action <number>");
            return;
        }

        const selectedAction = queue.actions[number - 1];

        console.log("");
        console.log("COFOUNDER ACTION SELECTED");
        console.log("-------------------------");
        console.log("Action: " + selectedAction.action);
        console.log("Type: " + selectedAction.type);
        console.log("Priority: " + selectedAction.priority);
        console.log("Passing to existing approval gate...");

        handleCommand("approve recommendation " + selectedAction.action + " for decision " + decisionNumber);
        return;
    }

    if (lower === "world" || lower === "world model" || lower === "zayzana world") {
        showWorldModel();
        return;
    }

    if (
        lower === "commercial-opportunity" ||
        lower === "commercial opportunity" ||
        lower === "opportunity detector"
    ) {
        showCommercialOpportunityDetector();
        return;
    }
    if (lower === "research-latest") {
        const state = loadJson("cofounder-state.json", {});
        const latest = Array.isArray(state.research) ? state.research.at(-1) : null;

        console.log("\nJARVIS LATEST RESEARCH");
        console.log("---------------------");

        if (!latest) {
            console.log("No saved research sessions.");
            return;
        }

        console.log("Query: " + latest.query);
        console.log("Status: " + latest.status);
        console.log("Created: " + latest.createdAt);
        console.log("\nRESULTS");
        console.log("-------");
        console.log(latest.result);
        return;
    }

    if (lower.startsWith("research ")) {
        let query = trimmed.slice("research ".length).trim();
        let researchProspectName = null;

        // Optional explicit association: research for Prospect Name: search query
        if (query.toLowerCase().startsWith("for ") && query.includes(":")) {
            const separator = query.indexOf(":");
            const requestedProspectName = query.slice(4, separator).trim();
            query = query.slice(separator + 1).trim();

            if (!requestedProspectName || !query) {
                console.log("Usage: research for Prospect Name: research query");
                return;
            }

            const researchBusiness = loadJson("business.json", { prospects: [] });
            const matches = (researchBusiness.prospects || []).filter(prospect =>
                prospect.status !== "CLOSED" &&
                typeof prospect.name === "string" &&
                prospect.name.trim().toLowerCase() === requestedProspectName.trim().toLowerCase()
            );

            if (matches.length !== 1) {
                console.log("Research not run: no single open prospect matched '" + requestedProspectName + "'.");
                console.log("Check the prospect name, or run unassigned research without the \"for ...:\" prefix.");
                return;
            }

            researchProspectName = matches[0].name.trim();
        }

        if (!query) {
            console.log("JARVIS > Please provide a research query.");
            return;
        }

        console.log("\nJARVIS WEB RESEARCH");
        console.log("------------------");
        console.log("Query: " + query);
        console.log("Prospect: " + (researchProspectName || "Unassigned"));
        console.log('Use "research for Prospect Name: query" to associate research deliberately.');
        console.log("Research only. No external action will be taken.");

        webResearch(query)
            .then(result => {
                console.log("\nEXA RESEARCH RESULTS");
                console.log("--------------------");
                console.log("STATUS: UNVERIFIED WEB RESEARCH");
                console.log("Use these findings for discovery only. Do not treat them as confirmed prospect facts.");
                console.log("");
                console.log(formatResearchClassification(query, result));
                console.log("\nFULL RAW RESULTS");
                console.log("-----------------");
                console.log(result);
                saveResearchEntry(query, result, researchProspectName);
            })
            .catch(error => {
                console.log("\nRESEARCH ERROR");
                console.log("--------------");
                console.log(error.message);
            });

        return;
    }
    if (lower.startsWith("record decision ")) {
        const decisionText = trimmed.slice("record decision ".length).trim();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));

        if (!Array.isArray(state.decisions)) state.decisions = [];

        const record = {
            id: "decision-" + (state.decisions.length + 1),
            decision: decisionText,
            reason: "Recorded by Zayn",
            evidence: [],
            date: new Date().toISOString(),
            status: "ACTIVE"
        };

        state.decisions.push(record);
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS DECISION RECORDED");
        console.log("-------------------------");
        console.log("Decision: " + record.decision);
        console.log("Reason: " + record.reason);
        console.log("Evidence: none recorded");
        console.log("Status: " + record.status);
        console.log("Date: " + record.date);

        return true;
    }

    if (lower === "show decisions" || lower === "decisions" || lower === "decision history") {
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];

        console.log("");
        console.log("JARVIS DECISION HISTORY");
        console.log("-----------------------");

        if (decisions.length === 0) {
            console.log("No decisions recorded.");
            return true;
        }

        decisions.forEach((d, i) => {
            const decisionText = d.decision || d.text || "Unknown decision";
            console.log((i + 1) + ". " + decisionText);
            console.log("   Status: " + (d.status || "UNKNOWN"));
            console.log("   Date: " + (d.date || "Unknown"));
            console.log("   Reason: " + (d.reason || "Not recorded"));
            console.log("   Evidence: " + (Array.isArray(d.evidence) && d.evidence.length > 0 ? d.evidence.join("; ") : "None recorded"));
            console.log("   Outcome: " + (d.outcome || "Not recorded"));
            console.log("   Lesson: " + (d.lesson || "Not recorded"));
            console.log("");
        });

        return true;
    }

    if (lower.startsWith("close decision ")) {
        const numberText = trimmed.slice("close decision ".length).trim();
        const number = parseInt(numberText, 10);
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];

        if (!Number.isInteger(number) || number < 1 || number > decisions.length) {
            console.log("");
            console.log("JARVIS DECISION UPDATE");
            console.log("----------------------");
            console.log("Invalid decision number.");
            console.log("Use: close decision <number>");
            console.log("Use show decisions to see the decision numbers.");
            return true;
        }

        const decision = decisions[number - 1];
        const decisionText = decision.decision || decision.text || "Unknown decision";

        if (decision.status === "CLOSED") {
            console.log("");
            console.log("Decision is already CLOSED.");
            return true;
        }

        decision.status = "CLOSED";
        decision.closedDate = new Date().toISOString();
        decision.closedBy = "Zayn";

        const linkedApprovals = Array.isArray(state.approvals)
            ? state.approvals.filter(a => a.status === "ACTIVE" && a.decisionNumber === number)
            : [];
        linkedApprovals.forEach(a => {
            a.status = "STALE";
            a.staleDate = decision.closedDate;
            a.staleReason = "Linked decision was closed.";
        });

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS DECISION CLOSED");
        console.log("----------------------");
        console.log("Decision: " + decisionText);
        console.log("Status: CLOSED");
        console.log("Closed by: Zayn");
        if (linkedApprovals.length > 0) {
            console.log("Linked active approvals marked STALE.");
        }
        console.log("The decision remains in history but is no longer an active constraint.");

        return true;
    }

    if (lower.startsWith("decision reason ")) {
        const parts = trimmed.slice("decision reason ".length).trim().split(" ");
        const number = parseInt(parts.shift(), 10);
        const reason = parts.join(" ").trim();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];

        if (!Number.isInteger(number) || number < 1 || number > decisions.length || !reason) {
            console.log("");
            console.log("JARVIS DECISION REASON");
            console.log("----------------------");
            console.log("Use: decision reason <number> <reason>");
            return true;
        }

        const decision = decisions[number - 1];
        decision.reason = reason;

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS DECISION REASON UPDATED");
        console.log("-------------------------------");
        console.log("Decision: " + (decision.decision || decision.text || "Unknown decision"));
        console.log("Reason: " + decision.reason);

        return true;
    }

    if (lower.startsWith("decision evidence ")) {
        const parts = trimmed.slice("decision evidence ".length).trim().split(" ");
        const number = parseInt(parts.shift(), 10);
        const evidenceText = parts.join(" ").trim();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];

        if (!Number.isInteger(number) || number < 1 || number > decisions.length || !evidenceText) {
            console.log("");
            console.log("JARVIS DECISION EVIDENCE");
            console.log("------------------------");
            console.log("Use: decision evidence <number> <evidence>");
            return true;
        }

        const decision = decisions[number - 1];
        if (!Array.isArray(decision.evidence)) decision.evidence = [];
        decision.evidence.push(evidenceText);

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS DECISION EVIDENCE ADDED");
        console.log("-------------------------------");
        console.log("Decision: " + (decision.decision || decision.text || "Unknown decision"));
        console.log("Evidence: " + evidenceText);
        console.log("Evidence count: " + decision.evidence.length);

        return true;
    }

    if (lower.startsWith("decision outcome ")) {
        const parts = trimmed.slice("decision outcome ".length).trim().split(" ");
        const number = parseInt(parts.shift(), 10);
        const outcomeText = parts.join(" ").trim();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];

        if (!Number.isInteger(number) || number < 1 || number > decisions.length || !outcomeText) {
            console.log("");
            console.log("JARVIS DECISION OUTCOME");
            console.log("-----------------------");
            console.log("Use: decision outcome <number> <what happened>");
            return true;
        }

        const decision = decisions[number - 1];
        decision.outcome = outcomeText;
        decision.outcomeDate = new Date().toISOString();
        decision.outcomeDecisionId = decision.id || ("decision-" + number);

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS DECISION OUTCOME RECORDED");
        console.log("---------------------------------");
        console.log("Decision: " + (decision.decision || decision.text || "Unknown decision"));
        console.log("Outcome: " + decision.outcome);
        console.log("Outcome date: " + decision.outcomeDate);

        return true;
    }

    if (lower.startsWith("decision lesson ")) {
        const parts = trimmed.slice("decision lesson ".length).trim().split(" ");
        const number = parseInt(parts.shift(), 10);
        const lessonText = parts.join(" ").trim();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];

        if (!Number.isInteger(number) || number < 1 || number > decisions.length || !lessonText) {
            console.log("");
            console.log("JARVIS DECISION LESSON");
            console.log("----------------------");
            console.log("Use: decision lesson <number> <lesson learned>");
            return true;
        }

        const decision = decisions[number - 1];

        if (!decision.outcome) {
            console.log("");
            console.log("JARVIS DECISION LESSON BLOCKED");
            console.log("-------------------------------");
            console.log("Record the decision outcome before recording a lesson.");
            console.log("Use: decision outcome <number> <what happened>");
            return true;
        }

        if (!Array.isArray(state.lessons)) state.lessons = [];

        const lesson = {
            id: "lesson-" + (state.lessons.length + 1),
            date: new Date().toISOString(),
            source: "decision " + number,
            decisionId: decision.id || ("decision-" + number),
            text: lessonText
        };

        state.lessons.push(lesson);
        decision.lesson = lessonText;
        decision.lessonId = lesson.id;

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS DECISION LESSON RECORDED");
        console.log("---------------------------------");
        console.log("Decision: " + (decision.decision || decision.text || "Unknown decision"));
        console.log("Lesson: " + lessonText);
        console.log("Lessons recorded: " + state.lessons.length);

        return true;
    }

    if (lower.startsWith("approve recommendation ")) {
        const rawApproval = trimmed.slice("approve recommendation ".length).trim();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const decisions = Array.isArray(state.decisions) ? state.decisions : [];
        const decisionMatch = rawApproval.match(/\s+for decision\s+(\d+)$/i);
        const approvalText = decisionMatch
            ? rawApproval.slice(0, decisionMatch.index).trim()
            : rawApproval;
        const decisionNumber = decisionMatch ? parseInt(decisionMatch[1], 10) : null;

        if (!approvalText) {
            console.log("");
            console.log("JARVIS APPROVAL");
            console.log("----------------");
            console.log("Use: approve recommendation <action>");
            console.log("Example: approve recommendation complete prospect qualification before contracting");
            return true;
        }

        if (!Array.isArray(state.approvals)) state.approvals = [];

        if (decisions.some(d => d.status === "ACTIVE") && decisionNumber === null) {
            console.log("");
            console.log("JARVIS APPROVAL BLOCKED");
            console.log("------------------------");
            console.log("An active decision exists. Link the approval to that decision.");
            console.log("Use: approve recommendation <action> for decision <number>");
            return true;
        }

        let linkedDecision = null;
        if (decisionNumber !== null) {
            if (!Number.isInteger(decisionNumber) || decisionNumber < 1 || decisionNumber > decisions.length) {
                console.log("");
                console.log("JARVIS APPROVAL BLOCKED");
                console.log("------------------------");
                console.log("Invalid decision number.");
                return true;
            }

            linkedDecision = decisions[decisionNumber - 1];
            if (linkedDecision.status !== "ACTIVE") {
                console.log("");
                console.log("JARVIS APPROVAL BLOCKED");
                console.log("------------------------");
                console.log("The linked decision is not active.");
                return true;
            }
        }

        const approval = {
            approvalId: "approval-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            action: approvalText,
            approvedBy: "Zayn",
            date: new Date().toISOString(),
            status: "ACTIVE",
            decisionNumber: decisionNumber,
            decisionId: linkedDecision ? (linkedDecision.id || ("decision-" + decisionNumber)) : null
        };

        state.approvals.push(approval);
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS RECOMMENDATION APPROVED");
        console.log("-------------------------------");
        console.log("Action: " + approval.action);
        console.log("Approved by: " + approval.approvedBy);
        console.log("Status: " + approval.status);
        console.log("Date: " + approval.date);
        console.log("No external action executed.");

        return true;
    }

    if (lower.startsWith("execute approved ")) {
        const numberText = trimmed.slice("execute approved ".length).trim();
        const number = parseInt(numberText, 10);
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const approvals = Array.isArray(state.approvals) ? state.approvals : [];

        if (!Number.isInteger(number) || number < 1 || number > approvals.length) {
            console.log("");
            console.log("JARVIS EXECUTION GATE");
            console.log("----------------------");
            console.log("Invalid approval number.");
            console.log("Use: execute approved <number>");
            return true;
        }

        const approval = approvals[number - 1];

        if (approval.status !== "ACTIVE") {
            console.log("");
            console.log("JARVIS EXECUTION BLOCKED");
            console.log("--------------------------");
            console.log("This approval is not active.");
            return true;
        }

        if (approval.decisionNumber) {
            const linkedDecision = state.decisions?.[approval.decisionNumber - 1];
            if (!linkedDecision || linkedDecision.status !== "ACTIVE") {
                console.log("");
                console.log("JARVIS EXECUTION BLOCKED");
                console.log("--------------------------");
                console.log("The approval's linked decision is no longer active.");
                return true;
            }
        }

        if (!Array.isArray(state.executions)) state.executions = [];

        const execution = {
            approvalId: approval.approvalId || null,
            action: approval.action,
            approvedBy: approval.approvedBy || "Zayn",
            approvedDate: approval.date || new Date().toISOString(),
            executedBy: "JARVIS",
            executedDate: new Date().toISOString(),
            status: "INTERNAL_ACTION_RECORDED",
            verificationStatus: "PENDING"
        };

        state.executions.push(execution);
        approval.status = "EXECUTED";
        approval.executedDate = execution.executedDate;
        approval.executionStatus = execution.status;
        approval.verificationStatus = execution.verificationStatus;

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("JARVIS EXECUTION RECORDED");
        console.log("---------------------------");
        console.log("Action: " + execution.action);
        console.log("Approved by: " + execution.approvedBy);
        console.log("Executed by: " + execution.executedBy);
        console.log("Status: " + execution.status);
        console.log("No external action was performed.");

        return true;
    }

    if (lower.startsWith("verify execution ")) {
        const parts = trimmed.split(/\s+/);
        const number = parseInt(parts[2], 10);
        const verificationStatus = (parts[3] || "").toUpperCase();
        const stateFile = "cofounder-state.json";
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        const executions = Array.isArray(state.executions) ? state.executions : [];

        if (!Number.isInteger(number) || number < 1 || number > executions.length) {
            console.log("");
            console.log("COFOUNDER VERIFICATION BLOCKED");
            console.log("------------------------------");
            console.log("Invalid execution number.");
            console.log("Use: verify execution <number> verified|failed|unknown");
            return true;
        }

        if (!["VERIFIED", "FAILED", "UNKNOWN"].includes(verificationStatus)) {
            console.log("");
            console.log("COFOUNDER VERIFICATION BLOCKED");
            console.log("------------------------------");
            console.log("Invalid verification status.");
            console.log("Use: verify execution <number> verified|failed|unknown");
            return true;
        }

        const execution = executions[number - 1];

        if (execution.verificationStatus !== "PENDING") {
            console.log("");
            console.log("COFOUNDER VERIFICATION BLOCKED");
            console.log("------------------------------");
            console.log("This execution is not pending verification.");
            console.log("Current verification status: " + (execution.verificationStatus || "UNKNOWN"));
            return true;
        }

        execution.verificationStatus = verificationStatus;
        execution.verifiedBy = "Zayn";
        execution.verifiedDate = new Date().toISOString();

        const approval = Array.isArray(state.approvals)
            ? state.approvals.find(a => (execution.approvalId && a.approvalId === execution.approvalId) || (!execution.approvalId && a.action === execution.action && a.status === "EXECUTED"))
            : null;

        if (approval) {
            approval.verificationStatus = verificationStatus;
            approval.verifiedBy = execution.verifiedBy;
            approval.verifiedDate = execution.verifiedDate;
        }

        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

        console.log("");
        console.log("COFOUNDER EXECUTION VERIFIED");
        console.log("-----------------------------");
        console.log("Action: " + execution.action);
        console.log("Verification: " + execution.verificationStatus);
        console.log("Verified by: " + execution.verifiedBy);
        console.log("Verified date: " + execution.verifiedDate);
        console.log("Verification records the reported outcome only.");
        console.log("No external action was performed.");

        return true;
    }
    if (lower === "challenge" || lower === "cofounder challenge" || lower === "challenge recommendation") {
        const state = JSON.parse(fs.readFileSync("cofounder-state.json", "utf8"));
        const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
        const prospects = business.prospects || [];
        const openFollowUps = business.followUps.filter(f => f.status === "OPEN");

        console.log("");
        console.log("JARVIS COFOUNDER CHALLENGE");
        console.log("-------------------------");

        if (openFollowUps.length === 0) {
            console.log("No open follow-up is currently recorded.");
        } else {
            console.log("CURRENT ACTION");
            console.log("- " + openFollowUps[0].text);

            const activeDecisionList = Array.isArray(state.decisions)
                ? state.decisions.filter(d => d.status === "ACTIVE")
                : [];

            console.log("");
            console.log("ACTIVE DECISION CHECK");
            if (activeDecisionList.length === 0) {
                console.log("No active decisions recorded.");
            } else {
                activeDecisionList.forEach(d => {
                    const decisionText = d.decision || d.text || "Unknown decision";
                    console.log("- " + decisionText);
                    if (d.reason) console.log("  Reason: " + d.reason);
                    if (Array.isArray(d.evidence) && d.evidence.length > 0) {
                        d.evidence.forEach(e => console.log("  Evidence: " + e));
                    }
                });
            }

            const incomplete = prospects.filter(p => p.qualification && p.qualification.status !== "QUALIFIED");

            console.log("");
            console.log("CHALLENGE");
            if (incomplete.length > 0) {
                const missing = incomplete[0].qualification.missing || [];
                console.log("The current follow-up may be premature because prospect qualification is incomplete.");
                console.log("Missing evidence: " + (missing.join(", ") || "additional qualification data") + ".");
                console.log("Before contracting, confirm the prospect problem, impact, current solution, desired outcome and decision maker.");
            } else {
                console.log("No recorded qualification gap currently conflicts with the open follow-up.");
            }
        }

        console.log("");
        console.log("DECISION");
        console.log("Challenge is advisory only. No external action taken.");
        console.log("Zayn decides whether to proceed, change the action, or gather more evidence.");
        return true;
    }

    if (lower === "recommend" || lower === "cofounder recommend" || lower === "recommend next") {
        const state = JSON.parse(fs.readFileSync("cofounder-state.json", "utf8"));
        const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
        const activeGoals = state.goals.filter(g => g.status === "ACTIVE");
        const openOpps = business.opportunities.filter(o => o.status === "OPEN");
        const openFollowUps = business.followUps.filter(f => f.status === "OPEN");
        const prospects = business.prospects || [];

        console.log("\nJARVIS COFOUNDER RECOMMENDATION");
        console.log("--------------------------------");
        console.log("RECOMMENDATION");

        const recommendationLessons = Array.isArray(state.lessons) ? state.lessons : [];
        const incompleteProspects = prospects.filter(p => p.status !== "CLOSED" && (!p.qualification || p.qualification.status !== "QUALIFIED"));
        const hasQualificationLesson = recommendationLessons.some(lesson => {
            const text = (lesson.text || "").toLowerCase();
            return text.includes("qualify") && text.includes("contract");
        });
        const currentFollowUp = openFollowUps.length > 0 ? openFollowUps[0] : null;
        const currentFollowUpText = currentFollowUp ? currentFollowUp.text.toLowerCase() : "";
        const contractFollowUp = currentFollowUp && (currentFollowUpText.includes("contract") || currentFollowUpText.includes("contracting"));
        const qualificationOverride = contractFollowUp && incompleteProspects.length > 0 && hasQualificationLesson;

        if (qualificationOverride) {
            console.log("Focus first on: complete prospect qualification before contracting.");
            console.log("The current contract follow-up conflicts with the recorded qualification gap and a lesson from a previous decision.");
        } else if (openFollowUps.length > 0) {
            const followUp = openFollowUps[0];
            console.log("Focus first on: " + followUp.text);
            console.log("Do not create new work until this open follow-up has been acted on or deliberately closed.");
        } else if (incompleteProspects.length > 0) {
            console.log("Focus first on: complete discovery for " + (incompleteProspects[0].name || "the active prospect") + " before recommending a solution.");
        } else if (openOpps.length > 0) {
            console.log("Focus on converting the open opportunity: " + openOpps[0].text);
        } else {
            console.log("Identify the next concrete action against the highest-priority active goal.");
        }

        console.log("\nWHY");
        console.log("- " + activeGoals.length + " active strategic goals are recorded.");
        console.log("- " + openOpps.length + " open opportunities are recorded.");
        console.log("- " + openFollowUps.length + " open follow-ups are recorded.");
        console.log("- " + prospects.length + " prospects are recorded.");

        console.log("\nGAP");
        const incomplete = incompleteProspects;
        if (incomplete.length > 0) {
            const prospect = incomplete[0];
            const discovery = prospect.discovery || {};
            const missing = prospect.qualification && Array.isArray(prospect.qualification.missing)
                ? prospect.qualification.missing
                : [
                    { label: "problem", value: discovery.problem },
                    { label: "impact", value: discovery.impact },
                    { label: "current solution", value: discovery.currentSolution },
                    { label: "desired outcome", value: discovery.desiredOutcome },
                    { label: "decision maker", value: discovery.decisionMaker }
                ].filter(item => !String(item.value || "").trim()).map(item => item.label);
            console.log("Prospect discovery is incomplete for " + (prospect.name || "the active prospect") + ". Missing: " + (missing.join(", ") || "additional qualification data") + ".");
        } else {
            console.log("No major prospect qualification gap is recorded.");
        }

        console.log("");
        console.log("APPROVAL CHECK");
        const approvalList = Array.isArray(state.approvals) ? state.approvals : [];
        const activeApprovals = approvalList.filter(a => a.status === "ACTIVE");

        if (activeApprovals.length === 0) {
            console.log("No active recommendation approvals recorded.");
        } else {
            activeApprovals.forEach(a => {
                console.log("- " + (a.action || "Unknown action"));
                console.log("  Approved by: " + (a.approvedBy || "Unknown"));
                console.log("  Date: " + (a.date || "Unknown"));
            });
            console.log("Approval is recorded, but execution still requires a separate execution step.");
        }

        console.log("\nDECISION CHECK");
        const decisionState = JSON.parse(fs.readFileSync("cofounder-state.json", "utf8"));
        const activeDecisionList = Array.isArray(decisionState.decisions)
            ? decisionState.decisions.filter(d => d.status === "ACTIVE")
            : [];

        if (activeDecisionList.length === 0) {
            console.log("No active decisions constrain the current recommendation.");
        } else {
            activeDecisionList.forEach(d => {
                const decisionText = d.decision || d.text || "Unknown decision";
                console.log("- " + decisionText);
                if (d.reason) console.log("  Reason: " + d.reason);
                if (Array.isArray(d.evidence) && d.evidence.length > 0) {
                    d.evidence.forEach(e => console.log("  Evidence: " + e));
                }
            });

            const followUpText = openFollowUps.length > 0 ? openFollowUps[0].text.toLowerCase() : "";
            const contractGate = activeDecisionList.find(d => {
                const text = (d.decision || d.text || "").toLowerCase();
                return text.includes("before contracting");
            });

            if (contractGate && (followUpText.includes("contract") || followUpText.includes("contracting"))) {
                console.log("CONFLICT: Current follow-up may conflict with an active decision requiring qualification before contracting.");
                console.log("JARVIS should not recommend contracting until Zayn changes or closes that decision.");
            } else {
                console.log("No direct conflict detected between the current recommendation and active decisions.");
            }
        }

        console.log("");
        console.log("LESSONS FROM PAST DECISIONS");
        const lessons = Array.isArray(state.lessons) ? state.lessons : [];

        if (lessons.length === 0) {
            console.log("No lessons recorded yet.");
        } else {
            lessons.slice(-3).forEach(lesson => {
                console.log("- " + (lesson.text || "Unknown lesson"));
            });

            const qualificationLesson = lessons.some(lesson => {
                const text = (lesson.text || "").toLowerCase();
                return text.includes("qualify") && text.includes("contract");
            });

            if (qualificationLesson && incomplete.length > 0 && openFollowUps.length > 0) {
                const currentAction = openFollowUps[0].text.toLowerCase();

                if (currentAction.includes("contract") || currentAction.includes("contracting")) {
                    console.log("LEARNING SIGNAL: A past decision lesson indicates qualification should happen before contracting when discovery evidence is incomplete.");
                    console.log("This is guidance from past experience, not an active decision constraint.");
                }
            }
        }

        console.log("\nNEXT ACTION");
        if (qualificationOverride) {
            console.log("Gather the missing prospect qualification evidence: impact, current solution, desired outcome and decision maker.");
        } else if (openFollowUps.length > 0) {
            console.log("Review and act on: " + openFollowUps[0].text);
        } else if (incompleteProspects.length > 0) {
            console.log("Gather missing discovery evidence for " + (incompleteProspects[0].name || "the active prospect") + "; do not recommend a final solution until qualification is complete.");
        } else {
            console.log("Choose and record one concrete next action.");
        }

        console.log("\nAPPROVAL");
        console.log("No external action taken. Zayn approval is required before execution.");
        return true;
    }

    if (input.startsWith("capture discovery ")) {
    const value = input.slice("capture discovery ".length).trim();

    if (!value) {
        console.log("Please provide the discovery answer.");
        return;
    }

    const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
    const prospects = business.prospects || [];
    const active = resolveActiveProspect(business);

    console.log("");

    if (!active) {
        console.log("No active prospect is currently recorded.");
        console.log("");
        return;
    }

    active.discovery = active.discovery || {};
    const d = active.discovery;

    let field = active.currentDiscoveryField || "";
    let label = "";

    const labels = {
        problem: "Problem",
        impact: "Impact",
        currentSolution: "Current solution",
        desiredOutcome: "Desired outcome",
        decisionMaker: "Decision maker",
        budget: "Budget",
        timeline: "Timeline"
    };

    if (field) {
        label = labels[field] || field;
    } else if (!d.problem) {
        field = "problem";
        label = "Problem";
    } else if (!d.impact) {
        field = "impact";
        label = "Impact";
    } else if (!d.currentSolution) {
        field = "currentSolution";
        label = "Current solution";
    } else if (!d.desiredOutcome) {
        field = "desiredOutcome";
        label = "Desired outcome";
    } else if (!d.decisionMaker) {
        field = "decisionMaker";
        label = "Decision maker";
    } else if (!d.budget) {
        field = "budget";
        label = "Budget";
    } else if (!d.timeline) {
        field = "timeline";
        label = "Timeline";
    }
    if (!field) {
        console.log("Discovery evidence is already complete.");
        console.log("Proceed to qualification and commercial review.");
        console.log("");
        return;
    }

    d[field] = value;
    fs.writeFileSync("business.json", JSON.stringify(business, null, 2));

    console.log("DISCOVERY CAPTURED");
    console.log("------------------");
    console.log(label + ": " + value);
    console.log("");
    console.log("Next step: run 'next discovery'.");
    console.log("");
    return;
}
if (input.startsWith("discovery impact ")) {
    const value = input.slice("discovery impact ".length).trim();

    if (!value) {
        console.log("Please provide the prospect impact.");
        return;
    }

    const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
    const prospects = business.prospects || [];
    const active = resolveActiveProspect(business);

    if (!active) {
        console.log("No active prospect is currently recorded.");
        return;
    }

    active.discovery = active.discovery || {};
    active.discovery.impact = value;

    fs.writeFileSync("business.json", JSON.stringify(business, null, 2));

    console.log("");
    console.log("DISCOVERY CAPTURED");
    console.log("------------------");
    console.log("Impact: " + value);
    console.log("");
    console.log("Next step: run 'next discovery'.");
    console.log("");
    return;
}
if (input === "next discovery" || input === "discovery question") {
    const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
    const prospects = business.prospects || [];
    const active = resolveActiveProspect(business);

    console.log("");
    console.log("NEXT DISCOVERY QUESTION");
    console.log("-----------------------");

    if (!active) {
        console.log("No active prospect is currently recorded.");
    } else {
        const d = active.discovery || {};

        if (!d.problem) {
            active.currentDiscoveryField = "problem";
            console.log("What specific business problem are you trying to solve?");
        } else if (!d.impact) {
            active.currentDiscoveryField = "impact";
            console.log("Roughly how many staff hours per week are being spent handling these customer enquiries?");
        } else if (!d.currentSolution) {
            active.currentDiscoveryField = "currentSolution";
            console.log("How are you handling this problem today?");
        } else if (!d.desiredOutcome) {
            active.currentDiscoveryField = "desiredOutcome";
            console.log("If we solved that problem, what specific result would you want to see instead?");
        } else if (!d.decisionMaker) {
            active.currentDiscoveryField = "decisionMaker";
            console.log("Who would normally be involved in approving or deciding on a solution to this problem?");
        } else if (!d.budget) {
            active.currentDiscoveryField = "budget";
            console.log("Has the business already set aside a budget or spending range for solving this problem?");
        } else if (!d.timeline) {
            active.currentDiscoveryField = "timeline";
            console.log("When would you ideally want this problem solved or the new process in place?");
        } else {
            console.log("Discovery evidence is complete. Proceed to qualification and commercial review.");
        }
    }

    fs.writeFileSync("business.json", JSON.stringify(business, null, 2));
    console.log("");
    return;
}
if (input === "run cycle" || input === "cycle") {
    const businessState = JSON.parse(fs.readFileSync("business.json", "utf8"));
    const activeProspects = (businessState.prospects || []).filter(p => p.status !== "CLOSED");

    console.log("");
    console.log("COFOUNDER BUSINESS CYCLE");
    console.log("========================");

    if (activeProspects.length === 0) {
        console.log("No active prospect found.");
        console.log("Next action: identify and record a real commercial prospect.");
        console.log("");
        return;
    }

    const prospect = resolveActiveProspect(businessState);
    if (!prospect) return;
    const d = prospect.discovery || {};
    const required = [
        ["problem", d.problem],
        ["impact", d.impact],
        ["current solution", d.currentSolution],
        ["desired outcome", d.desiredOutcome],
        ["decision maker", d.decisionMaker]
    ];

    const missing = required
        .filter(item => !item[1] || !item[1].trim())
        .map(item => item[0]);

    console.log("Active prospect: " + (prospect.name || "Unknown"));
    console.log("");

    if (missing.length > 0) {
        console.log("STAGE: DISCOVERY");
        console.log("----------------");
        console.log("Missing core evidence: " + missing.join(", "));
        console.log("Next action: continue discovery.");
        console.log("");
        return;
    }

    const qualification = prospect.qualification || {};
    const buyerConfirmationRecorded =
        qualification.status === "QUALIFIED" &&
        qualification.confirmationSource === "ZAYN_CONFIRMED_BUYER_EVIDENCE" &&
        Boolean(qualification.confirmedAt);

    if (!buyerConfirmationRecorded) {
        console.log("STAGE: QUALIFICATION");
        console.log("--------------------");
        console.log("Core discovery fields are complete, but buyer confirmation is not recorded.");

        if (qualification.status !== "READY FOR CONFIRMATION") {
            prospect.qualification = {
                status: "READY FOR CONFIRMATION",
                checkedAt: new Date().toISOString(),
                missing: [],
                note: "Core discovery fields are present; buyer confirmation is still required."
            };
            saveJson("business.json", businessState);
        }

        console.log("Qualification: READY FOR CONFIRMATION");
        console.log("Next action: confirm these details with the buyer, then run 'confirm prospect qualification'.");
        console.log("No commercial recommendation was made.");
        console.log("");
        return;
    }

    console.log("STAGE: COMMERCIAL REVIEW");
    console.log("------------------------");
    console.log("Prospect is qualified.");
    console.log("");

    const recommendation = buildCommercialRecommendation(prospect, commercialOffers);

    console.log("COMMERCIAL RECOMMENDATION");
    console.log("-------------------------");
    console.log("Primary offer: " + (recommendation.primaryOffer || "No match found"));
    console.log("Expected outcome: " + (recommendation.primaryOutcome || "Not available"));
    console.log("Evidence:");
    console.log("- Problem: " + (d.problem || "Not recorded"));
    console.log("- Impact: " + (d.impact || "Not recorded"));
    console.log("- Desired outcome: " + (d.desiredOutcome || "Not recorded"));

    if (recommendation.primaryEvidence.length > 0) {
        console.log("Matched problem signals: " + recommendation.primaryEvidence.join(", "));
    }

    console.log("Alternative offer: " + (recommendation.alternativeOffer || "None identified"));

    if (recommendation.unknowns.length > 0) {
        console.log("Commercial unknowns: " + recommendation.unknowns.join(", "));
    } else {
        console.log("Commercial unknowns: none");
    }

    console.log("");

    const cofounderState = JSON.parse(fs.readFileSync("cofounder-state.json", "utf8"));
    const activeApprovals = Array.isArray(cofounderState.approvals)
        ? cofounderState.approvals.filter(a => a.status === "ACTIVE")
        : [];
    const executions = Array.isArray(cofounderState.executions)
        ? cofounderState.executions
        : [];

    if (activeApprovals.length === 0) {
        console.log("STATUS: READY FOR ZAYN APPROVAL");
    } else {
        const recordedExecutions = activeApprovals.filter(approval =>
            executions.some(execution =>
                execution.status === "INTERNAL_ACTION_RECORDED" &&
                (execution.approvalId && execution.approvalId === approval.approvalId) || (!execution.approvalId && execution.action === approval.action)
            )
        );

        if (recordedExecutions.length > 0) {
            console.log("STATUS: INTERNAL ACTION RECORDED");
            recordedExecutions.forEach(a => {
                console.log("Approved action: " + (a.action || "Unknown action"));
                console.log("Approved by: " + (a.approvedBy || "Unknown"));
                const execution = executions.find(e =>
                    e.status === "INTERNAL_ACTION_RECORDED" &&
                    (e.approvalId && e.approvalId === a.approvalId) || (!e.approvalId && e.action === a.action)
                );
                console.log("Executed by: " + (execution?.executedBy || "Unknown"));
                console.log("Execution date: " + (execution?.executedDate || "Unknown"));
            });
            console.log("Next stage: determine the next commercial action.");
        } else {
            console.log("STATUS: APPROVAL RECORDED");
            activeApprovals.forEach(a => {
                console.log("Approved action: " + (a.action || "Unknown action"));
                console.log("Approved by: " + (a.approvedBy || "Unknown"));
                console.log("Approval date: " + (a.date || "Unknown"));
            });
            console.log("Next stage: execute approved action when explicitly instructed.");
        }
    }

    console.log("External action: BLOCKED");
    console.log("");
    return;
}
if (input === "commercial assessment") { commercialAssessment(); return; }
if (input === "commercial brain" || input === "commercial") { commercialBrain.analyze(); return; }

  // MEMORY
    if (lower.startsWith("remember ")) {
        remember(trimmed.substring(9).trim());
        return true;
    }

    if (
        lower === "memory" ||
        lower === "memories" ||
        lower === "what do you remember"
    ) {
        showMemory();
        return true;
    }

    // TASKS
    if (lower.startsWith("add task ")) {
        addTask(trimmed.substring(9).trim());
        return true;
    }

    if (
        lower === "task" ||
        lower === "tasks" ||
        lower === "show tasks"
    ) {
        showTasks();
        return true;
    }

    if (lower.startsWith("complete task ")) {
        completeTask(trimmed.substring(14).trim());
        return true;
    }

    if (lower.startsWith("remove task ")) {
        removeTask(trimmed.substring(12).trim());
        return true;
    }

    // REMINDERS
    if (
        lower === "reminders" ||
        lower === "show reminders"
    ) {
        showReminders();
        return true;
    }

    // BUSINESS
    if (
        lower === "business" ||
        lower === "business brain" ||
        lower === "show business" ||
        lower === "business overview"
    ) {
        showBusinessOverview();
        return true;
    }

    if (
        lower === "action brain" ||
        lower === "next action" ||
        lower === "what should i do" ||
        lower === "what should we do" ||
        lower === "what next"
    ) {
        showActionBrain();
        return true;
    }

    if (
        lower === "priorities" ||
        lower === "business priorities"
    ) {
        showBusinessPriorities();
        return true;
    }

    // STEP 16
    if (
        lower === "operating brain" ||
        lower === "zayzana operating brain" ||
        lower === "zayzana strategy" ||
        lower === "business strategy"
    ) {
        showOperatingBrain();
        return true;
    }

    if (
        lower === "zayzana focus" ||
        lower === "what is the focus" ||
        lower === "where should we focus"
    ) {
        showZayzanaFocus();
        return true;
    }

    // STEP 17
    if (
        lower === "opportunity action" ||
        lower === "opportunity action brain" ||
        lower === "what should i do next" ||
        lower === "what should we do next"
    ) {
        showOpportunityAction();
        return true;
    }

    // STEP 18
    if (
        lower === "prospect intelligence" ||
        lower === "prospect analysis" ||
        lower === "what do we know about the prospect" ||
        lower === "what do we know about this prospect" ||
        lower === "what do we need to find out" ||
        lower === "how can zayzana help this prospect" ||
        lower === "what should we ask the prospect"
    ) {
        showProspectIntelligence();
        return true;
    }

    // PROSPECT WORKSPACE
    if (
        lower === "prospect workspace" ||
        lower === "workspace" ||
        lower === "show prospect workspace"
    ) {
        showProspectWorkspace();
        return true;
    }

    // STEP 19: PROSPECT DISCOVERY
    if (
        lower === "prospect discovery" ||
        lower === "prospect discovery brain" ||
        lower === "discover prospect" ||
        lower === "what do we need to discover"
    ) {
        showProspectDiscovery();
        return true;
    }

    // STEP 19: DISCOVERY CAPTURE
    if (lower.startsWith("discovery ")) {
        const parts = trimmed.split(" ");
        const field = parts[1];
        const value = parts.slice(2).join(" ").trim();

        if (!value) {
            console.log("JARVIS > Please provide the discovery answer.");
            return true;
        }

        const activeProspects = business.prospects.filter(
            (item) => item.status !== "CLOSED"
        );

        if (activeProspects.length === 0) {
            console.log("JARVIS > No active prospect found.");
            return true;
        }

        const prospect = resolveActiveProspect(business);
        if (!prospect) return true;

        if (!prospect.discovery) {
            prospect.discovery = {
                problem: "",
                impact: "",
                currentSolution: "",
                desiredOutcome: "",
                decisionMaker: "",
                budget: "",
                timeline: "",
                notes: ""
            };
        }

        const fieldMap = {
            problem: "problem",
            impact: "impact",
            current: "currentSolution",
            solution: "currentSolution",
            outcome: "desiredOutcome",
            decision: "decisionMaker",
            maker: "decisionMaker",
            budget: "budget",
            timeline: "timeline",
            notes: "notes"
        };

        if (!fieldMap[field]) {
            console.log("JARVIS > Unknown discovery field.");
            console.log("Use: problem, impact, current, outcome, decision, budget, timeline or notes.");
            return true;
        }

        prospect.discovery[fieldMap[field]] = value;

        if (prospect.qualification) {
            prospect.qualification = {
                status: "NEEDS RECONFIRMATION",
                checkedAt: new Date().toISOString(),
                missing: [],
                note: "Discovery changed after qualification review; rerun qualification and reconfirm buyer evidence."
            };
        }

        saveJson(businessFile, business);

        console.log(`JARVIS > Discovery saved: ${fieldMap[field]}`);
        if (prospect.qualification?.status === "NEEDS RECONFIRMATION") {
            console.log("Qualification invalidated because discovery changed. Rerun prospect qualification.");
        }
        return true;
    }
    if (lower === "confirm prospect qualification" || lower === "confirm qualification") {
        const activeProspects = business.prospects.filter(
            (item) => item.status !== "CLOSED"
        );

        if (activeProspects.length === 0) {
            console.log("\nJARVIS > No active prospect found.");
            return true;
        }

        const prospect = resolveActiveProspect(business);
        if (!prospect) return true;

        const d = prospect.discovery || {};
        const requiredFields = [
            ["problem", d.problem],
            ["impact", d.impact],
            ["current solution", d.currentSolution],
            ["desired outcome", d.desiredOutcome],
            ["decision maker", d.decisionMaker]
        ];
        const missing = requiredFields
            .filter((item) => typeof item[1] !== "string" || !item[1].trim())
            .map((item) => item[0]);

        console.log("\nJARVIS BUYER CONFIRMATION");
        console.log("------------------------");
        console.log("Prospect: " + (prospect.name || "Unknown"));

        if (missing.length > 0) {
            console.log("Confirmation blocked. Missing core discovery fields: " + missing.join(", "));
            console.log("Run prospect discovery and prospect qualification first.");
            return true;
        }

        if (prospect.qualification?.status !== "READY FOR CONFIRMATION") {
            console.log("Confirmation blocked. Run 'prospect qualification' first and review the recorded fields.");
            console.log("Only use this command after the buyer has confirmed the recorded information.");
            return true;
        }

        const confirmedAt = new Date().toISOString();
        prospect.qualification = {
            status: "QUALIFIED",
            checkedAt: prospect.qualification.checkedAt || confirmedAt,
            confirmedAt,
            confirmationSource: "ZAYN_CONFIRMED_BUYER_EVIDENCE",
            confirmedBy: "Zayn",
            missing: []
        };
        saveJson(businessFile, business);

        console.log("QUALIFICATION: QUALIFIED");
        console.log("Buyer confirmation recorded by Zayn.");
        console.log("Commercial review may proceed; external actions still require approval.");
        console.log("Reminder: only record this confirmation after checking the details with the buyer.");
        return true;
    }

    // STEP 19: PROSPECT QUALIFICATION
    if (
        lower === "prospect qualification" ||
        lower === "qualify prospect" ||
        lower === "qualify this prospect" ||
        lower === "is this prospect qualified"
    ) {
        const activeProspects = business.prospects.filter(
            (item) => item.status !== "CLOSED"
        );

        if (activeProspects.length === 0) {
            console.log("\nJARVIS > No active prospect found.");
            return true;
        }

        const prospect = resolveActiveProspect(business);
        if (!prospect) return true;

        if (!prospect.discovery) {
            console.log("\nJARVIS > Discovery has not been started for this prospect.");
            console.log("Run: prospect discovery");
            return true;
        }

        const d = prospect.discovery;

        const requiredFields = [
            ["problem", d.problem],
            ["impact", d.impact],
            ["current solution", d.currentSolution],
            ["desired outcome", d.desiredOutcome],
            ["decision maker", d.decisionMaker]
        ];

        const missing = requiredFields
            .filter((item) => !item[1] || !item[1].trim())
            .map((item) => item[0]);

        console.log("\nJARVIS PROSPECT QUALIFICATION");
        console.log("-----------------------------");
        console.log(`Prospect: ${prospect.name}`);

        if (missing.length === 0) {
            const buyerConfirmationRecorded =
                prospect.qualification?.status === "QUALIFIED" &&
                prospect.qualification?.confirmationSource === "ZAYN_CONFIRMED_BUYER_EVIDENCE" &&
                Boolean(prospect.qualification?.confirmedAt);

            if (!buyerConfirmationRecorded) {
                prospect.qualification = {
                    status: "READY FOR CONFIRMATION",
                    checkedAt: new Date().toISOString(),
                    missing: [],
                    note: "Core discovery fields are present; buyer confirmation is still required."
                };
                saveJson(businessFile, business);
            }

            if (buyerConfirmationRecorded) {
                console.log("\nQUALIFICATION: QUALIFIED");
                console.log("Recorded buyer confirmation is present.");
            } else {
                console.log("\nQUALIFICATION: READY FOR CONFIRMATION");
                console.log("Core discovery fields are recorded, but they are not automatically treated as buyer-verified.");
                console.log("Confirm these details with the buyer, then run: confirm prospect qualification");
            }
            console.log("Budget and timeline must still be confirmed before a commercial proposal.");
        } else {
            prospect.qualification = {
                status: "NEEDS MORE DISCOVERY",
                checkedAt: new Date().toISOString(),
                missing
            };

            saveJson(businessFile, business);

            console.log("\nQUALIFICATION: NEEDS MORE DISCOVERY");
            console.log("Missing information:");
            missing.forEach((item, index) => {
                console.log(`${index + 1}. ${item}`);
            });
        }

        const state = loadJson("cofounder-state.json", {});
    const research = Array.isArray(state.research) ? state.research : [];
    const prospectResearch = research.filter((entry) =>
        entry.prospectName === prospect.name
    );

    console.log("\nEVIDENCE");
    console.log("--------");
    if (prospectResearch.length === 0) {
        console.log("EVIDENCE: INSUFFICIENT");
    } else {
        prospectResearch.slice(-5).forEach((entry) => {
            console.log("- " + (entry.result || entry.query || "Research available"));
        });
    }

    const researchText = prospectResearch
        .map((entry) => `${entry.query || ""}\n${entry.result || ""}`)
        .join("\n")
        .toLowerCase();

    const matchedSignals = [
        "website",
        "whatsapp",
        "24/7",
        "customer enquiries",
        "customer support",
        "digital"
    ].filter((term) => researchText.includes(term));

    console.log("\nCOMMERCIAL SIGNALS:");
    if (matchedSignals.length === 0) {
        console.log("UNKNOWN");
    } else {
        matchedSignals.forEach((signal) => console.log("- " + signal));
    }

    console.log("\nHYPOTHESES:");
    if (researchText.includes("whatsapp")) {
        console.log("- Manual enquiry handling may consume staff time (HYPOTHESIS)");
        console.log("- Lead follow-up may be inconsistent (HYPOTHESIS)");
    } else {
        console.log("UNKNOWN");
    }

    console.log("\nUNKNOWN:");
    console.log("- Budget");
    console.log("- Timeline");
    console.log("- Confirmed business impact");
    console.log("- Expected return");

    console.log("\nJUDGEMENT: " + (prospectResearch.length === 0 ? "NOT ENOUGH EVIDENCE" : "INVESTIGATE"));
    console.log("External action: BLOCKED");
    console.log("\nJARVIS RULE");
        console.log("--------------------");
        console.log("Qualification must be based on recorded evidence. Do not invent missing information.");

        return true;
    }
    // STEP 19: PROSPECT RECOMMENDATION
    if (
        lower === "prospect recommendation" ||
        lower === "recommend for prospect" ||
        lower === "recommendation for prospect" ||
        lower === "what should we offer this prospect"
    ) {
        const activeProspects = business.prospects.filter(
            (item) => item.status !== "CLOSED"
        );

        if (activeProspects.length === 0) {
            console.log("\nJARVIS > No active prospect found.");
            return true;
        }

        const prospect = resolveActiveProspect(business);
        if (!prospect) return true;
        const d = prospect.discovery || {};

        console.log("\nJARVIS PROSPECT RECOMMENDATION");
        console.log("------------------------------");
        console.log(`Prospect: ${prospect.name}`);

        const coreFields = [
            d.problem,
            d.impact,
            d.currentSolution,
            d.desiredOutcome,
            d.decisionMaker
        ];

        const discoveredCount = coreFields.filter(
            (item) => item && item.trim()
        ).length;

        if (!d.problem || !d.problem.trim()) {
            console.log("\nSTATUS: INSUFFICIENT DISCOVERY");
            console.log("No confirmed business problem has been recorded.");
            console.log("Recommendation: continue discovery.");
            return true;
        }

        if (discoveredCount < 5) {
            console.log("\nSTATUS: POSSIBLE ZAYZANA FIT");
            console.log("A business problem has been recorded, but discovery is incomplete.");
            console.log("\nCURRENT EVIDENCE");
            console.log("----------------");
            console.log(`Problem: ${d.problem}`);

            if (d.impact) {
                console.log(`Impact: ${d.impact}`);
            }

            console.log("\nPOSSIBLE AREAS TO INVESTIGATE");
            console.log("-----------------------------");
            console.log("- AI automation");
            console.log("- Business process automation");
            console.log("- Customer support tools");
            console.log("- Internal tools");
            console.log("- Website or lightweight software");

            console.log("\nRECOMMENDATION");
            console.log("--------------");
            console.log("Do not select a final solution yet.");
            console.log("Complete discovery before proposing a specific Zayzana solution.");
        } else {
            console.log("\nSTATUS: READY FOR REVIEW");
            console.log("Core discovery information has been recorded.");

            console.log("\nDISCOVERED BUSINESS NEED");
            console.log("------------------------");
            console.log(`Problem: ${d.problem}`);
            console.log(`Impact: ${d.impact}`);
            console.log(`Current solution: ${d.currentSolution}`);
            console.log(`Desired outcome: ${d.desiredOutcome}`);
            console.log(`Decision maker: ${d.decisionMaker}`);

            console.log("\nPOTENTIAL ZAYZANA AREAS");
            console.log("-----------------------");
            console.log("- AI automation");
            console.log("- Business process automation");
            console.log("- Customer support tools");
            console.log("- Internal tools");
            console.log("- Website or lightweight software");

            console.log("\nJARVIS RECOMMENDATION");
            console.log("---------------------");
            console.log("Review the recorded problem and outcome before selecting the specific solution.");
            console.log("No proposal or external action should occur without Zayn's approval.");
        }

        const state = loadJson("cofounder-state.json", {});
    const research = Array.isArray(state.research) ? state.research : [];
    const prospectResearch = research.filter((entry) =>
        entry.prospectName === prospect.name
    );

    console.log("\nEVIDENCE");
    console.log("--------");
    if (prospectResearch.length === 0) {
        console.log("EVIDENCE: INSUFFICIENT");
    } else {
        prospectResearch.slice(-5).forEach((entry) => {
            console.log("- " + (entry.result || entry.query || "Research available"));
        });
    }

    const researchText = prospectResearch
        .map((entry) => `${entry.query || ""}\n${entry.result || ""}`)
        .join("\n")
        .toLowerCase();

    const matchedSignals = [
        "website",
        "whatsapp",
        "24/7",
        "customer enquiries",
        "customer support",
        "digital"
    ].filter((term) => researchText.includes(term));

    console.log("\nCOMMERCIAL SIGNALS:");
    if (matchedSignals.length === 0) {
        console.log("UNKNOWN");
    } else {
        matchedSignals.forEach((signal) => console.log("- " + signal));
    }

    console.log("\nHYPOTHESES:");
    if (researchText.includes("whatsapp")) {
        console.log("- Manual enquiry handling may consume staff time (HYPOTHESIS)");
        console.log("- Lead follow-up may be inconsistent (HYPOTHESIS)");
    } else {
        console.log("UNKNOWN");
    }

    console.log("\nUNKNOWN:");
    console.log("- Budget");
    console.log("- Timeline");
    console.log("- Confirmed business impact");
    console.log("- Expected return");

    console.log("\nJUDGEMENT: " + (prospectResearch.length === 0 ? "NOT ENOUGH EVIDENCE" : "INVESTIGATE"));
    console.log("External action: BLOCKED");
    console.log("\nJARVIS RULE");
        console.log("--------------------");
        console.log("Evidence first. Recommendation second. Zayn approval before action.");

        return true;
    }
    // PROSPECTS
    if (
        lower === "prospects" ||
        lower === "show prospects" ||
        lower === "show my prospects" ||
        lower === "clients" ||
        lower === "show clients"
    ) {
        showProspects();
        return true;
    }

    // OPPORTUNITIES
    if (
        lower === "opportunities" ||
        lower === "show opportunities" ||
        lower === "business opportunities"
    ) {
        showOpportunities();
        return true;
    }

    // OFFERS
    if (
        lower === "offers" ||
        lower === "show offers" ||
        lower === "what can we sell"
    ) {
        showOffers();
        return true;
    }

    // FOLLOW-UPS
    if (
        lower === "follow ups" ||
        lower === "follow-ups" ||
        lower === "show follow ups" ||
        lower === "show follow-ups"
    ) {
        showFollowUps();
        return true;
    }

    // REVENUE
    if (
        lower === "revenue" ||
        lower === "show revenue" ||
        lower === "money"
    ) {
        showRevenue();
        return true;
    }

    // ADD BUSINESS DATA
    if (lower.startsWith("add prospect ")) {
        addProspect(trimmed.substring(13).trim());
        return true;
    }

    if (lower.startsWith("add opportunity ")) {
        addOpportunity(trimmed.substring(16).trim());
        return true;
    }

    if (lower.startsWith("add offer ")) {
        addOffer(trimmed.substring(10).trim());
        return true;
    }

    if (
        lower.startsWith("add follow up ") ||
        lower.startsWith("add follow-up ")
    ) {
        addFollowUp(trimmed.substring(14).trim());
        return true;
    }

    if (lower.startsWith("add revenue ")) {
        const parts = trimmed.substring(12).trim().split(" ");
        const amount = parts.shift();
        const description = parts.join(" ");

        addRevenue(amount, description);
        return true;
    }

    // PROJECT INFO
    if (lower.startsWith("tell me about ")) {
        const projectKey = detectProject(trimmed);

        if (projectKey) {
            showProject(projectKey);
        } else {
            console.log("JARVIS > I don't recognise that project.");
        }

        return true;
    }

    // WEBSITE COMMANDS
    if (lower === "open fishing") {
        openWebsite("fishing");
        return true;
    }

    if (lower === "open taalhuis") {
        openWebsite("taalhuis");
        return true;
    }

    if (lower === "open sizani") {
        openWebsite("sizani");
        return true;
    }

    if (lower === "open zayzana") {
        openWebsite("zayzana");
        return true;
    }

    if (lower === "open github") {
        openWebsite("github");
        return true;
    }

    // EXIT
    if (
        lower === "exit" ||
        lower === "quit" ||
        lower === "close"
    ) {
        console.log("JARVIS > Shutting down.");
        process.exit(0);
    }

    // DECISION LAYER
    if (decide(trimmed)) {
        return true;
    }

    // SMART LAYER
    const smartResult = smartUnderstand(trimmed);

    if (smartResult === "OPERATING") {
        showOperatingBrain();
        return true;
    }

    if (smartResult === "FOCUS") {
        showZayzanaFocus();
        return true;
    }

    if (smartResult === "PROSPECT_INTELLIGENCE") {
        showProspectIntelligence();
        return true;
    }

    if (smartResult === "BUSINESS") {
        showBusinessOverview();
        return true;
    }

    if (smartResult === "ACTION") {
        showActionBrain();
        return true;
    }

    if (smartResult === "PRIORITIES") {
        showBusinessPriorities();
        return true;
    }

    console.log(
        "JARVIS > I understand the command, but I don't have an action for it yet."
    );

    return true;
}

// --------------------------------------------------
// START JARVIS
// --------------------------------------------------

console.log("\n=================================");
console.log("        JARVIS ONLINE");
console.log("=================================");
console.log("Zayzana local business assistant");
console.log("Step 18 - Prospect Intelligence");
console.log("");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "JARVIS > "
});

rl.prompt();

rl.on("line", (line) => {
    handleCommand(line);
    rl.prompt();
}).on("close", () => {
    console.log("\nJARVIS > Session ended.");
});




const commercialBrain = {
    analyze() {
        const state = JSON.parse(fs.readFileSync("cofounder-state.json", "utf8"));
        const business = JSON.parse(fs.readFileSync("business.json", "utf8"));

        const prospects = business.prospects || [];
        const opportunities = business.opportunities || [];
        const followUps = business.followUps || [];

        const openProspects = prospects.filter(p => p.status !== "CLOSED");
        const openOpportunities = opportunities.filter(o => o.status === "OPEN");
        const openFollowUps = followUps.filter(f => f.status === "OPEN");
        const activeProspect = resolveActiveProspect(business);

        console.log("");
        console.log("JARVIS COMMERCIAL BRAIN");
        console.log("=======================");

        console.log("");
        console.log("COMMERCIAL PIPELINE");
        console.log("-------------------");
        console.log("Open prospects: " + openProspects.length);
        console.log("Open opportunities: " + openOpportunities.length);
        console.log("Open follow-ups: " + openFollowUps.length);

        if (openProspects.length === 0 && openOpportunities.length === 0) {
            console.log("");
            console.log("COMMERCIAL STATUS");
            console.log("-----------------");
            console.log("No active commercial opportunity is currently recorded.");
            console.log("Next step: identify and record a real prospect or opportunity.");
            return;
        }

        if (activeProspect) {
            const prospect = activeProspect;
            const discovery = prospect.discovery || {};
            const qualification = prospect.qualification || {};

            console.log("");
            console.log("ACTIVE PROSPECT");
            console.log("---------------");
            console.log("Name: " + (prospect.name || "Unknown"));
            console.log("Qualification: " + (qualification.status || "NOT CHECKED"));

            console.log("");
            console.log("COMMERCIAL EVIDENCE");
            console.log("-------------------");
            console.log("Problem: " + (discovery.problem || "Not recorded"));
            console.log("Impact: " + (discovery.impact || "Not recorded"));
            console.log("Desired outcome: " + (discovery.desiredOutcome || "Not recorded"));
            console.log("Decision maker: " + (discovery.decisionMaker || "Not recorded"));
            console.log("Budget: " + (discovery.budget || "Not recorded"));
            console.log("Timeline: " + (discovery.timeline || "Not recorded"));

            console.log("");
            console.log("COMMERCIAL GAPS");

            const gaps = [];

            if (!discovery.problem) gaps.push("business problem");
            if (!discovery.impact) gaps.push("business impact");
            if (!discovery.desiredOutcome) gaps.push("desired outcome");
            if (!discovery.decisionMaker) gaps.push("decision maker");
            if (!discovery.budget) gaps.push("budget");
            if (!discovery.timeline) gaps.push("timeline");

            if (gaps.length === 0) {
                console.log("-----------------");
                console.log("No major recorded commercial information gaps.");
            } else {
                console.log("-----------------");
                gaps.forEach((gap, index) => {
                    console.log((index + 1) + ". " + gap);
                });
            }

            console.log("");
            console.log("");
console.log("POTENTIAL ZAYZANA OFFER FIT");
console.log("--------------------------");

const problemText = (discovery.problem || "").toLowerCase();
const matchingOffers = commercialOffers.filter(offer =>
    offer.solves.some(term => problemText.includes(term.toLowerCase()))
);

if (matchingOffers.length === 0) {
    console.log("No direct offer match identified from the recorded problem.");
    console.log("Do not force an offer. Continue discovery.");
} else {
    matchingOffers.forEach((offer, index) => {
        console.log((index + 1) + ". " + offer.name);
        console.log("   Potential outcome: " + offer.outcome);
    });
}
console.log("");console.log("COMMERCIAL READ");
            console.log("---------------");

            if (qualification.status !== "QUALIFIED") {
                console.log("Do not treat this prospect as sales-ready yet.");
                console.log("Complete the missing discovery and qualification evidence.");
            } else if (gaps.length > 0) {
                console.log("Prospect is qualified, but commercial terms still need confirmation.");
                console.log("Confirm budget and timeline before preparing a commercial proposal.");
            } else {
                console.log("Recorded evidence is sufficient for commercial review.");
                console.log("Next question: what Zayzana offer directly addresses the confirmed problem and outcome?");
            }
        }

        if (openOpportunities.length > 0) {
            console.log("");
            console.log("OPEN OPPORTUNITY");
            console.log("----------------");
            console.log(openOpportunities[0].text || "Opportunity recorded without description.");
        }

        if (openFollowUps.length > 0) {
            console.log("");
            console.log("CURRENT COMMERCIAL FOLLOW-UP");
            console.log("-----------------------------");
            console.log(openFollowUps[0].text || "Follow-up recorded without description.");
        }

        console.log("");
        console.log("");
console.log("COMMERCIAL NEXT ACTION");
console.log("----------------------");

let commercialNextAction = "";

if (activeProspect) {
    const active = activeProspect;
    const d = active.discovery || {};
    const q = active.qualification || {};

    if (!d.problem) {
            active.currentDiscoveryField = "problem";
        commercialNextAction = "Capture the prospect's confirmed business problem.";
    } else if (!d.impact) {
            active.currentDiscoveryField = "impact";
        commercialNextAction = "Ask how the problem affects time, cost, revenue, customers or staff capacity.";
    } else if (!d.desiredOutcome) {
            active.currentDiscoveryField = "desiredOutcome";
        commercialNextAction = "Ask what measurable outcome the prospect wants instead.";
    } else if (!d.decisionMaker) {
            active.currentDiscoveryField = "decisionMaker";
        commercialNextAction = "Confirm who makes or approves the buying decision.";
    } else if (!d.budget) {
            active.currentDiscoveryField = "budget";
        commercialNextAction = "Confirm whether a budget or spending range exists for solving the problem.";
    } else if (!d.timeline) {
            active.currentDiscoveryField = "timeline";
        commercialNextAction = "Confirm when the prospect wants the problem solved.";
    } else if (q.status !== "QUALIFIED") {
        commercialNextAction = "Run prospect qualification using the completed discovery evidence.";
    } else {
        commercialNextAction = "Review the matching Zayzana offer and prepare commercial terms for Zayn's approval.";
    }
} else if (openOpportunities.length > 0) {
    commercialNextAction = "Review the open opportunity and identify the next buyer-facing action.";
} else {
    commercialNextAction = "Identify and record the next real commercial prospect.";
}

console.log(commercialNextAction);
console.log("");console.log("");
console.log("DISCOVERY QUESTION");
console.log("------------------");

let discoveryQuestion = "";

if (activeProspect) {
    const active = activeProspect;
    const d = active.discovery || {};

    if (!d.problem) {
            active.currentDiscoveryField = "problem";
        discoveryQuestion = "What specific business problem are you trying to solve?";
    } else if (!d.impact) {
            active.currentDiscoveryField = "impact";
        discoveryQuestion = "You mentioned that " + d.problem + ". Roughly how much time, cost, customer impact or staff capacity does this issue affect?";
    } else if (!d.desiredOutcome) {
            active.currentDiscoveryField = "desiredOutcome";
        discoveryQuestion = "If we solved that problem, what specific result would you want to see instead?";
    } else if (!d.decisionMaker) {
            active.currentDiscoveryField = "decisionMaker";
        discoveryQuestion = "Who would normally be involved in approving or deciding on a solution to this problem?";
    } else if (!d.budget) {
            active.currentDiscoveryField = "budget";
        discoveryQuestion = "Has the business already set aside a budget or spending range for solving this problem?";
    } else if (!d.timeline) {
            active.currentDiscoveryField = "timeline";
        discoveryQuestion = "When would you ideally want this problem solved or the new process in place?";
    } else {
        discoveryQuestion = "What would make you confident that the proposed solution has delivered the result you want?";
    }
}

console.log(discoveryQuestion || "No active prospect requires a discovery question.");
console.log("");console.log("COMMERCIAL RULE");
        console.log("---------------");
        console.log("Sell against a confirmed business problem, measurable impact and desired outcome.");
        console.log("Do not invent budget, urgency, authority or buying intent.");
        console.log("Do not create a proposal or external action without Zayn's approval.");
    }
};





function buildCommercialRecommendation(prospect, offers) {
    const discovery = prospect.discovery || {};
    const problemText = (discovery.problem || "").toLowerCase();

    const matches = offers.map(offer => {
        const matchedTerms = offer.solves.filter(term =>
            problemText.includes(term.toLowerCase())
        );

        return {
            offer,
            matchedTerms,
            matchCount: matchedTerms.length
        };
    })
    .filter(item => item.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);

    const primary = matches[0] || null;
    const alternative = matches[1] || null;

    const unknowns = [];

    if (!discovery.budget) unknowns.push("budget");
    if (!discovery.timeline) unknowns.push("timeline");

    return {
        prospect: prospect.name || "Unknown",
        primaryOffer: primary ? primary.offer.name : null,
        primaryOutcome: primary ? primary.offer.outcome : null,
        primaryEvidence: primary ? primary.matchedTerms : [],
        alternativeOffer: alternative ? alternative.offer.name : null,
        alternativeOutcome: alternative ? alternative.offer.outcome : null,
        unknowns,
        approvalRequired: true,
        externalActionAllowed: false
    };
}
const commercialOffers = [
    {
        name: "AI Automation",
        solves: ["manual customer enquiries", "repetitive admin", "manual workflows"],
        outcome: "Reduce repetitive staff work and improve response speed"
    },
    {
        name: "Business Process Automation",
        solves: ["manual processes", "repetitive tasks", "workflow bottlenecks"],
        outcome: "Make recurring business processes faster and more consistent"
    },
    {
        name: "Customer Support Tool",
        solves: ["customer enquiries", "slow responses", "support workload"],
        outcome: "Improve customer response handling and reduce staff workload"
    },
    {
        name: "Internal Business Tool",
        solves: ["spreadsheet-heavy work", "manual tracking", "information scattered across systems"],
        outcome: "Centralise business information and reduce manual administration"
    },
    {
        name: "Website / Lightweight Software",
        solves: ["poor online workflow", "manual customer intake", "lack of digital self-service"],
        outcome: "Create a simple digital workflow around a real business need"
    }
];


function buildActionQueue() {
    const heartbeat = evaluateHeartbeat();
    const actions = [];

    heartbeat.signals.forEach(signal => {
        if (signal.type === "FOLLOW_UP") {
            actions.push({
                priority: signal.priority,
                reason: signal.message,
                type: "FOLLOW_UP",
                action: `Review and work the open follow-up(s): ${(business.followUps || []).map(item => item.text).filter(Boolean).join("; ") || "Details not recorded."}`,
                approvalRequired: true
            });
        }

        if (signal.type === "APPROVAL") {
            actions.push({
                priority: signal.priority,
                reason: signal.message,
                type: "APPROVAL",
                action: "Review the active approval(s) and confirm whether they are still valid.",
                approvalRequired: true
            });
        }

        if (signal.type === "COMMERCIAL") {
            actions.push({
                priority: signal.priority,
                reason: signal.message,
                type: "COMMERCIAL",
                action: "Review available research and identify one legitimate commercial opportunity.",
                approvalRequired: true
            });
        }

        if (signal.type === "RESEARCH") {
            actions.push({
                priority: signal.priority,
                reason: signal.message,
                type: "RESEARCH",
                action: "Review the unverified research and decide whether any finding should become a verified Zayzana fact.",
                approvalRequired: true
            });
        }
    });

    actions.sort((a, b) => b.priority - a.priority);

    return {
        generatedAt: new Date().toISOString(),
        actions
    };
}

function showActionQueue() {
    const queue = buildActionQueue();

    console.log("\nCOFOUNDER ACTION QUEUE");
    console.log("----------------------");
    console.log(`Generated: ${queue.generatedAt}`);

    if (queue.actions.length === 0) {
        console.log("No recommended actions.");
        console.log("Cofounder remains quiet.");
        return;
    }

    queue.actions.forEach((action, index) => {
        console.log(`\n${index + 1}. [${action.type}]`);
        console.log('Priority:', action.priority);
        console.log("Action:", action.action);
        console.log('Reason:', action.reason || 'No reason recorded.');
        console.log("Approval:", action.approvalRequired ? "Zayn approval required" : "Not required");
    });

    console.log("\nACTION RULE");
    console.log("Recommendations only. Nothing is executed automatically.");
}








function commercialAssessment() {
    const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
    const prospects = Array.isArray(business.prospects) ? business.prospects : [];
    const prospect = resolveActiveProspect(business);

    console.log("");
    console.log("JARVIS COMMERCIAL ASSESSMENT");
    console.log("============================");

    if (!prospect) {
        console.log("CUSTOMER: UNKNOWN");
        console.log("VALUE: UNKNOWN");
        console.log("MONEY: UNKNOWN");
        console.log("EVIDENCE: INSUFFICIENT");
        console.log("EFFORT: UNKNOWN");
        console.log("RETURN: UNKNOWN");
        console.log("STRATEGIC FIT: UNKNOWN");
        console.log("RISK: HIGH");
        console.log("JUDGEMENT: NOT ENOUGH EVIDENCE");
        console.log("NEXT ACTION: Identify and record a real commercial prospect.");
        console.log("External action: BLOCKED");
        console.log("");
        return;
    }

    const discovery = prospect.discovery || {};

    const hasProblem = Boolean(discovery.problem);
    const hasImpact = Boolean(discovery.impact);
    const hasOutcome = Boolean(discovery.desiredOutcome);
    const hasDecisionMaker = Boolean(discovery.decisionMaker);
    const hasBudget = Boolean(discovery.budget);
    const hasTimeline = Boolean(discovery.timeline);
    const hasStrategicFit = Boolean(discovery.strategicFit);

    const coreEvidence = [
        hasProblem,
        hasImpact,
        hasOutcome,
        hasDecisionMaker
    ].filter(Boolean).length;

    let evidenceStatus = "INSUFFICIENT";

    if (coreEvidence === 4) {
        evidenceStatus = "STRONG";
    } else if (coreEvidence >= 2) {
        evidenceStatus = "PARTIAL";
    }

    let money = "UNKNOWN";
    if (hasBudget) {
        money = discovery.budget;
    }

    let returnAssessment = "UNKNOWN";

    let effort = "UNKNOWN";
    if (hasProblem && hasOutcome) {
        effort =
            "Potential Zayzana solution effort requires further scoping before a reliable estimate.";
    }

    let strategicFit = hasStrategicFit
        ? discovery.strategicFit
        : "Not explicitly established";

    let risk = "HIGH";

    if (evidenceStatus === "STRONG" && hasBudget && hasTimeline && hasStrategicFit) {
        risk = "MEDIUM";
    } else if (evidenceStatus === "PARTIAL") {
        risk = "HIGH";
    }

    let judgement = "NOT ENOUGH EVIDENCE";
    let nextAction = "Complete the missing commercial discovery before deciding whether to pursue.";

    if (evidenceStatus === "STRONG") {
        if (
            prospect.qualification?.status !== "QUALIFIED" ||
            prospect.qualification?.confirmationSource !== "ZAYN_CONFIRMED_BUYER_EVIDENCE" ||
            !prospect.qualification?.confirmedAt
        ) {
            judgement = "INVESTIGATE";
            nextAction = "Run prospect qualification using the recorded discovery evidence before recommending pursuit.";
        } else if (!hasBudget || !hasTimeline) {
            judgement = "INVESTIGATE";
            nextAction = "Confirm commercial constraints, especially budget and timeline, before recommending pursuit.";
        } else if (!hasStrategicFit) {
            judgement = "INVESTIGATE";
            nextAction = "Establish whether the opportunity fits Zayzana's current commercial strategy.";
        } else {
            judgement = "PURSUE";
            nextAction = "Prepare the opportunity for Zayn's review and approval; do not contact the prospect yet.";
        }
    } else if (evidenceStatus === "PARTIAL") {
        judgement = "INVESTIGATE";
        nextAction = "Strengthen the evidence around the business problem, impact, desired outcome and decision authority.";
    }

    console.log("CUSTOMER: " + (prospect.name || "Unknown"));
    console.log("VALUE: " + (discovery.desiredOutcome || "UNKNOWN"));
    console.log("MONEY: " + money);
    console.log("EVIDENCE: " + evidenceStatus);
    console.log("EFFORT: " + effort);
    console.log("RETURN: " + returnAssessment);
    console.log("STRATEGIC FIT: " + strategicFit);
    console.log("RISK: " + risk);
    console.log("JUDGEMENT: " + judgement);
    console.log("NEXT ACTION: " + nextAction);
    console.log("External action: BLOCKED");
    console.log("");
}



