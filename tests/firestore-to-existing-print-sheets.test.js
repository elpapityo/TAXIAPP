'use strict';
/* Firestore OWNER original -> existing Sheets 4 sources, synthetic only */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const load=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const script=[load('google-apps-script/Code.gs'),
 load('google-apps-script/FirestorePrintPullDraft.gs'),
 load('google-apps-script/FirestorePrintSourcesDraft.gs')].join('\n');
const names=['TAXIAPP_乗務一覧','TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計'];
const head={
 'TAXIAPP_乗務一覧':['乗務ID','乗務日','出庫日時','入庫日時','運転者','社員番号','車両番号','営業件数','メーター売上','障がい者割引','GO手数料','Uber配車手数料','現金納金','ETC','総入金額','更新日時','転送状態','出庫km','入庫km'],
 'TAXIAPP_印刷データ':['乗務ID','営業番号','配車区分','支払表示','表示金額','乗車時刻','降車時刻','乗車地','降車地','GO手数料確認','実車高速','空車高速','障がい者割引','精算完了日時'],
 'TAXIAPP_決済内訳':['乗務ID','営業番号','決済内訳番号','支払金種','支払金額','アプリ決済額','現金受取','高速料金','割引額','手数料','備考'],
 'TAXIAPP_集計':['乗務ID','種類','金額','計算根拠','更新日時']
};
const values=new Map();
for(const name of [...names,'TAXIAPP_同期原本','TAXIAPP_乗務保管',
 'TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁']){
 values.set(name,new Map());
 if(head[name])head[name].forEach((v,i)=>values.get(name).set('1:'+ (i+1),v));
}
values.get('TAXIAPP_同期原本').set('2:1','shift-999-legacy');
values.get('補助簿印刷用').set('1:1','=DO_NOT_CHANGE()');
values.get('補助簿印刷用_2頁').set('1:1','=SECOND_PAGE()');
values.get('TAXIAPP_乗務一覧').set('2:20','=DO_NOT_CHANGE_SELECTOR()');
const key=(r,c)=>r+':'+c;
class FakeSheet{
 constructor(name){this.name=name;this.data=values.get(name);}
 getName(){return this.name;}
 getMaxRows(){return 1200;}
 getMaxColumns(){return 24;}
 getLastRow(){return Math.max(1,...[...this.data.keys()].map(k=>Number(k.split(':')[0])));}
 getRange(r,c,n=1,m=1){
  const data=this.data;
  return {
   getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>data.get(key(r+i,c+j))??'')),
   getFormulas:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>{
     const v=data.get(key(r+i,c+j));return typeof v==='string'&&v[0]==='='?v:'';})),
   setValues:rows=>{assert.equal(rows.length,n);for(let i=0;i<n;i++){
    assert.equal(rows[i].length,m);for(let j=0;j<m;j++)data.set(key(r+i,c+j),rows[i][j]);}},
   clearContent:()=>{for(let i=0;i<n;i++)for(let j=0;j<m;j++)data.delete(key(r+i,c+j));}
  };
 }
}
const sh=Object.fromEntries([...values.keys()].map(n=>[n,new FakeSheet(n)]));
const ss={getSheetByName:n=>sh[n]||null};
const id='shift-1792600000000-synthetic',uid='ownerSyntheticUID',project='taxiapp-test-project';
const shift={id,date:'2026-10-21',startedAt:'09:00',endedAt:'11:00',
 startedIso:'2026-10-21T00:00:00.000Z',endedIso:'2026-10-21T02:00:00.000Z',
 startingOdo:'0',endingOdo:'10',records:[{kind:'ride',status:'complete',
 raw:{A:1,E:'G',N:'現',K:1000,G:'09:15',M:'09:25',AL:'【合成】乗車',AM:'【合成】降車',AQ:200,W:0,AR:0},
 amounts:{meter:1000,goFee:200,uberSurcharge:0,realToll:0,discount:0},
 payments:[{type:'現',received:700,company:700},{type:'Q',received:500,company:500}],
 meta:{settledIso:'2026-10-21T00:25:00.000Z'}}],settings:{},
 __taxiPrintSummary:{meter:1000,discount:0,goFee:200,uberSurcharge:0,
  cashRemittance:700,etcRemittance:0,totalRemittance:700,
  realToll:0,emptyToll:0,cancellation:0,tip:0,reservation:0,
  cashReceived:700,paymentAllocated:1200}};
