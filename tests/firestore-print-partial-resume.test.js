'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync('google-apps-script/FirestorePrintSourcesDraft.gs','utf8');
const now='2026-10-23T04:17:59Z';
const clock=(value)=>new Date('2026-10-23T'+String(Number(value.slice(0,2))-9).padStart(2,'0')+':'+value.slice(3)+'Z');
const formatter=(value,zone,format)=>{
 assert.equal(zone,'Asia/Tokyo');
 if(format==='HH:mm:ss'||format==='HH:mm')
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour12:false,
    hour:'2-digit',minute:'2-digit',...(format==='HH:mm:ss'?{second:'2-digit'}:{})}).format(value);
 if(format==='yyyy-MM-dd')
  return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
 if(format==='yyyy-MM-dd HH:mm:ss')return '2026-10-23 13:17:59';
 throw Error('unknown format');
};
const tables=['TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'];
const id='shift-1792728540000',uid='synthetic-owner',store=new Map(),journal=new Map();
let modifications=0;
const makeSheet=name=>{
 const map=new Map();store.set(name,map);
 const access=(r,c)=>r+':'+c;
 return {
  getMaxRows:()=>200,getMaxColumns:()=>24,
  getLastRow:()=>Math.max(1,...[...map.keys()].map(x=>Number(x.split(':')[0]))),
  getRange:(r,c,height=1,width=1)=>({
   getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>map.get(access(r+i,c+j))??'')),
   getFormulas:()=>Array.from({length:height},()=>Array(width).fill('')),
   setValues:rows=>{
    modifications++;
    for(let i=0;i<rows.length;i++)for(let j=0;j<rows[i].length;j++){
     const column=c+j;
     let value=rows[i][j];
     if(name==='TAXIAPP_印刷データ'&&[6,7].includes(column)&&/^\d{2}:\d{2}:\d{2}$/.test(String(value)))
      value=clock(value);
     map.set(access(r+i,c+j),value);
    }
   },
   clearContent:()=>{modifications++;for(let i=0;i<height;i++)for(let j=0;j<width;j++)map.delete(access(r+i,c+j))}
  })
 };
};
const sheets=Object.fromEntries(tables.map(name=>[name,makeSheet(name)]));
const workbook={
 getSheetByName:n=>sheets[n]||null,
 insertSheet:n=>{if(sheets[n])throw Error('duplicate');return sheets[n]=makeSheet(n);}
};
const ctx={Object,Array,JSON,String,Number,Boolean,Date,Error,RegExp,console,
 TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS:undefined,
 PropertiesService:{getScriptProperties:()=>({
  getProperty:key=>journal.get(key)||null,
  setProperty:(key,value)=>journal.set(key,value),
  deleteProperty:key=>journal.delete(key)
 })},
 Utilities:{formatDate:formatter,computeDigest:(_algo,input)=>[...crypto.createHash('sha256').update(input).digest()],
   DigestAlgorithm:{SHA_256:'SHA-256'},Charset:{UTF_8:'UTF-8'},
   base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
ctx.safeCell_=x=>x==null?'':x;
const headings=ctx.TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS;
for(const name of tables)
 headings[name].forEach((x,i)=>store.get(name).set('1:'+(i+1),x));
const print=[
 [id,1,'乗','現',5200,'13:17:59','13:21:07','北本町1','北本町1','',0,0,520,'2026-10-23T04:22:33.815Z'],
 [id,2,'U','チ',5800,'13:44:53','13:48:45','北本町1','北本町1','',0,0,0,'2026-10-23T04:49:10.855Z']
];
const blanks=(name,rows)=>({name,rows,width:headings[name].length});
const batches=[
 blanks(tables[0],print),
 blanks(tables[1],[[id,1,1,'現',5200,'',5200,0,520,0,'主金種']]),
 blanks(tables[2],[[id,'meter',11000,'TAXIAPP 計算済み','2026-10-23 13:55:00']]),
 blanks(tables[3],[[id,'2026-10-23','2026-10-23 13:05:00','2026-10-23 13:55:00','', '', '',2,11000,520,0,0,5200,0,5200,'2026-10-23 13:55:00','Firestore印刷済',0,120]])
];
const seedPartial=()=>{
 print.forEach((row,i)=>row.forEach((value,j)=>{
  store.get('TAXIAPP_印刷データ').set((i+2)+':'+(j+1),
   (j===5||j===6)?clock(value):value);
 }));
};
seedPartial();
assert.equal(ctx.firestorePrintSameRowsDraft_(
 sheets['TAXIAPP_印刷データ'].getRange(2,1,2,14).getValues(),print),true,
 'same actual seconds represented as native Sheets Date must match text');
let sourceChecks=0;
const before=JSON.stringify([...store.get('TAXIAPP_印刷データ')]);
const result=ctx.firestorePrintPublishVersionedDraft_(workbook,id,batches,7,uid,()=>sourceChecks++);
assert.equal(result.id,id);
assert.equal(sourceChecks,1);
assert.deepEqual(Array.from(result.changedSheets),tables.slice(1));
assert.equal(JSON.stringify([...store.get('TAXIAPP_印刷データ')]),before,
 'previous valid partial rows must not be modified, cleared or duplicated');
for(const name of tables)assert.ok(store.get(name).has('2:1'),name+' populated');
const record=JSON.parse(journal.get('TAXIAPP_FS_PRINT_REV1_'+uid+'_'+id));
assert.equal(record.state,'ready');assert.equal(record.revision,7);
const match=ctx.firestorePrintVerifyRowsDraft_(workbook,id,batches);
assert.equal(match.readOnly,true);
// An unverified first import with stale partial rows may be recovered ONLY
// after preserving all original data in a read-back verified audit sheet.
journal.clear();store.get('TAXIAPP_印刷データ').set('2:8','別の乗車地');
for(const name of tables.slice(1)){
 for(const key of [...store.get(name).keys()])
  if(!key.startsWith('1:'))store.get(name).delete(key);
}
const rescue=ctx.firestorePrintPublishVersionedDraft_(workbook,id,batches,8,uid,()=>sourceChecks++);
assert.equal(rescue.id,id);
assert.equal(JSON.parse(journal.get('TAXIAPP_FS_PRINT_REV1_'+uid+'_'+id)).revision,8);
assert.equal(store.get('TAXIAPP_印刷データ').get('2:8'),'北本町1');
const archive=store.get('TAXIAPP_転送中断保護');
assert.ok(archive,'old partial rows must be preserved in new audit sheet');
assert.equal(archive.get('1:1'),'保護日時');
assert.equal(archive.get('2:3'),'TAXIAPP_印刷データ');
assert.equal(JSON.parse(archive.get('2:5'))[7],'別の乗車地',
 'old source contents survive in the verified backup without being lost');
assert.equal(JSON.parse(archive.get('3:5'))[0],id);
assert.equal(ctx.firestorePrintVerifyRowsDraft_(workbook,id,batches).readOnly,true);
// Do not replace anything if a published index exists, even if a journal was
// erased or missing. A completed source must never be treated as abandoned.
journal.clear();
store.get('TAXIAPP_印刷データ').set('2:8','疑わしい別の乗車地');
const beforeUnsafe=modifications,archiveRows=archive.size;
assert.throws(()=>ctx.firestorePrintPublishVersionedDraft_(workbook,id,batches,9,uid,()=>sourceChecks++),
 /確定済み印刷元または保護対象不明/);
assert.equal(modifications,beforeUnsafe);
assert.equal(archive.size,archiveRows);
console.log('時刻型変換、未完了明細の退避・再取得・再開と確定済みデータ保護を確認');
