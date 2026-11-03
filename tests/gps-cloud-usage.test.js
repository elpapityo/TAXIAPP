const {test}=require('node:test'),assert=require('node:assert/strict');
const {readWorkerUsage}=require('../scripts/read-gps-cloud-usage');
test('Worker名で絞らずアカウント全体を取得し、UTCの更新境界と推計値であることを保持',async()=>{
 let request;
 const value=await readWorkerUsage({accountId:'a'.repeat(32),token:'synthetic-secret',now:()=>Date.parse('2026-11-01T03:00:00Z'),
  fetch:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:{viewer:{accounts:[{workersInvocationsAdaptive:[{sum:{requests:17}}]}]}}})};}});
 const sent=JSON.parse(request.options.body);assert.equal(sent.query.includes('scriptName'),false);
 assert.equal(value.windows.workerRequests.used,17);assert.equal(value.scope,'account');assert.equal(value.accuracy,'analytics-estimate');
 assert.equal(value.windows.workerRequests.resetAtMs,Date.parse('2026-11-02T00:00:00Z'));
 assert.equal(JSON.stringify(value).includes('synthetic-secret'),false);
});
test('回数制限・HTTP拒否・集計欠落・空結果は0件にせず自動再試行もしない',async()=>{
 for(const response of [{ok:false,status:403},{ok:true,json:async()=>({errors:[{message:'limit'}]})},
  {ok:true,json:async()=>({data:{viewer:{accounts:[]}}})},
  {ok:true,json:async()=>({data:{viewer:{accounts:[{workersInvocationsAdaptive:[]}]}}})}]){
  let calls=0;await assert.rejects(readWorkerUsage({accountId:'a'.repeat(32),token:'synthetic-secret',fetch:async()=>{calls++;return response;}}));
  assert.equal(calls,1);
 }
});
