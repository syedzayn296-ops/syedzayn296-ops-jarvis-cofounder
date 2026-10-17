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
      protectedFiles
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
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'research: find company website\n',
    {},
    { fakeResearch: true }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /Prospect: Unassigned/);
  assert.equal(state.research.length, 1);
  assert.equal(state.research[0].prospectName, null);
  assert.equal(state.research[0].query, 'find company website');
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
  assert.match(duplicate.result.stdout ?? '', /More than one open prospect shares the saved name/);
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
