const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const indexFile = path.join(repoRoot, 'index.js');

function runIsolatedJarvis(business, input, state = {}, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));

  try {
    fs.copyFileSync(indexFile, path.join(tempDir, 'index.js'));
    fs.copyFileSync(path.join(repoRoot, 'state-store.js'), path.join(tempDir, 'state-store.js'));
    fs.writeFileSync(
      path.join(tempDir, 'business.json'),
      JSON.stringify(business, null, 2)
    );
    if (options.omitBusinessData) fs.unlinkSync(path.join(tempDir, 'business.json'));
    if (options.invalidBusinessData) fs.writeFileSync(path.join(tempDir, 'business.json'), '{ invalid json');
    if (!options.omitStateData) {
      fs.writeFileSync(
        path.join(tempDir, 'cofounder-state.json'),
        JSON.stringify({
          goals: [],
          decisions: [],
          approvals: [],
          executions: [],
          lessons: [],
          ...state
        }, null, 2)
      );
    }

    fs.writeFileSync(
      path.join(tempDir, 'cofounder-settings.json'),
      JSON.stringify({ speechEnabled: false })
    );
    if (options.memoryData) {
      fs.writeFileSync(path.join(tempDir, 'memory.json'), JSON.stringify(options.memoryData, null, 2));
    }
    if (options.seedProtectedFiles) {
      for (const [name, content] of Object.entries(options.seedProtectedFiles)) {
        fs.writeFileSync(path.join(tempDir, name), content);
      }
    }
    if (options.fakeResearch) {
      fs.writeFileSync(
        path.join(tempDir, 'mcporter.cmd'),
        '@echo off\r\necho x>>research-calls.txt\r\necho Title: Example Result\r\necho URL: https://example.com/test\r\n'
      );
    }
    if (options.fakeResearchError) {
      fs.writeFileSync(
        path.join(tempDir, 'mcporter.cmd'),
        '@echo off\r\necho simulated research tool failure 1>&2\r\nexit /b 1\r\n'
      );
    }

    if (options.fakeAIResponse || options.fakeAIHangs || options.fakeAIResponses || options.aiFailFirst) {
      fs.writeFileSync(
        path.join(tempDir, 'fake-fetch.cjs'),
        [
          'let __jarvisCall = 0;',
          'const __jarvisResponses = ' + JSON.stringify(options.fakeAIResponses || null) + ';',
          'const __jarvisFailFirst = ' + Number(options.aiFailFirst || 0) + ';',
          'const __jarvisDelaySpec = ' + JSON.stringify(options.fakeAIDelayMs ?? null) + ';',
          'global.fetch = async function(url, options = {}) {',
          '  __jarvisCall++;',
          '  const body = String(options.body || "");',
          '  if (process.env.COFOUNDER_CAPTURE_AI_REQUEST === "1") require("node:fs").writeFileSync("captured-ai-request.json", body);',
          '  if (process.env.COFOUNDER_CAPTURE_AI_REQUESTS === "1") require("node:fs").appendFileSync("captured-ai-requests.jsonl", body + "\\n");',
          '  const __jarvisDelay = Array.isArray(__jarvisDelaySpec)',
          '    ? (__jarvisDelaySpec[Math.min(__jarvisCall - 1, __jarvisDelaySpec.length - 1)] || 0)',
          '    : (Number(__jarvisDelaySpec) || 0);',
          '  if (__jarvisDelay) {',
          '    await new Promise((resolve, reject) => {',
          '      const signal = options.signal;',
          '      const t = setTimeout(resolve, __jarvisDelay);',
          '      if (signal) {',
          '        if (signal.aborted) { clearTimeout(t); reject(signal.reason || new Error("aborted")); return; }',
          '        signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason || new Error("aborted")); }, { once: true });',
          '      }',
          '    });',
          '  }',
          '  if (__jarvisFailFirst && __jarvisCall <= __jarvisFailFirst) throw new Error("simulated AI failure " + __jarvisCall);',
          '  if (String(url).includes("/api/chat")) {',
          '    const ollamaText = __jarvisResponses ? __jarvisResponses[Math.min(__jarvisCall - 1, __jarvisResponses.length - 1)] : "OLLAMA TEST RESPONSE";',
          '    return { ok: true, status: 200, json: async () => ({ message: { content: ollamaText } }) };',
          '  }',
          '  if (process.env.COFOUNDER_TEST_FETCH_HANG === "1") {',
          '    return new Promise((resolve, reject) => {',
          '      const signal = options.signal;',
          '      if (signal && signal.aborted) return reject(signal.reason || new Error("aborted"));',
          '      if (signal) signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });',
          '    });',
          '  }',
          '  const text = __jarvisResponses ? __jarvisResponses[Math.min(__jarvisCall - 1, __jarvisResponses.length - 1)] : "GEMINI TEST RESPONSE";',
          '  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };',
          '};',
          ''
        ].join('\n')
      );
    }

    const usesFakeAI = options.fakeAIResponse || options.fakeAIHangs || options.fakeAIResponses || options.aiFailFirst;
    const env = {
      ...process.env,
      GEMINI_API_KEY: usesFakeAI ? 'test-key' : '',
      COFOUNDER_PROVIDER: options.provider || 'gemini',
      COFOUNDER_TEST_FETCH_HANG: options.fakeAIHangs ? '1' : '0',
      COFOUNDER_CAPTURE_AI_REQUEST: options.captureAIRequest ? '1' : '0',
      COFOUNDER_CAPTURE_AI_REQUESTS: options.captureAIRequests ? '1' : '0',
      ...(options.aiTimeoutMs ? { COFOUNDER_AI_TIMEOUT_MS: String(options.aiTimeoutMs) } : {}),
      ...((options.fakeResearch || options.fakeResearchError) ? { PATH: tempDir + ';' + (process.env.PATH || '') } : {}),
      ...(usesFakeAI ? {
        NODE_OPTIONS: (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '') + '--require=' + path.join(tempDir, 'fake-fetch.cjs').replace(/\\/g, '/')
      } : {})
    };

    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: tempDir,
      input,
      encoding: 'utf8',
      env,
      timeout: 3000
    });

    const requestsFile = path.join(tempDir, 'captured-ai-requests.jsonl');
    const protectedNames = ['business.json', 'cofounder-state.json', 'memory.json', 'reminders.json', 'tasks.json', 'cofounder-settings.json'];
    const protectedFiles = {};
    for (const name of protectedNames) {
      const filePath = path.join(tempDir, name);
      protectedFiles[name] = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    }
    const directoryListing = fs.readdirSync(tempDir).sort();
    const backupFiles = {};
    for (const name of directoryListing) {
      if (!name.endsWith('.bak')) continue;
      backupFiles[name] = fs.readFileSync(path.join(tempDir, name), 'utf8');
    }
    return {
      result,
      business: fs.existsSync(path.join(tempDir, 'business.json'))
        ? (() => { try { return JSON.parse(fs.readFileSync(path.join(tempDir, 'business.json'), 'utf8')); } catch (_) { return null; } })()
        : null,
      state: fs.existsSync(path.join(tempDir, 'cofounder-state.json'))
        ? JSON.parse(fs.readFileSync(path.join(tempDir, 'cofounder-state.json'), 'utf8'))
        : null,
      capturedAIRequest: fs.existsSync(path.join(tempDir, 'captured-ai-request.json'))
        ? fs.readFileSync(path.join(tempDir, 'captured-ai-request.json'), 'utf8')
        : null,
      capturedAIRequests: fs.existsSync(requestsFile)
        ? fs.readFileSync(requestsFile, 'utf8').split('\n').filter(Boolean)
        : [],
      researchCalls: fs.existsSync(path.join(tempDir, 'research-calls.txt'))
        ? fs.readFileSync(path.join(tempDir, 'research-calls.txt'), 'utf8').split('\n').filter(Boolean).length
        : 0,
      protectedFiles,
      directoryListing,
      backupFiles
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function prospectFixture(discovery = {}) {
  return {
    prospects: [
      {
        name: 'Test prospect',
        details: 'Test business',
        status: 'NEW',
        discovery
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };
}

test('JARVIS recommendation command responds', () => {
  const { result } = runIsolatedJarvis(
    {
      prospects: [],
      opportunities: [],
      offers: [],
      followUps: [],
      revenue: []
    },
    'recommend\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS COFOUNDER RECOMMENDATION/);
});

test('general recommendation flags a prospect with no discovery or qualification record', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'recommend\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Prospect discovery is incomplete/);
  assert.match(result.stdout ?? '', /Test prospect/);
  assert.doesNotMatch(result.stdout ?? '', /No major prospect qualification gap is recorded/);
});
test('prospect recommendation refuses a final solution when discovery is incomplete', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend hours each week chasing responses'
    }),
    'prospect recommendation\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /STATUS: POSSIBLE ZAYZANA FIT/);
  assert.match(result.stdout ?? '', /Do not select a final solution yet/);
  assert.match(result.stdout ?? '', /Complete discovery before proposing a specific Zayzana solution/);
});

test('prospect recommendation reaches review only when all core discovery is recorded', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend hours each week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager'
    }),
    'prospect recommendation\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /STATUS: READY FOR REVIEW/);
  assert.match(result.stdout ?? '', /Core discovery information has been recorded/);
  assert.match(result.stdout ?? '', /No proposal or external action should occur without Zayn's approval/);
});

test('prospect qualification records missing evidence instead of inventing it', () => {
  const { result, business } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time'
    }),
    'prospect qualification\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /QUALIFICATION: NEEDS MORE DISCOVERY/);
  assert.deepEqual(
    business.prospects[0].qualification.missing,
    ['impact', 'current solution', 'desired outcome', 'decision maker']
  );
  assert.equal(
    business.prospects[0].qualification.status,
    'NEEDS MORE DISCOVERY'
  );
});

test('prospect qualification records readiness but does not assume buyer confirmation', () => {
  const { result, business } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend hours each week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager'
    }),
    'prospect qualification\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /QUALIFICATION: READY FOR CONFIRMATION/);
  assert.deepEqual(business.prospects[0].qualification.missing, []);
  assert.equal(business.prospects[0].qualification.status, 'READY FOR CONFIRMATION');
  assert.equal(business.prospects[0].qualification.confirmationSource, undefined);
});

test('buyer confirmation explicitly records qualification after discovery review', () => {
  const { result, business } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend hours each week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager'
    }),
    'prospect qualification\nconfirm prospect qualification\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /QUALIFICATION: READY FOR CONFIRMATION/);
  assert.match(result.stdout ?? '', /Buyer confirmation recorded by Zayn/);
  assert.equal(business.prospects[0].qualification.status, 'QUALIFIED');
  assert.equal(business.prospects[0].qualification.confirmationSource, 'ZAYN_CONFIRMED_BUYER_EVIDENCE');
  assert.ok(business.prospects[0].qualification.confirmedAt);
});

test('buyer confirmation cannot qualify a prospect with missing discovery fields', () => {
  const { result, business } = runIsolatedJarvis(
    prospectFixture({ problem: 'A recorded problem' }),
    'confirm prospect qualification\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Confirmation blocked/);
  assert.notEqual(business.prospects[0].qualification?.status, 'QUALIFIED');
});

test('cofounder challenge flags an open follow-up when qualification is incomplete', () => {
  const { result } = runIsolatedJarvis(
    {
      ...prospectFixture({
        problem: 'Manual customer follow-up is consuming staff time'
      }),
      followUps: [
        {
          text: 'Send contract to prospect',
          status: 'OPEN'
        }
      ]
    },
    'prospect qualification\nchallenge\n'
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS COFOUNDER CHALLENGE/);
  assert.match(result.stdout ?? '', /The current follow-up may be premature because prospect qualification is incomplete/);
});

test('cofounder blocks an unlinked approval when an active decision exists', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\napprove recommendation complete prospect qualification before contracting\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder links an approval to the active decision it authorizes', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\napprove recommendation complete prospect qualification before contracting for decision 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS RECOMMENDATION APPROVED/);
  assert.equal(state.approvals[0].decisionNumber, 1);
  assert.equal(state.approvals[0].decisionId, 'decision-1');
});

test('cofounder blocks execution when the linked decision has been closed', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\napprove recommendation complete prospect qualification before contracting for decision 1\nclose decision 1\nexecute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Linked active approvals marked STALE/);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.decisions[0].status, 'CLOSED');
  assert.equal(state.approvals[0].status, 'STALE');
  assert.equal(state.executions.length, 0);
});

test('cofounder approval records an active approval without executing it', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS RECOMMENDATION APPROVED/);
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].status, 'ACTIVE');
  assert.equal(state.approvals[0].approvedBy, 'Zayn');
  assert.equal(state.executions.length, 0);
});

test('cofounder execution gate executes only an active approval and records the execution', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION RECORDED/);
  assert.equal(state.approvals[0].status, 'EXECUTED');
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].status, 'INTERNAL_ACTION_RECORDED');
  assert.equal(state.executions[0].executedBy, 'JARVIS');
});

test('cofounder marks a new execution as pending verification', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].verificationStatus, 'PENDING');
  assert.equal(state.approvals[0].verificationStatus, 'PENDING');
});
test('cofounder verifies a completed execution', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\nverify execution 1 verified\nverify execution 1 verified\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /COFOUNDER EXECUTION VERIFIED/);
  assert.match(result.stdout, /Verification: VERIFIED/);
  assert.match(result.stdout, /This execution is not pending verification/);
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].verificationStatus, 'VERIFIED');
  assert.equal(state.approvals[0].verificationStatus, 'VERIFIED');
});
test('cofounder records a failed execution verification', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\nverify execution 1 failed\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verification: FAILED/);
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].verificationStatus, 'FAILED');
  assert.equal(state.approvals[0].verificationStatus, 'FAILED');
});
test('cofounder records an unknown execution verification', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\nverify execution 1 unknown\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verification: UNKNOWN/);
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].verificationStatus, 'UNKNOWN');
  assert.equal(state.approvals[0].verificationStatus, 'UNKNOWN');
});
test('cofounder blocks execution when an approval has already been executed', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\nexecute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION RECORDED/);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.approvals[0].status, 'EXECUTED');
  assert.equal(state.executions.length, 1);
});

test('cofounder blocks execution when no approvals exist', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'execute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION GATE/);
  assert.match(result.stdout ?? '', /Invalid approval number/);
  assert.equal(state.approvals.length, 0);
  assert.equal(state.executions.length, 0);
});

test('cofounder lets newer qualification evidence supersede an older qualification lesson', () => {
  const { result } = runIsolatedJarvis(
    {
      ...prospectFixture({
        problem: 'Manual customer follow-up is consuming staff time',
        impact: 'Staff spend hours each week chasing responses',
        currentSolution: 'Staff use spreadsheets and manual messages',
        desiredOutcome: 'Automate routine follow-up and tracking',
        decisionMaker: 'Operations manager'
      }),
      followUps: [
        {
          text: 'Send contract to prospect',
          status: 'OPEN'
        }
      ]
    },
    'prospect qualification\nconfirm prospect qualification\nrecommend\n',
    {
      lessons: [
        {
          date: '2026-09-24T10:00:00.000Z',
          source: 'decision 1',
          text: 'Qualify before contract when discovery evidence is incomplete'
        }
      ]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /QUALIFICATION: QUALIFIED/);
  assert.match(result.stdout ?? '', /Focus first on: Send contract to prospect/);
  assert.doesNotMatch(result.stdout ?? '', /LEARNING SIGNAL: A past decision lesson indicates qualification should happen before contracting/);
});

test('cofounder blocks a lesson until the decision outcome is recorded', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\ndecision lesson 1 qualify before contract\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS DECISION LESSON BLOCKED/);
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0].lesson, undefined);
  assert.equal(state.lessons.length, 0);
});

test('cofounder records an outcome before allowing the linked decision lesson', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\ndecision outcome 1 Prospect confirmed the problem and agreed to provide missing evidence\ndecision lesson 1 Qualify before contract when discovery evidence is incomplete\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS DECISION OUTCOME RECORDED/);
  assert.match(result.stdout ?? '', /JARVIS DECISION LESSON RECORDED/);
  assert.equal(state.decisions[0].outcome, 'Prospect confirmed the problem and agreed to provide missing evidence');
  assert.equal(state.decisions[0].lesson, 'Qualify before contract when discovery evidence is incomplete');
  assert.equal(state.lessons.length, 1);
  assert.equal(state.lessons[0].source, 'decision 1');
  assert.equal(state.lessons[0].decisionId, 'decision-1');
  assert.equal(state.decisions[0].lessonId, 'lesson-1');
});

