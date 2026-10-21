'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const values=new Map();
function sheet(name){
 if(!values.has(name))values.set(name,[]);
 const rows=values.get(name);
 return {
  name,hideSheet(){},
  getLastRow(){return rows.length;},
  getRange(row,col,height=1,width=1){
   return {
    getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>rows[row-1+i]?.[col-1+j]??'')),
    setValues:matrix=>{matrix.forEach((array,i)=>{
     const pos=row-1+i;
     if(!rows[pos])rows[pos]=[];
     array.forEach((v,j)=>{rows[pos][col-1+j]=v;});
    });}
   };
  }
 };
}
const ss={
 getSheetByName:name=>values.has(name)?sheet(name):null,
 insertSheet:name=>sheet(name)
};
const context={
 SpreadsheetApp:{openById:()=>ss},
 Utilities:{formatDate:()=> '2026-10-17 10:00:00'},
 HtmlService:{createHtmlOutput:html=>({html,setXFrameOptionsMode(){return this}}),XFrameOptionsMode:{ALLOWALL:1}},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'x'.repeat(64)})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
 console,JSON,Array,Object,Number,String,Date,Math,RegExp,Error,Set
};
vm.createContext(context);vm.runInContext(src,context);
context.savePacket_=(packet)=>{
 const originals=sheet('TAXIAPP_同期原本');
 if(originals.getLastRow()===0)originals.getRange(1,1,1,3).setValues([['ID','更新','分割数']]);
 const id=packet.shift.id,existing=values.get('TAXIAPP_同期原本').findIndex((x,i)=>i>0&&x&&x[0]===id);
 const at=existing>0?existing+1:originals.getLastRow()+1;
 const json=JSON.stringify(packet.shift);
 originals.getRange(at,1,1,4).setValues([[id,'2026-10-17 10:00',1,json]]);
 return '保存';
};
function nativeGet(id){
 const data=values.get('TAXIAPP_同期原本')?.find((x,i)=>i>0&&x[0]===id);
 return JSON.parse(data[3]);
}
context.loadShift_=(ss,id)=>nativeGet(id);
const id='shift-123-abc';
const payload={kind:'TAXIAPP_SHIFT_V1',shift:{id,date:'2026-10-17',records:[]}};
const result=context.syncPutV2_(payload,'0');
assert.equal(result.revision,1);
assert.equal(context.syncListV2_().shifts.length,1);
assert.equal(context.syncGetV2_(id).shift.date,'2026-10-17');
assert.throws(()=>context.syncPutV2_(payload,'0'),/SYNC_CONFLICT:1/);
assert.equal(context.syncPutV2_(payload,'1').revision,2);
assert.equal(context.syncRevisionV2_(ss,id).revision,2);
const legacyId='shift-456-def';
sheet('TAXIAPP_同期原本').getRange(4,1,1,4).setValues([[legacyId,'旧',1,'{}']]);
assert.equal(context.syncRevisionV2_(ss,legacyId).revision,1);
assert.equal(context.syncRevisionV2_(ss,legacyId).managed,false);
assert.equal(context.syncRevisionV2_(ss,'shift-999-xxx').revision,0);
const legacy={kind:'TAXIAPP_SHIFT_V1',shift:{id:'shift-789-legacy',date:'2026-10-17',records:[]}};
const message=JSON.stringify(legacy);
const param={parameter:{key:'x'.repeat(64),action:'sync',nonce:'n',payload:message,origin:'https://elpapityo.github.io'}};
const response=context.doPost(param);
assert.match(response.html,/"ok":true/,response.html);
assert.equal(context.syncRevisionV2_(ss,legacy.shift.id).revision,1);
assert.equal(context.syncRevisionV2_(ss,legacy.shift.id).managed,false);
context.doPost(param);
assert.equal(context.syncRevisionV2_(ss,legacy.shift.id).revision,2);
context.syncPutV2_(legacy,'2');
assert.equal(context.syncRevisionV2_(ss,legacy.shift.id).revision,3);
assert.equal(context.syncRevisionV2_(ss,legacy.shift.id).managed,true);
context.doPost(param);
assert.equal(context.syncRevisionV2_(ss,legacy.shift.id).revision,3,'legacy must not overwrite managed v2');

const archived=JSON.stringify(nativeGet(id));
const trash=context.syncSetTrashV2_(id,2,true);
assert.equal(trash.revision,3);
assert.equal(trash.deleted,true);
assert.equal(context.syncRevisionV2_(ss,id).managed,true);
assert.equal(context.syncListV2_().shifts.find(x=>x.id===id).deleted,true);
assert.equal(JSON.stringify(nativeGet(id)),archived,'Google日報原本を消さずに論理削除する');
assert.throws(()=>context.syncGetV2_(id),/ゴミ箱/);
assert.throws(()=>context.syncPutV2_(payload,'3'),/削除済み/);
assert.throws(()=>context.syncSetTrashV2_(id,2,false),/SYNC_CONFLICT:3/);
const restore=context.syncSetTrashV2_(id,3,false);
assert.equal(restore.deleted,false);
assert.equal(restore.revision,4);
assert.equal(context.syncGetV2_(id).shift.id,id);
const trashPost=context.doPost({parameter:{
 key:'x'.repeat(64),action:'syncTrash',shiftId:id,baseRevision:'4',
 nonce:'trash-test',origin:'https://elpapityo.github.io'}});
assert.match(trashPost.html,/"ok":true/);
assert.equal(context.syncRevisionV2_(ss,id).revision,5);
assert.equal(context.syncRevisionV2_(ss,id).deleted,true);
assert.equal(JSON.stringify(nativeGet(id)),archived);
console.log('Google日報クラウド：ゴミ箱と復元をCASで処理し、原本・印刷データは保持');
assert.match(src,/TAXIAPP_ANDROID_ORIGIN\s*=\s*'https:\/\/appassets\.androidplatform\.net'/);
assert.match(src,/if\(version\.managed\)throw Error/);
assert.match(src,/if\(current\.revision!==base\)/);
assert.match(src,/action==='syncList'/);
assert.match(src,/action==='syncGet'/);
assert.match(src,/action==='syncPut'/);
console.log('Server sync API tests passed: legacy migration, CAS, list/get, write revisions, Android origin and unmanaged legacy guard.');
