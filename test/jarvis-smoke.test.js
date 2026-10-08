const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const indexFile = path.join(repoRoot, 'index.js');

function runIsolatedJarvis(business, input, state = {}) {
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

    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: tempDir,
      input,
      encoding: 'utf8',
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
  const result = spawnSync(process.execPath, ['index.js'], {
    input: 'recommend\n',
    encoding: 'utf8',
    timeout: 3000
  });

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JARVIS COFOUNDER RECOMMENDATION/);
});

test('prospect recommendation refuses a final solution when discovery is incomplete', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture({
      problem: 'Manual customer follow-up is consuming staff time',
      impact: 'Staff spend hours each week chasing responses'
    }),
    'prospect recommendation\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

test('prospect qualification marks a prospect qualified only with all core evidence', () => {
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /QUALIFICATION: QUALIFIED/);
  assert.deepEqual(business.prospects[0].qualification.missing, []);
  assert.equal(business.prospects[0].qualification.status, 'QUALIFIED');
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
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JARVIS COFOUNDER CHALLENGE/);
  assert.match(result.stdout ?? '', /The current follow-up may be premature because prospect qualification is incomplete/);
});

test('cofounder blocks an unlinked approval when an active decision exists', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\napprove recommendation complete prospect qualification before contracting\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JARVIS APPROVAL BLOCKED/);
  assert.equal(state.approvals.length, 0);
});

test('cofounder links an approval to the active decision it authorizes', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\napprove recommendation complete prospect qualification before contracting for decision 1\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JARVIS RECOMMENDATION APPROVED/);
  assert.equal(state.approvals[0].decisionNumber, 1);
  assert.equal(state.approvals[0].decisionId, 'decision-1');
});

test('cofounder blocks execution when the linked decision has been closed', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\napprove recommendation complete prospect qualification before contracting for decision 1\nclose decision 1\nexecute approved 1\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].verificationStatus, 'PENDING');
  assert.equal(state.approvals[0].verificationStatus, 'PENDING');
});
test('cofounder verifies a completed execution', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'approve recommendation complete prospect qualification before contracting\nexecute approved 1\nverify execution 1 verified\nverify execution 1 verified\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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
    'prospect qualification\nrecommend\n',
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /QUALIFICATION: QUALIFIED/);
  assert.match(result.stdout ?? '', /Focus first on: Send contract to prospect/);
  assert.doesNotMatch(result.stdout ?? '', /LEARNING SIGNAL: A past decision lesson indicates qualification should happen before contracting/);
});

test('cofounder blocks a lesson until the decision outcome is recorded', () => {
  const { result, state } = runIsolatedJarvis(
    prospectFixture(),
    'record decision complete qualification before contracting\ndecision lesson 1 qualify before contract\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JUDGEMENT: INVESTIGATE/);
  assert.match(result.stdout ?? '', /MONEY: UNKNOWN/);
  assert.match(result.stdout ?? '', /RETURN: UNKNOWN/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('commercial assessment can pursue when evidence and strategic fit are strong', () => {
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JUDGEMENT: PURSUE/);
  assert.match(result.stdout ?? '', /STRATEGIC FIT:/);
  assert.match(result.stdout ?? '', /External action: BLOCKED/);
});

test('prospect intelligence rejects weak research as insufficient evidence', () => {
  const { result } = runIsolatedJarvis(
    prospectFixture(),
    'prospect intelligence\n'
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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

  assert.equal(result.error?.code, 'ETIMEDOUT');
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
  assert.match(result.stdout ?? '', /Zayn approval required/);
  assert.match(result.stdout ?? '', /Nothing is executed automatically/);
});
