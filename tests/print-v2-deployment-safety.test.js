'use strict';
/** Stage-12 guard: no production print cutover while authentication and
 * old-Google-original migration approval are absent. Pure static check.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=loc=>fs.readFileSync(path.join(__dirname,'..',loc),'utf8');
const liveRules=load('firestore.rules'),draftRules=load('rules-drafts/firestore-trash.rules');
const liveGas=load('google-apps-script/Code.gs'),liveHtml=load('index.html');
const journal=load('google-apps-script/PrintOnlyExistingSheetsReprintTransactionDraft.gs');
const stage=load('google-apps-script/PrintOnlyStageV2Draft.gs');
const mapper=load('server-drafts/print-stage-legacy-rows.js');
const handoff=load('google-apps-script/PrintOnlyExistingSheetsDraft.gs');
assert.ok(draftRules.includes('match /privateDuties/{uid}/tombstones/{shiftId}'),
 'draft security rules must protect per-duty tombstones');
assert.ok(!liveRules.includes('match /privateDuties/{uid}/tombstones/{shiftId}'),
 'production-like rules have not been upgraded; do not pretend production is ready');
assert.match(journal,/printV2ReprintVerify_/);
assert.match(journal,/RECOVERY_REQUIRED/);
assert.match(journal,/COMMIT_CONFIRMATION_UNKNOWN/);
assert.match(journal,/印刷停止を保証できません/);
assert.match(handoff,/旧Google原本に同じ乗務IDが存在するため印刷専用の更新を拒否/);
assert.match(stage,/TAXIAPP_印刷V2_ステージ/);
assert.match(mapper,/TAXIAPP_決済内訳/);
for(const str of [
 'printV2ExistingReprintPublishDraft_', 'printV2ReprintRecoverDraft_',
 'printV2ExistingPublishDraft_','printV2AppendDraft_'
]){
 assert.ok(!liveGas.includes(str),'current live GAS must not call draft writer '+str);
 assert.ok(!liveHtml.includes(str),'current app must not route to draft writer '+str);
}
assert.ok(!journal.includes('SpreadsheetApp.openById('),
 'draft must not open or write any spreadsheet by hard-coded ID');
assert.ok(!journal.includes('doPost('),
 'reprint writer must never be publicly callable with old shared key');
console.log('Print V2 readiness guard PASS: archived legacy originals protected, published rules missing tombstones, no draft production routing');
