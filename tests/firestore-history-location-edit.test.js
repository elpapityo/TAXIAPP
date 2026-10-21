'use strict';
/* 過去日報の孤立編集：現在乗務を変更しない・本人UID・CAS・未保存控え */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const begin=source.indexOf('function historyEditStorageKey(');
const end=source.indexOf('function renderHistory(_shift)',begin);
assert.ok(begin>0&&end>begin,'過去日報の独立編集処理が必要です');
const original={id:'shift-1792100000000-old',date:'2026-10-20',
 records:[{id:'ride-1',kind:'ride',status:'complete',raw:{AL:'旧乗車地',AM:'旧降車地',K:'2200'}}],
 settings:{},endedIso:'2026-10-20T13:00:00Z'};
const active={id:'shift-1792300000000-current',records:[],settings:{},startedIso:'2026-10-22T08:00:00Z'};
const server=new Map([[original.id,{revision:2,shift:JSON.parse(JSON.stringify(original))}]]);
const storage=new Map();
const clone=x=>JSON.parse(JSON.stringify(x));
const fields={historyEditPickup:{value:'新乗車地'},historyEditDropoff:{value:'新降車地'}};
const ctx={
 accountScope:{uid:'user-A',adminFirestore:false},
 accountScopeGeneration:1,historyCloudEpoch:1,
 historyCloudUid:'user-A',historyCloudDate:'2026-10-20',
 historyCloudRows:[{id:original.id,revision:2,shift:clone(original)}],
 historyCloudShifts:[clone(original)],historyLocationEdit:null,historyShiftId:'',
 historyCloudMessage:'',model:{shifts:[active],activeId:active.id},
 accountDiary:{ready:()=>true,async request(action,payload){
  assert.equal(action,'syncPut');
  const shift=JSON.parse(payload.payload).shift;
  assert.equal(shift.id,original.id,'現在の乗務は送信しない');
  const item=server.get(shift.id);
  if(item.revision!==payload.baseRevision)throw Error('SYNC_CONFLICT:'+item.revision);
  item.revision++;item.shift=clone(shift);
  return {id:shift.id,revision:item.revision,confirmed:true};
 }},
 memberDiary:()=>true,canEditNow:()=>true,
 localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},
 MAX_RECORDS:60,
 makeDraft:(_shift,kind,when)=>({kind,status:'draft',id:'new-temporary',raw:{
  A:2,E:'乗',G:'10:00',M:'10:10',K:'1800',N:'現',AL:'',AM:'',F:'1',L:'3'
 },meta:{serviceDate:'2026-10-20',createdAt:when.toISOString()}}),
 validateDraft:()=>[],validatePaymentBreakdown:()=>[],deriveRaw:row=>({...row.raw}),
 document:{getElementById:id=>fields[id]},
 deepCopy:clone,render:()=>{},toast:()=>{},safeText:s=>String(s),
 confirm:()=>true,googleShiftPacket:()=>{throw Error('一般利用者は印刷計算を行わない');},
 Number,JSON,String,encodeURIComponent,Error,Map
};
vm.createContext(ctx);
vm.runInContext(source.slice(begin,end),ctx);
(async()=>{
 ctx.startHistoryLocationEdit(original.id,'ride-1');
 assert.equal(ctx.historyLocationEdit.baseRevision,2);
 assert.equal(storage.size,1,'編集控えを即座に端末へ保護');
 await ctx.commitHistoryLocationEdit();
 assert.equal(ctx.historyLocationEdit,null);
 assert.equal(server.get(original.id).revision,3);
 assert.equal(server.get(original.id).shift.records[0].raw.AL,'新乗車地');
 assert.equal(server.get(original.id).shift.records[0].raw.AM,'新降車地');
 assert.equal(server.get(original.id).shift.records[0].raw.K,'2200','金額は一切変更しない');
 assert.equal(ctx.model.shifts.length,1);
 assert.equal(ctx.model.shifts[0].id,active.id,'現在の乗務は維持');
 assert.equal(storage.size,0,'読戻し確認後だけ修正控えを整理');
 // 競合の場合：保存先と作業控えの双方を保護する。
 ctx.historyCloudRows=[{id:original.id,revision:3,shift:clone(server.get(original.id).shift)}];
 ctx.startHistoryLocationEdit(original.id,'ride-1');
 fields.historyEditPickup.value='再修正案';
 server.get(original.id).revision=4; // 別端末による変更
 await ctx.commitHistoryLocationEdit();
 assert.equal(server.get(original.id).shift.records[0].raw.AL,'新乗車地');
 assert.equal(ctx.historyLocationEdit.al,'再修正案');
 assert.equal(storage.size,1,'競合した修正控えは削除しない');
 assert.match(ctx.historyLocationEdit.message,/SYNC_CONFLICT/);
 // 端末に同じ乗務があるときは直接編集を止める。
 ctx.model.shifts.push(clone(original));
 assert.throws(()=>ctx.startHistoryLocationEdit(original.id,'ride-1'),/未同期/);
 ctx.model.shifts.pop();
 ctx.historyCloudRows=[{id:original.id,revision:4,shift:clone(server.get(original.id).shift)}];
 ctx.historyLocationEdit=null;
 ctx.startHistoryNewRecord('ride');
 assert.equal(ctx.historyLocationEdit.addRecord,true,'過去の営業追加は独立控え');
 assert.equal(storage.size>=2,true,'作成途中は端末に保存');
 fields.historyEditPickup.value='新規の乗車地';
 fields.historyEditDropoff.value='新規の降車地';
 await ctx.commitHistoryLocationEdit();
 assert.equal(server.get(original.id).shift.records.length,2,'既存原本に1営業を追加');
 assert.equal(server.get(original.id).shift.records[1].raw.K,'1800');
 assert.equal(ctx.model.shifts.length,1,'現在乗務は不変');
 const newId=server.get(original.id).shift.records[1].id;
 ctx.markHistoryRecordRemoval(newId);
 assert.equal(ctx.historyLocationEdit.removeRecord,true);
 await ctx.commitHistoryLocationEdit();
 assert.equal(server.get(original.id).shift.records.length,1,'対象営業だけ削除');
 assert.equal(server.get(original.id).shift.records[0].raw.A,1);
 assert.equal(ctx.model.shifts[0].id,active.id,'営業削除後も現在乗務を維持');
 console.log('Firestore過去日報：新規1営業追加・削除・CAS・端末原本分離を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});
