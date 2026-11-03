/* サーバー専用。認証済み本人・信頼する使用量取得処理からだけ呼ぶ。外部HTTP APIではない。 */
'use strict';
const core=require('./gps-cloud-budget');
function create({storage,resources,costs,now=()=>Date.now(),maxAgeMs=300000}){
 if(typeof storage?.sql?.exec!=='function'||typeof storage.transactionSync!=='function')throw Error('GPS予算の同期保存先が必要です');
 storage.sql.exec('CREATE TABLE IF NOT EXISTS gps_cloud_budget (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)');
 const options={resources,costs,now,maxAgeMs};core.create(options);
 // 全要求で保存状態から復元するため、別インスタンスや再起動で消費が消えない。
 function transact(operation){
  try{return storage.transactionSync(()=>{
   const rows=storage.sql.exec('SELECT payload FROM gps_cloud_budget WHERE id = 1').toArray();
   const checkpoint=rows.length?JSON.parse(rows[0].payload):undefined;
   const budget=core.create({...options,checkpoint}),result=operation(budget);
   storage.sql.exec('INSERT INTO gps_cloud_budget (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',JSON.stringify(budget.checkpoint()));
   return result;
  });}catch{
   // 破損/設定差/保存失敗時に空の予算へ初期化しない。
   return {allowed:false,mode:'paused',reason:'budget-storage-unavailable',message:'共通クラウド予算を保存確認できないためGPS通信を休止'};
  }
 }
 return Object.freeze({
  update(snapshot){return transact(b=>({updated:b.update(snapshot),...b.state()}));},
  admit(operation,verifiedActor,options={}){
   if(typeof verifiedActor!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(verifiedActor))return {allowed:false,mode:'paused',reason:'actor-required',message:'GPS通信の本人確認が必要です'};
   return transact(b=>b.admit(operation,{...options,actor:verifiedActor}));
  },
  invalidate(){return transact(b=>{b.invalidate();return b.state();});}
 });
}
module.exports={create};
