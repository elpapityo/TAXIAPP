const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../gps-cloud-budget-store');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gps-budget-')),file=path.join(dir,'budget.sqlite');
 let db=new DatabaseSync(file),time=1000000,failWrites=false;
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const storage={sql:{},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 // DO sql.execと同じくINSERT/DDLも呼出時点で実行する。
 storage.sql.exec=(query,...args)=>{
  if(failWrites&&query.startsWith('INSERT'))throw Error('合成保存失敗');
  const stmt=db.prepare(query);const rows=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);
  return {toArray:()=>rows};
 };
 const options={storage,resources:{requests:{limit:1000,reserve:500}},costs:{send:{requests:1},list:{requests:1}},now:()=>time};
 const sample=used=>({scope:'account-and-project',observedAtMs:time,windows:{requests:{used,resetAtMs:86400000}}});
 return {open:()=>create(options),sample,advance:n=>time+=n,
  reopen(){db.close();db=new DatabaseSync(file);},fail:v=>failWrites=v,
  corrupt(){db.exec("UPDATE gps_cloud_budget SET payload = 'broken'");},
  options};
}
test('実SQLite：同一保存先の別インスタンスで本人別間隔と共通予算を共有し、再起動後も保持',t=>{
 const f=fixture(t),a=f.open(),b=f.open();assert.equal(a.update(f.sample(0)).updated,true);
 assert.equal(a.admit('send').reason,'actor-required');
 assert.equal(a.admit('send','driverA').allowed,true);
 assert.equal(b.admit('send','driverA').allowed,false);
 assert.equal(b.admit('send','driverB').allowed,true,'別の本人の初回通信を間引かない');
 f.reopen();const restarted=f.open();assert.equal(restarted.admit('send','driverA').allowed,false);
 f.advance(1);restarted.update(f.sample(473));
 assert.equal(restarted.admit('list','driverC').allowed,false,'再起動前2回分と新使用量473で95%に達する');
});
test('実SQLite：複数本人の同時要求で共通予約残量を超過させない',async t=>{
 const f=fixture(t);f.open().update(f.sample(474));
 const results=await Promise.all(Array.from({length:10},(_,i)=>Promise.resolve().then(()=>f.open().admit('send','driver'+i))));
 assert.equal(results.filter(r=>r.allowed).length,1);
 f.reopen();assert.equal(f.open().admit('send','newDriver').allowed,false);
});
test('実SQLite：永続化失敗では許可応答を返さず、壊れた予算を再初期化しない',t=>{
 const f=fixture(t),store=f.open();store.update(f.sample(0));f.fail(true);
 assert.equal(store.admit('send','driver').reason,'budget-storage-unavailable');
 f.fail(false);assert.equal(store.admit('send','driver').allowed,true,'失敗した予約では実通信を許可していない');
 f.corrupt();assert.equal(f.open().admit('send','driverB').allowed,false);
 assert.equal(f.open().update(f.sample(0)).reason,'budget-storage-unavailable');
});
test('実SQLite：利用量更新不能・設定変更時も既存消費を捨てずに休止',t=>{
 const f=fixture(t),store=f.open();store.update(f.sample(0));store.invalidate();
 assert.equal(f.open().admit('send','driver').allowed,false);
 f.advance(1);assert.equal(store.update(f.sample(0)).updated,true);
 const changed=create({...f.options,resources:{requests:{limit:2000,reserve:500}}});
 assert.equal(changed.admit('send','driver').reason,'budget-storage-unavailable');
 assert.equal(store.admit('send','driver').allowed,true,'設定差で元の保存予算を書き換えない');
});
