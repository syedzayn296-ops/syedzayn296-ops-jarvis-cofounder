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