test('cofounder carries a recorded lesson into a future recommendation', () => {
  const { result } = runIsolatedJarvis(
    {
      ...prospectFixture({
        problem: 'Manual customer follow-up is consuming staff time'
      }),
      prospects: [
        {
          name: 'Test prospect',
          details: 'Test business',
          status: 'NEW',
          discovery: {
            problem: 'Manual customer follow-up is consuming staff time'
          },
          qualification: {
            status: 'NEEDS MORE DISCOVERY',
            missing: ['impact', 'current solution', 'desired outcome', 'decision maker']
          }
        }
      ],
      followUps: [
        {
          text: 'Send contract to prospect',
          status: 'OPEN'
        }
      ]
    },
    'record decision complete qualification before contracting\ndecision outcome 1 Qualification gap confirmed\ndecision lesson 1 Qualify before contract when discovery evidence is incomplete\nrecommend\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS DECISION LESSON RECORDED/);
  assert.match(result.stdout ?? '', /Focus first on: complete prospect qualification before contracting/);
  assert.match(result.stdout ?? '', /LEARNING SIGNAL: A past decision lesson indicates qualification should happen before contracting/);
});




test('commercial assessment refuses to pursue when evidence is insufficient', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time'
    }),
    'commercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JUDGEMENT: NOT ENOUGH EVIDENCE/);
  assert.match(result.stdout ?? '', /EVIDENCE: INSUFFICIENT/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('commercial assessment investigates when value is clear but money is unknown', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend hours each week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager'
    }),
    'commercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.match(result.stdout ?? '', /MONEY: UNKNOWN/);
  assert.match(result.stdout ?? '', /RETURN: UNKNOWN/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('commercial assessment requires recorded qualification before pursuit', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend 10 hours per week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager',
      budget: 'R15000',
      timeline: 'Within 30 days',
      strategicFit: 'AI automation matches Zayzana commercial focus'
    }),
    'commercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.match(result.stdout ?? '', /STRATEGIC FIT:/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('commercial assessment does not pursue a qualified prospect when the current solution is missing', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff spend 10 hours per week chasing responses',
    desiredOutcome: 'Automate routine follow-up and tracking',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE'
  };

  const { result } = runIsolatedJarvis(fixture, 'commercial assessment\n');

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout ?? '', /EVIDENCE: STRONG/);
  assert.doesNotMatch(result.stdout ?? '', /JUDGEMENT: PURSUE/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('editing discovery invalidates prior buyer confirmation', () => {
  const fixture = prospectFixture({
    problem: 'Original buyer-confirmed problem',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Manual spreadsheet workflow',
    desiredOutcome: 'Automate follow-up',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    checkedAt: '2026-10-11T00:00:00.000Z',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE',
    missing: []
  };

  const { result, business } = runIsolatedJarvis(
    fixture,
    'discovery problem Updated problem\ncommercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Qualification invalidated because discovery changed/);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.equal(business.prospects[0].qualification.status, 'NEEDS RECONFIRMATION');
  assert.equal(business.prospects[0].qualification.confirmationSource, undefined);
});

test('editing discovery impact invalidates prior buyer confirmation', () => {
  const fixture = prospectFixture({
    problem: 'Original buyer-confirmed problem',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Manual spreadsheet workflow',
    desiredOutcome: 'Automate follow-up',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    checkedAt: '2026-10-11T00:00:00.000Z',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE',
    missing: []
  };

  const { result, business } = runIsolatedJarvis(
    fixture,
    'discovery impact Staff now lose 20 hours weekly\ncommercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Qualification invalidated because discovery changed/);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.equal(business.prospects[0].qualification.status, 'NEEDS RECONFIRMATION');
  assert.equal(business.prospects[0].qualification.confirmationSource, undefined);
});

test('RC-04 discovery impact refuses stale saved prospect selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'IMPACT_MARKER',
    note: 'EXISTING_IMPACT_NOTE',
    confirmationSource: 'PREEXISTING_SOURCE'
  };
  const closedProspect = {
    name: 'Closed Prospect',
    details: 'Synthetic closed record',
    status: 'CLOSED',
    discovery: { problem: 'CLOSED_PROBLEM' }
  };
  const openProspect = {
    name: 'Remaining Open',
    details: 'Synthetic open record',
    status: 'NEW',
    discovery: {
      problem: 'ORIGINAL_PROBLEM',
      impact: 'ORIGINAL_IMPACT'
    },
    qualification
  };
  const business = {
    prospects: [closedProspect, openProspect],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'discovery impact INJECTED_VALUE\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /DISCOVERY CAPTURED/);
  assert.doesNotMatch(stdout, /Impact: INJECTED_VALUE/);
  assert.doesNotMatch(stdout, /Qualification invalidated because discovery changed/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.deepEqual(remaining.discovery, {
    problem: 'ORIGINAL_PROBLEM',
    impact: 'ORIGINAL_IMPACT'
  });
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    closedProspect
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 discovery impact preserves single-open auto-selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'IMPACT_MARKER',
    note: 'EXISTING_IMPACT_NOTE'
  };
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: {
          problem: 'ORIGINAL_PROBLEM',
          impact: 'ORIGINAL_IMPACT'
        },
        qualification
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'discovery impact CONTROL_VALUE\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /DISCOVERY CAPTURED/);
  assert.match(stdout, /Impact: CONTROL_VALUE/);
  assert.match(stdout, /Qualification invalidated because discovery changed/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);

  const remaining = run.business.prospects[0];
  assert.equal(remaining.discovery.problem, 'ORIGINAL_PROBLEM');
  assert.equal(remaining.discovery.impact, 'CONTROL_VALUE');
  assert.equal(remaining.qualification.status, 'NEEDS RECONFIRMATION');
  assert.deepEqual(remaining.qualification.missing, []);
  assert.equal(
    remaining.qualification.note,
    'Discovery changed after qualification review; rerun qualification and reconfirm buyer evidence.'
  );
  assert.equal(remaining.qualification.confirmationSource, undefined);
  assert.equal(typeof remaining.qualification.checkedAt, 'string');
  assert.ok(remaining.qualification.checkedAt);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('editing discovery current solution invalidates prior buyer confirmation', () => {
  const fixture = prospectFixture({
    problem: 'Original buyer-confirmed problem',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Manual spreadsheet workflow',
    desiredOutcome: 'Automate follow-up',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    checkedAt: '2026-10-11T00:00:00.000Z',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE',
    missing: []
  };

  const { result, business } = runIsolatedJarvis(
    fixture,
    'discovery current Revised current solution\ncommercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.equal(business.prospects[0].discovery.currentSolution, 'Revised current solution');
  assert.equal(business.prospects[0].discovery.desiredOutcome, 'Automate follow-up');
  assert.match(result.stdout ?? '', /Qualification invalidated because discovery changed/);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.equal(business.prospects[0].qualification.status, 'NEEDS RECONFIRMATION');
  assert.equal(business.prospects[0].qualification.confirmationSource, undefined);
});

test('capture discovery invalidates prior buyer confirmation', () => {
  const fixture = prospectFixture({
    problem: 'Original buyer-confirmed problem',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Manual spreadsheet workflow',
    desiredOutcome: 'Automate follow-up',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    checkedAt: '2026-10-11T00:00:00.000Z',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE',
    missing: []
  };
  fixture.prospects[0].currentDiscoveryField = 'problem';

  const { result, business } = runIsolatedJarvis(
    fixture,
    'capture discovery Revised problem text\ncommercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.equal(business.prospects[0].discovery.problem, 'Revised problem text');
  assert.match(result.stdout ?? '', /Qualification invalidated because discovery changed/);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.equal(business.prospects[0].qualification.status, 'NEEDS RECONFIRMATION');
  assert.equal(business.prospects[0].qualification.confirmationSource, undefined);
});

test('capture discovery advances to the next missing field instead of overwriting the previous answer', () => {
  const fixture = prospectFixture({});

  const { result, business } = runIsolatedJarvis(
    fixture,
    'next discovery\n' +
    'capture discovery Manual follow-up is eating staff time\n' +
    'capture discovery Staff lose 10 hours weekly\n'
  );

  assert.equal(result.status, 0);
  assert.deepEqual(
    {
      problem: business.prospects[0].discovery.problem,
      impact: business.prospects[0].discovery.impact
    },
    {
      problem: 'Manual follow-up is eating staff time',
      impact: 'Staff lose 10 hours weekly'
    }
  );
});

test('RC-04 next discovery refuses stale saved prospect selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'NEXT_DISCOVERY_MARKER',
    note: 'EXISTING_NEXT_DISCOVERY_NOTE',
    confirmationSource: 'PREEXISTING_SOURCE'
  };
  const closedProspect = {
    name: 'Closed Prospect',
    details: 'Synthetic closed record',
    status: 'CLOSED',
    discovery: { problem: 'CLOSED_PROBLEM' }
  };
  const openProspect = {
    name: 'Remaining Open',
    details: 'Synthetic open record',
    status: 'NEW',
    discovery: { problem: 'ORIGINAL_PROBLEM' },
    currentDiscoveryField: 'timeline',
    qualification
  };
  const business = {
    prospects: [closedProspect, openProspect],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'next discovery\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /NEXT DISCOVERY QUESTION/);
  assert.doesNotMatch(stdout, /Roughly how many staff hours per week are being spent handling these customer enquiries\?/);
  assert.doesNotMatch(stdout, /Discovery evidence is complete/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.equal(remaining.currentDiscoveryField, 'timeline');
  assert.deepEqual(remaining.discovery, { problem: 'ORIGINAL_PROBLEM' });
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(remaining.status, 'NEW');
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    closedProspect
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 next discovery preserves single-open auto-selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'NEXT_DISCOVERY_MARKER',
    note: 'EXISTING_NEXT_DISCOVERY_NOTE'
  };
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: { problem: 'ORIGINAL_PROBLEM' },
        currentDiscoveryField: 'timeline',
        qualification
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'next discovery\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /NEXT DISCOVERY QUESTION/);
  assert.match(stdout, /Roughly how many staff hours per week are being spent handling these customer enquiries\?/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);

  const remaining = run.business.prospects[0];
  assert.equal(remaining.currentDiscoveryField, 'impact');
  assert.equal(remaining.discovery.problem, 'ORIGINAL_PROBLEM');
  assert.equal(Object.prototype.hasOwnProperty.call(remaining.discovery, 'impact'), false);
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('RC-04 capture discovery refuses stale saved prospect selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'CAPTURE_MARKER',
    note: 'EXISTING_CAPTURE_NOTE',
    confirmationSource: 'PREEXISTING_SOURCE'
  };
  const closedProspect = {
    name: 'Closed Prospect',
    details: 'Synthetic closed record',
    status: 'CLOSED',
    discovery: { problem: 'CLOSED_PROBLEM' }
  };
  const openProspect = {
    name: 'Remaining Open',
    details: 'Synthetic open record',
    status: 'NEW',
    discovery: { problem: 'ORIGINAL_PROBLEM' },
    currentDiscoveryField: 'impact',
    qualification
  };
  const business = {
    prospects: [closedProspect, openProspect],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'capture discovery INJECTED_VALUE\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /DISCOVERY CAPTURED/);
  assert.doesNotMatch(stdout, /Impact: INJECTED_VALUE/);
  assert.doesNotMatch(stdout, /Qualification invalidated because discovery changed/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.deepEqual(remaining.discovery, { problem: 'ORIGINAL_PROBLEM' });
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(remaining.currentDiscoveryField, 'impact');
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    closedProspect
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 capture discovery preserves single-open auto-selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'CAPTURE_MARKER',
    note: 'EXISTING_CAPTURE_NOTE'
  };
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: { problem: 'ORIGINAL_PROBLEM' },
        currentDiscoveryField: 'impact',
        qualification
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'capture discovery CONTROL_VALUE\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /DISCOVERY CAPTURED/);
  assert.match(stdout, /Impact: CONTROL_VALUE/);
  assert.match(stdout, /Qualification invalidated because discovery changed/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);

  const remaining = run.business.prospects[0];
  assert.equal(remaining.discovery.problem, 'ORIGINAL_PROBLEM');
  assert.equal(remaining.discovery.impact, 'CONTROL_VALUE');
  assert.equal(remaining.currentDiscoveryField, '');
  assert.equal(remaining.qualification.status, 'NEEDS RECONFIRMATION');
  assert.deepEqual(remaining.qualification.missing, []);
  assert.equal(
    remaining.qualification.note,
    'Discovery changed after qualification review; rerun qualification and reconfirm buyer evidence.'
  );
  assert.equal(remaining.qualification.confirmationSource, undefined);
  assert.equal(typeof remaining.qualification.checkedAt, 'string');
  assert.ok(remaining.qualification.checkedAt);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('RC-04 discovery refuses stale saved prospect selection without mutating Remaining Open', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'QUALIFICATION_MARKER',
    confirmationSource: 'MARKER_SOURCE'
  };
  const business = {
    prospects: [
      {
        name: 'Closed Prospect',
        details: 'Synthetic closed record',
        status: 'CLOSED',
        discovery: { problem: 'CLOSED_ORIGINAL' }
      },
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: { problem: 'ORIGINAL' },
        qualification
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'discovery problem INJECTED_VALUE\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Discovery saved: problem/);
  assert.doesNotMatch(stdout, /Qualification invalidated because discovery changed/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.equal(remaining.discovery.problem, 'ORIGINAL');
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    business.prospects[0]
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused mutation must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 discovery preserves single-open auto-selection when no prospect is saved', () => {
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: { problem: 'ORIGINAL' },
        qualification: {
          status: 'READY FOR CONFIRMATION',
          checkedAt: '2026-01-01T00:00:00.000Z',
          missing: [],
          marker: 'QUALIFICATION_MARKER'
        }
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'discovery problem CONTROL_VALUE\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /Discovery saved: problem/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);

  const remaining = run.business.prospects[0];
  assert.equal(remaining.discovery.problem, 'CONTROL_VALUE');
  assert.equal(remaining.qualification.status, 'NEEDS RECONFIRMATION');
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('RC-04 prospect discovery refuses stale saved prospect selection', () => {
  const business = {
    prospects: [
      {
        name: 'Closed Prospect',
        details: 'Synthetic closed record',
        status: 'CLOSED',
        discovery: { problem: 'CLOSED_PROBLEM' }
      },
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW'
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'prospect discovery\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS PROSPECT DISCOVERY/);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /CURRENT PROSPECT/);
  assert.doesNotMatch(stdout, /DISCOVERY STATUS/);
  assert.doesNotMatch(stdout, /Problem: NOT DISCOVERED/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.equal(Object.prototype.hasOwnProperty.call(remaining, 'discovery'), false);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    business.prospects[0]
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 prospect discovery preserves single-open auto-selection', () => {
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW'
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'prospect discovery\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS PROSPECT DISCOVERY/);
  assert.match(stdout, /CURRENT PROSPECT/);
  assert.match(stdout, /Name: Remaining Open/);
  assert.match(stdout, /Problem: NOT DISCOVERED/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);

  const remaining = run.business.prospects[0];
  assert.deepEqual(remaining.discovery, {
    problem: "",
    impact: "",
    currentSolution: "",
    desiredOutcome: "",
    decisionMaker: "",
    budget: "",
    timeline: "",
    notes: ""
  });
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('RC-04 confirm prospect qualification refuses stale saved prospect selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'CONFIRMATION_MARKER',
    note: 'EXISTING_CONFIRMATION_NOTE',
    confirmationSource: 'PREEXISTING_SOURCE'
  };
  const closedProspect = {
    name: 'Closed Prospect',
    details: 'Synthetic closed record',
    status: 'CLOSED',
    discovery: { problem: 'CLOSED_PROBLEM' }
  };
  const openProspect = {
    name: 'Remaining Open',
    details: 'Synthetic open record',
    status: 'NEW',
    discovery: {
      problem: 'Confirmed problem',
      impact: 'Confirmed impact',
      currentSolution: 'Current solution',
      desiredOutcome: 'Desired outcome',
      decisionMaker: 'Decision maker'
    },
    qualification
  };
  const business = {
    prospects: [closedProspect, openProspect],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'confirm prospect qualification\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /JARVIS BUYER CONFIRMATION/);
  assert.doesNotMatch(stdout, /QUALIFICATION: QUALIFIED/);
  assert.doesNotMatch(stdout, /Buyer confirmation recorded by Zayn/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    closedProspect
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 confirm prospect qualification preserves single-open auto-selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'CONFIRMATION_MARKER'
  };
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: {
          problem: 'Confirmed problem',
          impact: 'Confirmed impact',
          currentSolution: 'Current solution',
          desiredOutcome: 'Desired outcome',
          decisionMaker: 'Decision maker'
        },
        qualification
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'confirm prospect qualification\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /QUALIFICATION: QUALIFIED/);
  assert.match(stdout, /Buyer confirmation recorded by Zayn/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Confirmation blocked/);

  const remaining = run.business.prospects[0];
  assert.equal(remaining.qualification.status, 'QUALIFIED');
  assert.equal(remaining.qualification.confirmationSource, 'ZAYN_CONFIRMED_BUYER_EVIDENCE');
  assert.equal(remaining.qualification.confirmedBy, 'Zayn');
  assert.equal(remaining.qualification.checkedAt, qualification.checkedAt);
  assert.ok(remaining.qualification.confirmedAt);
  assert.deepEqual(remaining.qualification.missing, []);
  assert.deepEqual(remaining.discovery, business.prospects[0].discovery);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('RC-04 prospect qualification refuses stale saved prospect selection', () => {
  const qualification = {
    status: 'READY FOR CONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: [],
    marker: 'QUALIFICATION_MARKER',
    note: 'EXISTING_QUALIFICATION_NOTE',
    confirmationSource: 'PREEXISTING_SOURCE'
  };
  const closedProspect = {
    name: 'Closed Prospect',
    details: 'Synthetic closed record',
    status: 'CLOSED',
    discovery: { problem: 'CLOSED_PROBLEM' }
  };
  const openProspect = {
    name: 'Remaining Open',
    details: 'Synthetic open record',
    status: 'NEW',
    discovery: {
      problem: 'Confirmed problem',
      impact: 'Confirmed impact',
      currentSolution: 'Current solution',
      desiredOutcome: 'Desired outcome',
      decisionMaker: 'Decision maker'
    },
    qualification
  };
  const business = {
    prospects: [closedProspect, openProspect],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'prospect qualification\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /JARVIS PROSPECT QUALIFICATION/);
  assert.doesNotMatch(stdout, /QUALIFICATION: READY FOR CONFIRMATION/);
  assert.doesNotMatch(stdout, /QUALIFICATION: NEEDS MORE DISCOVERY/);
  assert.doesNotMatch(stdout, /QUALIFICATION: QUALIFIED/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    closedProspect
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 prospect qualification preserves single-open auto-selection', () => {
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: {
          problem: 'Confirmed problem',
          impact: 'Confirmed impact',
          currentSolution: 'Current solution',
          desiredOutcome: 'Desired outcome',
          decisionMaker: 'Decision maker'
        }
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'prospect qualification\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /QUALIFICATION: READY FOR CONFIRMATION/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);

  const remaining = run.business.prospects[0];
  assert.equal(remaining.qualification.status, 'READY FOR CONFIRMATION');
  assert.deepEqual(remaining.qualification.missing, []);
  assert.equal(
    remaining.qualification.note,
    'Core discovery fields are present; buyer confirmation is still required.'
  );
  assert.equal(typeof remaining.qualification.checkedAt, 'string');
  assert.ok(remaining.qualification.checkedAt);
  assert.deepEqual(remaining.discovery, business.prospects[0].discovery);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('commercial assessment rejects a QUALIFIED status without buyer-confirmation provenance', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff spend 10 hours per week chasing responses',
    desiredOutcome: 'Automate routine follow-up and tracking',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = { status: 'QUALIFIED', missing: [] };

  const { result } = runIsolatedJarvis(fixture, 'commercial assessment\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('run cycle does not auto-qualify complete but unconfirmed discovery', () => {
  const { result, business } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend 10 hours per week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager'
    }),
    'cycle\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Qualification: READY FOR CONFIRMATION/);
  assert.match(result.stdout ?? '', /No commercial recommendation was made/);
  assert.equal(business.prospects[0].qualification.status, 'READY FOR CONFIRMATION');
});

test('RC-04 run cycle refuses stale saved prospect selection', () => {
  const qualification = {
    status: 'NEEDS RECONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: ['budget'],
    marker: 'RUN_CYCLE_MARKER',
    note: 'EXISTING_RUN_CYCLE_NOTE',
    confirmationSource: 'PREEXISTING_SOURCE'
  };
  const discovery = {
    problem: 'ORIGINAL_PROBLEM',
    impact: 'ORIGINAL_IMPACT',
    currentSolution: 'ORIGINAL_CURRENT_SOLUTION',
    desiredOutcome: 'ORIGINAL_DESIRED_OUTCOME',
    decisionMaker: 'ORIGINAL_DECISION_MAKER'
  };
  const closedProspect = {
    name: 'Closed Prospect',
    details: 'Synthetic closed record',
    status: 'CLOSED',
    discovery: { problem: 'CLOSED_PROBLEM' }
  };
  const openProspect = {
    name: 'Remaining Open',
    details: 'Synthetic open record',
    status: 'NEW',
    discovery,
    currentDiscoveryField: 'timeline',
    qualification
  };
  const business = {
    prospects: [closedProspect, openProspect],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);
  const settingsBytes = JSON.stringify({ speechEnabled: false }, null, 2);
  const stateBytes = JSON.stringify({
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  }, null, 2);
  const emptyArrayBytes = '[]';

  const run = runIsolatedJarvis(
    business,
    'run cycle\n',
    {},
    {
      seedProtectedFiles: {
        'cofounder-settings.json': settingsBytes,
        'cofounder-state.json': stateBytes,
        'memory.json': emptyArrayBytes,
        'tasks.json': emptyArrayBytes,
        'reminders.json': emptyArrayBytes
      }
    }
  );

  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Active prospect: Remaining Open/);
  assert.doesNotMatch(stdout, /STAGE: QUALIFICATION/);
  assert.doesNotMatch(stdout, /Qualification: READY FOR CONFIRMATION/);
  assert.doesNotMatch(stdout, /COMMERCIAL RECOMMENDATION/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  const remaining = run.business.prospects.find(item => item.name === 'Remaining Open');
  assert.deepEqual(remaining.discovery, discovery);
  assert.deepEqual(remaining.qualification, qualification);
  assert.equal(remaining.currentDiscoveryField, 'timeline');
  assert.equal(remaining.status, 'NEW');
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Closed Prospect'),
    closedProspect
  );

  const protectedExpectations = {
    'cofounder-state.json': stateBytes,
    'memory.json': emptyArrayBytes,
    'tasks.json': emptyArrayBytes,
    'reminders.json': emptyArrayBytes,
    'cofounder-settings.json': settingsBytes
  };
  for (const [name, expected] of Object.entries(protectedExpectations)) {
    assert.equal(run.protectedFiles[name], expected, name + ' must remain byte-identical');
  }

  const businessBackups = run.directoryListing.filter(name => /^business\.json\..*\.bak$/.test(name));
  assert.deepEqual(businessBackups, [], 'the refused command must not create a business backup');
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');

  const settingsBackups = run.directoryListing.filter(name => /^cofounder-settings\.json\..*\.bak$/.test(name));
  assert.equal(settingsBackups.length, 1, 'the only permitted backup is the known startup settings backup');
  assert.equal(run.backupFiles[settingsBackups[0]], settingsBytes);
});

test('RC-04 run cycle preserves single-open auto-selection', () => {
  const qualification = {
    status: 'NEEDS RECONFIRMATION',
    checkedAt: '2026-01-01T00:00:00.000Z',
    missing: ['budget'],
    marker: 'RUN_CYCLE_MARKER',
    note: 'EXISTING_RUN_CYCLE_NOTE'
  };
  const discovery = {
    problem: 'ORIGINAL_PROBLEM',
    impact: 'ORIGINAL_IMPACT',
    currentSolution: 'ORIGINAL_CURRENT_SOLUTION',
    desiredOutcome: 'ORIGINAL_DESIRED_OUTCOME',
    decisionMaker: 'ORIGINAL_DECISION_MAKER'
  };
  const business = {
    prospects: [
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery,
        qualification
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };

  const run = runIsolatedJarvis(business, 'cycle\n');
  const stdout = run.result.stdout ?? '';
  assert.equal(run.result.status, 0);
  assert.match(stdout, /COFOUNDER BUSINESS CYCLE/);
  assert.match(stdout, /Active prospect: Remaining Open/);
  assert.match(stdout, /STAGE: QUALIFICATION/);
  assert.match(stdout, /Qualification: READY FOR CONFIRMATION/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /COMMERCIAL RECOMMENDATION/);

  const remaining = run.business.prospects[0];
  assert.deepEqual(remaining.discovery, discovery);
  assert.equal(remaining.qualification.status, 'READY FOR CONFIRMATION');
  assert.deepEqual(remaining.qualification.missing, []);
  assert.equal(
    remaining.qualification.note,
    'Core discovery fields are present; buyer confirmation is still required.'
  );
  assert.equal(typeof remaining.qualification.checkedAt, 'string');
  assert.ok(remaining.qualification.checkedAt);
  assert.equal(remaining.qualification.marker, undefined);
  assert.equal(remaining.qualification.confirmationSource, undefined);
  assert.equal(remaining.name, 'Remaining Open');
  assert.equal(remaining.details, 'Synthetic open record');
  assert.equal(remaining.status, 'NEW');
  assert.equal(run.business.prospects.length, 1);
  for (const key of ['opportunities', 'offers', 'followUps', 'revenue']) {
    assert.deepEqual(run.business[key], business[key], key + ' must remain unchanged');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('commercial assessment can pursue a qualified prospect when commercial requirements are met', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff spend 10 hours per week chasing responses',
    currentSolution: 'Staff use spreadsheets and manual messages',
    desiredOutcome: 'Automate routine follow-up and tracking',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days',
    strategicFit: 'AI automation matches Zayzana commercial focus'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE'
  };

  const { result } = runIsolatedJarvis(
    fixture,
    'commercial assessment\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JUDGEMENT: PURSUE/);
  assert.match(result.stdout ?? '', /STRATEGIC FIT:/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('RC-04 commercial assessment refuses stale saved prospect selection', () => {
  const business = {
    prospects: [
      {
        name: 'Closed Prospect',
        details: 'Synthetic closed record',
        status: 'CLOSED',
        discovery: {
          problem: 'CLOSED_PROBLEM',
          impact: 'CLOSED_IMPACT',
          currentSolution: 'CLOSED_SOLUTION',
          desiredOutcome: 'CLOSED_OUTCOME',
          decisionMaker: 'CLOSED_DECISION_MAKER'
        }
      },
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: {
          problem: 'OPEN_ONLY_PROBLEM',
          impact: 'OPEN_ONLY_IMPACT',
          currentSolution: 'OPEN_ONLY_SOLUTION',
          desiredOutcome: 'OPEN_ONLY_OUTCOME',
          decisionMaker: 'OPEN_ONLY_DECISION_MAKER',
          budget: 'OPEN_ONLY_BUDGET',
          timeline: 'OPEN_ONLY_TIMELINE',
          strategicFit: 'OPEN_ONLY_STRATEGIC_FIT'
        },
        qualification: {
          status: 'QUALIFIED',
          confirmedAt: '2026-10-11T00:00:00.000Z',
          confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE'
        }
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);

  const run = runIsolatedJarvis(business, 'commercial assessment\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.match(stdout, /No prospect-dependent commercial assessment was produced\./);
  assert.doesNotMatch(stdout, /JARVIS COMMERCIAL ASSESSMENT/);
  assert.doesNotMatch(stdout, /CUSTOMER:/);
  assert.doesNotMatch(stdout, /VALUE:/);
  assert.doesNotMatch(stdout, /EVIDENCE:/);
  assert.doesNotMatch(stdout, /JUDGEMENT:/);
  assert.doesNotMatch(stdout, /NEXT ACTION:/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Remaining Open'),
    business.prospects[1]
  );
});

test('RC-04 commercial assessment preserves single-open auto-selection', () => {
  const business = prospectFixture({
    problem: 'SOLE_OPEN_PROBLEM',
    impact: 'SOLE_OPEN_IMPACT',
    currentSolution: 'SOLE_OPEN_SOLUTION',
    desiredOutcome: 'SOLE_OPEN_OUTCOME',
    decisionMaker: 'SOLE_OPEN_DECISION_MAKER'
  });
  business.prospects[0].name = 'Sole Open Prospect';
  business.prospects[0].details = 'Synthetic sole open record';
  const businessBytes = JSON.stringify(business, null, 2);

  const run = runIsolatedJarvis(business, 'commercial assessment\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS COMMERCIAL ASSESSMENT/);
  assert.match(stdout, /CUSTOMER: Sole Open Prospect/);
  assert.match(stdout, /VALUE: SOLE_OPEN_OUTCOME/);
  assert.match(stdout, /EVIDENCE: STRONG/);
  assert.match(stdout, /JUDGEMENT: INVESTIGATE/);
  assert.match(stdout, /NEXT ACTION: Run prospect qualification using the recorded discovery evidence before recommending pursuit\./);
  assert.match(stdout, /External action: BLOCKED/);
  assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('prospect intelligence rejects weak research as insufficient evidence', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'prospect intelligence\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /EVIDENCE: INSUFFICIENT/);
  assert.match(result.stdout ?? '', /JUDGEMENT: NOT ENOUGH EVIDENCE/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('prospect intelligence distinguishes commercial signals from hypotheses', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'prospect intelligence\n',
    {
      research: [
        {
          query: 'Example Plumbing Durban',
          prospectName: 'Test prospect',
          result: 'Website: 24/7 emergency plumbing. WhatsApp enquiries available. Residential and commercial plumbing services.',
          status: 'UNVERIFIED',
          createdAt: new Date().toISOString()
        }
      ]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /COMMERCIAL SIGNALS:/);
  assert.match(result.stdout ?? '', /HYPOTHESES:/);
  assert.match(result.stdout ?? '', /UNKNOWN/);
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('prospect intelligence does not treat an unverified hypothesis as confirmed fact', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'prospect intelligence\n',
    {
      research: [
        {
          query: 'Example Plumbing Durban',
          prospectName: 'Test prospect',
          result: 'Website: WhatsApp enquiries available.',
          status: 'UNVERIFIED',
          createdAt: new Date().toISOString()
        }
      ]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /HYPOTHESES:/);
  assert.doesNotMatch(result.stdout ?? '', /FACT:.*losing leads/i);
  assert.doesNotMatch(result.stdout ?? '', /FACT:.*manual enquiry handling/i);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('action queue identifies the actual open follow-up', () => {
  const business = prospectFixture();
  business.followUps = [
    {
      text: 'Contact Guardsman Plumbers London',
      status: 'OPEN',
      createdAt: new Date().toISOString()
    }
  ];

  const { result } = runIsolatedJarvis(business, 'actions\n');

  assert.match(result.stdout ?? '', /Contact Guardsman Plumbers London/);
  assert.match(result.stdout ?? '', /Priority:.*100/);
  assert.match(result.stdout ?? '', /Reason:.*open follow-up.*require attention/);
  assert.match(result.stdout ?? '', /Zayn approval required/);
  assert.match(result.stdout ?? '', /Nothing is executed automatically/);
});

test('research remains unassigned by default and only links to an explicitly named open prospect', () => {
  const source = fs.readFileSync(indexFile, 'utf8');
  const start = source.indexOf('if (lower.startsWith("research:"))');
  const end = source.indexOf('if (lower.startsWith("record decision "))', start);

  assert.ok(start >= 0 && end > start, 'research handler should be present');
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /activeResearchProspects|activeResearchProspects\[0\]/);
  assert.match(handler, /researchProspectName \|\| "Unassigned"/);
  assert.match(handler, /prospect\.name\.trim\(\)\.toLowerCase\(\) === requestedProspectName\.trim\(\)\.toLowerCase\(\)/);
  assert.match(handler, /saveResearchEntry\(query, result, researchProspectName\)/);
  assert.match(handler, /matches\.length !== 1/);
});

test('research command stores unassigned research without borrowing the first open prospect', {
  skip: process.platform !== 'win32'
}, () => {
  const { result, state, researchCalls } = runIsolatedJarvis(
    prospectFixture(),
    'research: find company website\n',
    {},
    { fakeResearch: true }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Prospect: Unassigned/);
  assert.equal(researchCalls, 1, 'the research tool must be invoked exactly once');
  assert.equal(state.research.length, 1);
  assert.equal(state.research[0].prospectName, null);
  assert.equal(state.research[0].query, 'find company website');
  assert.equal(state.research[0].status, 'UNVERIFIED');
  assert.deepEqual(state.research[0].sources, [{
    url: 'https://example.com/test',
    support: 'unresolved',
    title: 'Example Result'
  }]);
  assert.ok(!('retrievedAt' in state.research[0].sources[0]), 'record creation must not be mislabelled as a retrieval timestamp');
  assert.equal(typeof state.research[0].createdAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(state.research[0].createdAt)), 'record creation timestamp must be valid');
});

test('research command associates evidence only with the explicitly named open prospect', {
  skip: process.platform !== 'win32'
}, () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'research: for Test prospect: find company website\n',
    {},
    { fakeResearch: true }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Prospect: Test prospect/);
  assert.equal(state.research.length, 1);
  assert.equal(state.research[0].prospectName, 'Test prospect');
  assert.equal(state.research[0].query, 'find company website');
});

test('research association trims accidental whitespace from prospect names', {
  skip: process.platform !== 'win32'
}, () => {
  const business = prospectFixture();
  business.prospects[0].name = '  Test prospect  ';

  const { result, state } = runIsolatedJarvis(
    business,
    'research: for Test prospect: find company website\n',
    {},
    { fakeResearch: true }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Prospect: Test prospect/);
  assert.equal(state.research.length, 1);
  assert.equal(state.research[0].prospectName, 'Test prospect');
});

test('research refuses to run when an explicitly named prospect cannot be uniquely matched', {
  skip: process.platform !== 'win32'
}, () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'research: for Wrong prospect: find company website\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /no single open prospect matched 'Wrong prospect'/);
  assert.equal(state.research, undefined);
});

test('research command returns and records the fake research result without network access', {
  skip: process.platform !== 'win32'
}, () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'research: find company website\n',
    {},
    { fakeResearch: true }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /EXA RESEARCH RESULTS/);
  assert.match(result.stdout ?? '', /Title: Example Result/);
  assert.equal(state.research.length, 1);
  assert.equal(state.research[0].prospectName, null);
  assert.equal(state.research[0].query, 'find company website');
});

test('the explicit research: command runs research directly without reaching the AI', {
  skip: process.platform !== 'win32'
}, () => {
  const { result, researchCalls } = runIsolatedJarvis(
    prospectFixture(),
    'research: find company website\n',
    {},
    { fakeResearch: true, fakeAIResponse: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /EXA RESEARCH RESULTS/);
  assert.match(result.stdout ?? '', /Title: Example Result/);
  assert.equal(researchCalls, 1, 'the direct command must invoke the research tool exactly once');
  assert.doesNotMatch(result.stdout ?? '', /COFOUNDER > Thinking\.\.\./);
});

test('a bare research command asks for a query and runs nothing', {
  skip: process.platform !== 'win32'
}, () => {
  const { result, researchCalls, state } = runIsolatedJarvis(
    prospectFixture(),
    'research\n',
    {},
    { fakeResearch: true, fakeAIResponse: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Please provide a research query/);
  assert.equal(researchCalls, 0, 'a bare command must not invoke the research tool');
  assert.ok(!state.research, 'a bare command must not persist research');
});

test('an ordinary natural-language request beginning with the word Research reaches the AI', () => {
  const { result, researchCalls, state } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Research current public guidance on South Africa POPIA.\n',
    {},
    { fakeAIResponse: true, fakeResearch: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.doesNotMatch(result.stdout ?? '', /JARVIS WEB RESEARCH/);
  assert.doesNotMatch(result.stdout ?? '', /EXA RESEARCH RESULTS/);
  assert.equal(researchCalls, 0, 'ordinary prose must not be executed as the direct research command');
  assert.ok(!state.research, 'ordinary prose must not persist research');
});

test('a natural-language request beginning with Research for is not treated as prospect research', () => {
  const { result, researchCalls, state } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Research for small business owners on POPIA compliance.\n',
    {},
    { fakeAIResponse: true, fakeResearch: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.doesNotMatch(result.stdout ?? '', /JARVIS WEB RESEARCH/);
  assert.equal(researchCalls, 0, 'prose beginning "Research for" must not invoke the research tool');
  assert.ok(!state.research, 'prose beginning "Research for" must not persist research');
});

test('capitalising the research word does not divert a natural-language request to the command', () => {
  const { result, researchCalls } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Research find company website\n',
    {},
    { fakeAIResponse: true, fakeResearch: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.doesNotMatch(result.stdout ?? '', /JARVIS WEB RESEARCH/);
  assert.equal(researchCalls, 0, 'case must not change routing');
});

test('multiple open prospects require an explicit selection before recommendation', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {
      problem: 'Confirmed problem',
      impact: 'Confirmed impact',
      currentSolution: 'Current workaround',
      desiredOutcome: 'Desired outcome',
      decisionMaker: 'Owner'
    }
  });

  const { result } = runIsolatedJarvis(business, 'prospect recommendation\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Multiple open prospects found/);
  assert.match(result.stdout ?? '', /select prospect <exact name>/);
  assert.match(result.stdout ?? '', /Test prospect/);
  assert.match(result.stdout ?? '', /Second prospect/);
  assert.doesNotMatch(result.stdout ?? '', /JARVIS PROSPECT RECOMMENDATION/);
});

test('explicit prospect selection directs recommendation to the chosen prospect', () => {
  const business = prospectFixture({
    problem: 'First prospect problem',
    impact: 'First prospect impact',
    currentSolution: 'First current solution',
    desiredOutcome: 'First desired outcome',
    decisionMaker: 'First decision maker'
  });
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {
      problem: 'Second prospect problem',
      impact: 'Second prospect impact',
      currentSolution: 'Second current solution',
      desiredOutcome: 'Second desired outcome',
      decisionMaker: 'Second decision maker'
    }
  });

  const { result, business: savedBusiness } = runIsolatedJarvis(
    business,
    'select prospect Second prospect\nprospect recommendation\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Selected prospect: Second prospect/);
  assert.match(result.stdout ?? '', /Prospect: Second prospect/);
  assert.equal(savedBusiness.selectedProspectName, 'Second prospect');
});

test('RC-04 prospect recommendation refuses stale saved prospect selection', () => {
  const business = {
    prospects: [
      {
        name: 'Closed Prospect',
        details: 'Synthetic closed record',
        status: 'CLOSED',
        discovery: {
          problem: 'CLOSED_PROBLEM',
          impact: 'CLOSED_IMPACT',
          currentSolution: 'CLOSED_SOLUTION',
          desiredOutcome: 'CLOSED_OUTCOME',
          decisionMaker: 'CLOSED_DECISION_MAKER'
        }
      },
      {
        name: 'Remaining Open',
        details: 'Synthetic open record',
        status: 'NEW',
        discovery: {
          problem: 'OPEN_ONLY_PROBLEM',
          impact: 'OPEN_ONLY_IMPACT',
          currentSolution: 'OPEN_ONLY_SOLUTION',
          desiredOutcome: 'OPEN_ONLY_OUTCOME',
          decisionMaker: 'OPEN_ONLY_DECISION_MAKER'
        }
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: [],
    selectedProspectName: 'Closed Prospect'
  };
  const businessBytes = JSON.stringify(business, null, 2);

  const run = runIsolatedJarvis(business, 'prospect recommendation\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.match(stdout, /No prospect-dependent recommendation was produced\./);
  assert.doesNotMatch(stdout, /JARVIS PROSPECT RECOMMENDATION/);
  assert.doesNotMatch(stdout, /Prospect: Remaining Open/);
  assert.doesNotMatch(stdout, /OPEN_ONLY_PROBLEM/);
  assert.doesNotMatch(stdout, /STATUS: READY FOR REVIEW/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.deepEqual(
    run.business.prospects.find(item => item.name === 'Remaining Open'),
    business.prospects[1]
  );
});

test('RC-04 prospect recommendation preserves single-open auto-selection', () => {
  const business = {
    prospects: [
      {
        name: 'Sole Open Prospect',
        details: 'Synthetic sole open record',
        status: 'NEW',
        discovery: {
          problem: 'SOLE_OPEN_PROBLEM',
          impact: 'SOLE_OPEN_IMPACT',
          currentSolution: 'SOLE_OPEN_SOLUTION',
          desiredOutcome: 'SOLE_OPEN_OUTCOME',
          decisionMaker: 'SOLE_OPEN_DECISION_MAKER'
        }
      }
    ],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };
  const businessBytes = JSON.stringify(business, null, 2);

  const run = runIsolatedJarvis(business, 'prospect recommendation\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS PROSPECT RECOMMENDATION/);
  assert.match(stdout, /Prospect: Sole Open Prospect/);
  assert.match(stdout, /STATUS: READY FOR REVIEW/);
  assert.match(stdout, /Core discovery information has been recorded\./);
  assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);
  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('commercial brain respects the explicitly selected prospect', () => {
  const business = prospectFixture({
    problem: 'First prospect problem',
    impact: 'First prospect impact',
    currentSolution: 'First current solution',
    desiredOutcome: 'First desired outcome',
    decisionMaker: 'First decision maker'
  });
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {
      problem: 'Second prospect problem',
      impact: 'Second prospect impact',
      currentSolution: 'Second current solution',
      desiredOutcome: 'Second desired outcome',
      decisionMaker: 'Second decision maker'
    }
  });
  business.selectedProspectName = 'Second prospect';

  const { result } = runIsolatedJarvis(business, 'commercial brain\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /ACTIVE PROSPECT[\s\S]*Name: Second prospect/);
  assert.match(result.stdout ?? '', /Second prospect problem/);
  assert.doesNotMatch(result.stdout ?? '', /Name: Test prospect/);
});

test('RC-04 commercialBrain analysis refuses stale saved prospect selection', () => {
  const business = prospectFixture({
    problem: 'OPEN_PROBLEM',
    impact: 'OPEN_IMPACT',
    currentSolution: 'OPEN_CURRENT_SOLUTION',
    desiredOutcome: 'OPEN_DESIRED_OUTCOME',
    decisionMaker: 'OPEN_DECISION_MAKER',
    budget: 'OPEN_BUDGET',
    timeline: 'OPEN_TIMELINE'
  });
  business.prospects[0].name = 'Remaining Open Prospect';
  business.prospects[0].qualification = { status: 'QUALIFIED' };
  business.prospects.unshift({
    name: 'Closed Prospect',
    details: 'Closed business',
    status: 'CLOSED',
    discovery: {}
  });
  business.selectedProspectName = 'Closed Prospect';
  business.opportunities = [{ text: 'GENERIC_OPEN_OPPORTUNITY', status: 'OPEN' }];

  const run = runIsolatedJarvis(business, 'commercial brain\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS COMMERCIAL BRAIN/);
  assert.match(stdout, /COMMERCIAL PIPELINE/);
  assert.match(stdout, /Open prospects: 1/);
  assert.match(stdout, /Open opportunities: 1/);
  assert.match(stdout, /OPEN OPPORTUNITY/);
  assert.match(stdout, /GENERIC_OPEN_OPPORTUNITY/);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);

  assert.doesNotMatch(stdout, /ACTIVE PROSPECT/);
  assert.doesNotMatch(stdout, /Name: Remaining Open Prospect/);
  assert.doesNotMatch(stdout, /OPEN_PROBLEM/);
  assert.doesNotMatch(stdout, /OPEN_IMPACT/);
  assert.doesNotMatch(stdout, /OPEN_CURRENT_SOLUTION/);
  assert.doesNotMatch(stdout, /OPEN_DESIRED_OUTCOME/);
  assert.doesNotMatch(stdout, /OPEN_DECISION_MAKER/);
  assert.doesNotMatch(stdout, /OPEN_BUDGET/);
  assert.doesNotMatch(stdout, /OPEN_TIMELINE/);
  assert.doesNotMatch(stdout, /Qualification:/);
  assert.doesNotMatch(stdout, /POTENTIAL ZAYZANA OFFER FIT/);
  assert.doesNotMatch(stdout, /COMMERCIAL READ/);
  assert.doesNotMatch(stdout, /COMMERCIAL NEXT ACTION/);
  assert.doesNotMatch(stdout, /DISCOVERY QUESTION/);
  assert.doesNotMatch(stdout, /Recorded evidence is sufficient for commercial review\./);
  assert.doesNotMatch(stdout, /Review the matching Zayzana offer and prepare commercial terms for Zayn's approval\./);

  assert.deepEqual(run.business, business);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.equal(Object.prototype.hasOwnProperty.call(run.business.prospects[0], 'currentDiscoveryField'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business.prospects[1], 'currentDiscoveryField'), false);
});

test('RC-04 commercialBrain analysis preserves single-open auto-selection', () => {
  const business = prospectFixture({
    problem: 'SOLE_OPEN_PROBLEM',
    impact: 'SOLE_OPEN_IMPACT',
    currentSolution: 'SOLE_OPEN_CURRENT_SOLUTION',
    desiredOutcome: 'SOLE_OPEN_DESIRED_OUTCOME',
    decisionMaker: 'SOLE_OPEN_DECISION_MAKER'
  });

  const run = runIsolatedJarvis(business, 'commercial brain\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS COMMERCIAL BRAIN/);
  assert.match(stdout, /ACTIVE PROSPECT[\s\S]*Name: Test prospect/);
  assert.match(stdout, /Qualification: NOT CHECKED/);
  assert.match(stdout, /Problem: SOLE_OPEN_PROBLEM/);
  assert.match(stdout, /Current solution: SOLE_OPEN_CURRENT_SOLUTION/);
  assert.match(stdout, /COMMERCIAL GAPS[\s\S]*1\. budget[\s\S]*2\. timeline/);
  assert.match(stdout, /Do not treat this prospect as sales-ready yet\./);
  assert.match(stdout, /COMMERCIAL NEXT ACTION[\s\S]*Confirm whether a budget or spending range exists for solving the problem\./);
  assert.match(stdout, /DISCOVERY QUESTION[\s\S]*Has the business already set aside a budget or spending range for solving this problem\?/);

  assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);

  assert.deepEqual(run.business, business);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business.prospects[0], 'currentDiscoveryField'), false);
});

test('commercial view displays the recorded current solution as evidence', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Manual spreadsheet workflow',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin',
    decisionMaker: 'Operations manager'
  });

  const { result } = runIsolatedJarvis(fixture, 'commercial\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Current solution: Manual spreadsheet workflow/);
});

test('commercial view reports the current solution as a gap when it is missing', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days'
  });

  const { result } = runIsolatedJarvis(fixture, 'commercial\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /1\. current solution/);
  assert.doesNotMatch(result.stdout ?? '', /No major recorded commercial information gaps\./);
});

test('commercial guided discovery asks for the current solution before the desired outcome', () => {
  const fixture = prospectFixture({
    problem: 'Manual follow-up is eating staff time',
    impact: 'Staff lose 10 hours weekly'
  });

  const { result, business } = runIsolatedJarvis(
    fixture,
    'commercial\ncapture discovery Automate follow-up and tracking\n'
  );

  assert.equal(result.status, 0);
  assert.match(
    result.stdout ?? '',
    /How are you handling this problem today\?/,
    'commercial should ask the current-solution question when currentSolution is missing'
  );
  assert.equal(
    business.prospects[0].discovery.currentSolution,
    'Automate follow-up and tracking',
    'the current-solution answer must be stored in discovery.currentSolution'
  );
  assert.ok(
    !business.prospects[0].discovery.desiredOutcome,
    'the current-solution answer must not be stored in discovery.desiredOutcome'
  );
});

test('prospect workspace does not mark a prospect ready when the current solution is missing', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin',
    decisionMaker: 'Operations manager'
  });

  const { result } = runIsolatedJarvis(fixture, 'prospect workspace\n');

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout ?? '', /READY FOR REVIEW/);
  assert.match(result.stdout ?? '', /Current solution is not recorded\./);
});

test('prospect workspace does not mark a prospect ready when the decision maker is missing', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Staff use spreadsheets and manual messages',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin'
  });

  const { result } = runIsolatedJarvis(fixture, 'prospect workspace\n');

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout ?? '', /READY FOR REVIEW/);
  assert.match(result.stdout ?? '', /Decision maker is not recorded\./);
});

test('prospect workspace leaves business data unchanged', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Staff use spreadsheets and manual messages',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin',
    decisionMaker: 'Operations manager'
  });
  const before = JSON.stringify(fixture);

  const { result, business } = runIsolatedJarvis(fixture, 'prospect workspace\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /READY FOR REVIEW/);
  assert.equal(JSON.stringify(business), before);
});

test('RC-04 prospect workspace refuses stale saved prospect selection', () => {
  const business = prospectFixture({
    problem: 'WORKSPACE_OPEN_PROBLEM',
    impact: 'WORKSPACE_OPEN_IMPACT',
    currentSolution: 'Manual workspace process',
    desiredOutcome: 'WORKSPACE_OPEN_OUTCOME',
    decisionMaker: 'WORKSPACE_OPEN_DECISION_MAKER',
    budget: 'R15000',
    timeline: 'Within 30 days'
  });
  business.prospects[0].name = 'Remaining Open Prospect';
  business.prospects[0].details = 'Synthetic open workspace record';
  business.prospects.unshift({
    name: 'Closed Prospect',
    details: 'Synthetic closed workspace record',
    status: 'CLOSED',
    discovery: {}
  });
  business.selectedProspectName = 'Closed Prospect';
  const businessBytes = JSON.stringify(business, null, 2);

  const run = runIsolatedJarvis(business, 'prospect workspace\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);

  assert.doesNotMatch(stdout, /JARVIS PROSPECT WORKSPACE/);
  assert.doesNotMatch(stdout, /IDENTITY/);
  assert.doesNotMatch(stdout, /Name: Remaining Open Prospect/);
  assert.doesNotMatch(stdout, /Synthetic open workspace record/);
  assert.doesNotMatch(stdout, /WORKSPACE_OPEN_PROBLEM/);
  assert.doesNotMatch(stdout, /WORKSPACE_OPEN_IMPACT/);
  assert.doesNotMatch(stdout, /Manual workspace process/);
  assert.doesNotMatch(stdout, /WORKSPACE_OPEN_OUTCOME/);
  assert.doesNotMatch(stdout, /WORKSPACE_OPEN_DECISION_MAKER/);
  assert.doesNotMatch(stdout, /COMMERCIAL FIGURES/);
  assert.doesNotMatch(stdout, /RECOMMENDATION/);
  assert.doesNotMatch(stdout, /QUALIFICATION/);
  assert.doesNotMatch(stdout, /NEXT STAGE/);

  assert.equal(run.protectedFiles['business.json'], businessBytes);
  assert.deepEqual(run.business, business);
  assert.equal(run.business.selectedProspectName, 'Closed Prospect');
  assert.equal(Object.prototype.hasOwnProperty.call(run.business.prospects[0], 'currentDiscoveryField'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business.prospects[1], 'currentDiscoveryField'), false);
});

test('RC-04 prospect workspace preserves single-open auto-selection', () => {
  const business = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    currentSolution: 'Staff use spreadsheets and manual messages',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin',
    decisionMaker: 'Operations manager'
  });
  business.prospects[0].name = 'Sole Workspace Prospect';
  business.prospects[0].details = 'Synthetic sole workspace record';
  const before = JSON.stringify(business);

  const run = runIsolatedJarvis(business, 'prospect workspace\n');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.match(stdout, /JARVIS PROSPECT WORKSPACE/);
  assert.match(stdout, /IDENTITY/);
  assert.match(stdout, /Name: Sole Workspace Prospect/);
  assert.match(stdout, /Details: Synthetic sole workspace record/);
  assert.match(stdout, /DISCOVERY/);
  assert.match(stdout, /READY FOR REVIEW/);
  assert.match(stdout, /COMMERCIAL FIGURES/);
  assert.match(stdout, /QUALIFICATION/);
  assert.match(stdout, /NEXT STAGE/);
  assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /The saved prospect selection does not match an open prospect/);

  assert.equal(JSON.stringify(run.business), before);
  assert.equal(Object.prototype.hasOwnProperty.call(run.business, 'selectedProspectName'), false);
});

test('dashboard views respect the selected prospect instead of showing the first open prospect', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: { problem: 'Second prospect problem' }
  });
  business.selectedProspectName = 'Second prospect';

  for (const command of [
    'action brain',
    'business priorities',
    'operating brain',
    'opportunity action',
    'zayzana focus'
  ]) {
    const { result } = runIsolatedJarvis(business, command + '\n');
    assert.equal(result.status, 0, command);
    assert.match(result.stdout ?? '', /Second prospect/, command);
    assert.doesNotMatch(result.stdout ?? '', /Test prospect/, command);
  }
});

test('dashboard views require selection when multiple prospects are open and none is selected', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW'
  });

  for (const command of [
    'action brain',
    'business priorities',
    'operating brain',
    'opportunity action',
    'zayzana focus'
  ]) {
    const { result } = runIsolatedJarvis(business, command + '\n');
    assert.equal(result.status, 0, command);
    assert.match(result.stdout ?? '', /select prospect <exact name>/i, command);
    assert.doesNotMatch(result.stdout ?? '', /Work the next prospect: Test prospect|Contact the prospect: Test prospect|CURRENT FOCUS: Prospect \| Test prospect/, command);
  }
});

test('dashboard views require reselection when the saved prospect is no longer open and multiple prospects remain', () => {
  const business = prospectFixture();
  business.prospects[0].status = 'CLOSED';
  business.prospects.push(
    { name: 'Second prospect', status: 'NEW' },
    { name: 'Third prospect', status: 'NEW' }
  );
  business.selectedProspectName = 'Test prospect';

  for (const command of [
    'action brain',
    'business priorities',
    'operating brain',
    'opportunity action',
    'zayzana focus'
  ]) {
    const { result } = runIsolatedJarvis(business, command + '\n');
    assert.equal(result.status, 0, command);
    assert.match(result.stdout ?? '', /select prospect <exact name>/i, command);
    assert.doesNotMatch(result.stdout ?? '', /CURRENT FOCUS: Selected prospect \\| Test prospect|Work the selected prospect: Test prospect/, command);
  }
});

test('dashboard views do not choose between duplicate open prospect names', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Test prospect',
    details: 'A different record with the same name',
    status: 'NEW'
  });
  business.prospects.push({ name: 'Third prospect', status: 'NEW' });
  business.selectedProspectName = 'Test prospect';

  for (const command of [
    'action brain',
    'business priorities',
    'operating brain',
    'opportunity action',
    'zayzana focus'
  ]) {
    const { result } = runIsolatedJarvis(business, command + '\n');
    assert.equal(result.status, 0, command);
    assert.match(result.stdout ?? '', /select prospect <exact name>/i, command);
    assert.doesNotMatch(result.stdout ?? '', /Work the selected prospect: Test prospect|CURRENT FOCUS: Selected prospect \\| Test prospect/, command);
  }
});

test('AI conversation uses the direct Gemini API response', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'What is our commercial focus?\n',
    {},
    { fakeAIResponse: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
});
test('unknown tell-me-about topic reaches AI instead of project error', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'Tell me about the weather today\n',
    {},
    { fakeAIResponse: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.doesNotMatch(result.stdout ?? '', /I don't recognise that project/);
});

test('Fishing Logbook question still opens its project details', () => {
  const { result } = runIsolatedJarvis(
    {
      prospects: [],
      opportunities: [],
      offers: [],
      followUps: [],
      revenue: []
    },
    'Tell me about Fishing Logbook\n'
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Fishing Logbook/);
  assert.doesNotMatch(result.stdout ?? '', /ZAYZANA TECH .* PROJECT PORTFOLIO/);
});

test('stop command is handled locally when no AI request is active', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'stop\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /No AI request is currently running/);
  assert.doesNotMatch(result.stdout ?? '', /Thinking\.\.\./);
});

test('missing Gemini API key produces a clear error without fallback', () => {
  const { result } = runIsolatedJarvis(prospectFixture(), 'What should we do next?\n');
  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /GEMINI_API_KEY is not set/);
  assert.doesNotMatch(result.stdout ?? '', /fallback provider|All AI providers failed/);
});

test('Ollama can be selected explicitly as the local provider', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'What is our commercial focus?\n',
    {},
    { fakeAIResponse: true, provider: 'ollama' }
  );
  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /OLLAMA TEST RESPONSE/);
});

test('stop interrupts an active AI request without switching providers', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'What should we do next?\nstop\n',
    {},
    { fakeAIHangs: true }
  );
  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Stop requested/);
  assert.match(result.stdout ?? '', /Request cancelled by Zayn/);
  assert.doesNotMatch(result.stdout ?? '', /fallback provider|All AI providers failed/);
});


test('stop stops speech locally without ending the session', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'stop\nWhat is our commercial focus?\n',
    {},
    { fakeAIResponse: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /No AI request is currently running/);
  assert.match(result.stdout ?? '', /Speech stopped\. Cofounder is still running/);
  // The session must survive a stop: the next command still reaches the AI.
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
});

test('the response prompt is not blocked by speech playback', () => {
  const source = fs.readFileSync(indexFile, 'utf8');
  // Speech must never be awaited, otherwise the prompt waits for it to finish.
  assert.doesNotMatch(source, /await\s+speakText\(/);
  assert.match(source, /speakText\(spokenResponse\)/);
});

test('stop command handler stops speech and does not close the session', () => {
  const source = fs.readFileSync(indexFile, 'utf8');
  const start = source.indexOf('const isStopCommand =');
  const end = source.indexOf('if (commandBusy) {', start);
  assert.ok(start >= 0 && end > start, 'stop command handler should be present');
  const handler = source.slice(start, end);
  assert.match(handler, /stopSpeech\(\)/);
  assert.doesNotMatch(handler, /rl\.close\(\)/);
  assert.doesNotMatch(handler, /shuttingDown\s*=\s*true/);
});


test('portfolio question lists all known projects instead of only the umbrella company', () => {
  const { result } = runIsolatedJarvis(
    {
      prospects: [],
      opportunities: [],
      offers: [],
      followUps: [],
      revenue: []
    },
    'tell me about zayzana latest projects and products\\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /ZAYZANA TECH — PROJECT PORTFOLIO/);
  assert.match(result.stdout ?? '', /Zayzana Tech/);
  assert.match(result.stdout ?? '', /Fishing Logbook/);
  assert.match(result.stdout ?? '', /Taalhuis/);
  assert.match(result.stdout ?? '', /Sizani/);
  assert.match(result.stdout ?? '', /JARVIS/);
  assert.match(result.stdout ?? '', /Take n Pay/);
  assert.match(result.stdout ?? '', /does not mean it has paying customers or validated demand/);
});

test('single-project question still shows only the requested project', () => {
  const { result } = runIsolatedJarvis(
    {
      prospects: [],
      opportunities: [],
      offers: [],
      followUps: [],
      revenue: []
    },
    'tell me about taalhuis\\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /School-facing Afrikaans and education learning platform/);
  assert.doesNotMatch(result.stdout ?? '', /ZAYZANA TECH — PROJECT PORTFOLIO/);
  assert.doesNotMatch(result.stdout ?? '', /Fishing Logbook/);
});


test('read-only business audit reports local file health and missing memory without changing records', () => {
  const business = {
    prospects: [],
    opportunities: [],
    offers: [],
    followUps: [],
    revenue: []
  };
  const state = {
    goals: [],
    decisions: [],
    approvals: [],
    executions: [],
    lessons: [],
    research: []
  };
  const { result, business: afterBusiness, state: afterState } = runIsolatedJarvis(
    business,
    'audit\n',
    state
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /COFOUNDER — READ-ONLY BUSINESS DATA AUDIT/);
  assert.match(result.stdout ?? '', /business\.json[\s\S]*Status: OK — JSON parsed/);
  assert.match(result.stdout ?? '', /cofounder-state\.json[\s\S]*Status: OK — JSON parsed/);
  assert.match(result.stdout ?? '', /memory\.json[\s\S]*Status: MISSING/);
  assert.match(result.stdout ?? '', /No file was created/);
  assert.match(result.stdout ?? '', /No files were modified by the audit/);
  assert.deepEqual(afterBusiness, business);
  assert.deepEqual(afterState, state);
});

test('read-only business audit detects malformed JSON without changing the file', () => {
  const malformedBusiness = '{ invalid json';
  const { result, protectedFiles } = runIsolatedJarvis(
    {},
    'audit\n',
    {},
    { invalidBusinessData: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /business\.json[\s\S]*Status: INVALID JSON/);
  const problemCount = (result.stdout ?? '').match(/Items requiring review: (\d+)/);
  assert.ok(problemCount, 'the audit must report a problem count');
  assert.ok(Number(problemCount[1]) > 0, 'the audit must report a non-zero problem count');
  assert.equal(
    protectedFiles['business.json'],
    malformedBusiness,
    'the malformed business.json must remain byte-identical'
  );
  assert.match(result.stdout ?? '', /No files were modified by the audit/);
});


test('daily briefing treats missing or invalid business data as unknown instead of an empty pipeline', () => {
  for (const options of [{ omitBusinessData: true }, { invalidBusinessData: true }]) {
    const { result, business } = runIsolatedJarvis(
      { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
      'briefing\n',
      {},
      options
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout ?? '', /business\.json status: (MISSING|INVALID_OR_UNREADABLE)/);
    assert.match(result.stdout ?? '', /Open prospects: UNAVAILABLE/);
    assert.match(result.stdout ?? '', /Restore or validate business\.json/);
    assert.doesNotMatch(result.stdout ?? '', /No active prospect or open opportunity is recorded/);
    assert.equal(business, null);
  }
});

test('daily briefing ranks an overdue follow-up and reports real record counts without mutating state', () => {
  const business = prospectFixture();
  business.followUps = [
    { text: 'Follow up with paying customer', status: 'OPEN', dueDate: '2026-01-01' },
    { text: 'Later follow-up', status: 'OPEN', dueDate: '2099-01-01' }
  ];
  const state = {
    goals: [{ title: 'Grow revenue', status: 'ACTIVE' }],
    approvals: [],
    lessons: []
  };
  const beforeBusiness = JSON.stringify(business);
  const { result, business: afterBusiness, state: afterState } = runIsolatedJarvis(
    business,
    'briefing\n',
    state
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /COFOUNDER DAILY BRIEFING/);
  assert.match(result.stdout ?? '', /Open follow-ups: 2/);
  assert.match(result.stdout ?? '', /Overdue follow-ups with a valid recorded date: 1/);
  assert.match(result.stdout ?? '', /NEXT ACTION: Review overdue follow-up: Follow up with paying customer/);
  assert.match(result.stdout ?? '', /PRIORITY SCORE: 110/);
  assert.match(result.stdout ?? '', /READ ONLY/);
  assert.equal(JSON.stringify(afterBusiness), beforeBusiness);
  assert.deepEqual(afterState.goals, state.goals);
  assert.deepEqual(afterState.approvals, state.approvals);
  assert.deepEqual(afterState.lessons, state.lessons);
});

test('daily briefing does not invent a prospect choice when several prospects need discovery', () => {
  const business = prospectFixture();
  business.prospects.push({ name: 'Second prospect', status: 'NEW', discovery: {} });
  const { result } = runIsolatedJarvis(business, 'daily briefing\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Choose which prospect to qualify next/);
  assert.match(result.stdout ?? '', /Test prospect, Second prospect/);
  assert.match(result.stdout ?? '', /Several prospects have incomplete discovery/);
  assert.match(result.stdout ?? '', /contacting anyone/);
});

test('daily briefing flags a prospect that is missing only the current solution', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff lose 10 hours weekly',
    desiredOutcome: 'Automate routine follow-up and reduce manual admin',
    decisionMaker: 'Operations manager',
    budget: 'R15000',
    timeline: 'Within 30 days'
  });

  const { result } = runIsolatedJarvis(fixture, 'briefing\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Qualify Test prospect: capture the current solution\./);
  assert.match(result.stdout ?? '', /1 required discovery field\(s\) still missing\./);
});

test('daily briefing gives a grounded first commercial action when the pipeline is empty', () => {
  const business = { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] };
  const { result } = runIsolatedJarvis(business, 'what should i do next\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /No active prospect or open opportunity is recorded/);
  assert.match(result.stdout ?? '', /Identify one real buyer/);
  assert.match(result.stdout ?? '', /READ ONLY/);
});


test('AI context summarizes prioritized records and labels missing sources instead of dumping truncated JSON', () => {
  const business = prospectFixture({
    problem: 'Manual dispatch delays customer orders',
    impact: 'Staff spend three hours each day updating customers',
    desiredOutcome: 'Reduce customer update time'
  });
  business.followUps = [
    { text: 'Call buyer about paid pilot', status: 'OPEN', dueDate: '2026-01-01' }
  ];
  const state = {
    goals: [{ title: 'Win first paid pilot', status: 'ACTIVE' }],
    decisions: [{ decision: 'Test one small paid pilot', outcome: 'pending' }],
    approvals: [],
    lessons: [{ text: 'Confirm buyer pain before building' }],
    research: [{ query: 'Customer service workflow', prospectName: 'Test prospect', status: 'UNVERIFIED', createdAt: '2026-10-15' }]
  };
  const { result, capturedAIRequest } = runIsolatedJarvis(
    business,
    'What should we do next?\n',
    state,
    {
      fakeAIResponse: true,
      captureAIRequest: true,
      memoryData: [{ text: 'Keep spending near zero', savedAt: '2026-10-15' }]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.match(capturedAIRequest ?? '', /CURRENT LOCAL RECORD SUMMARY/);

  assert.match(capturedAIRequest ?? '', /Commercial Strategist/);
  assert.match(capturedAIRequest ?? '', /Customer\/Market Analyst/);
  assert.match(capturedAIRequest ?? '', /Sceptic\/Risk Adviser/);
  assert.match(capturedAIRequest ?? '', /Chair reconciles disagreements/);
  assert.match(capturedAIRequest ?? '', /likelihood of payment/);
  assert.match(capturedAIRequest ?? '', /cheapest next validation step/);
  assert.match(capturedAIRequest ?? '', /Manual dispatch delays customer orders/);
  assert.match(capturedAIRequest ?? '', /Call buyer about paid pilot/);
  assert.match(capturedAIRequest ?? '', /Win first paid pilot/);
  assert.match(capturedAIRequest ?? '', /UNVERIFIED RESEARCH/);
  assert.match(capturedAIRequest ?? '', /Keep spending near zero/);
  assert.match(capturedAIRequest ?? '', /memory.json: READABLE/);
  assert.doesNotMatch(capturedAIRequest ?? '', /No local context files could be read/);
});


test('multiline paste mode sends a complete prompt as one AI request', () => {
  const { result, capturedAIRequest } = runIsolatedJarvis(
    {
      prospects: [],
      opportunities: [],
      offers: [],
      followUps: [],
      revenue: []
    },
    'paste\nProcess the complete instruction.\nInclude prices, costs, and the message draft.\nDo not ask me to repeat the instruction.\nEND\n',
    {},
    { fakeAIResponse: true, captureAIRequest: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.ok(capturedAIRequest, 'expected the AI request to be captured');
  const payload = JSON.parse(capturedAIRequest);
  const prompt = payload.contents[0].parts[0].text;
  assert.match(prompt, /LATEST MESSAGE FROM ZAYN:\nProcess the complete instruction\.\nInclude prices, costs, and the message draft\.\nDo not ask me to repeat the instruction\./);
  assert.doesNotMatch(prompt, /LATEST MESSAGE FROM ZAYN:\nProcess the complete instruction\.\nCOFOUNDER:/);
});


test('commercial deliverables receive a second-pass evidence and delivery audit', () => {
  const { result, capturedAIRequest } = runIsolatedJarvis(
    {
      prospects: [],
      opportunities: [],
      offers: [],
      followUps: [],
      revenue: []
    },
    'Produce a complete commercial decision brief for a pilot offer with pricing and delivery scope.\n',
    {},
    { fakeAIResponse: true, captureAIRequest: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Running commercial evidence and delivery audit/);
  assert.ok(capturedAIRequest, 'expected the audit request to be captured');
  const auditPayload = JSON.parse(capturedAIRequest);
  const auditPrompt = auditPayload.contents[0].parts[0].text;
  assert.match(auditPrompt, /independent commercial evidence and delivery reviewer/);
  assert.match(auditPrompt, /Remove or qualify every feature/);
  assert.match(auditPrompt, /founder labour using an explicit assumed hourly rate/);
  assert.match(auditPrompt, /DRAFT TO AUDIT AND CORRECT/);
});

test('the commercial audit reuses the prepared context instead of rebuilding it', () => {
  const source = fs.readFileSync(indexFile, 'utf8');
  const start = source.indexOf('function buildCommercialDeliverableAuditMessage');
  const end = source.indexOf('async function askCofounderAI', start);
  assert.ok(start >= 0 && end > start, 'audit builder should be present');
  const builder = source.slice(start, end);
  // The safeguard still runs, but it must not recompute the company context.
  assert.match(builder, /baseMessage/);
  assert.doesNotMatch(builder, /buildCofounderMessage\(/);
});

test('ordinary prompts do not trigger the commercial evidence and delivery audit', () => {
  const { result } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'What is our commercial focus?\n',
    {},
    { fakeAIResponse: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.doesNotMatch(result.stdout ?? '', /Running commercial evidence and delivery audit/);
});


test('missing optional local state files do not stop a public research question from reaching the AI', () => {
  const { result, capturedAIRequest } = runIsolatedJarvis(
    null,
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    { fakeAIResponse: true, captureAIRequest: true, omitBusinessData: true, omitStateData: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.match(capturedAIRequest ?? '', /business\.json: MISSING/);
  assert.match(capturedAIRequest ?? '', /cofounder-state\.json: MISSING/);
  // The AI is explicitly told that absent local state must not block a research task.
  assert.match(capturedAIRequest ?? '', /must never be a reason to refuse/);
});

test('the assistant runs the existing live research tool once and grounds the answer on real results', () => {
  const { result, capturedAIRequest, state } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban KZN bookkeeping practices directory',
        'GROUNDED ANSWER citing https://example.com/test'
      ],
      fakeResearch: true,
      captureAIRequest: true
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Live web research returned/);
  assert.match(result.stdout ?? '', /GROUNDED ANSWER/);
  assert.ok(capturedAIRequest, 'expected the grounded request to be captured');
  const prompt = JSON.parse(capturedAIRequest).contents[0].parts[0].text;
  assert.match(prompt, /LIVE WEB RESEARCH RESULTS/);
  assert.match(prompt, /https:\/\/example\.com\/test/);
  // Results must remain in the response only, not be written to protected user data.
  assert.ok(!state.research || state.research.length === 0);
});

test('a research request does not alter any protected user-data JSON file', () => {
  const seeds = {
    'business.json': JSON.stringify({ prospects: [], opportunities: [], offers: [], followUps: [], revenue: [], marker: 'business-untouched' }, null, 2),
    'cofounder-state.json': JSON.stringify({ goals: [], decisions: [], approvals: [], executions: [], lessons: [], research: [], marker: 'state-untouched' }, null, 2),
    'memory.json': JSON.stringify([{ text: 'keep me', marker: 'memory-untouched' }], null, 2),
    'reminders.json': JSON.stringify([{ message: 'keep', time: 9999999999999, marker: 'reminders-untouched' }], null, 2),
    'tasks.json': JSON.stringify([{ text: 'keep', marker: 'tasks-untouched' }], null, 2),
    'cofounder-settings.json': JSON.stringify({ speechEnabled: false }, null, 2)
  };
  const { result, protectedFiles } = runIsolatedJarvis(
    null,
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban KZN bookkeeping practices directory',
        'GROUNDED ANSWER citing https://example.com/test'
      ],
      fakeResearch: true,
      seedProtectedFiles: seeds
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GROUNDED ANSWER/);
  for (const [name, expected] of Object.entries(seeds)) {
    assert.equal(protectedFiles[name], expected, name + ' must remain byte-identical after a research request');
  }
});

test('a research request does not create protected user-data JSON files that are absent', () => {
  const { result, protectedFiles, state } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban bookkeeping practices',
        'GROUNDED ANSWER citing https://example.com/test'
      ],
      fakeResearch: true,
      omitStateData: true
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.equal(state, null);
  assert.equal(protectedFiles['cofounder-state.json'], null, 'an absent cofounder-state.json must not be created');
  assert.equal(protectedFiles['memory.json'], null, 'an absent memory.json must not be created');
});

test('a natural-language Research request grounds the answer with exactly one research call and no persistence', () => {
  const { result, researchCalls, state } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Research current public guidance on South Africa POPIA.\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban KZN bookkeeping practices directory',
        'GROUNDED ANSWER citing https://example.com/test'
      ],
      fakeResearch: true
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Live web research returned/);
  assert.match(result.stdout ?? '', /GROUNDED ANSWER/);
  assert.equal(researchCalls, 1, 'exactly one research tool invocation');
  assert.ok(!state.research || state.research.length === 0, 'grounded research must not be persisted');
});

test('a natural-language Research request leaves protected user-data files byte-identical', () => {
  const seeds = {
    'business.json': JSON.stringify({ prospects: [], opportunities: [], offers: [], followUps: [], revenue: [], marker: 'business-untouched' }, null, 2),
    'cofounder-state.json': JSON.stringify({ goals: [], decisions: [], approvals: [], executions: [], lessons: [], research: [], marker: 'state-untouched' }, null, 2),
    'memory.json': JSON.stringify([{ text: 'keep me', marker: 'memory-untouched' }], null, 2),
    'reminders.json': JSON.stringify([{ message: 'keep', time: 9999999999999, marker: 'reminders-untouched' }], null, 2),
    'tasks.json': JSON.stringify([{ text: 'keep', marker: 'tasks-untouched' }], null, 2),
    'cofounder-settings.json': JSON.stringify({ speechEnabled: false }, null, 2)
  };
  const { result, researchCalls, protectedFiles } = runIsolatedJarvis(
    null,
    'Research current public guidance on South Africa POPIA.\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban KZN bookkeeping practices directory',
        'GROUNDED ANSWER citing https://example.com/test'
      ],
      fakeResearch: true,
      seedProtectedFiles: seeds
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /GROUNDED ANSWER/);
  assert.equal(researchCalls, 1, 'exactly one research tool invocation');
  for (const [name, expected] of Object.entries(seeds)) {
    assert.equal(protectedFiles[name], expected, name + ' must remain byte-identical after a natural-language research request');
  }
});

test('a failed live search is reported honestly instead of inventing sources', () => {
  const { result, capturedAIRequest, state } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban bookkeeping practices',
        'I could not verify these; no live results were returned.'
      ],
      fakeResearchError: true,
      captureAIRequest: true
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Live web research failed/);
  assert.match(result.stdout ?? '', /could not verify/);
  const prompt = JSON.parse(capturedAIRequest).contents[0].parts[0].text;
  assert.match(prompt, /The live web search tool failed/);
  assert.ok(!state.research || state.research.length === 0, 'a failed search must not be saved as evidence');
});

test('a failed AI request is not retried automatically', () => {
  const { result, capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'What should we do next?\n',
    {},
    { fakeAIResponse: true, aiFailFirst: 1, captureAIRequests: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /AI request failed/);
  assert.equal(capturedAIRequests.length, 1, 'a failed request must not create an automatic retry');
});

test('a failed AI request does not contaminate the next prompt', () => {
  const { capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'UNIQUE FAILED PROMPT alpha\nWhat is our commercial focus?\n',
    {},
    { fakeAIResponse: true, aiFailFirst: 1, captureAIRequests: true }
  );

  assert.equal(capturedAIRequests.length, 2);
  const second = JSON.parse(capturedAIRequests[1]).contents[0].parts[0].text;
  assert.doesNotMatch(second, /UNIQUE FAILED PROMPT alpha/);
  assert.match(second, /LATEST MESSAGE FROM ZAYN:\nWhat is our commercial focus\?/);
});

test('each queued command produces its own coherent request without merging', () => {
  const { capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'First distinct question about alpha\nSecond distinct question about beta\n',
    {},
    { fakeAIResponse: true, captureAIRequests: true }
  );

  assert.equal(capturedAIRequests.length, 2);
  const first = JSON.parse(capturedAIRequests[0]).contents[0].parts[0].text;
  const second = JSON.parse(capturedAIRequests[1]).contents[0].parts[0].text;
  assert.match(first, /LATEST MESSAGE FROM ZAYN:\nFirst distinct question about alpha/);
  assert.doesNotMatch(first, /Second distinct question about beta/);
  assert.match(second, /LATEST MESSAGE FROM ZAYN:\nSecond distinct question about beta/);
  assert.doesNotMatch(second, /LATEST MESSAGE FROM ZAYN:\nFirst distinct question about alpha/);
});

test('the CLI prompt is printed only after queued commands are drained', () => {
  const source = fs.readFileSync(indexFile, 'utf8');
  const start = source.indexOf('async function processCommandLine');
  const end = source.indexOf('rl.on("SIGINT"', start);
  assert.ok(start >= 0 && end > start, 'processCommandLine should be present');
  const body = source.slice(start, end);
  const queueIndex = body.indexOf('if (queuedCommands.length > 0) {');
  const promptIndex = body.indexOf('rl.prompt()');
  assert.ok(queueIndex >= 0, 'queued draining should be present');
  assert.ok(promptIndex > queueIndex, 'rl.prompt() must not run before the queue is drained');
});

test('cumulative AI time exceeding the old shared budget still succeeds per call', () => {
  const { result } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Draft a proposal for the prospect\n',
    {},
    { fakeAIResponse: true, fakeAIDelayMs: 220, aiTimeoutMs: 300 }
  );

  assert.equal(result.status, 0, 'CLI should exit cleanly');
  assert.match(result.stdout ?? '', /Running commercial evidence and delivery audit/);
  assert.match(result.stdout ?? '', /GEMINI TEST RESPONSE/);
  assert.doesNotMatch(result.stdout ?? '', /timed out/);
});

test('a successful search is followed by a grounded answer without a false timeout', () => {
  const { result } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban bookkeeping practices directory',
        'GROUNDED ANSWER citing https://example.com/test'
      ],
      fakeResearch: true,
      fakeAIDelayMs: 220,
      aiTimeoutMs: 300
    }
  );

  assert.equal(result.status, 0, 'CLI should exit cleanly');
  assert.match(result.stdout ?? '', /Live web research returned/);
  assert.match(result.stdout ?? '', /GROUNDED ANSWER citing https:\/\/example\.com\/test/);
  assert.doesNotMatch(result.stdout ?? '', /timed out/);
});

test('a provider call that exceeds its own timeout is still reported as timed out', () => {
  const { result, capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'What should we do next?\n',
    {},
    { fakeAIResponse: true, fakeAIDelayMs: 600, aiTimeoutMs: 200, captureAIRequests: true }
  );

  assert.match(result.stdout ?? '', /timed out/);
  assert.equal(capturedAIRequests.length, 1, 'no retry: exactly one provider call attempted');
});

test('the commercial audit runs with its own call budget after grounded research', () => {
  const { result } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Draft a proposal for the prospect\n',
    {},
    {
      fakeAIResponses: [
        'RESEARCH_REQUEST: Durban bookkeeping practices directory',
        'GROUNDED ANSWER',
        'AUDITED ANSWER'
      ],
      fakeResearch: true,
      fakeAIDelayMs: 220,
      aiTimeoutMs: 300
    }
  );

  assert.equal(result.status, 0, 'CLI should exit cleanly');
  assert.match(result.stdout ?? '', /Live web research returned/);
  assert.match(result.stdout ?? '', /Running commercial evidence and delivery audit/);
  assert.match(result.stdout ?? '', /AUDITED ANSWER/);
  assert.doesNotMatch(result.stdout ?? '', /timed out/);
});

test('a research flow performs exactly one research tool invocation', () => {
  const { result, researchCalls } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Identify five real Durban bookkeeping practices with source URLs\n',
    {},
    {
      fakeAIResponses: ['RESEARCH_REQUEST: Durban bookkeeping practices directory', 'GROUNDED ANSWER'],
      fakeResearch: true
    }
  );

  assert.equal(result.status, 0, 'CLI should exit cleanly');
  assert.equal(researchCalls, 1, 'the research tool must be invoked exactly once');
});

test('stop during the grounded research stage cancels the answer and skips the audit', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-stop-grounded-'));
  let child;
  let killTimer;
  try {
    fs.copyFileSync(indexFile, path.join(tempDir, 'index.js'));
    fs.copyFileSync(path.join(repoRoot, 'state-store.js'), path.join(tempDir, 'state-store.js'));
    fs.writeFileSync(
      path.join(tempDir, 'business.json'),
      JSON.stringify({ prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] })
    );
    fs.writeFileSync(path.join(tempDir, 'cofounder-settings.json'), JSON.stringify({ speechEnabled: false }));
    fs.writeFileSync(
      path.join(tempDir, 'mcporter.cmd'),
      '@echo off\r\necho Title: Example Result\r\necho URL: https://example.com/test\r\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'fake-fetch.cjs'),
      [
        'let __jarvisCall = 0;',
        'const __jarvisResponses = ' + JSON.stringify(['RESEARCH_REQUEST: Durban directory', 'GROUNDED ANSWER']) + ';',
        'const __jarvisDelay = 1500;',
        'global.fetch = async function(url, options = {}) {',
        '  __jarvisCall++;',
        '  await new Promise((resolve, reject) => {',
        '    const signal = options.signal;',
        '    const t = setTimeout(resolve, __jarvisDelay);',
        '    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason || new Error("aborted")); }, { once: true });',
        '  });',
        '  const text = __jarvisResponses[Math.min(__jarvisCall - 1, __jarvisResponses.length - 1)];',
        '  if (String(url).includes("/api/chat")) return { ok: true, status: 200, json: async () => ({ message: { content: text } }) };',
        '  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };',
        '};',
        ''
      ].join('\n')
    );

    child = spawn(process.execPath, ['index.js'], {
      cwd: tempDir,
      env: {
        ...process.env,
        GEMINI_API_KEY: 'test-key',
        COFOUNDER_PROVIDER: 'gemini',
        PATH: tempDir + ';' + (process.env.PATH || ''),
        COFOUNDER_AI_TIMEOUT_MS: '10000',
        NODE_OPTIONS: (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '') +
          '--require=' + path.join(tempDir, 'fake-fetch.cjs').replace(/\\/g, '/')
      }
    });

    let stdout = '';
    let stopSent = false;
    const finished = new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (!stopSent && /Live web research returned/.test(stdout)) {
          stopSent = true;
          child.stdin.write('stop\n');
          child.stdin.end();
        }
      });
      child.on('close', resolve);
    });
    killTimer = setTimeout(() => { try { child.kill(); } catch (_) {} }, 15000);

    child.stdin.write('Draft a proposal for the prospect\n');
    await finished;

    assert.match(stdout, /Live web research returned/, 'research should have completed');
    assert.match(stdout, /Request cancelled by Zayn/, 'the grounded stage should be cancelled');
    assert.doesNotMatch(stdout, /GROUNDED ANSWER/, 'the grounded answer must not be delivered');
    assert.doesNotMatch(stdout, /Running commercial evidence and delivery audit/, 'the audit must not run after cancellation');
  } finally {
    if (killTimer) clearTimeout(killTimer);
    if (child && !child.killed) {
      try { child.kill(); } catch (_) {}
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


test('numerical evidence discipline safeguard immediately follows the kill-criterion instruction', () => {
  const { result, capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Give me one practical recommendation for testing demand and state what evidence would justify proceeding or stopping.\n',
    {},
    { fakeAIResponse: true, captureAIRequests: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  const requests = capturedAIRequests ?? [];
  assert.equal(requests.length, 1, 'a plain prompt should produce exactly one AI request');
  const prompt = JSON.parse(requests[0]).contents[0].parts[0].text;

  assert.match(prompt, /NUMERICAL EVIDENCE DISCIPLINE:/);
  assert.match(prompt, /Use only figures supplied in this conversation and valid calculations from them/);
  assert.match(prompt, /budget amounts, budget percentages, spending limits/);
  assert.match(prompt, /numerical thresholds or any other unsupported quantitative recommendation/);
  assert.match(prompt, /Do not introduce illustrative numerical placeholders, even when labelled illustrative/);
  assert.match(prompt, /offer estimates only when the user explicitly authorises them/);
  assert.match(prompt, /An available budget is not permission to spend it/);
  assert.match(prompt, /cannot establish a numerical threshold or budget allocation/);
  assert.match(prompt, /offer a qualitative alternative instead/);
  assert.match(prompt, /a clear kill criterion, and the cheapest next validation step/);

  const lines = prompt.split('\n');
  const killIndex = lines.findIndex(line => /a clear kill criterion, and the cheapest next validation step/.test(line));
  const disciplineIndex = lines.findIndex(line => /NUMERICAL EVIDENCE DISCIPLINE:/.test(line));
  assert.ok(killIndex >= 0, 'the kill-criterion instruction must be present');
  assert.equal(disciplineIndex, killIndex + 1, 'the safeguard must immediately follow the kill-criterion instruction');
});

test('numerical evidence discipline safeguard reaches the commercial-deliverable audit prompt', () => {
  const { result, capturedAIRequest, capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Produce a complete commercial decision brief for a pilot offer with pricing and delivery scope.\n',
    {},
    { fakeAIResponse: true, captureAIRequest: true, captureAIRequests: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /Running commercial evidence and delivery audit/);

  const requests = capturedAIRequests ?? [];
  assert.equal(requests.length, 2, 'a commercial deliverable should produce a draft call plus one audit call');

  const draftPrompt = JSON.parse(requests[0]).contents[0].parts[0].text;
  const auditPrompt = JSON.parse(requests[1]).contents[0].parts[0].text;
  const capturedAuditPrompt = JSON.parse(capturedAIRequest).contents[0].parts[0].text;

  assert.equal(auditPrompt, capturedAuditPrompt, 'captureAIRequest should hold the final audit request');
  assert.match(auditPrompt, /independent commercial evidence and delivery reviewer/);
  assert.match(draftPrompt, /NUMERICAL EVIDENCE DISCIPLINE:/, 'the draft prompt must carry the safeguard');
  assert.match(auditPrompt, /NUMERICAL EVIDENCE DISCIPLINE:/, 'the audit prompt must reuse the prepared context carrying the safeguard');
});

// ---------------------------------------------------------------------------
// EVIDENCE-BOUNDED COMMERCIAL FIGURES (deterministic commercial workflow only)
//
// These tests cover the deterministic workflow. The free-form AI path is NOT
// mechanically validated; its safeguard remains prompt-only (Fix 1 and Fix 2),
// as the final test in this block documents.
// ---------------------------------------------------------------------------

test('commercial figures derives a contribution only from a recorded price and cost', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      price: 'R15000',
      cost: 'R9000'
    }),
    'commercial figures\n'
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  assert.match(result.stdout ?? '', /JARVIS COMMERCIAL FIGURES/);
  assert.match(result.stdout ?? '', /Contribution: 6000/);
  assert.match(result.stdout ?? '', /contribution = price - cost = 15000 - 9000 = 6000/);
});

test('commercial figures refuses to fabricate a contribution when price or cost is missing', () => {
  const priceOnly = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      price: 'R15000'
    }),
    'commercial figures\n'
  );

  assert.equal(priceOnly.result.status, 0);
  assert.match(priceOnly.result.stdout ?? '', /Contribution: NOT CALCULATED/);
  assert.match(priceOnly.result.stdout ?? '', /Missing recorded evidence: cost/);
  assert.doesNotMatch(priceOnly.result.stdout ?? '', /contribution = price - cost/);

  const neither = runIsolatedJarvis(
    prospectFixture({ problem: 'Manual customer follow-up is consuming staff time' }),
    'commercial figures\n'
  );

  assert.equal(neither.result.status, 0);
  assert.match(neither.result.stdout ?? '', /Contribution: NOT CALCULATED/);
  assert.match(neither.result.stdout ?? '', /Missing recorded evidence: price, cost/);
});

