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
let uid='admin-A',isLegacy=true,writer=true,saved=[],toast=[],summaryNode={innerHTML:''},exportButton={disabled:true};
const root={
 TAXIAPP_ADMIN_CUTOVER:globalThis.TAXIAPP_ADMIN_CUTOVER
};
const context={
 window:root,accountScope:{uid},adminCutoverSelectionUid:uid,
 adminCutoverSelected:new Set(),model:{version:1,shifts:clone(rows),activeId:null,prefs:{}},
 legacyDiary:()=>isLegacy,canEditNow:()=>writer,
 totals:()=>({meter:0}),money:n=>n+'円',shortTime:x=>String(x||''),dateStamp:()=> '20261021',
 safeText:s=>String(s??'').replace(/[<>"']/g,''),
 appEl:{
  querySelector:selector=>selector==='[data-admin-cutover-summary]'?summaryNode:
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
assert.match(html,/data-action='adminCutoverExport'/);
assert.match(html,/data-action="adminCutoverExport"/);
assert.match(html,/data-admin-cutover-choice/);
console.log('Admin cutover selection UI passed: five-to-two selection, UID split, no cloud write, no migration');
