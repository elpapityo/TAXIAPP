const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../gps-cloud-budget');
function fixture(){
 let time=1000000;
 const budget=create({now:()=>time,resources:{worker:{limit:100000,reserve:50000},diary:{limit:50000,reserve:40000}},
  costs:{send:{worker:1,diary:1},claim:{worker:1,diary:1},list:{worker:1,diary:0}}});
 const sample=(worker=0,diary=0,resets={worker:86400000,diary:87000000})=>({scope:'account-and-project',observedAtMs:time,
  windows:{worker:{used:worker,resetAtMs:resets.worker},diary:{used:diary,resetAtMs:resets.diary}}});
 return {budget,sample,advance:n=>time+=n};
}
test('全用途使用量と他用途予約の厳しい方で15秒→60秒→180秒→休止を決定',()=>{
 const f=fixture();assert.equal(f.budget.state().mode,'paused');
 assert.equal(f.budget.update(f.sample()),true);assert.equal(f.budget.state().sendMs,15000);
 f.advance(1);f.budget.update(f.sample(30000));assert.equal(f.budget.state().sendMs,60000);
 f.advance(1);f.budget.update(f.sample(0,8000));assert.equal(f.budget.state().sendMs,180000);
 f.advance(1);f.budget.update(f.sample(0,9500));assert.equal(f.budget.state().mode,'paused');
});
test('送信と一覧を独立して間引き、再送失敗・同時呼出でも予約を解放しない',()=>{
 const f=fixture();f.budget.update(f.sample());
 assert.equal(f.budget.admit('send').allowed,true);assert.equal(f.budget.admit('send').allowed,false);
 assert.equal(f.budget.admit('list').allowed,true);assert.equal(f.budget.admit('list').allowed,false);
 f.advance(15000);assert.equal(f.budget.admit('send').allowed,true);assert.equal(f.budget.admit('list').allowed,false);
 f.advance(45000);assert.equal(f.budget.admit('list').allowed,true);
});
test('取得不能・期限切れ・リセット直後・将来時刻は通信を止め、0件と推測しない',()=>{
 const f=fixture();f.budget.update(f.sample());f.advance(300000);
 assert.equal(f.budget.admit('send').allowed,false);
 assert.equal(f.budget.update({...f.sample(),observedAtMs:999999999}),false);
 assert.equal(f.budget.state().mode,'paused');
 f.advance(1);assert.equal(f.budget.update(f.sample()),true);
 f.budget.invalidate();assert.equal(f.budget.admit('claim').allowed,false);
 f.advance(86400000);assert.equal(f.budget.update(f.sample()),false);
});
test('同じ集計期間の使用量減少・再取得・不正情報によって残予算を復活させない',()=>{
 const f=fixture();f.budget.update(f.sample(47499));assert.equal(f.budget.admit('claim').allowed,true);
 assert.equal(f.budget.admit('claim').allowed,false);
 f.advance(1);f.budget.update(f.sample(0));assert.equal(f.budget.admit('claim').allowed,false);
 f.budget.invalidate();f.advance(1);f.budget.update(f.sample(0));assert.equal(f.budget.admit('claim').allowed,false);
});
test('リセット時刻はサービス別に検査し、早期リセットや別サービスの予算初期化を拒否',()=>{
 const f=fixture();f.budget.update(f.sample(47499,9499));f.budget.admit('claim');
 f.advance(1);assert.equal(f.budget.update(f.sample(0,0,{worker:86400001,diary:87000000})),false);
 f.advance(85400000);assert.equal(f.budget.update(f.sample(0,0,{worker:172800000,diary:87000000})),true);
 assert.equal(f.budget.admit('claim').allowed,false,'日報側の期間はまだ変わらない');
});
test('不明なコストや不正な予約枠を受付けない',()=>{
 assert.throws(()=>create({resources:{a:{limit:1,reserve:1}},costs:{send:{a:1}}}));
 assert.throws(()=>create({resources:{a:{limit:100,reserve:50}},costs:{send:{}}}));
});