test('commercial figures withholds an unsupported threshold or sample size with no invented figure', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({ problem: 'Manual customer follow-up is consuming staff time' }),
    'commercial figures sample size\ncommercial figures kill threshold\ncommercial figures budget percentage\n'
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  const stdout = result.stdout ?? '';

  assert.match(stdout, /No sample size can be stated from the recorded evidence\./);
  assert.match(stdout, /No kill threshold can be stated from the recorded evidence\./);
  assert.match(stdout, /No budget percentage can be stated from the recorded evidence\./);

  const statementLines = stdout
    .split('\n')
    .filter(line => /can be stated from the recorded evidence/.test(line));

  assert.equal(statementLines.length, 3, 'each request must produce exactly one fixed statement');
  for (const line of statementLines) {
    assert.doesNotMatch(line, /\d/, 'a withheld figure statement must contain no number: ' + line);
  }
});

test('an unqualified prospect still blocks the commercial recommendation and its figures', () => {
  const { result, business } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend 10 hours per week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager',
      price: 'R15000',
      cost: 'R9000'
    }),
    'cycle\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Qualification: READY FOR CONFIRMATION/);
  assert.match(result.stdout ?? '', /No commercial recommendation was made/);
  assert.doesNotMatch(result.stdout ?? '', /contribution = price - cost/);
  assert.notEqual(business.prospects[0].qualification?.status, 'QUALIFIED');
});

