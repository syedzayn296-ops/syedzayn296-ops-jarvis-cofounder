const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

    fs.writeFileSync(
      path.join(tempDir, 'cofounder-settings.json'),
      JSON.stringify({ speechEnabled: false })
    );
    if (options.fakeResearch) {
      fs.writeFileSync(
        path.join(tempDir, 'mcporter.cmd'),
        '@echo off\r\necho Title: Example Result\r\necho URL: https://example.com/test\r\n'
      );
    }

    if (options.fakeAIResponse || options.fakeAIHangs) {
      fs.writeFileSync(
        path.join(tempDir, 'fake-fetch.cjs'),
        [
          'global.fetch = async function(url, options = {}) {',
          '  if (String(url).includes("/api/chat")) return { ok: true, status: 200, json: async () => ({ message: { content: "OLLAMA TEST RESPONSE" } }) };',
          '  if (process.env.COFOUNDER_TEST_FETCH_HANG === "1") {',
          '    return new Promise((resolve, reject) => {',
          '      const signal = options.signal;',
          '      if (signal && signal.aborted) return reject(signal.reason || new Error("aborted"));',
          '      if (signal) signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });',
          '    });',
          '  }',
          '  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "GEMINI TEST RESPONSE" }] } }] }) };',
          '};',
          ''
        ].join('\n')
      );
    }

    const env = {
      ...process.env,
      GEMINI_API_KEY: options.fakeAIResponse || options.fakeAIHangs ? 'test-key' : '',
      COFOUNDER_PROVIDER: options.provider || 'gemini',
      COFOUNDER_TEST_FETCH_HANG: options.fakeAIHangs ? '1' : '0',
      ...(options.fakeResearch ? { PATH: tempDir + ';' + (process.env.PATH || '') } : {}),
      ...((options.fakeAIResponse || options.fakeAIHangs) ? {
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

    return {
      result,
      business: JSON.parse(
        fs.readFileSync(path.join(tempDir, 'business.json'), 'utf8')
      ),
      state: JSON.parse(
        fs.readFileSync(path.join(tempDir, 'cofounder-state.json'), 'utf8')
      )
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
  const start = source.indexOf('if (lower.startsWith("research "))');
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
    'research find company website\n',
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
    'research for Test prospect: find company website\n',
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
    'research for Test prospect: find company website\n',
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
    'research for Wrong prospect: find company website\n'
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /no single open prospect matched 'Wrong prospect'/);
  assert.equal(state.research, undefined);
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
