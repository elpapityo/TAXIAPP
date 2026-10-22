'use strict';
// Firestore lightweight listing and UID-bound local cache must never accept stale history.
const assert=require('node:assert/strict');
require('../account-diary-store.js');
const root=globalThis.TAXIAPP_ACCOUNT_DIARY;
const uid='owner-cache-test',id='shift-1792700000000-cache';
let revision=1,updated='2026-10-23T00:01:00Z',getCount=0,networkDown=false;
let shift={id,date:'2026-10-23',startedIso:'2026-10-23T01:00:00.000Z',
 endedAt:'03:00:00',records:[],settings:{},__taxiPrintSummary:{records:0,meter:0}};
const enc=v=>typeof v==='number'?{integerValue:String(v)}:
 typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)};
const nested=(fields)=>({mapValue:{fields}});
function document(){
 return {name:'projects/taxiapp-test/databases/(default)/documents/privateDuties/'+uid+'/shifts/'+id,
 updateTime:updated,fields:{
  format:enc('TAXIAPP_PRIVATE_SHIFT_V1'),revision:enc(revision),trashed:enc(false),
  shift:nested({id:enc(id),date:enc(shift.date),startedIso:enc(shift.startedIso),
   endedAt:enc(shift.endedAt),__taxiPrintSummary:nested({
    records:enc(shift.__taxiPrintSummary.records),
    meter:enc(shift.__taxiPrintSummary.meter)})})
 }};
}
const requests=[];
globalThis.fetch=async(url,opts={})=>{
 requests.push({url:String(url),opts});
 if(networkDown)return {ok:false,status:503};
 assert.equal(opts.headers.Authorization,'Bearer owner-token');
 if(String(url).includes(':runQuery')){
  const body=JSON.parse(opts.body);
  assert.equal(body.structuredQuery.where.fieldFilter.value.stringValue,'2026-10-23');
  assert.ok(!JSON.stringify(body.structuredQuery.select).includes('"shift.records"'));
  return {ok:true,json:async()=>[{document:document()}]};
 }
 assert.ok(String(url).includes('mask.fieldPaths='));
 assert.ok(!String(url).includes('shift.records'));
 return {ok:true,json:async()=>({documents:[document()]})};
};
const f={
 collection(){throw Error('一覧全件のSDK取得は禁止');},
 doc(_db,_a,_uid,_b,shiftId){return shiftId;},
 async getDocFromServer(shiftId){getCount++;assert.equal(shiftId,id);
  return {exists:()=>true,data:()=>({
   format:'TAXIAPP_PRIVATE_SHIFT_V1',revision,trashed:false,
   shift:JSON.parse(JSON.stringify(shift))})};},
 query(){throw Error('本文全件SDKクエリは禁止');},
 where(){throw Error('本文全件SDKクエリは禁止');}
};
const auth={currentUser:{uid,getIdToken:async()=> 'owner-token'}};
const store=root.create();
store.bind({uid},{f,db:{app:{options:{projectId:'taxiapp-test'}}},auth,admin:false});
(async()=>{
 const listing=await store.request('syncList',{});
 assert.equal(listing.shifts.length,1);
 assert.equal(listing.shifts[0].recordsCount,0);
 assert.equal(listing.shifts[0].meter,0);
 assert.equal(getCount,0,'一覧は原本本文をダウンロードしない');
 let history=await store.request('syncHistoryDate',{date:'2026-10-23'});
 assert.equal(history.shifts[0].shift.records.length,0);
 assert.equal(getCount,1);
 history=await store.request('syncHistoryDate',{date:'2026-10-23'});
 assert.equal(getCount,1,'同じサーバー更新番号・更新時刻ならキャッシュから取得');
 shift={...shift,records:[{id:'r1'}],__taxiPrintSummary:{records:1,meter:1100}};
 revision=2;updated='2026-10-23T00:02:00Z';
 history=await store.request('syncHistoryDate',{date:'2026-10-23'});
 assert.equal(getCount,2,'更新番号が変わると全文再取得');
 assert.equal(history.shifts[0].shift.records.length,1);
 assert.equal(history.shifts[0].revision,2);
 updated='2026-10-23T00:03:00Z';
 await store.request('syncHistoryDate',{date:'2026-10-23'});
 assert.equal(getCount,3,'更新時刻の変化もキャッシュを無効化');
 networkDown=true;
 await assert.rejects(()=>store.request('syncHistoryDate',{date:'2026-10-23'}),/HTTP 503/,
  '通信障害で古いキャッシュを最新として返さない');
 networkDown=false;
 assert.equal((await store.request('syncList')).shifts[0].recordsCount,1);
 assert.ok(requests.some(r=>r.url.includes(':runQuery')));
 console.log('本人UID別キャッシュ：軽量一覧、同版再利用、改版再取得、通信失敗時停止を確認');
})().catch(e=>{console.error(e);process.exitCode=1;});