test('a derived contribution does not bypass the approval gate', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    impact: 'Staff spend 10 hours per week chasing responses',
    currentSolution: 'Staff use spreadsheets and manual messages',
    desiredOutcome: 'Automate routine follow-up and tracking',
    decisionMaker: 'Operations manager',
    price: 'R15000',
    cost: 'R9000'
  });
  fixture.prospects[0].qualification = {
    status: 'QUALIFIED',
    confirmedAt: '2026-10-11T00:00:00.000Z',
    confirmationSource: 'ZAYN_CONFIRMED_BUYER_EVIDENCE'
  };

  const { result } = runIsolatedJarvis(fixture, 'cycle\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /COMMERCIAL RECOMMENDATION/);
  assert.match(result.stdout ?? '', /contribution = price - cost = 15000 - 9000 = 6000/);
  assert.match(result.stdout ?? '', /STATUS: READY FOR ZAYN APPROVAL/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('the free-form AI path keeps Fix 1 and Fix 2 prompts and is not mechanically validated', () => {
  const unsupportedReply = 'Contact 20-30 prospective buyers before deciding whether to continue.';
  const { result, capturedAIRequests } = runIsolatedJarvis(
    { prospects: [], opportunities: [], offers: [], followUps: [], revenue: [] },
    'Give me one practical recommendation for testing demand and state what evidence would justify proceeding or stopping.\n',
    {},
    { fakeAIResponses: [unsupportedReply], captureAIRequests: true }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);

  const requests = capturedAIRequests ?? [];
  assert.equal(requests.length, 1, 'a plain prompt should produce exactly one AI request');
  const prompt = JSON.parse(requests[0]).contents[0].parts[0].text;

  // Fix 1 and Fix 2 prompt instructions remain on the free-form path.
  assert.match(prompt, /NUMERICAL EVIDENCE DISCIPLINE:/);
  assert.match(prompt, /An available budget is not permission to spend it/);
  assert.match(prompt, /Do not introduce illustrative numerical placeholders, even when labelled illustrative/);

  // Documented limitation: the deterministic figure guard does NOT inspect or
  // rewrite free-form AI answers, so an unsupported figure is returned verbatim.
  assert.match(result.stdout ?? '', /Contact 20-30 prospective buyers before deciding whether to continue\./);
});

// ---------------------------------------------------------------------------
// AUDIT CORRECTIONS — evidence-bounded commercial figures
// Each test below pins a defect that was reproduced against the previous
// implementation: ambiguous amount parsing, currency compatibility, misleading
// withholding statements, and stale prospect selection. Fix 1 and Fix 2 are
// covered by the two tests above and are unchanged.
// ---------------------------------------------------------------------------

test('commercial figures accepts unambiguous grouped and coded monetary formats', () => {
  const grouped = runIsolatedJarvis(
    prospectFixture({ problem: 'p', price: 'R1,500.50', cost: 'R1,500' }),
    'commercial figures\n'
  );
  assert.equal(grouped.result.status, 0, 'stdout: ' + grouped.result.stdout + '\nstderr: ' + grouped.result.stderr);
  assert.match(grouped.result.stdout ?? '', /Contribution: 0\.5 ZAR/);
  assert.match(grouped.result.stdout ?? '', /contribution = price - cost = 1500\.5 - 1500 = 0\.5 ZAR/);

  const coded = runIsolatedJarvis(
    prospectFixture({ problem: 'p', price: 'ZAR 15000', cost: 'R 9000' }),
    'commercial figures\n'
  );
  assert.equal(coded.result.status, 0);
  assert.match(coded.result.stdout ?? '', /Contribution: 6000 ZAR/);
});

test('commercial figures rejects ambiguous, malformed or negative amounts instead of guessing', () => {
  const cases = [
    ['R150 or R200', 'two amounts'],
    ['R150-R200', 'a range'],
    ['R150 per hour', 'a rate'],
    ['R1,50', 'malformed digit grouping'],
    ['-R150', 'a negative value'],
    ['15000 9000', 'two bare numbers'],
    ['R15000.50.10', 'a malformed decimal']
  ];

  for (const [value, label] of cases) {
    const { result } = runIsolatedJarvis(
      prospectFixture({ problem: 'p', price: value, cost: 'R50' }),
      'commercial figures\n'
    );
    const stdout = result.stdout ?? '';
    assert.equal(result.status, 0, label);
    assert.match(stdout, /Contribution: NOT CALCULATED/, label + ' [' + value + ']');
    assert.match(stdout, /is not a single unambiguous non-negative amount/, label + ' [' + value + ']');
    assert.doesNotMatch(stdout, /contribution = price - cost/, label + ' [' + value + ']');
  }
});

test('commercial figures refuses a contribution across mismatched or unrecorded currencies', () => {
  const mismatch = runIsolatedJarvis(
    prospectFixture({ problem: 'p', price: 'R15000', cost: '$9000' }),
    'commercial figures\n'
  );
  assert.equal(mismatch.result.status, 0);
  assert.match(mismatch.result.stdout ?? '', /Contribution: NOT CALCULATED/);
  assert.match(mismatch.result.stdout ?? '', /recorded price is in ZAR and the recorded cost is in USD/);
  assert.doesNotMatch(mismatch.result.stdout ?? '', /contribution = price - cost/);

  const unrecorded = runIsolatedJarvis(
    prospectFixture({ problem: 'p', price: 15000, cost: 9000 }),
    'commercial figures\n'
  );
  assert.equal(unrecorded.result.status, 0);
  assert.match(unrecorded.result.stdout ?? '', /Contribution: NOT CALCULATED/);
  assert.match(unrecorded.result.stdout ?? '', /currency of the recorded price and cost is not recorded/);
  assert.doesNotMatch(unrecorded.result.stdout ?? '', /contribution = price - cost/);

  const halfRecorded = runIsolatedJarvis(
    prospectFixture({ problem: 'p', price: 'R15000', cost: '9000' }),
    'commercial figures\n'
  );
  assert.equal(halfRecorded.result.status, 0);
  assert.match(halfRecorded.result.stdout ?? '', /currency of the recorded price and cost is not recorded/);
  assert.doesNotMatch(halfRecorded.result.stdout ?? '', /contribution = price - cost/);
});

test('commercial figures preserves and labels a legitimate negative contribution', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({ problem: 'p', price: 'R100', cost: 'R250' }),
    'commercial figures\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Contribution: -150 ZAR/);
  assert.match(result.stdout ?? '', /contribution = price - cost = 100 - 250 = -150 ZAR/);
  assert.match(result.stdout ?? '', /this contribution is negative/);
});

test('commercial figures reports a recorded timeline as a fact instead of claiming it is missing', () => {
  const recorded = runIsolatedJarvis(
    prospectFixture({ problem: 'p', timeline: 'Within 30 days' }),
    'commercial figures timeline\n'
  );
  assert.equal(recorded.result.status, 0);
  const recordedOut = recorded.result.stdout ?? '';
  assert.match(
    recordedOut,
    /A recorded timeline exists \(Within 30 days\), but it is a recorded fact, not a supported recommendation\./
  );
  assert.doesNotMatch(recordedOut, /No timeline figure can be stated from the recorded evidence/);

  const absent = runIsolatedJarvis(
    prospectFixture({ problem: 'p' }),
    'commercial figures timeline\n'
  );
  assert.equal(absent.result.status, 0);
  const absentOut = absent.result.stdout ?? '';
  assert.match(absentOut, /No timeline figure can be stated from the recorded evidence\./);
  assert.doesNotMatch(absentOut, /A recorded timeline exists/);
});

test('commercial figures fails closed on missing, ambiguous or stale prospect selection', () => {
  const openRobert = { name: 'Robert', status: 'NEW', discovery: { problem: 'p', price: 'R15000', cost: 'R9000' } };
  const openAlice = { name: 'Alice', status: 'NEW', discovery: { problem: 'q', price: 'R100', cost: 'R40' } };
  const closedGhost = { name: 'Ghost', status: 'CLOSED', discovery: { problem: 'z', price: 'R999999', cost: 'R1' } };
  const blank = { opportunities: [], offers: [], followUps: [], revenue: [] };

  const none = runIsolatedJarvis({ prospects: [], ...blank }, 'commercial figures\n');
  assert.equal(none.result.status, 0);
  assert.match(none.result.stdout ?? '', /No open prospect is recorded\./);
  assert.doesNotMatch(none.result.stdout ?? '', /Contribution: \d/);

  const unselected = runIsolatedJarvis({ prospects: [openRobert, openAlice], ...blank }, 'commercial figures\n');
  assert.equal(unselected.result.status, 0);
  assert.match(unselected.result.stdout ?? '', /More than one open prospect is recorded and none is selected\./);
  assert.doesNotMatch(unselected.result.stdout ?? '', /contribution = price - cost/);

  const stale = runIsolatedJarvis(
    { prospects: [closedGhost, openRobert], selectedProspectName: 'Ghost', ...blank },
    'commercial figures\n'
  );
  assert.equal(stale.result.status, 0);
  assert.match(stale.result.stdout ?? '', /saved prospect selection does not match an open prospect/);
  assert.doesNotMatch(stale.result.stdout ?? '', /contribution = price - cost/);
  assert.doesNotMatch(stale.result.stdout ?? '', /Contribution: \d/);

  const duplicate = runIsolatedJarvis(
    { prospects: [openRobert, { name: 'Robert', status: 'NEW', discovery: openAlice.discovery }], selectedProspectName: 'Robert', ...blank },
    'commercial figures\n'
  );
  assert.equal(duplicate.result.status, 0);
  assert.match(duplicate.result.stdout ?? '', /matches multiple prospect records \(identity-collision\)/);
  assert.doesNotMatch(duplicate.result.stdout ?? '', /contribution = price - cost/);

  const selected = runIsolatedJarvis(
    { prospects: [openRobert, openAlice], selectedProspectName: 'Alice', ...blank },
    'commercial figures\n'
  );
  assert.equal(selected.result.status, 0);
  assert.match(selected.result.stdout ?? '', /Prospect: Alice/);
  assert.match(selected.result.stdout ?? '', /Contribution: 60 ZAR/);
  assert.doesNotMatch(selected.result.stdout ?? '', /Contribution: 6000/);
});

test('commercial figures does not satisfy qualification or bypass founder approval', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend 10 hours per week chasing responses',
      currentSolution: 'Staff use spreadsheets and manual messages',
      desiredOutcome: 'Automate routine follow-up and tracking',
      decisionMaker: 'Operations manager',
      price: 'R15000',
      cost: 'R9000'
    }),
    'commercial figures\ncycle\n'
  );

  const stdout = result.stdout ?? '';
  assert.equal(result.status, 0);
  assert.match(stdout, /Qualification: NOT CHECKED/);
  assert.match(stdout, /This is an evidence calculation only\. It is not a commercial recommendation and does not replace qualification or Zayn's approval\./);
  assert.match(stdout, /External action: BLOCKED/);
  assert.match(stdout, /No commercial recommendation was made/);

  // Only the standalone evidence calculation may state a contribution; the
  // blocked run-cycle path must not produce one.
  const derivations = stdout.split('\n').filter(line => /contribution = price - cost/.test(line));
  assert.equal(derivations.length, 1, 'the blocked cycle must not emit a contribution');
  const cycleSection = stdout.slice(stdout.indexOf('COFOUNDER BUSINESS CYCLE'));
  assert.doesNotMatch(cycleSection, /contribution = price - cost/);
});

