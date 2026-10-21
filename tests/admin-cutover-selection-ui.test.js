'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
require('../admin-firestore-cutover.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function adminCutoverLocalPreview(){');
const end=html.indexOf('function renderDeviceManagementPanel(){',start);
assert.ok(start>0&&end>start,'read-only cutover functions must be in the data settings area');
const rows=[1,2,3,4,5].map(i=>({
 id:'shift-'+i+'-a',date:i===2?'2026-10-21':'2026-10-20',
 startedAt:i===2?'08:00':'09:00',endedAt:'17:00',
 startedIso:i===2?'2026-10-21T08:00:00+09:00':'2026-10-20T09:00:00+09:00',
 endedIso:i===2?'2026-10-21T17:00:00+09:00':'2026-10-20T17:00:00+09:00',
 records:[],settings:{}
}));
const clone=x=>JSON.parse(JSON.stringify(x));
let uid='admin-A',isLegacy=true,writer=true,saved=[],toast=[],summaryNode={innerHTML:''},sheetNode={innerHTML:''},exportButton={disabled:true};
const googleCalls=[];let googleFail=false;
const sheetOnly={id:'shift-777-a',date:'2026-10-21',startedIso:'2026-10-21T08:00:00+09:00',
 endedIso:'2026-10-21T17:00:00+09:00',startedAt:'08:00',endedAt:'17:00',records:[],settings:{}};