const toField=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:
 typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?
 (Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):
 Array.isArray(v)?{arrayValue:{values:v.map(toField)}}:
 {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,toField(x)]))}};
const payload={format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:1,shift};
const doc=(which=id,what=payload)=>({name:'projects/'+project+'/databases/(default)/documents/privateDuties/'+uid+'/shifts/'+which,
 fields:Object.fromEntries(Object.entries(what).map(([k,x])=>[k,toField(x)]))});
const fetches=[];
const ctx={Date,JSON,Object,Number,Error,RegExp,String,Array,console,
 SpreadsheetApp:{openById:()=>ss},PropertiesService:{getScriptProperties:()=>({
  getProperty:k=>({'TAXIAPP_FIRESTORE_PROJECT_ID':project,
    'TAXIAPP_FIRESTORE_OWNER_UID':uid})[k]||''
 })},
 ScriptApp:{getOAuthToken:()=> 'synthetic-oauth'},
 UrlFetchApp:{fetch:(url,opts)=>{
  fetches.push({url,auth:opts.headers.Authorization});
  const reply=url.includes('?pageSize=100')?{documents:[doc()]}:doc();
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(reply)};
 }},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
 Utilities:{formatDate:()=> '2026-10-21 11:00:00'}};
vm.createContext(ctx);vm.runInContext(script,ctx);
const original=values.get('TAXIAPP_同期原本').get('2:1');
const amount=shift.__taxiPrintSummary.cashRemittance;
const result=ctx.firestorePrintSelectedDutyDraft_(id);
assert.match(result,/保存完了/);
assert.equal(shift.__taxiPrintSummary.cashRemittance,amount,'app finances stay authoritative');
assert.equal(values.get('TAXIAPP_同期原本').size,1);
assert.equal(values.get('TAXIAPP_同期原本').get('2:1'),original);
assert.equal(values.get('補助簿印刷用').get('1:1'),'=DO_NOT_CHANGE()');
assert.equal(values.get('補助簿印刷用_2頁').get('1:1'),'=SECOND_PAGE()');
assert.equal(values.get('TAXIAPP_乗務一覧').get('2:20'),'=DO_NOT_CHANGE_SELECTOR()');
assert.equal(values.get('TAXIAPP_乗務一覧').get('2:1'),id);
assert.equal(values.get('TAXIAPP_乗務一覧').get('2:9'),1000);
assert.equal(values.get('TAXIAPP_乗務一覧').get('2:13'),700);
assert.equal(values.get('TAXIAPP_印刷データ').get('2:5'),1000);
assert.equal(values.get('TAXIAPP_集計').get('6:3'),700);
assert.equal([...values.get('TAXIAPP_決済内訳').values()].filter(v=>v===500).length,1);
assert.ok(fetches.length===2,'read before lock and revalidate exact Firestore source');
assert.ok(fetches.every(f=>f.url.includes('/privateDuties/'+uid+'/shifts/'+id)&&f.auth==='Bearer synthetic-oauth'));
assert.throws(()=>ctx.firestorePrintSelectedDutyDraft_(id),/同じ乗務ID/,'do not overwrite without revision recovery');
assert.throws(()=>ctx.firestorePrintSelectedDutyDraft_('invalid'),/乗務ID/);
assert.throws(()=>ctx.firestorePrintSelectedDutyDraft_('shift-999-legacy'),/同じ乗務/,
 'same-ID legacy original must not be automatically converted');
assert.match(load('index.html'),/ADMIN_FIRESTORE_CUTOVER_ENABLED=false/,
 'real production cutover stays OFF until separate authorization');
assert.match(load('index.html'),/__taxiPrintSummary=deepCopy\(packet.summary\)/);
assert.doesNotMatch(load('google-apps-script/FirestorePrintPullDraft.gs'),/function doPost\(/);
console.log('Firestore owner print pull PASS: exact UID, same source recheck, four print sources only, no original/selector/formula writes.');