test('commercial figures leaves protected state unchanged and triggers no external work', () => {
  const fixture = prospectFixture({
    problem: 'Manual customer follow-up is consuming staff time',
    price: 'R15000',
    cost: 'R9000'
  });

  const { result, protectedFiles, researchCalls } = runIsolatedJarvis(fixture, 'commercial figures\n');

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Contribution: 6000 ZAR/);
  assert.equal(
    protectedFiles['business.json'],
    JSON.stringify(fixture, null, 2),
    'business.json must be byte-identical after a read-only figure request'
  );
  assert.equal(
    protectedFiles['cofounder-state.json'],
    JSON.stringify({ goals: [], decisions: [], approvals: [], executions: [], lessons: [] }, null, 2),
    'cofounder-state.json must be byte-identical after a read-only figure request'
  );
  assert.equal(researchCalls, 0, 'no research tool must be invoked');
  assert.doesNotMatch(result.stdout ?? '', /COFOUNDER > Thinking/);
  assert.doesNotMatch(result.stdout ?? '', /AI request failed/);
});

// DECISION INTEGRITY: unambiguous linkage, tamper-resistant execution, duplicate prevention.

test('cofounder preserves a quoted action text byte-for-byte and links from outside the quotes', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'record decision SIMULATED beta decision\n' +
      'approve recommendation "SIMULATED keep the tail for decision 2" for decision 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS RECOMMENDATION APPROVED/);
  assert.equal(state.approvals[0].action, 'SIMULATED keep the tail for decision 2');
  assert.equal(state.approvals[0].decisionNumber, 1);
  assert.equal(state.approvals[0].decisionId, 'decision-1');
});

