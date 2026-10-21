'use strict';
// STATIC GUARDRAILS ONLY. They cannot prove Firestore Rules authorization.
// Run a Firebase Emulator with real security-rule unit tests before rollout.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const repo=path.join(__dirname,'..');
const production=fs.readFileSync(path.join(repo,'firestore.rules'),'utf8');
const draft=fs.readFileSync(path.join(repo,'rules-drafts/firestore-trash.rules'),'utf8');
const clauses=[
 'function isMove(uid,shiftId)',
 'function isRestore(uid,shiftId)',
 'function isExpiredPurge(uid,shiftId)',
 'function isPurging(uid,shiftId)',
 '!existsAfter(dutyPath(uid,shiftId))',
 'getAfter(tombPath(uid,shiftId))',
 'request.resource.data.expiresAt',
 'request.resource.data.expiresAt < request.time + duration.value(31',
 'allow delete: if ownerEnabled(uid)',
 "request.resource.data.state == 'deleted'",
 "request.resource.data.state == 'active'",
 'editingSession(uid',
 'allow update: if false;'
];
for(const snippet of clauses){
 assert.ok(draft.includes(snippet),'missing Rules safety gate: '+snippet);
}
assert.match(draft,/match \/privateDuties\/\{uid\}\/shifts\/\{shiftId\}/);
assert.match(draft,/match \/privateDuties\/\{uid\}\/trash\/\{shiftId\}/);
assert.match(draft,/match \/privateDuties\/\{uid\}\/tombstones\/\{shiftId\}/);
assert.match(draft,/allow delete: if false;/);
assert.doesNotMatch(draft,/allow (?:read|write): if true/);
// The active rules MUST still reject deletion until emulator tests,
// approval and an explicit rules deployment are complete.
assert.ok(production.includes('match /privateDuties/{uid}/shifts/{shiftId}'));
assert.match(production,/allow delete: if false;/);
assert.doesNotMatch(production,/match \/privateDuties\/\{uid\}\/trash\//);
assert.doesNotMatch(production,/match \/privateDuties\/\{uid\}\/tombstones\//);
console.log('Firestore Rules draft static guardrails present; production rules unchanged; emulator proof still REQUIRED');
