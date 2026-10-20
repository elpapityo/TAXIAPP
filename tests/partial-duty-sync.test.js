'use strict';
const assert=require('node:assert/strict');
require('../bidirectional-sync.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const data={shifts:[
 {id:'shift-111-a',date:'2026-10-20',records:[],settings:{},startingOdo:'10'},
 {id:'shift-222-b',date:'2026-10-20',records:[],settings:{},startingOdo:'20'}
]};
const cloud=new Map(),calls=[],mem=new Map();
const request=async(action,args)=>{
 calls.push({action,...args});
 if(action==='syncList')return {shifts:[...cloud].map(([id,v])=>({id,revision:v.revision}))};
 if(action==='syncPut'){
  const record=JSON.parse(args.payload).shift,old=cloud.get(record.id);
  assert.equal(Number(args.baseRevision),old?.revision||0);
  const next={revision:(old?.revision||0)+1,shift:clone(record)};
  cloud.set(record.id,next);return {id:record.id,revision:next.revision};
 }
 if(action==='syncGet'){const row=cloud.get(args.shiftId);return {id:args.shiftId,revision:row.revision,shift:clone(row.shift)};}
 throw Error('Unexpected operation: '+action);
};
const engine=globalThis.TAXIAPP_BIDIRECTIONAL_SYNC.create({
 getEndpoint:()=>'/work-shifts',getModel:()=>data,
 getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
 localStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v)},
 request,
 replaceRemoteShift:async()=>{throw Error('unexpected cloud pull for unchanged duty');}
});
(async()=>{
 assert.equal(await engine.run(),true);
 assert.deepEqual([cloud.get('shift-111-a').revision,cloud.get('shift-222-b').revision],[1,1]);
 data.shifts[0].startingOdo='11';
 data.shifts[1].startingOdo='21';
 calls.length=0;
 assert.equal(await engine.run(['shift-111-a']),true);
 assert.equal(cloud.get('shift-111-a').revision,2);
 assert.equal(cloud.get('shift-222-b').revision,1,'unrelated duty must not upload');
 assert.deepEqual(calls.filter(c=>c.action==='syncPut').map(c=>JSON.parse(c.payload).shift.id),['shift-111-a']);
 assert.equal(await engine.run(['shift-222-b']),true);
 assert.equal(cloud.get('shift-222-b').shift.startingOdo,'21');
 // A conflicted duty remains blocked when a different duty is transmitted.
 data.shifts[0].startingOdo='12';
 cloud.get('shift-111-a').shift.startingOdo='remote-version';
 cloud.get('shift-111-a').revision++;
 assert.equal(await engine.run(['shift-111-a']),false);
 assert.equal(engine.status().conflicts.length,1);
 data.shifts[1].startingOdo='22';
 assert.equal(await engine.run(['shift-222-b']),false);
 assert.equal(engine.status().conflicts.length,1,'unrelated updates must never erase a conflict warning');
 assert.equal(cloud.get('shift-111-a').shift.startingOdo,'remote-version','conflicted remote must not be overwritten');
 console.log('Selective duty sync and conflict preservation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