test('cofounder treats the historical trailing marker as linkage without a warning', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'record decision SIMULATED beta decision\n' +
      'approve recommendation SIMULATED keep the tail for decision 2\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.approvals[0].action, 'SIMULATED keep the tail');
  assert.equal(state.approvals[0].decisionNumber, 2);
  assert.equal(state.approvals[0].decisionId, 'decision-2');
  assert.doesNotMatch(result.stdout ?? '', /was read as decision linkage, not action text/);
  assert.doesNotMatch(result.stdout ?? '', /wrap the action text in double quotes/);
});

test('cofounder blocks a quoted approval that states no decision while a decision is active', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "SIMULATED quoted no linkage"\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.match(result.stdout ?? '', /Link the approval to that decision/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder blocks quoted action text followed by anything other than decision linkage', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "SIMULATED quoted malformed" trailing garbage\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.match(result.stdout ?? '', /Quoted action text may only be followed by: for decision <number>/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder blocks an unbalanced quoted approval', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "SIMULATED unbalanced quote\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.match(result.stdout ?? '', /Unbalanced quotes/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder rejects a zero decision number', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED zero probe for decision 0\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Invalid decision number\./);
  assert.equal(state.approvals.length, 0);
});

test('cofounder rejects an out-of-range decision number', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED range probe for decision 4\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Invalid decision number\./);
  assert.equal(state.approvals.length, 0);
});

test('cofounder accepts a mixed-case decision marker', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED case probe FOR DECISION 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.approvals[0].action, 'SIMULATED case probe');
  assert.equal(state.approvals[0].decisionId, 'decision-1');
});

test('cofounder does not treat a double-spaced marker as decision linkage', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED spacing probe for  decision 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder closes only the approvals linked to the closed decision', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'record decision SIMULATED beta decision\n' +
      'approve recommendation SIMULATED alpha action for decision 1\n' +
      'approve recommendation SIMULATED beta action for decision 2\n' +
      'close decision 1\n' +
      'execute approved 1\n' +
      'execute approved 2\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.decisions[0].status, 'CLOSED');
  assert.equal(state.decisions[1].status, 'ACTIVE');
  assert.equal(state.approvals[0].decisionId, 'decision-1');
  assert.equal(state.approvals[1].decisionId, 'decision-2');
  assert.equal(state.approvals[0].status, 'STALE');
  assert.equal(state.approvals[1].status, 'EXECUTED');
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].action, 'SIMULATED beta action');
  assert.match(result.stdout ?? '', /Linked active approvals marked STALE/);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
});

test('cofounder execution follows the stored decision, not free text in the action', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'record decision SIMULATED beta decision\n' +
      'record decision SIMULATED gamma decision\n' +
      'approve recommendation SIMULATED review decision 3 item for decision 2\n' +
      'close decision 3\n' +
      'execute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.approvals[0].action, 'SIMULATED review decision 3 item');
  assert.equal(state.approvals[0].decisionNumber, 2);
  assert.equal(state.approvals[0].decisionId, 'decision-2');
  assert.equal(state.approvals[0].status, 'EXECUTED');
  assert.equal(state.executions.length, 1);
  assert.doesNotMatch(result.stdout ?? '', /marked STALE/);
});

test('cofounder queue approval preserves follow-up text and uses the explicit decision', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'record decision SIMULATED beta decision\n' +
      'add follow-up SIMULATED reembed tail for decision 9\n' +
      'approve action 1 for decision 2\n'
  );

  assert.equal(result.status, 0);
  assert.equal(
    state.approvals[0].action,
    'Review and work the open follow-up(s): SIMULATED reembed tail for decision 9'
  );
  assert.equal(state.approvals[0].decisionNumber, 2);
  assert.equal(state.approvals[0].decisionId, 'decision-2');
  assert.doesNotMatch(result.stdout ?? '', /was read as decision linkage, not action text/);
});

test('cofounder blocks a repeat execution of an already executed approval', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'execute approved 1\n',
    {
      decisions: [
        { id: 'decision-1', decision: 'SIMULATED alpha decision', reason: 'Recorded by Zayn', evidence: [], date: '2026-01-01T00:00:00.000Z', status: 'ACTIVE' }
      ],
      approvals: [
        { approvalId: 'approval-simulated', action: 'SIMULATED already executed', approvedBy: 'Zayn', date: '2026-01-01T00:00:00.000Z', status: 'EXECUTED', decisionNumber: 1, decisionId: 'decision-1' }
      ],
      executions: [
        { approvalId: 'approval-simulated', action: 'SIMULATED already executed', approvedBy: 'Zayn', approvedDate: '2026-01-01T00:00:00.000Z', executedBy: 'JARVIS', executedDate: '2026-01-01T00:00:00.000Z', status: 'INTERNAL_ACTION_RECORDED', verificationStatus: 'PENDING' }
      ]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.approvals[0].status, 'EXECUTED');
  assert.equal(state.executions.length, 1);
});

test('cofounder blocks execution of a stale approval whose decision was closed', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'execute approved 1\n',
    {
      decisions: [
        { id: 'decision-1', decision: 'SIMULATED alpha decision', reason: 'Recorded by Zayn', evidence: [], date: '2026-01-01T00:00:00.000Z', status: 'CLOSED' }
      ],
      approvals: [
        { approvalId: 'approval-stale', action: 'SIMULATED stale action', approvedBy: 'Zayn', date: '2026-01-01T00:00:00.000Z', status: 'STALE', decisionNumber: 1, decisionId: 'decision-1' }
      ]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.executions.length, 0);
});

test('cofounder blocks execution when the stored decision index no longer resolves', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'execute approved 1\n',
    {
      decisions: [],
      approvals: [
        { approvalId: 'approval-orphan', action: 'SIMULATED orphan action', approvedBy: 'Zayn', date: '2026-01-01T00:00:00.000Z', status: 'ACTIVE', decisionNumber: 3, decisionId: 'decision-3' }
      ]
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.executions.length, 0);
});

// UNLINKED-APPROVAL SYMMETRY: an approval with no decision link must not bypass the
// decision gate once an ACTIVE decision exists.

test('cofounder blocks execution of an unlinked approval once an active decision exists', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation SIMULATED unlinked probe\n' +
      'record decision SIMULATED alpha decision\n' +
      'execute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.approvals[0].decisionNumber, null);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.match(result.stdout ?? '', /not linked to a decision, and an active decision now exists/);
  assert.equal(state.approvals[0].status, 'ACTIVE');
  assert.equal(state.executions.length, 0);
});

test('cofounder still executes an unlinked approval when no decision exists', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation SIMULATED unlinked probe\n' +
      'execute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.approvals[0].decisionNumber, null);
  assert.match(result.stdout ?? '', /JARVIS EXECUTION RECORDED/);
  assert.equal(state.approvals[0].status, 'EXECUTED');
  assert.equal(state.executions.length, 1);
});

test('cofounder blocks execution of a linked approval whose decision was closed', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED linked probe for decision 1\n' +
      'close decision 1\n' +
      'execute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.decisions[0].status, 'CLOSED');
  assert.equal(state.approvals[0].status, 'STALE');
  assert.equal(state.approvals[0].staleReason, 'Linked decision was closed.');
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.executions.length, 0);
});

test('cofounder does not execute an approval against a different active decision', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'record decision SIMULATED beta decision\n' +
      'approve recommendation SIMULATED second decision action for decision 2\n' +
      'close decision 2\n' +
      'execute approved 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.decisions[0].status, 'ACTIVE');
  assert.equal(state.decisions[1].status, 'CLOSED');
  assert.equal(state.approvals[0].decisionId, 'decision-2');
  assert.match(result.stdout ?? '', /JARVIS EXECUTION BLOCKED/);
  assert.equal(state.executions.length, 0);
});

// QUOTED-APPROVAL EDGE CASES AND LEGACY TRUNCATION NOTICES.

test('cofounder blocks a quoted approval with empty action text', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "" for decision 1\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL/);
  assert.match(result.stdout ?? '', /Use: approve recommendation <action>/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder blocks a quoted approval whose suffix omits the decision number', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "SIMULATED text" for decision\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.match(result.stdout ?? '', /Quoted action text may only be followed by: for decision <number>/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder rejects an out-of-range decision number in the quoted form', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "SIMULATED text" for decision 4\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.match(result.stdout ?? '', /Invalid decision number\./);
  assert.equal(state.approvals.length, 0);
});

test('cofounder prints no truncation warning for the documented linkage form', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED documented form for decision 1\n'
  );

  assert.equal(result.status, 0);
  assert.equal(state.approvals[0].action, 'SIMULATED documented form');
  assert.equal(state.approvals[0].decisionId, 'decision-1');
  assert.doesNotMatch(result.stdout ?? '', /was read as decision linkage, not action text/);
  assert.doesNotMatch(result.stdout ?? '', /wrap the action text in double quotes/);
});

test('cofounder cannot distinguish literal trailing text from linkage in unquoted input', () => {
  const unquoted = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation SIMULATED literal for decision 1\n'
  );

  assert.equal(unquoted.result.status, 0);
  assert.equal(unquoted.state.approvals[0].action, 'SIMULATED literal');
  assert.equal(unquoted.state.approvals[0].decisionId, 'decision-1');
  assert.doesNotMatch(unquoted.result.stdout ?? '', /was read as decision linkage, not action text/);

  const quoted = runIsolatedJarvis(
    prospectFixture(),
    'record decision SIMULATED alpha decision\n' +
      'approve recommendation "SIMULATED literal for decision 1" for decision 1\n'
  );

  assert.equal(quoted.result.status, 0);
  assert.equal(quoted.state.approvals[0].action, 'SIMULATED literal for decision 1');
  assert.equal(quoted.state.approvals[0].decisionId, 'decision-1');
});

