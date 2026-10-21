'use strict';
/** Synthetic only. No network, real Firebase SDK, Google Sheets, or deployment. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fixture=require('./print-v2-existing-sheets-draft.test.js');
const {projectTrustedPacket}=require('../server-drafts/print-stage-legacy-rows.js');
const {prepareV2}=require('../server-drafts/print-stage-v2.js');
const script=fs.readFileSync(path.join(__dirname,'..','google-apps-script',
 'PrintOnlyExistingSheetsReprintTransactionDraft.gs'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup({edited='合成の編集済み地点',revision=4}={}){
 const z=fixture.make();
 vm.runInContext(script,z.sandbox);
 z.sandbox.printV2ExistingPublishDraft_(
  z.ss,z.stage,fixture.fixtureId,fixture.uid,()=>true);
 const updatedShift=clone(z.shift);
 updatedShift.records[0].raw.AL=edited;
 const virtual=projectTrustedPacket({
  packet:{kind:'TAXIAPP_SHIFT_V1',shift:updatedShift,summary:z.sums},
  sourceRevision:revision});
 const prepared=prepareV2({
  sourceUid:fixture.uid,sourceRevision:revision,
  expectedCommittedRevision:3,virtual,chunkSize:4000});
 z.sandbox.printV2AppendDraft_(z.stage,prepared,fixture.uid);
 const journal=fixture.sheet(z.sandbox.TAXIAPP_PRINT_REPRINT_JOURNAL,
  [...z.sandbox.TAXIAPP_PRINT_REPRINT_HEADERS]);
 const before=Object.fromEntries(fixture.originalSheets.map(n=>[
  n,JSON.stringify(z.book[n].values)]));
 return {...z,journal,before,updatedShift};
}
function runPublish(z,verify=()=>true,maintenance=()=>true){
 return z.sandbox.printV2ExistingReprintPublishDraft_(
  z.ss,z.stage,z.journal,fixture.fixtureId,fixture.uid,3,verify,maintenance);
}
function statuses(journal){
 return Object.values(journal.values).slice(1).map(row=>row[6]);
}
function compareProtected(z){
 for(const name of fixture.originalSheets)
  assert.equal(JSON.stringify(z.book[name].values),z.before[name],
   'never modify '+name);
}
const normal=setup(),print=normal.book['TAXIAPP_印刷データ'];
const oldRow=[...print.values[3]];
assert.equal(oldRow[7],'合成乗車');
const entryPlan=normal.sandbox.printV2ExistingReprintPlan_(
 normal.ss,normal.stage,fixture.fixtureId,fixture.uid,3);
assert.equal(entryPlan.hasAnyChange,true);
assert.equal(entryPlan.requiresRowMove,false);
assert.equal(entryPlan.sheetActions.filter(x=>x.changed).length,1);
let signed=0,maintenanceCalls=0;
const result=runPublish(normal,()=>{signed++;return true;},
 ()=>{maintenanceCalls++;return true;});
assert.equal(result.state,'reprint-source-updated-needs-paper-review');
assert.equal(result.from,3);assert.equal(result.to,4);
assert.deepEqual([...result.updatedSheets],['TAXIAPP_印刷データ']);
assert.equal(print.values[3][7],'合成の編集済み地点');
assert.deepEqual(statuses(normal.journal),['BEGIN','COMMIT']);
assert.ok(signed>=3&&maintenanceCalls>=3);
assert.equal(result.printAuthorized,false);
assert.equal(normal.sandbox.printV2ReprintHistory_(
 normal.journal,fixture.fixtureId).active,null);
assert.throws(()=>runPublish(normal),/確定済み旧版/,
 'cannot reprint same update twice using the old printed revision');
for(const item of Object.values(normal.journal.values))
 assert.equal(JSON.stringify(item).includes('合成の編集済み地点'),false,
  'journal cannot store passenger addresses or original diary JSON');
compareProtected(normal);
assert.equal(normal.book['TAXIAPP_乗務一覧'].formulaCells.has('2:20'),true);
assert.equal(normal.book['TAXIAPP_乗務一覧'].formulaCells.has('2:21'),true);

const denied=setup();
assert.throws(()=>runPublish(denied,()=>false),/Firestore原本/);
assert.deepEqual(statuses(denied.journal),[]);
assert.equal(denied.book['TAXIAPP_印刷データ'].values[3][7],'合成乗車');
const noMaintenance=setup();
assert.throws(()=>runPublish(noMaintenance,()=>true,()=>false),/印刷停止/);
assert.deepEqual(statuses(noMaintenance.journal),[]);
const roleFail=setup();
assert.throws(()=>roleFail.sandbox.printV2ExistingReprintPublishDraft_(
 roleFail.ss,roleFail.stage,roleFail.journal,
 fixture.fixtureId,'other-user',3,()=>true,()=>true),/SHA256|本人UID/);

const interrupted=setup();
interrupted.book['TAXIAPP_印刷データ'].failWrites(true);
assert.throws(()=>runPublish(interrupted),/Simulated Sheets service write failure/);
assert.deepEqual(statuses(interrupted.journal),['BEGIN','ROLLED_BACK']);
assert.equal(interrupted.book['TAXIAPP_印刷データ'].values[3][7],'合成乗車');
interrupted.book['TAXIAPP_印刷データ'].failWrites(false);
assert.equal(runPublish(interrupted).state,'reprint-source-updated-needs-paper-review');

// Multi-sheet update: if payments fail AFTER printed details changed,
 // all touched sources must return to exactly the prior version.
const multiple=setup(),modified=clone(multiple.updatedShift);
modified.records[0].raw.N='QR'; // changes both printed payment display and split-payment labels
const v5=projectTrustedPacket({
 packet:{kind:'TAXIAPP_SHIFT_V1',shift:modified,summary:multiple.sums},
 sourceRevision:5});
multiple.sandbox.printV2AppendDraft_(multiple.stage,prepareV2({
 sourceUid:fixture.uid,sourceRevision:5,expectedCommittedRevision:4,
 virtual:v5,chunkSize:4000}),fixture.uid);
const paymentSheet=multiple.book['TAXIAPP_決済内訳'];
paymentSheet.failWrites(true);
assert.throws(()=>runPublish(multiple),/Simulated Sheets service write failure/);
assert.equal(multiple.book['TAXIAPP_印刷データ'].values[3][7],'合成乗車');
assert.equal(multiple.book['TAXIAPP_決済内訳'].values[3][10],'主金種');
assert.deepEqual(statuses(multiple.journal),['BEGIN','ROLLED_BACK']);
compareProtected(multiple);
paymentSheet.failWrites(false);
assert.equal(runPublish(multiple).to,5);
assert.deepEqual(statuses(multiple.journal),
 ['BEGIN','ROLLED_BACK','BEGIN','COMMIT']);
const wroteThenFailed=setup();
const printable=wroteThenFailed.book['TAXIAPP_印刷データ'];
const baseRange=printable.getRange;
let inject=true;
printable.getRange=(...args)=>{
 const result=baseRange(...args);
 if(args[0]===3&&args[1]===1&&args[3]===14&&inject){
  return {...result,setValues:rows=>{
   result.setValues(rows);
   inject=false;
   throw Error('Simulated response failure AFTER successful write');
  }};
 }
 return result;
};
assert.throws(()=>runPublish(wroteThenFailed),/Simulated response failure/);
assert.equal(printable.values[3][7],'合成乗車',
 'a write followed by lost HTTP confirmation MUST roll back safely');
assert.deepEqual(statuses(wroteThenFailed.journal),['BEGIN','ROLLED_BACK']);
assert.equal(wroteThenFailed.book['TAXIAPP_乗務一覧'].values[3][0],
 fixture.fixtureId,'index must not be rewritten or deleted');

const thirdParty=setup();
const third=thirdParty.book['TAXIAPP_印刷データ'],oldRange=third.getRange;
let oneShot=true;
third.getRange=(...args)=>{
 const result=oldRange(...args);
 if(args[0]===3&&args[1]===1&&args[3]===14&&oneShot)
  return {...result,setValues:rows=>{
   result.setValues(rows);
   third.values[3][7]='OTHER_ADMIN_CHANGED_THIS_CELL';
   oneShot=false;
   throw Error('Third party editing during network failure');
  }};
 return result;
};
assert.throws(()=>runPublish(thirdParty),/RECOVERY_REQUIRED/);
assert.deepEqual(statuses(thirdParty.journal),['BEGIN','RECOVERY_REQUIRED']);
assert.throws(()=>runPublish(thirdParty),/未復旧/);
assert.throws(()=>thirdParty.sandbox.printV2ReprintRecoverDraft_(
 thirdParty.ss,thirdParty.stage,thirdParty.journal,fixture.fixtureId,
 fixture.uid,()=>true,()=>true),/第三者/);
assert.equal(third.values[3][7],'OTHER_ADMIN_CHANGED_THIS_CELL',
 'do not overwrite an unrecognized third-party edit');
third.values[3][7]='合成の編集済み地点';
assert.equal(thirdParty.sandbox.printV2ReprintRecoverDraft_(
 thirdParty.ss,thirdParty.stage,thirdParty.journal,fixture.fixtureId,
 fixture.uid,()=>true,()=>true).state,'recovered-to-previous-print-version');
assert.equal(third.values[3][7],'合成乗車');
assert.deepEqual(statuses(thirdParty.journal),
 ['BEGIN','RECOVERY_REQUIRED','ROLLED_BACK']);


// A COMMIT might be durable even when the readback acknowledgement fails.
const uncertain=setup(),journal=uncertain.journal,oldGet=journal.getRange;
let corruptAck=true;
journal.getRange=(...args)=>{
 const range=oldGet(...args);
 return {...range,getValues:()=>{
  const rows=range.getValues();
  if(corruptAck&&args[0]===3&&rows[0]?.[6]==='COMMIT'){
   corruptAck=false;
   const bad=rows.map(row=>[...row]);bad[0][0]='CORRUPTED_ACK_ONLY';
   return bad;
  }
  return rows;
 }};
};
assert.throws(()=>runPublish(uncertain),/COMMIT_CONFIRMATION_UNKNOWN/);
assert.deepEqual(statuses(uncertain.journal),['BEGIN','COMMIT']);
assert.equal(uncertain.book['TAXIAPP_印刷データ'].values[3][7],
 '合成の編集済み地点','confirmed COMMIT must not be followed by automatic rollback');
assert.equal(uncertain.sandbox.printV2ReprintHistory_(
 uncertain.journal,fixture.fixtureId).active,null);
const crashed=setup();
const p=crashed.sandbox.printV2ExistingReprintPlan_(
 crashed.ss,crashed.stage,fixture.fixtureId,fixture.uid,3);
const tx=crashed.sandbox.printV2ReprintMakeEntry_(p);
crashed.sandbox.printV2ReprintJournalAppend_(crashed.journal,tx,'BEGIN');
// Simulate Apps Script interrupted after one row changed but before COMMIT.
crashed.book['TAXIAPP_印刷データ'].values[3][7]='合成の編集済み地点';
assert.throws(()=>runPublish(crashed),/未復旧/);
const recovered=crashed.sandbox.printV2ReprintRecoverDraft_(
 crashed.ss,crashed.stage,crashed.journal,fixture.fixtureId,fixture.uid,
 ()=>true,()=>true);
assert.equal(recovered.state,'recovered-to-previous-print-version');
assert.equal(recovered.revision,3);
assert.equal(crashed.book['TAXIAPP_印刷データ'].values[3][7],'合成乗車');
assert.deepEqual(statuses(crashed.journal),['BEGIN','ROLLED_BACK']);
compareProtected(crashed);
assert.equal(runPublish(crashed).state,'reprint-source-updated-needs-paper-review');
assert.deepEqual(statuses(crashed.journal),['BEGIN','ROLLED_BACK','BEGIN','COMMIT']);

const tampered=setup();
const oldPlan=tampered.sandbox.printV2ExistingReprintPlan_(
 tampered.ss,tampered.stage,fixture.fixtureId,fixture.uid,3);
tampered.sandbox.printV2ReprintJournalAppend_(
 tampered.journal,tampered.sandbox.printV2ReprintMakeEntry_(oldPlan),'BEGIN');
tampered.journal.values[2][4]='0'.repeat(64);
assert.throws(()=>runPublish(tampered),/監査のSHA256/);

const production=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.doesNotMatch(production,/printV2ExistingReprintPublishDraft_|printV2ReprintRecoverDraft_/);
assert.doesNotMatch(app,/printV2ExistingReprintPublishDraft_|printV2ReprintRecoverDraft_/);
console.log('Reprint draft PASS: maintenance/auth, one-ID same-count update, append-only audit, interruption rollback and crash recovery');
