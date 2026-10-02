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

function addReminder(message, time) {
    if (!message || !time) return;

    reminders.push({
        id: Date.now(),
        message,
        time,
        fired: false
    });

    saveJson(remindersFile, reminders);

    console.log(
        `JARVIS > Reminder saved: ${message} — ${new Date(time).toLocaleString()}`
    );
}

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
            `${index + 1}. [${status}] ${reminder.message} — ${new Date(
                reminderTime
            ).toLocaleString()}`
        );
    });
}

function checkReminders() {
    reminders.forEach((reminder) => {
        const reminderTime = reminder.time || reminder.dueAt;

        if (!reminder.fired && reminderTime && Date.now() >= reminderTime) {
            console.log(
                `\n🔔 JARVIS REMINDER: ${reminder.message}\n`
            );

            reminder.fired = true;
            saveJson(remindersFile, reminders);
        }
    });
}

setInterval(checkReminders, 1000);

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
        `JARVIS > Revenue recorded: ${numericAmount} — ${
            description || "No description"
        }`
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
            `${index + 1}. ${item.amount} — ${
                item.description || "No description"
            }`
        );
    });

    console.log(`\nTotal recorded revenue: ${total}`);
}

// --------------------------------------------------
// STEP 15 — ACTION BRAIN
// --------------------------------------------------