// --------------------------------------------------
// openWebsite launch-failure handling
// --------------------------------------------------
// The browser command is `start "" "<url>"`. These tests install a child-process double
// BEFORE the application starts (NODE_OPTIONS=--require), so no shell and no browser can
// be launched. The double is faithful to the two contracts Node's exec() can have:
//   * if production exec() passed a callback, the double invokes it asynchronously with a
//     synthetic Error, using the same ordering Node uses for a launch failure;
//   * if production passed NO callback, the double emits 'error' on the returned fake
//     ChildProcess, which is exactly how Node surfaces a failed launch - with no listener
//     attached that event terminates the process with an unhandled 'error'.
// Fail-closed guards:
//   * the double writes a ready-handshake file when it loads, and this helper throws if the
//     handshake is missing, so a preload that failed to install can never look like a pass;
//   * a probe subprocess confirms the patch is live before the application is started;
//   * ComSpec is pointed at a non-existent path, so even if interception ever leaked, exec()
//     could not find a shell and no real `start` command or browser could run.
function stripOpenWebsiteErrorCallback(source) {
  const marker = 'exec(`start "" "${url}"`, error => {';
  const first = source.indexOf(marker);
  if (first === -1) {
    throw new Error('openWebsite error-callback marker not found in index.js');
  }
  if (source.indexOf(marker, first + marker.length) !== -1) {
    throw new Error('openWebsite error-callback marker is not unique in index.js');
  }
  const closeToken = '\n    });';
  const closeAt = source.indexOf(closeToken, first);
  if (closeAt === -1) {
    throw new Error('openWebsite error-callback terminator not found in index.js');
  }
  return source.slice(0, first) + 'exec(`start "" "${url}"`);' + source.slice(closeAt + closeToken.length);
}

function runOpenWebsiteScenario(input, outcome, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-openwebsite-'));
  try {
    const productionSource = fs.readFileSync(indexFile, 'utf8');
    fs.writeFileSync(
      path.join(tempDir, 'index.js'),
      options.stripOpenWebsiteErrorCallback === true
        ? stripOpenWebsiteErrorCallback(productionSource)
        : productionSource
    );
    fs.copyFileSync(path.join(repoRoot, 'state-store.js'), path.join(tempDir, 'state-store.js'));
    fs.writeFileSync(
      path.join(tempDir, 'cofounder-settings.json'),
      JSON.stringify({ speechEnabled: false }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempDir, 'double-exec.cjs'),
      [
        'const fs = require("fs");',
        'const cp = require("child_process");',
        'const LOG = process.env.DOUBLE_LOG;',
        'const READY = process.env.DOUBLE_READY;',
        'const OUTCOME = process.env.DOUBLE_EXEC_OUTCOME || "success";',
        'function log(entry) { if (!LOG) return; try { fs.appendFileSync(LOG, JSON.stringify(Object.assign({ at: new Date().toISOString(), forwardedToRealService: false }, entry)) + "\\n"); } catch (_) {} }',
        'try { fs.writeFileSync(READY, "installed\\n"); } catch (_) {}',
        'log({ boundary: "double.load", category: "interception", outcome: "INSTALLED" });',
        'function classify(command) {',
        '  const c = String(command || "");',
        '  if (/mcporter/i.test(c)) return "research-child-process";',
        '  if (/taskkill/i.test(c)) return "speech-cleanup-child-process";',
        '  if (/^\\s*start\\s+""/i.test(c) || /https?:\\/\\//i.test(c)) return "website-open-child-process";',
        '  return "child-process-other";',
        '}',
        'function fakeChild() {',
        '  const { EventEmitter } = require("events");',
        '  const child = new EventEmitter();',
        '  child.pid = 900000;',
        '  child.stdout = new EventEmitter();',
        '  child.stderr = new EventEmitter();',
        '  child.kill = function () { log({ boundary: "child_process.ChildProcess.kill", category: "child-process-kill", outcome: "INTERCEPTED_NO_KILL" }); return true; };',
        '  return child;',
        '}',
        'cp.exec = function (command, options, callback) {',
        '  const cb = typeof options === "function" ? options : callback;',
        '  const callbackProvided = typeof cb === "function";',
        '  const category = classify(command);',
        '  log({ boundary: "child_process.exec", category: category, outcome: "INTERCEPTED_NOT_EXECUTED", callbackProvided: callbackProvided, command: String(command).slice(0, 200) });',
        '  const child = fakeChild();',
        '  if (OUTCOME === "hang") return child;',
        '  if (OUTCOME === "fail" || OUTCOME === "launch-error") {',
        '    setImmediate(function () {',
        '      const error = new Error("simulated launch failure: start");',
        '      if (callbackProvided) {',
        '        log({ boundary: "child_process.exec.delivery", launchCategory: category, outcome: "CALLBACK_ERROR_DELIVERED", callbackProvided: true });',
        '        cb(error);',
        '      } else {',
        '        log({ boundary: "child_process.exec.delivery", launchCategory: category, outcome: "ERROR_EVENT_EMITTED", callbackProvided: false });',
        '        child.emit("error", error);',
        '      }',
        '    });',
        '    return child;',
        '  }',
        '  setImmediate(function () { if (callbackProvided) cb(null, "", ""); else child.emit("close", 0); });',
        '  return child;',
        '};',
        'cp.execSync = function (file) { log({ boundary: "child_process.execSync", category: classify(file), outcome: "INTERCEPTED_NOT_EXECUTED" }); return ""; };',
        'cp.execFileSync = function (file) { log({ boundary: "child_process.execFileSync", category: classify(file), outcome: "INTERCEPTED_NOT_EXECUTED" }); return ""; };',
        'cp.execFile = function (file, args, options, callback) { const cb = typeof options === "function" ? options : (typeof args === "function" ? args : callback); log({ boundary: "child_process.execFile", category: classify(file), outcome: "INTERCEPTED_NOT_EXECUTED" }); if (typeof cb === "function") setImmediate(function () { cb(null, "", ""); }); return fakeChild(); };',
        'cp.spawn = function (file) { log({ boundary: "child_process.spawn", category: /powershell/i.test(String(file)) ? "speech-process-spawn" : classify(file), outcome: "INTERCEPTED_NOT_SPAWNED" }); return fakeChild(); };',
        'cp.spawnSync = function (file) { log({ boundary: "child_process.spawnSync", category: classify(file), outcome: "INTERCEPTED_NOT_SPAWNED" }); return { status: 0, stdout: "", stderr: "", pid: 900000, output: [null, "", ""], signal: null }; };',
        ''
      ].join('\n')
    );

    const logFile = path.join(tempDir, 'double-log.jsonl');
    const readyFile = path.join(tempDir, 'double-ready.txt');
    const probeReadyFile = path.join(tempDir, 'double-ready-probe.txt');
    const probeLogFile = path.join(tempDir, 'double-probe-log.jsonl');
    const preload = path.join(tempDir, 'double-exec.cjs').replace(/\\/g, '/');
    const doubleEnv = {
      ...process.env,
      GEMINI_API_KEY: '',
      // Fail-closed: if the double ever failed to install, exec() could not locate a shell,
      // so no real `start` command and no browser could be launched.
      ComSpec: path.join(tempDir, 'no-shell-here.cmd'),
      DOUBLE_LOG: logFile,
      DOUBLE_EXEC_OUTCOME: outcome,
      DOUBLE_READY: readyFile,
      NODE_OPTIONS: (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '') + '--require=' + preload
    };

    // Pre-flight: prove the interception is installed before the application is started.
    // A missing preload must fail loudly here; it must never fall back to a real `start`.
    const probe = spawnSync(
      process.execPath,
      ['-e', "process.exit(require('child_process').exec.toString().includes('INTERCEPTED_NOT_EXECUTED') ? 0 : 3)"],
      {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 10000,
        env: { ...doubleEnv, DOUBLE_LOG: probeLogFile, DOUBLE_READY: probeReadyFile }
      }
    );
    if (probe.status !== 0) {
      throw new Error(
        `child-process interception could not be confirmed before the application started (probe exit ${probe.status}): ${probe.stderr ?? ''}`
      );
    }
    if (!fs.existsSync(probeReadyFile)) {
      throw new Error('child-process double did not signal readiness during the pre-start probe');
    }

    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: tempDir,
      input,
      encoding: 'utf8',
      timeout: 10000,
      env: doubleEnv
    });

    if (!fs.existsSync(readyFile)) {
      throw new Error('child-process interception was not installed before the application started');
    }

    const entries = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      : [];
    const protectedNames = ['business.json', 'cofounder-state.json', 'memory.json', 'reminders.json', 'tasks.json', 'cofounder-settings.json'];
    const state = {};
    for (const name of protectedNames) {
      const filePath = path.join(tempDir, name);
      state[name] = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    }
    return {
      result,
      entries,
      execCalls: entries.filter(entry => entry.boundary === 'child_process.exec'),
      browserCalls: entries.filter(entry => entry.category === 'website-open-child-process'),
      deliveries: entries.filter(entry => entry.boundary === 'child_process.exec.delivery'),
      interceptorLoaded: entries.some(entry => entry.boundary === 'double.load'),
      forwarded: entries.filter(entry => entry.forwardedToRealService === true).length,
      state
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('openWebsite launch failure is handled without terminating Cofounder', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'fail');

  assert.equal(run.result.status, 0, 'the CLI must exit cleanly after a failed launch');
  assert.equal(run.result.signal, null);
  assert.doesNotMatch(run.result.stderr ?? '', /Unhandled 'error' event/);
  assert.doesNotMatch(run.result.stderr ?? '', /throw er;/);
  assert.match(run.result.stdout ?? '', /JARVIS > Attempting to open zayzana\./);
  assert.match(run.result.stdout ?? '', /JARVIS > Could not open zayzana\. The browser did not start\./);
});

test('the browser failure response does not claim the browser opened', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'fail');
  const stdout = run.result.stdout ?? '';

  assert.doesNotMatch(stdout, /Opening zayzana/);
  assert.doesNotMatch(stdout, /Opened zayzana/);
  assert.match(stdout, /Attempting to open zayzana\./);
  assert.equal((stdout.match(/Could not open zayzana/g) || []).length, 1);
});

test('a successful simulated launch follows the intended success path', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'success');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.equal(run.result.signal, null);
  assert.match(stdout, /JARVIS > Attempting to open zayzana\./);
  assert.doesNotMatch(stdout, /Could not open zayzana/);
  // The existing command construction is unchanged (hardcoded URL from the allow-list).
  assert.equal(run.browserCalls.length, 1);
  assert.equal(run.browserCalls[0].command, 'start "" "https://syedzayn296-ops.github.io/zayzana-tech/"');
  // Actual browser behaviour remains untested: only the process-launch signal is simulated.
});

test('an unknown name and a metacharacter name never reach the launch boundary', () => {
  const unknown = runOpenWebsiteScenario('open bank\n', 'success');
  assert.equal(unknown.result.status, 0);
  assert.equal(unknown.execCalls.length, 0, 'an unknown name must not execute anything');
  assert.doesNotMatch(unknown.result.stdout ?? '', /Attempting to open/);

  const metacharacters = runOpenWebsiteScenario('open zayzana && calc\n', 'success');
  assert.equal(metacharacters.result.status, 0);
  assert.equal(metacharacters.execCalls.length, 0, 'an inexact match must not execute anything');
  assert.doesNotMatch(metacharacters.result.stdout ?? '', /Attempting to open zayzana/);
});

test('the browser error handler does not conceal unrelated failures or block later commands', () => {
  const run = runOpenWebsiteScenario('open zayzana\nshow tasks\ntell me something\n', 'fail');
  const stdout = run.result.stdout ?? '';

  assert.equal(run.result.status, 0);
  assert.equal((stdout.match(/Could not open zayzana/g) || []).length, 1, 'exactly one failure response');
  assert.match(stdout, /JARVIS TASKS/, 'later commands must still be handled');
  assert.match(stdout, /GEMINI_API_KEY is not set/, 'unrelated failures must still be reported');
  assert.equal(run.execCalls.length, 1, 'only the website launch may reach exec');
});

// A live child process is never created, so this test cannot prove that a real hooked/hung
// process would not keep the CLI alive. It proves only that the CLI does not block its own
// command flow while waiting for a callback that the double deliberately never delivers
// (the double holds no OS handle and emits no event).
test('a launch callback that never arrives does not block the CLI command flow', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'hang');

  assert.equal(run.result.status, 0);
  assert.equal(run.result.signal, null);
  assert.match(run.result.stdout ?? '', /Attempting to open zayzana\./);
  assert.doesNotMatch(run.result.stdout ?? '', /Could not open zayzana/);
  // The application did supply a callback; the double simply never invokes it.
  assert.equal(run.browserCalls.length, 1);
  assert.equal(run.browserCalls[0].callbackProvided, true);
  assert.equal(run.deliveries.length, 0);
});

// Evidence here is interceptor-based: the double reports what the application asked for.
// The earlier inert detector shim was removed because it could not reliably run (a .cmd
// cannot be executed as a process without a shell, so it could not detect the event it
// claimed to detect). The fail-closed guards in runOpenWebsiteScenario are what prevent a
// real launch: interception is verified before the app starts, the double must handshake,
// and ComSpec is neutralised so a leaked exec() could not find a shell.
test('no real browser or child process is launched (interceptor-based evidence) and no protected file is changed', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'launch-error');

  assert.equal(run.interceptorLoaded, true, 'the double must have installed itself before the app started');
  assert.equal(run.forwarded, 0, 'no attempt may be forwarded to a real service');
  assert.equal(run.browserCalls.length, 1);
  assert.equal(run.browserCalls[0].outcome, 'INTERCEPTED_NOT_EXECUTED');
  assert.equal(run.browserCalls[0].callbackProvided, true);
  // Protected user-data files in the isolated working directory stay absent or empty.
  assert.equal(run.state['business.json'], null);
  assert.equal(run.state['cofounder-state.json'], null);
  assert.equal(run.state['memory.json'], null);
  assert.equal(run.state['tasks.json'], '[]');
  assert.equal(run.state['reminders.json'], '[]');
  assert.equal(run.state['cofounder-settings.json'], JSON.stringify({ speechEnabled: false }, null, 2));
});

test('a failing launch with a callback is handled without an unhandled error event', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'launch-error');
  const stdout = run.result.stdout ?? '';
  const stderr = run.result.stderr ?? '';

  // Production supplied the launch callback ...
  assert.equal(run.browserCalls.length, 1);
  assert.equal(run.browserCalls[0].callbackProvided, true, 'production exec() must receive an error callback');
  // ... the double's synthetic failure actually ran, and it was delivered through that callback ...
  assert.equal(run.deliveries.length, 1, 'the synthetic failure path must have run exactly once');
  assert.equal(run.deliveries[0].outcome, 'CALLBACK_ERROR_DELIVERED');
  assert.equal(run.deliveries[0].callbackProvided, true);
  // ... so the CLI exits normally, reports exactly one bounded failure, and never crashes.
  assert.equal(run.result.status, 0, 'exit 0 when the callback handles the failure');
  assert.equal(run.result.signal, null);
  assert.doesNotMatch(stderr, /Unhandled 'error' event/);
  assert.doesNotMatch(stderr, /throw er;/);
  assert.match(stdout, /JARVIS > Attempting to open zayzana\./);
  assert.equal((stdout.match(/Could not open zayzana/g) || []).length, 1);
  assert.equal(run.forwarded, 0);
});

// Synthetic negative control. The control is a mutated COPY of index.js written inside the
// isolated temp directory; the repository file is never modified. Removing the callback
// leaves Node with no 'error' listener on the child, so the double's 'error' event must
// terminate the subprocess. This is what makes the test above discriminating: it fails if
// the production callback is absent, even though the attempt/failure wording is unchanged.
test('the callback-less control crashes in an isolated subprocess (synthetic negative control)', () => {
  const run = runOpenWebsiteScenario('open zayzana\n', 'launch-error', { stripOpenWebsiteErrorCallback: true });
  const stdout = run.result.stdout ?? '';
  const stderr = run.result.stderr ?? '';

  assert.equal(run.browserCalls.length, 1);
  assert.equal(run.browserCalls[0].callbackProvided, false, 'the control must reach exec() with no callback');
  assert.equal(run.deliveries.length, 1);
  assert.equal(run.deliveries[0].outcome, 'ERROR_EVENT_EMITTED');
  assert.equal(run.deliveries[0].callbackProvided, false);
  assert.equal(run.result.signal, null);
  assert.equal(run.result.status, 1, 'the uncaught error must terminate the isolated control');
  assert.match(stderr, /Unhandled 'error' event/);
  assert.match(stderr, /throw er;/);
  // The mutated copy really ran the openWebsite path (a syntax error would not print this).
  assert.match(stdout, /JARVIS > Attempting to open zayzana\./);
  assert.equal(run.forwarded, 0);
});


// --------------------------------------------------
// state-file read hygiene (O5 / O6)
// --------------------------------------------------
// Read-only commands must not create absent state files, and a command that needs state must
// not leak filesystem paths or raw parser text when the file is missing or malformed. A
// child-process double is installed BEFORE the application starts (NODE_OPTIONS=--require), so
// no speech, research or shell process can run, and ComSpec points at a non-existent path as a
// second fail-closed guard. The double writes a ready-handshake that this helper requires, so a
// preload that failed to install can never look like a pass.
function runStateHygieneScenario(input, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-statehygiene-'));

  try {
    fs.copyFileSync(indexFile, path.join(tempDir, 'index.js'));
    fs.copyFileSync(path.join(repoRoot, 'state-store.js'), path.join(tempDir, 'state-store.js'));
    fs.writeFileSync(
      path.join(tempDir, 'cofounder-settings.json'),
      JSON.stringify({ speechEnabled: false }, null, 2)
    );
    for (const [name, content] of Object.entries(options.files || {})) {
      fs.writeFileSync(path.join(tempDir, name), content);
    }

    fs.writeFileSync(
      path.join(tempDir, 'double-exec.cjs'),
      [
        'const fs = require("fs");',
        'const cp = require("child_process");',
        'const LOG = process.env.DOUBLE_LOG;',
        'const READY = process.env.DOUBLE_READY;',
        'function log(entry) { if (!LOG) return; try { fs.appendFileSync(LOG, JSON.stringify(Object.assign({ at: new Date().toISOString(), forwardedToRealService: false }, entry)) + "\\n"); } catch (_) {} }',
        'try { fs.writeFileSync(READY, "installed\\n"); } catch (_) {}',
        'log({ boundary: "double.load", category: "interception", outcome: "INSTALLED" });',
        'function classify(command) {',
        '  const c = String(command || "");',
        '  if (/mcporter/i.test(c)) return "research-child-process";',
        '  if (/taskkill/i.test(c)) return "speech-cleanup-child-process";',
        '  if (/^\\s*start\\s+""/i.test(c) || /https?:\\/\\//i.test(c)) return "website-open-child-process";',
        '  return "child-process-other";',
        '}',
        'function fakeChild() {',
        '  const { EventEmitter } = require("events");',
        '  const child = new EventEmitter();',
        '  child.pid = 900000;',
        '  child.stdout = new EventEmitter();',
        '  child.stderr = new EventEmitter();',
        '  child.kill = function () { log({ boundary: "child_process.ChildProcess.kill", category: "child-process-kill", outcome: "INTERCEPTED_NO_KILL" }); return true; };',
        '  return child;',
        '}',
        'cp.exec = function (command, options, callback) {',
        '  const cb = typeof options === "function" ? options : callback;',
        '  log({ boundary: "child_process.exec", category: classify(command), outcome: "INTERCEPTED_NOT_EXECUTED", command: String(command).slice(0, 200) });',
        '  const child = fakeChild();',
        '  setImmediate(function () { if (typeof cb === "function") cb(null, "", ""); else child.emit("close", 0); });',
        '  return child;',
        '};',
        'cp.execSync = function (file) { log({ boundary: "child_process.execSync", category: classify(file), outcome: "INTERCEPTED_NOT_EXECUTED" }); return ""; };',
        'cp.execFileSync = function (file) { log({ boundary: "child_process.execFileSync", category: classify(file), outcome: "INTERCEPTED_NOT_EXECUTED" }); return ""; };',
        'cp.execFile = function (file, args, options, callback) { const cb = typeof options === "function" ? options : (typeof args === "function" ? args : callback); log({ boundary: "child_process.execFile", category: classify(file), outcome: "INTERCEPTED_NOT_EXECUTED" }); if (typeof cb === "function") setImmediate(function () { cb(null, "", ""); }); return fakeChild(); };',
        'cp.spawn = function (file) { log({ boundary: "child_process.spawn", category: /powershell/i.test(String(file)) ? "speech-process-spawn" : classify(file), outcome: "INTERCEPTED_NOT_SPAWNED" }); return fakeChild(); };',
        'cp.spawnSync = function (file) { log({ boundary: "child_process.spawnSync", category: classify(file), outcome: "INTERCEPTED_NOT_SPAWNED" }); return { status: 0, stdout: "", stderr: "", pid: 900000, output: [null, "", ""], signal: null }; };',
        ''
      ].join('\n')
    );

    const logFile = path.join(tempDir, 'double-log.jsonl');
    const readyFile = path.join(tempDir, 'double-ready.txt');
    const probeReadyFile = path.join(tempDir, 'double-ready-probe.txt');
    const preload = path.join(tempDir, 'double-exec.cjs').replace(/\\/g, '/');
    const env = {
      ...process.env,
      GEMINI_API_KEY: '',
      // Fail-closed: if the double ever failed to install, exec() could not locate a shell.
      ComSpec: path.join(tempDir, 'no-shell-here.cmd'),
      DOUBLE_LOG: logFile,
      DOUBLE_READY: readyFile,
      NODE_OPTIONS: (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '') + '--require=' + preload
    };

    // Pre-flight: prove the interception is installed before the application is started.
    const probe = spawnSync(
      process.execPath,
      ['-e', "process.exit(require('child_process').exec.toString().includes('INTERCEPTED_NOT_EXECUTED') ? 0 : 3)"],
      { cwd: tempDir, encoding: 'utf8', timeout: 10000, env: { ...env, DOUBLE_LOG: '', DOUBLE_READY: probeReadyFile } }
    );
    if (probe.status !== 0) {
      throw new Error(
        `child-process interception could not be confirmed before the application started (probe exit ${probe.status}): ${probe.stderr ?? ''}`
      );
    }
    if (!fs.existsSync(probeReadyFile)) {
      throw new Error('child-process double did not signal readiness during the pre-start probe');
    }

    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: tempDir,
      input,
      encoding: 'utf8',
      timeout: 10000,
      env
    });

    if (!fs.existsSync(readyFile)) {
      throw new Error('child-process interception was not installed before the application started');
    }

    const entries = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      : [];
    const protectedNames = ['business.json', 'cofounder-state.json', 'memory.json', 'reminders.json', 'tasks.json', 'cofounder-settings.json'];
    const protectedFiles = {};
    for (const name of protectedNames) {
      const filePath = path.join(tempDir, name);
      protectedFiles[name] = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    }
    return {
      result,
      entries,
      childProcessCalls: entries.filter(entry => String(entry.boundary).startsWith('child_process')),
      forwarded: entries.filter(entry => entry.forwardedToRealService === true).length,
      protectedFiles
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const hygieneBusinessSeed = JSON.stringify({
  prospects: [],
  opportunities: [],
  offers: [],
  followUps: [],
  revenue: [],
  marker: 'business-untouched'
}, null, 2);

const hygieneStateSeed = JSON.stringify({
  goals: [],
  decisions: [],
  approvals: [],
  executions: [],
  lessons: [],
  research: [],
  marker: 'state-untouched'
}, null, 2);

test('state-file read hygiene: status does not create absent business.json or cofounder-state.json', () => {
  const run = runStateHygieneScenario('status\n');

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /COFOUNDER FOUNDER DASHBOARD/);
  assert.equal(run.protectedFiles['business.json'], null, 'a read-only status must not create business.json');
  assert.equal(run.protectedFiles['cofounder-state.json'], null, 'a read-only status must not create cofounder-state.json');
  assert.equal(run.childProcessCalls.length, 0, 'no child process may be attempted; entries: ' + JSON.stringify(run.entries));
  assert.equal(run.forwarded, 0);
});