const root={
 TAXIAPP_ADMIN_CUTOVER:globalThis.TAXIAPP_ADMIN_CUTOVER
};
const context={
 window:root,accountScope:{uid},accountScopeGeneration:2,
 adminCutoverSelectionUid:uid,adminCutoverSheetAudit:null,adminCutoverSheetBusy:false,
 adminCutoverSelected:new Set(),adminCutoverSheetRequestToken:0,
 model:{version:1,shifts:clone(rows),activeId:null,prefs:{}},
 legacyDiary:()=>isLegacy,canEditNow:()=>writer,googleIsConfigured:()=>true,
 async googlePostRequest(action,fields={}){
  googleCalls.push({action,fields});
  if(googleFail)throw Error('read failed');
  if(action==='syncList')return {data:{shifts:[{id:rows[0].id,revision:1},{id:sheetOnly.id,revision:2}]}};
  if(action==='syncGet'&&fields.shiftId===rows[0].id)
   return {data:{id:rows[0].id,shift:clone(rows[0]),revision:1}};
  if(action==='syncGet'&&fields.shiftId===sheetOnly.id)
   return {data:{id:sheetOnly.id,shift:clone(sheetOnly),revision:2}};
  throw Error('unexpected action '+action);
 },
 totals:()=>({meter:0}),money:n=>n+'円',shortTime:x=>String(x||''),dateStamp:()=> '20261021',
 safeText:s=>String(s??'').replace(/[<>"']/g,''),
 appEl:{
  querySelector:selector=>selector==='[data-admin-cutover-sheet-report]'?sheetNode:
   selector==='[data-admin-cutover-summary]'?summaryNode:
   selector==='[data-action="adminCutoverExport"]'?exportButton:null,
  querySelectorAll:()=>[]
 },
 download:(json,name,contentType)=>saved.push({json,name,contentType}),
 toast:(...args)=>toast.push(args)
};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);
const invoke=(fn,...args)=>vm.runInContext(fn,context)(...args);
const panel=()=>invoke('renderAdminCutoverSelectionPanel');
const preview=()=>invoke('adminCutoverLocalPreview');
assert.match(panel(),/Firebase移行前の日報選択/);
assert.equal((panel().match(/data-admin-cutover-choice/g)||[]).length,5,'all five local records offered');
assert.doesNotMatch(panel(),/name="syncDelete"/);
assert.equal(preview().selectedCount,0,'safe initial state selects none');
assert.match(panel(),/Firebaseの記録は、まだ取得していません/);
invoke('handleAdminCutoverChoice','shift-1-a',true);
invoke('handleAdminCutoverChoice','shift-2-a',true);
assert.equal(preview().selectedCount,2);
assert.equal(preview().excludedCount,3);
assert.equal(preview().cloudVerified,false);
assert.equal(preview().migrationAuthorized,false);
assert.equal(exportButton.disabled,false);
assert.match(summaryNode.innerHTML,/選択/);
invoke('handleAdminCutoverChoice','shift-999-a',true);
assert.equal(preview().selectedCount,2,'invalid id must not add an item');
invoke('exportAdminCutoverSelection');
assert.equal(saved.length,1);
const note=JSON.parse(saved[0].json);
assert.deepEqual(note.entries.map(e=>e.id),['shift-1-a','shift-2-a']);
assert.equal(note.migrationAuthorized,false);
assert.equal(note.cloudVerified,false);
assert.ok(!note.entries.some(x=>x.records),'export is not a copy of sales records');
assert.equal(context.model.shifts.length,5,'selection must never edit saved duties');
writer=false;
invoke('handleAdminCutoverChoice','shift-3-a',true);
invoke('exportAdminCutoverSelection');
assert.equal(saved.length,1,'read-only device must not export as the writer');
assert.equal(preview().selectedCount,2);
writer=true;
isLegacy=false;
assert.equal(panel(),'','ordinary users cannot use admin migration panel');
invoke('handleAdminCutoverChoice','shift-3-a',true);
assert.equal(saved.length,1);
isLegacy=true;
context.accountScope={uid:'admin-B'};
assert.equal(panel(),'','wrong UID state must not list another account');
assert.equal(preview(),null);
assert.equal(context.model.shifts.length,5);
assert.match(html,/data-action="adminCutoverExport"/);
assert.match(html,/data-admin-cutover-choice/);
// Read-only Google reconciliation. Never send syncPut, sync, delete, or
// overwrite originals even if the administrator selects two local duties.
(async()=>{
 isLegacy=true;writer=true;context.accountScope={uid:'admin-A'};
 context.adminCutoverSelectionUid='admin-A';
 context.adminCutoverSelected=new Set(['shift-1-a','shift-2-a']);
 assert.match(panel(),/Google同期原本を照合/);
 assert.match(panel(),/TAXIAPP_同期原本/);
 await invoke('compareAdminCutoverSheet');
 assert.deepEqual(googleCalls.map(c=>c.action),['syncList','syncGet','syncGet','syncList']);
 assert.ok(googleCalls.every(c=>['syncList','syncGet'].includes(c.action)));
 assert.equal(context.adminCutoverSheetAudit.sheetShifts.length,2);
 assert.match(sheetNode.innerHTML,/Google同期原本 2件/);
 assert.match(sheetNode.innerHTML,/Googleのみ 1件/);
 assert.match(sheetNode.innerHTML,/端末のみ 4件/);
 assert.match(sheetNode.innerHTML,/shift-777-a/);
 assert.match(sheetNode.innerHTML,/Firebaseは未照合/);
 assert.equal(context.model.shifts.length,5,'no local deletion');
 assert.equal(saved.length,1,'audit must not export sensitive shifts');
 googleFail=true;await invoke('compareAdminCutoverSheet');
 assert.equal(context.adminCutoverSheetAudit,null,'failed comparison cannot reuse stale data');
 assert.ok(toast.some(x=>String(x[0]).includes('照合を完了できません')));
 googleFail=false;
 // A change to the logged-in UID after the list request must reject the result.
 context.googlePostRequest=async()=>{context.accountScope={uid:'another-user'};return {data:{shifts:[]}};};
 await invoke('compareAdminCutoverSheet');
 assert.equal(context.adminCutoverSheetAudit,null,'account switch cannot reveal another UID data');
 assert.ok(!context.adminCutoverSheetBusy,'old request completes without remaining busy');
 console.log('Admin cutover Sheets audit passed: read-only list/get, failure, account switch, local unchanged');
})().catch(err=>{console.error(err);process.exitCode=1;});
console.log('Admin cutover selection UI passed: five-to-two selection, UID split, no cloud write, no migration');
