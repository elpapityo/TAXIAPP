'use strict';
// Static regression guard only. This does NOT test deployed Firebase rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const section = (prefix) => {
  const start = rules.indexOf(prefix);
  assert.notEqual(start, -1, `Missing rules section: ${prefix}`);
  const open = rules.indexOf('{', start + prefix.length);
  assert.notEqual(open, -1);
  let depth = 1;
  for (let i = open + 1; i < rules.length; i++) {
    if (rules[i] === '{') depth++;
    if (rules[i] === '}' && --depth === 0) return rules.slice(open + 1, i);
  }
  throw Error(`Unclosed rules section: ${prefix}`);
};
const owner = section('function ownerEnabled(uid)');
assert.match(owner, /request\.auth\.uid\s*==\s*uid/);
assert.match(owner, /isAdmin\(\)\s*\|\|\s*activeUser\(uid\)/);
const active = section('function activeUser(uid)');
assert.match(active, /\.data\.status\s*==\s*'active'/);
const duty = section('match /privateDuties/{uid}/shifts/{shiftId}');
assert.match(duty, /allow get, list:\s*if ownerEnabled\(uid\)/);
assert.match(duty, /allow create:\s*if validPrivateDuty\(uid,shiftId\)/);
assert.match(duty, /allow update:\s*if validPrivateDuty\(uid,shiftId\)/);
assert.match(duty, /resource\.data\.revision\s*\+\s*1/);
assert.match(duty, /allow delete:\s*if false/);
const validation = section('function validPrivateDuty(uid,shiftId)');
assert.match(validation, /ownerEnabled\(uid\)/);
assert.match(validation, /isCurrentEditor\(uid\)/);
assert.match(validation, /request\.resource\.data\.shift\.id\s*==\s*shiftId/);
const editor = section('function isCurrentEditor(uid)');
assert.match(editor, /request\.resource\.data\.writerSessionId/);
assert.match(editor, /deviceSessions/);
assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write:\s*if false;/);
console.log('Firestore rule static contract passed (deployment and emulator verification still required).');