test('state-file read hygiene: world-model does not create absent state files', () => {
  const run = runStateHygieneScenario('world model\n');

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /ZAYZANA WORLD MODEL/);
  assert.equal(run.protectedFiles['business.json'], null, 'world model must not create business.json');
  assert.equal(run.protectedFiles['cofounder-state.json'], null, 'world model must not create cofounder-state.json');
  assert.equal(run.childProcessCalls.length, 0, 'no child process may be attempted');
});

test('state-file read hygiene: a read-only command leaves existing valid state files byte-identical', () => {
  const run = runStateHygieneScenario('status\n', {
    files: { 'business.json': hygieneBusinessSeed, 'cofounder-state.json': hygieneStateSeed }
  });

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.equal(run.protectedFiles['business.json'], hygieneBusinessSeed);
  assert.equal(run.protectedFiles['cofounder-state.json'], hygieneStateSeed);
  assert.equal(run.childProcessCalls.length, 0, 'no child process may be attempted');
});

test('state-file read hygiene: a malformed business.json is not overwritten by a read-only command', () => {
  const run = runStateHygieneScenario('status\n', {
    files: { 'business.json': '{ invalid json', 'cofounder-state.json': hygieneStateSeed }
  });

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.equal(run.protectedFiles['business.json'], '{ invalid json', 'a malformed file must be left for repair');
  assert.equal(run.protectedFiles['cofounder-state.json'], hygieneStateSeed);
  assert.doesNotMatch(run.result.stdout ?? '', /Unexpected token|SyntaxError/);
  assert.doesNotMatch(run.result.stdout ?? '', /[A-Za-z]:\\/);
});

test('state-file read hygiene: a malformed cofounder-state.json is not overwritten by a read-only command', () => {
  const run = runStateHygieneScenario('show decisions\n', {
    files: { 'cofounder-state.json': '{ broken json' }
  });

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /JARVIS DECISION HISTORY/);
  assert.match(run.result.stdout ?? '', /No decisions recorded\./);
  assert.equal(run.protectedFiles['cofounder-state.json'], '{ broken json', 'a malformed file must be left for repair');
  assert.doesNotMatch(run.result.stdout ?? '', /Unexpected token|SyntaxError/);
});

test('state-file read hygiene: read-only commands tolerate absent state and still create nothing', () => {
  const run = runStateHygieneScenario('show decisions\nresearch-latest\n');

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /No decisions recorded\./);
  assert.match(run.result.stdout ?? '', /No saved research sessions\./);
  assert.equal(run.protectedFiles['cofounder-state.json'], null, 'absent state must stay absent');
  assert.equal(run.protectedFiles['business.json'], null, 'absent state must stay absent');
  assert.equal(run.childProcessCalls.length, 0, 'no child process may be attempted');
});

test('state-file read hygiene: a missing required state file fails with a bounded message and no path', () => {
  const run = runStateHygieneScenario('record decision tighten local state hygiene\n');

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /Local state file "cofounder-state\.json" is missing or unreadable/);
  assert.doesNotMatch(run.result.stdout ?? '', /ENOENT|no such file/i);
  assert.doesNotMatch(run.result.stdout ?? '', /Unexpected token|SyntaxError/);
  assert.doesNotMatch(run.result.stdout ?? '', /[A-Za-z]:\\/);
  assert.equal(run.protectedFiles['cofounder-state.json'], null, 'a failed command must not create the missing file');
  assert.equal(run.childProcessCalls.length, 0, 'no child process may be attempted');
});

test('state-file read hygiene: a malformed required state file fails with a bounded message and is left unchanged', () => {
  const run = runStateHygieneScenario('record decision tighten local state hygiene\n', {
    files: { 'cofounder-state.json': '{ broken json' }
  });

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /Local state file "cofounder-state\.json" contains invalid JSON/);
  assert.match(run.result.stdout ?? '', /left unchanged so it can be repaired/);
  assert.equal(run.protectedFiles['cofounder-state.json'], '{ broken json', 'a malformed file must be left for repair');
  assert.doesNotMatch(run.result.stdout ?? '', /Unexpected token|SyntaxError/);
  assert.doesNotMatch(run.result.stdout ?? '', /[A-Za-z]:\\/);
});

test('state-file read hygiene: an intentional state write still records the decision', () => {
  const run = runStateHygieneScenario('record decision hygiene-check\n', {
    files: { 'cofounder-state.json': hygieneStateSeed }
  });

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\nstderr: ' + run.result.stderr);
  assert.match(run.result.stdout ?? '', /JARVIS DECISION RECORDED/);
  const written = JSON.parse(run.protectedFiles['cofounder-state.json']);
  assert.equal(written.decisions.length, 1);
  assert.equal(written.decisions[0].decision, 'hygiene-check');
  assert.equal(written.decisions[0].status, 'ACTIVE');
  assert.equal(run.protectedFiles['business.json'], null, 'recording a decision must not create business.json');
});

// ---------------------------------------------------------------------------
// PORTFOLIO JUDGEMENT REGRESSION DEFINITIONS
// ---------------------------------------------------------------------------

test('zayzana focus prints the exact fail-closed direction and separates it from immediate action', () => {
  const business = prospectFixture();
  business.followUps = [
    { text: 'SIMULATED open follow-up', status: 'OPEN' }
  ];
  business.opportunities = [
    { text: 'SIMULATED open opportunity', status: 'OPEN' }
  ];

  const { result } = runIsolatedJarvis(
    business,
    'zayzana focus\n',
    {
      goals: [{ title: 'SIMULATED active goal', status: 'ACTIVE' }],
      decisions: [{ decision: 'SIMULATED active decision', status: 'ACTIVE' }]
    }
  );
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.equal(
    stdout.split(/\r?\n/).filter(line => line === 'COMMERCIAL DIRECTION: NOT ESTABLISHED').length,
    1
  );
  assert.doesNotMatch(stdout, /SIMULATED active goal|SIMULATED active decision/);
  assert.ok(
    stdout.indexOf('COMMERCIAL DIRECTION: NOT ESTABLISHED') < stdout.indexOf('IMMEDIATE ACTION'),
    'commercial direction must precede the separate immediate-action section'
  );
  assert.match(stdout, /IMMEDIATE ACTION: Follow-up \| SIMULATED open follow-up/);
  assert.doesNotMatch(stdout, /SIMULATED open opportunity/);
});

test('zayzana focus preserves selected-prospect visibility and the exact selection instruction', () => {
  const selected = prospectFixture();
  selected.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {}
  });
  selected.selectedProspectName = 'Second prospect';

  const selectedRun = runIsolatedJarvis(selected, 'zayzana focus\n');
  assert.equal(selectedRun.result.status, 0);
  assert.match(selectedRun.result.stdout ?? '', /IMMEDIATE ACTION: Selected prospect \| Second prospect/);
  assert.doesNotMatch(selectedRun.result.stdout ?? '', /Test prospect/);

  const unselected = prospectFixture();
  unselected.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {}
  });

  const unselectedRun = runIsolatedJarvis(unselected, 'zayzana focus\n');
  assert.equal(unselectedRun.result.status, 0);
  assert.match(unselectedRun.result.stdout ?? '', /Command: select prospect <exact name>/);
  assert.doesNotMatch(unselectedRun.result.stdout ?? '', /IMMEDIATE ACTION: Selected prospect/);
});

test('recommend fails closed on a stale saved prospect selection with one other prospect open', () => {
  const business = prospectFixture();
  business.prospects[0].status = 'CLOSED';
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {}
  });
  business.selectedProspectName = 'Test prospect';

  const { result } = runIsolatedJarvis(business, 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /The saved prospect selection does not match an open prospect, so none was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Focus first on:/);
  assert.doesNotMatch(stdout, /Prospect discovery is incomplete/);
  assert.doesNotMatch(stdout, /Focus on converting the open opportunity/);
});

test('recommend refuses an identity collision between open and closed prospects', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: ' test PROSPECT ',
    details: 'A closed synthetic record with the same normalized name',
    status: 'CLOSED',
    discovery: {}
  });
  business.selectedProspectName = ' TEST prospect ';
  business.followUps = [
    { text: 'SIMULATED follow-up', status: 'OPEN' }
  ];

  const { result } = runIsolatedJarvis(business, 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /identity-collision/);
  assert.doesNotMatch(stdout, /Focus first on:/);
  assert.doesNotMatch(stdout, /Prospect discovery is incomplete/);
  assert.doesNotMatch(stdout, /SIMULATED follow-up/);
  assert.doesNotMatch(stdout, /Test prospect/);
});

test('recommend refuses a nonblank unresolved selection when no prospects are open', () => {
  const business = prospectFixture();
  business.prospects[0].status = 'CLOSED';
  business.selectedProspectName = 'Missing prospect';
  business.followUps = [
    { text: 'SIMULATED follow-up', status: 'OPEN' }
  ];

  const { result } = runIsolatedJarvis(business, 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /No open prospect is recorded\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Focus first on:/);
  assert.doesNotMatch(stdout, /SIMULATED follow-up/);
});

test('recommend fails closed on duplicate open prospect names matching the saved selection', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Test prospect',
    details: 'A different synthetic record with the same name',
    status: 'NEW',
    discovery: {}
  });
  business.selectedProspectName = 'Test prospect';

  const { result } = runIsolatedJarvis(business, 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /matches multiple prospect records \(identity-collision\), so no prospect was selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Focus first on:/);
  assert.doesNotMatch(stdout, /Focus on converting the open opportunity/);
});

test('recommend fails closed when multiple prospects are open and none is selected', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {}
  });

  const { result } = runIsolatedJarvis(business, 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.match(stdout, /More than one open prospect is recorded and none is selected\./);
  assert.match(stdout, /Use: select prospect <exact name>/);
  assert.doesNotMatch(stdout, /Focus first on:/);
  assert.doesNotMatch(stdout, /Prospect discovery is incomplete/);
});

test('recommend auto-selects the only open prospect when no selection is saved', () => {
  const { result } = runIsolatedJarvis(prospectFixture(), 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /Focus first on: complete discovery for Test prospect/);
  assert.match(stdout, /Test prospect/);
  assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);
});

test('recommend preserves non-prospect guidance when no prospect is open', () => {
  const business = prospectFixture();
  business.prospects = [];
  business.followUps = [
    { text: 'SIMULATED follow-up', status: 'OPEN' }
  ];
  business.opportunities = [
    { text: 'SIMULATED opportunity', status: 'OPEN' }
  ];

  const { result } = runIsolatedJarvis(business, 'recommend\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /Focus first on: SIMULATED follow-up/);
  assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /Use: select prospect <exact name>/);
  assert.match(stdout, /No external action taken\. Zayn approval is required before execution\./);
});

test('recommend blocks qualification and contract guidance when prospect resolution fails', () => {
  const business = prospectFixture();
  business.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {}
  });
  business.followUps = [
    { text: 'Send contract to prospect', status: 'OPEN' }
  ];
  business.opportunities = [
    { text: 'SIMULATED opportunity', status: 'OPEN' }
  ];

  const { result } = runIsolatedJarvis(business, 'recommend\n', {
    lessons: [
      { text: 'Qualify before contract when discovery evidence is incomplete' }
    ]
  });
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /PROSPECT SELECTION REQUIRED/);
  assert.doesNotMatch(stdout, /Focus first on:/);
  assert.doesNotMatch(stdout, /Focus first on: complete prospect qualification before contracting/);
  assert.doesNotMatch(stdout, /LEARNING SIGNAL/);
  assert.doesNotMatch(stdout, /Focus on converting the open opportunity/);
});

test('recommend preserves qualification, decision, approval and external-action safeguards', () => {
  const unconfirmed = prospectFixture({
    problem: 'SIMULATED recorded problem',
    impact: 'SIMULATED recorded impact',
    currentSolution: 'SIMULATED recorded current solution',
    desiredOutcome: 'SIMULATED recorded desired outcome',
    decisionMaker: 'SIMULATED recorded decision maker'
  });
  unconfirmed.prospects[0].qualification = {
    status: 'READY FOR CONFIRMATION',
    missing: []
  };
  unconfirmed.opportunities = [
    { text: 'SIMULATED opportunity', status: 'OPEN' }
  ];

  const buyerRun = runIsolatedJarvis(unconfirmed, 'recommend\n');
  const buyerStdout = buyerRun.result.stdout ?? '';

  assert.equal(buyerRun.result.status, 0);
  assert.match(buyerStdout, /Focus first on: complete discovery for Test prospect/);
  assert.match(buyerStdout, /Prospect discovery is incomplete/);
  assert.doesNotMatch(buyerStdout, /Focus on converting the open opportunity/);
  assert.doesNotMatch(buyerStdout, /No major prospect qualification gap is recorded/);

  const guarded = prospectFixture();
  guarded.followUps = [
    { text: 'Send contract to prospect', status: 'OPEN' }
  ];
  guarded.opportunities = [
    { text: 'SIMULATED opportunity', status: 'OPEN' }
  ];

  const guardedRun = runIsolatedJarvis(
    guarded,
    'recommend\n',
    {
      decisions: [
        {
          id: 'decision-1',
          decision: 'Complete qualification before contracting',
          status: 'ACTIVE'
        }
      ],
      approvals: [
        {
          approvalId: 'approval-1',
          action: 'SIMULATED approval',
          approvedBy: 'Zayn',
          date: '2026-01-01T00:00:00.000Z',
          status: 'ACTIVE'
        }
      ]
    }
  );
  const guardedStdout = guardedRun.result.stdout ?? '';

  assert.equal(guardedRun.result.status, 0);
  assert.match(guardedStdout, /CONFLICT: Current follow-up may conflict with an active decision requiring qualification before contracting\./);
  assert.match(guardedStdout, /JARVIS should not recommend contracting until Zayn changes or closes that decision\./);
  assert.match(guardedStdout, /Approval is recorded, but execution still requires a separate execution step\./);
  assert.match(guardedStdout, /No external action taken\. Zayn approval is required before execution\./);
  assert.equal(guardedRun.researchCalls, 0);
  assert.doesNotMatch(guardedStdout, /Thinking|AI request failed/);
});

test('action brain labels immediate-action scope without changing precedence', () => {
  const business = prospectFixture();
  business.followUps = [
    { text: 'SIMULATED follow-up', status: 'OPEN' }
  ];
  business.opportunities = [
    { text: 'SIMULATED opportunity', status: 'OPEN' }
  ];

  const { result } = runIsolatedJarvis(business, 'action brain\n');
  const stdout = result.stdout ?? '';

  assert.equal(result.status, 0);
  assert.match(stdout, /NEXT ACTION/);
  assert.match(stdout, /SCOPE: Immediate action only; not company-wide commercial direction\./);
  assert.match(stdout, /Follow up: SIMULATED follow-up/);
  assert.doesNotMatch(stdout, /Develop the open opportunity: SIMULATED opportunity/);

  const selected = prospectFixture();
  selected.prospects.push({
    name: 'Second prospect',
    details: 'Another test business',
    status: 'NEW',
    discovery: {}
  });
  selected.selectedProspectName = 'Second prospect';
  selected.opportunities = [
    { text: 'SIMULATED opportunity', status: 'OPEN' }
  ];

  const selectedRun = runIsolatedJarvis(selected, 'action brain\n');
  const selectedStdout = selectedRun.result.stdout ?? '';

  assert.equal(selectedRun.result.status, 0);
  assert.match(selectedStdout, /Work the selected prospect: Second prospect/);
  assert.doesNotMatch(selectedStdout, /Develop the open opportunity: SIMULATED opportunity/);
});

test('portfolio judgement commands leave protected state unchanged and trigger no external work', () => {
  const seeds = {
    'business.json': JSON.stringify({
      prospects: [
        { name: 'Test prospect', details: 'Test business', status: 'NEW', discovery: {} }
      ],
      opportunities: [{ text: 'SIMULATED opportunity', status: 'OPEN' }],
      offers: [],
      followUps: [{ text: 'SIMULATED follow-up', status: 'OPEN' }],
      revenue: [],
      marker: 'business-untouched'
    }, null, 2),
    'cofounder-state.json': JSON.stringify({
      goals: [{ title: 'SIMULATED active goal', status: 'ACTIVE' }],
      decisions: [],
      approvals: [],
      executions: [],
      lessons: [],
      research: [],
      marker: 'state-untouched'
    }, null, 2),
    'memory.json': JSON.stringify([{ text: 'SIMULATED memory', marker: 'memory-untouched' }], null, 2),
    'reminders.json': JSON.stringify([{ message: 'SIMULATED reminder', time: 9999999999999, marker: 'reminders-untouched' }], null, 2),
    'tasks.json': JSON.stringify([{ text: 'SIMULATED task', marker: 'tasks-untouched' }], null, 2),
    'cofounder-settings.json': JSON.stringify({ speechEnabled: false }, null, 2)
  };

  const { result, protectedFiles, researchCalls, capturedAIRequests } = runIsolatedJarvis(
    null,
    'zayzana focus\nrecommend\naction brain\n',
    {},
    {
      seedProtectedFiles: seeds,
      fakeResearch: true,
      fakeAIResponse: true,
      captureAIRequests: true
    }
  );

  assert.equal(result.status, 0, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  for (const [name, expected] of Object.entries(seeds)) {
    assert.equal(protectedFiles[name], expected, name + ' must remain byte-identical');
  }
  assert.equal(researchCalls, 0, 'no research tool must be invoked');
  assert.equal((capturedAIRequests ?? []).length, 0, 'no AI request may be made');
  assert.doesNotMatch(result.stdout ?? '', /Thinking|AI request failed/);
});

test('portfolio judgement views preserve first-record opportunity precedence', () => {
  const business = prospectFixture();
  business.prospects = [];
  business.followUps = [];
  business.opportunities = [
    { text: 'First opportunity', status: 'OPEN' },
    { text: 'Second opportunity', status: 'OPEN' }
  ];

  for (const command of ['zayzana focus', 'recommend', 'action brain']) {
    const { result } = runIsolatedJarvis(business, command + '\n');
    const stdout = result.stdout ?? '';
    assert.equal(result.status, 0, command);
    assert.match(stdout, /First opportunity/, command);
    assert.doesNotMatch(stdout, /Second opportunity/, command);
    assert.doesNotMatch(stdout, /PROSPECT SELECTION REQUIRED|Select a prospect/, command);
  }
});

test('state-file mutation hygiene: adding a prospect refuses malformed business.json and preserves the original bytes', () => {
  const malformedBusiness = '{ invalid json';
  const run = runIsolatedJarvis(
    prospectFixture(),
    'add prospect Regression Prospect\\n',
    {},
    { invalidBusinessData: true }
  );

  assert.equal(run.result.status, 0, 'stdout: ' + run.result.stdout + '\\nstderr: ' + run.result.stderr);
  assert.doesNotMatch(run.result.stdout ?? '', /Prospect added: Regression Prospect/);
  assert.equal(
    run.protectedFiles['business.json'],
    malformedBusiness,
    'a mutation must not replace malformed business state with an in-memory fallback'
  );
  assert.equal(
    run.directoryListing.some(name => /^business\\.json\\..*\\.bak$/.test(name)),
    false,
    'a refused mutation must not create a business backup'
  );
  assert.equal(run.directoryListing.includes('.cofounder-state.lock'), false, 'the writer lock must be released');
});

