const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('JARVIS recommendation command responds', () => {
  const result = spawnSync(process.execPath, ['index.js'], {
    input: 'recommend\n',
    encoding: 'utf8',
    timeout: 3000
  });

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.match(result.stdout ?? '', /JARVIS COFOUNDER RECOMMENDATION/);
});
