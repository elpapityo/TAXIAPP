'use strict';
const assert=require('node:assert/strict');
const mem=new Map();
globalThis.localStorage={getItem:key=>mem.get(key)||null,setItem:(key,val)=>mem.set(key,val)};
require('../bidirectional-sync.js');
require('../cloud-sync-ui.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,message){
 for(let i=0;i<100;i++){if(fn())return;await wait(30);}
 throw Error('Timeout: '+message);
}
const duty={id:'shift-20261020-test',date:'2026-10-20',startedIso:'2026-10-20T08:00:00Z',
 records:[],settings:{},draft:null,breakSessions:[]};
const model={shifts:[duty]},cloud=new Map(),requests=[];
let suspended=null;
const request=async(action,args)=>{
 requests.push({action,args});
 if(action==='syncList')return {shifts:[...cloud].map(([id,v])=>({id,revision:v.revision}))};
 if(action==='syncPut'){
  const data=JSON.parse(args.payload).shift;
  if(suspended){const current=suspended;suspended=null;current.enter();await current.promise;}
  const prior=cloud.get(data.id);
  if(Number(args.baseRevision)!==(prior?.revision||0))throw Error('SYNC_CONFLICT');
  const item={revision:(prior?.revision||0)+1,shift:clone(data)};
  cloud.set(data.id,item);return {id:data.id,revision:item.revision};
 }
 if(action==='syncGet')throw Error('no download expected');
 throw Error('unrecognized action '+action);
};
const ui=globalThis.TAXIAPP_SYNC_UI({
 canSync:()=>true,canView:()=>false,
 configured:()=>true,prefs:()=>({syncMode:'on'}),
 getModel:()=>model,getPacket:s=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(s)}),
 endpoint:()=>'/same-google-app',request,
 setStatus:()=>{},render:()=>{},toast:()=>{},
 isEditing:()=>true,isSettings:()=>false,
 root:{querySelector:()=>null},onWriterSynced:async()=>{}
});
const puts=()=>requests.filter(x=>x.action==='syncPut').length;
(async()=>{
 ui.schedule(); // Baseline from fully loaded login state.
 duty.draft={id:'draft-1',kind:'ride',status:'draft',raw:{E:'乗',G:'08:10',K:''},meta:{}};
 ui.schedule();
 await until(()=>puts()===1,'ride start uploaded');
 await until(()=>ui.status().lastSyncAt>0,'first sync completed');
 const count=puts();
 duty.draft.raw.I='2';duty.draft.raw.J='1';duty.draft.raw.D='新大阪';duty.draft.raw.N='ク';
 ui.schedule();
 await wait(450);
 assert.equal(puts(),count,'passengers, destination and payment choice should not send');
 duty.draft.raw.K='1200';
 ui.schedule();
 await until(()=>puts()===count+1,'meter amount synchronized');
 await until(()=>!ui.status().busy,'meter sync finished');
 // Force a slow server acknowledgment; a second important change during the
 // first sync must be sent in a separate sync after it completes.
 let enter,release;
 const entered=new Promise(r=>{enter=r;});
 const promise=new Promise(r=>{release=r;});
 suspended={enter,promise};
 duty.draft.status='alighted';
 ui.schedule();
 await entered;
 assert.equal(puts(),count+2);
 duty.draft.raw.K='1800';
 ui.schedule();
 release();
 await until(()=>puts()===count+3,'follow-up update not dropped');
 await until(()=>cloud.get(duty.id)?.shift?.draft?.raw?.K==='1800','latest fare persisted');
 await until(()=>!ui.status().busy,'followup completed');
 assert.equal(cloud.get(duty.id).shift.draft.status,'alighted');
 const noExtra=puts();await wait(450);
 assert.equal(puts(),noExtra,'must not poll or loop while idle');
 console.log('Event-driven live sync tests passed: ignored fields, money sync, in-flight edit replay.');
})().catch(e=>{console.error(e);process.exitCode=1;});
