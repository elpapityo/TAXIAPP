'use strict';
/** Firestore print-only GAS synthetic rollback simulation. No live data. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','google-apps-script/FirestorePrintSourcesDraft.gs'),'utf8');
const ctx={safeCell_:x=>x,console};vm.createContext(ctx);vm.runInContext(src,ctx);
const names=['TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'];
const id='shift-1234567890123-demo';
function workbook(fail='',tamper=false){
 const state=new Map(),sheets=new Map();
 for(const name of names){
  const data=new Map(),header=ctx.TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name];
  header.forEach((value,i)=>data.set('1:'+(i+1),value));
  state.set(name,data);
  sheets.set(name,{
   getMaxColumns:()=>24,getMaxRows:()=>1200,
   getRange(r,c,h=1,w=1){
    const key=(y,x)=>(r+y)+':'+(c+x),read=()=>
     Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>data.get(key(y,x))??''));
    return {
     getValues:()=>read().map(row=>row.map(v=>v==='=1'?1:v)),
     getFormulas:()=>read().map(row=>row.map(v=>typeof v==='string'&&v.startsWith('=')?v:'')),
     setValues(rows){
      rows.forEach((row,y)=>row.forEach((v,x)=>data.set(key(y,x),v)));
      if(name===fail){
       fail='';
       if(tamper===true)data.set(key(0,1),'他端末による書換え');
       if(tamper==='formula')data.set(key(0,1),'=1');
       throw Error('合成の途中書込失敗');
      }
     },
     clearContent(){for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.delete(key(y,x));}
    };
   }
  });
 }
 return {state,sheets,ss:{getSheetByName:name=>sheets.get(name)||null}};
}
const packages=()=>names.map(name=>({
 name,width:ctx.TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name].length,
 rows:[[id,...Array.from({length:ctx.TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name].length-1},(_,i)=>i+1)]]
}));
const oldOriginal='TAXIAPP_同期原本';
{
 const book=workbook('TAXIAPP_乗務一覧');
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages()),/空白へ戻しました/);
 for(const name of names)
  assert.equal(book.state.get(name).get('2:1')??'','',name+' partial write must rollback');
}
{
 const book=workbook('TAXIAPP_決済内訳');
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages()),/空白へ戻しました/);
 for(const name of names)
  assert.equal(book.state.get(name).get('2:1')??'','',name+' partial write must rollback');
}
{
 const book=workbook('TAXIAPP_決済内訳',true);
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages()),/手作業で確認してください/);
 assert.equal(book.state.get('TAXIAPP_決済内訳').get('2:2'),'他端末による書換え',
  'do not erase third-party edits during rollback');
 assert.equal(book.state.get('TAXIAPP_印刷データ').get('2:1')??'','',
  'other sheets can still be safely rolled back');
}
{
 const book=workbook('TAXIAPP_決済内訳','formula');
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages()),/手作業で確認してください/);
 assert.equal(book.state.get('TAXIAPP_決済内訳').get('2:2'),'=1',
  'rollback never removes a concurrent formula that evaluates to the intended amount');
}
{
 const book=workbook();
 const status=ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages());
 assert.equal(status.id,id);assert.equal(status.changedSheets.length,4);
 const before=JSON.stringify([...book.state].map(([name,rows])=>[name,[...rows]]));
 const retry=ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages());
 assert.equal(retry.changedSheets.length,0,'identical retry is a no-op');
 assert.equal(JSON.stringify([...book.state].map(([name,rows])=>[name,[...rows]])),before);
}
{
 const book=workbook();
 let checked=0;
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages(),()=>{
  checked++;throw Error('合成のFirestore原本更新');
 }),/空白へ戻しました/);
 assert.equal(checked,1,'source checked before index is published');
 for(const name of names)
  assert.equal(book.state.get(name).get('2:1')??'','',name+' rolled back');
}
{
 const book=workbook(),first=packages()[0];
 book.sheets.get(first.name).getRange(2,1,1,first.width).setValues(first.rows);
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages()),/一部だけ残っています/);
 assert.equal(book.state.get('TAXIAPP_乗務一覧').get('2:1')??'','');
}
{
 const book=workbook();
 assert.throws(()=>ctx.firestorePrintPublishRowsDraft_(book.ss,id,packages().reverse()),/行形式が不正/);
}
console.log('Firestore印刷転送：途中失敗・第三者編集・原本更新・部分残存・書込順序を合成検証');