function showActionBrain() {
    console.log("\nJARVIS ACTION BRAIN");
    console.log("-------------------");

    const openProspects = business.prospects.filter(
        (item) => item.status !== "CLOSED"
    );

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

    if (openProspects.length > 0) {
        console.log(
            `Work the next prospect: ${openProspects[0].name}`
        );
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

    if (openProspects.length > 0) {
        console.log(
            `2. Prospect: ${openProspects[0].name}`
        );
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
// STEP 16 — ZAYZANA OPERATING BRAIN
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

    if (openProspects.length > 0) {
        console.log(
            `1. Work the next prospect: ${openProspects[0].name}`
        );
        console.log(
            "2. Identify the business problem."
        );
        console.log(
            "3. Match it to a Zayzana offer."
        );
        console.log(
            "4. Capture reusable components from the solution."
        );
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
// STEP 17 — OPPORTUNITY ACTION BRAIN
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

    if (openProspects.length > 0) {
        console.log(
            `1. Contact the prospect: ${openProspects[0].name}`
        );
        console.log(
            "2. Discover the business problem."
        );
        console.log(
            "3. Match the problem to a Zayzana offer."
        );
        console.log(
            "4. Record the opportunity."
        );
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

    const openOpportunities = business.opportunities.filter(
        (item) => item.status === "OPEN"
    );

    if (openFollowUps.length > 0) {
        console.log(
            `CURRENT FOCUS: Follow-up — ${openFollowUps[0].text}`
        );
        return;
    }

    if (openProspects.length > 0) {
        console.log(
            `CURRENT FOCUS: Prospect — ${openProspects[0].name}`
        );
        return;
    }

    if (openOpportunities.length > 0) {
        console.log(
            `CURRENT FOCUS: Opportunity — ${openOpportunities[0].text}`
        );
        return;
    }

    console.log(
        "CURRENT FOCUS: Find and record the next real business opportunity."
    );
}

// --------------------------------------------------
// STEP 18 — PROSPECT INTELLIGENCE
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

    const prospect = activeProspects[0];

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
            "INSUFFICIENT INFORMATION — do not assume the prospect's problem."
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

    console.log("\nJARVIS RULE");
    console.log("-----------");
    console.log(
        "Do not invent facts about the prospect. Discover first, propose second."
    );
}

// --------------------------------------------------
 // --------------------------------------------------
 // STEP 19 — PROSPECT DISCOVERY
 // --------------------------------------------------

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

     const prospect = activeProspects[0];

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

     console.log("\nJARVIS RULE");
     console.log("-----------");
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
                `Decision: WORK_ON → ${projectKey}`
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

// --------------------------------------------------
// DIRECT COMMANDS
// --------------------------------------------------

function handleCommand(input) {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
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
            action: approval.action,
            approvedBy: approval.approvedBy || "Zayn",
            approvedDate: approval.date || new Date().toISOString(),
            executedBy: "JARVIS",
            executedDate: new Date().toISOString(),
            status: "INTERNAL_ACTION_RECORDED"
        };

        state.executions.push(execution);
        approval.status = "EXECUTED";
        approval.executedDate = execution.executedDate;
        approval.executionStatus = execution.status;

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
        const incompleteProspects = prospects.filter(p => p.qualification && p.qualification.status !== "QUALIFIED");
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
        const incomplete = prospects.filter(p => p.qualification && p.qualification.status !== "QUALIFIED");
        if (incomplete.length > 0) {
            const missing = incomplete[0].qualification.missing || [];
            console.log("Prospect discovery is incomplete. Missing: " + (missing.join(", ") || "additional qualification data") + ".");
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
        } else {
            console.log("Choose and record one concrete next action.");
        }

        console.log("\nAPPROVAL");
        console.log("No external action taken. Zayn approval is required before execution.");
        return true;
    }

    if (input === "next discovery" || input === "discovery question") {
    const business = JSON.parse(fs.readFileSync("business.json", "utf8"));
    const prospects = business.prospects || [];
    const active = prospects.find(p => p.status !== "CLOSED");

    console.log("");
    console.log("NEXT DISCOVERY QUESTION");
    console.log("-----------------------");

    if (!active) {
        console.log("No active prospect is currently recorded.");
    } else {
        const d = active.discovery || {};

        if (!d.problem) {
            console.log("What specific business problem are you trying to solve?");
        } else if (!d.impact) {
            console.log("Roughly how many staff hours per week are being spent handling these customer enquiries?");
        } else if (!d.desiredOutcome) {
            console.log("If we solved that problem, what specific result would you want to see instead?");
        } else if (!d.decisionMaker) {
            console.log("Who would normally be involved in approving or deciding on a solution to this problem?");
        } else if (!d.budget) {
            console.log("Has the business already set aside a budget or spending range for solving this problem?");
        } else if (!d.timeline) {
            console.log("When would you ideally want this problem solved or the new process in place?");
        } else {
            console.log("Discovery evidence is complete. Proceed to qualification and commercial review.");
        }
    }

    console.log("");
    return;
}
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

    // STEP 19 — PROSPECT DISCOVERY
    if (
        lower === "prospect discovery" ||
        lower === "prospect discovery brain" ||
        lower === "discover prospect" ||
        lower === "what do we need to discover"
    ) {
        showProspectDiscovery();
        return true;
    }
    // STEP 19 — DISCOVERY CAPTURE
    if (lower.startsWith("discovery ")) {
        const parts = trimmed.split(" ");
        const field = parts[1];
        const value = parts.slice(2).join(" ").trim();

        const validFields = [
            "problem",
            "impact",
            "current",
            "solution",
            "outcome",
            "decision",
            "maker",
            "budget",
            "timeline",
            "notes"
        ];

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

        const prospect = activeProspects[0];

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
        saveJson(businessFile, business);

        console.log(`JARVIS > Discovery saved: ${fieldMap[field]}`);
        return true;
    }
    // STEP 19 — PROSPECT QUALIFICATION
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

        const prospect = activeProspects[0];

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
            prospect.qualification = {
                status: "QUALIFIED",
                checkedAt: new Date().toISOString(),
                missing: []
            };

            saveJson(businessFile, business);

            console.log("\nQUALIFICATION: QUALIFIED");
            console.log("Enough core discovery information has been recorded.");
            console.log("Budget and timeline can still be confirmed before a commercial proposal.");
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

        console.log("\nJARVIS RULE");
        console.log("-----------");
        console.log("Qualification must be based on recorded evidence. Do not invent missing information.");

        return true;
    }
    // STEP 19 — PROSPECT RECOMMENDATION
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

        const prospect = activeProspects[0];
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
            console.log("• AI automation");
            console.log("• Business process automation");
            console.log("• Customer support tools");
            console.log("• Internal tools");
            console.log("• Website or lightweight software");

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
            console.log("AI automation");
            console.log("Business process automation");
            console.log("Customer support tools");
            console.log("Internal tools");
            console.log("Website or lightweight software");

            console.log("\nJARVIS RECOMMENDATION");
            console.log("---------------------");
            console.log("Review the recorded problem and outcome before selecting the specific solution.");
            console.log("No proposal or external action should occur without Zayn's approval.");
        }

        console.log("\nJARVIS RULE");
        console.log("-----------");
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

        if (openProspects.length > 0) {
            const prospect = openProspects[0];
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

if (openProspects.length > 0) {
    const active = openProspects[0];
    const d = active.discovery || {};
    const q = active.qualification || {};

    if (!d.problem) {
        commercialNextAction = "Capture the prospect's confirmed business problem.";
    } else if (!d.impact) {
        commercialNextAction = "Ask how the problem affects time, cost, revenue, customers or staff capacity.";
    } else if (!d.desiredOutcome) {
        commercialNextAction = "Ask what measurable outcome the prospect wants instead.";
    } else if (!d.decisionMaker) {
        commercialNextAction = "Confirm who makes or approves the buying decision.";
    } else if (!d.budget) {
        commercialNextAction = "Confirm whether a budget or spending range exists for solving the problem.";
    } else if (!d.timeline) {
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

if (openProspects.length > 0) {
    const active = openProspects[0];
    const d = active.discovery || {};

    if (!d.problem) {
        discoveryQuestion = "What specific business problem are you trying to solve?";
    } else if (!d.impact) {
        discoveryQuestion = "You mentioned that " + d.problem + ". Roughly how much time, cost, customer impact or staff capacity does this issue affect?";
    } else if (!d.desiredOutcome) {
        discoveryQuestion = "If we solved that problem, what specific result would you want to see instead?";
    } else if (!d.decisionMaker) {
        discoveryQuestion = "Who would normally be involved in approving or deciding on a solution to this problem?";
    } else if (!d.budget) {
        discoveryQuestion = "Has the business already set aside a budget or spending range for solving this problem?";
    } else if (!d.timeline) {
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




