'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
require('../firebase-trash-review.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function renderMemberTrashPanel(){');
const end=html.indexOf('// Preflight never calls accountDiary.request',start);
assert.ok(start>0&&end>start,'member preview functions must be self-contained');
const id='shift-101-a',other='shift-202-b';
const first={id,date:'2026-10-20',startedAt:'08:00',endedAt:'17:00',
 records:[{kind:'ride',raw:{K:1000}}],settings:{}};
const localOnly={...first,id:other};
let uid='driver-A',readCalls=[],fail=false,blocked=false,notices=[];
const cloud={shifts:[{id,revision:3}]};
const state={
 window:{TAXIAPP_TRASH_REVIEW:globalThis.TAXIAPP_TRASH_REVIEW},
 memberDiary:()=>true,legacyDiary:()=>false,
 accountScope:{uid},accountScopeGeneration:2,memberTrashPreview:null,
 memberTrashPreviewBusy:false,memberTrashPreviewToken:0,memberTrashSelection:'',
 model:{shifts:[first,localOnly],prefs:{},activeId:null},
 render(){},toast:(...args)=>notices.push(args),
 renderAdminCutoverSelectionPanel:()=>'',safeText:s=>String(s??'')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;'),
 totals:()=>({meter:1000}),money:n=>String(n)+'円',
 shortTime:t=>t,
 accountDiary:{async request(action,fields={}){
  readCalls.push([action,fields]);
  if(fail)throw Error('offline');
  if(blocked){state.accountScope={uid:'driver-B'};state.accountScopeGeneration++;state.memberTrashPreviewToken++;state.memberTrashPreviewBusy=false;}
  if(action==='syncList')return cloud;
  if(action==='syncGet')return {id,revision:3,shift:first};
  throw Error('must not write');
 }}
};
vm.createContext(state);
vm.runInContext(html.slice(start,end),state);
const invoke=(fn,...args)=>vm.runInContext(fn,state)(...args);
const panel=()=>invoke('renderMemberTrashPanel');
(async()=>{
 assert.match(panel(),/ゴミ箱（検証中）/);
 assert.match(panel(),/まだ読み込んでいません/);
 assert.doesNotMatch(panel(),/data-action="deleteShift"/);
 const saved=JSON.stringify(state.model);
 await invoke('refreshMemberTrashPreview');
 assert.deepEqual(readCalls.map(x=>x[0]),['syncList','syncGet','syncList']);
 assert.equal(state.memberTrashPreview.rows.length,1);
 assert.match(panel(),/Firebase 1件/);
 assert.match(panel(),/端末だけにある乗務 1件/);
 assert.match(panel(),/shift-101-a/);
 assert.doesNotMatch(panel(),/data-action="trashMove"/);
 assert.equal(JSON.stringify(state.model),saved,'pure preview cannot change local duties');
 // An obsolete local preview may never show as current.
 state.model.shifts.push({...first,id:'shift-999-a'});
 assert.match(panel(),/端末の日報が変わりました/);
 state.model.shifts.pop();
 fail=true;
 await invoke('refreshMemberTrashPreview');
 assert.equal(state.memberTrashPreview,null,'failed read clears stale preview');
 assert.ok(notices.some(x=>String(x[0]).includes('中止')));
 fail=false;blocked=true;
 await invoke('refreshMemberTrashPreview');
 assert.equal(state.memberTrashPreview,null,'UID change must stop snapshot');
 assert.equal(state.memberTrashPreviewBusy,false);
 assert.equal(readCalls.every(x=>['syncList','syncGet'].includes(x[0])),true);
 console.log('Member read-only trash preview: same UID, revision scan, missing-local safety, no writes, account switch');
})().catch(e=>{console.error(e);process.exitCode=1;});
