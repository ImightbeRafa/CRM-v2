import assert from 'node:assert/strict';
import {
  generateEmployeeCode,
  hashEmployeeCode,
  normalizeEmployeeCode,
} from '../logistics-workforce';

process.env.EMPLOYEE_CODE_SECRET = 'workforce-code-test-secret';

assert.equal(normalizeEmployeeCode(' yzlh-rmpf '), 'YZLHRMPF');
assert.equal(hashEmployeeCode('yzlh-rmpf'), hashEmployeeCode('YZLHRMPF'));
assert.notEqual(hashEmployeeCode('YZLHRMPF'), hashEmployeeCode('5ZZZ3U4R'));
assert.throws(() => hashEmployeeCode('abc'), /Invalid employee code/);

const generated = Array.from({ length: 250 }, () => generateEmployeeCode().code);
assert.equal(new Set(generated).size, generated.length);
for (const code of generated) assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

console.log('workforce code tests passed');
