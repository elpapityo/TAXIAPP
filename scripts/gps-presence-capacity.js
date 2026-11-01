// 現在地GAS候補の回数見積もり。実測/クォータ予約/課金設定は変更しない。
'use strict';
// Presence.gsの成功経路を手順別に数えたもの。再送/公開切替/停止/実日報/履歴は別。
const counts={send:{diaryReads:1,gpsReads:8,gpsWrites:1,urlFetch:13},
 claim:{diaryReads:1,gpsReads:6,gpsWrites:1,urlFetch:11},
 link:{diaryReads:4,gpsReads:6,gpsWrites:3,urlFetch:13}};
function estimate({users,hours=13,sendEverySec=15,listEverySec=60}){
 if(!Number.isSafeInteger(users)||users<1||![hours,sendEverySec,listEverySec].every(n=>Number.isFinite(n)&&n>0))throw Error('試算条件が不正です');
 const seconds=hours*3600,send=Math.ceil(seconds/sendEverySec),claim=Math.ceil(seconds/90),link=Math.ceil(seconds/285),list=Math.ceil(seconds/listEverySec);
 const diaryReads=users*(send*counts.send.diaryReads+claim*counts.claim.diaryReads+link*counts.link.diaryReads);
 const gpsReads=users*(send*counts.send.gpsReads+claim*counts.claim.gpsReads+link*counts.link.gpsReads+list*(3+4*users));
 const gpsWrites=users*(send+claim+3*link);
 const urlFetch=users*(send*counts.send.urlFetch+claim*counts.claim.urlFetch+link*counts.link.urlFetch+list*(6+3*users));
 return {users,hours,sendEverySec,listEverySec,perUser:{send,claim,link,list},diaryReads,gpsReads,gpsWrites,urlFetch,
  withinDocumentedCoreQuotas:diaryReads<=50000&&gpsReads<=50000&&gpsWrites<=20000&&urlFetch<=20000};
}
// 比較用の未実装構成。日報端末の毎送信確認だけで必要となる下限を先に判定。
// Cloudflare移設を実装済み/無料運用確認済みとするフラグは返さない。
function estimateEdgeCandidate({users,hours=13,sendEverySec=15,listEverySec=60,
 diaryOtherReads=0,workerOtherRequests=0,preflightsPerRequest=0}){
 if(!Number.isSafeInteger(users)||users<1||![hours,sendEverySec,listEverySec].every(n=>Number.isFinite(n)&&n>0)||
  ![diaryOtherReads,workerOtherRequests,preflightsPerRequest].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('試算条件が不正です');
 const seconds=hours*3600,send=Math.ceil(seconds/sendEverySec),claim=Math.ceil(seconds/90),
  eligibility=Math.ceil(seconds/285),list=Math.ceil(seconds/listEverySec);
 // 想定：現在地にはGAS/linkを経由せずWorkerが本人tokenで日報資格2文書を5分以内ごとに読む。
 // writer操作は従来どおり書込直前にdeviceSessionsを読む。Googleオンライン検証は毎要求2回。
 const apiRequests=users*(send+claim+eligibility+list+2); // 起動設定の取得/更新各1回
 const writerReadsLowerBound=users*send;
 const plannedDiaryReads=users*(send+claim+2*eligibility+1)+diaryOtherReads;
 const workerRequests=apiRequests*(1+preflightsPerRequest)+workerOtherRequests;
 const doRequests=apiRequests; // 単一roomへ1APIにつき1回。内部追加RPCは禁止という設計条件
 const plannedLogicalWrites=users*(send+claim+eligibility+1); // SQL課金行数と同一とは未確認
 const blockers=[];
 if(writerReadsLowerBound>50000)blockers.push('送信ごとの操作端末確認だけで日報読取上限超過');
 if(plannedDiaryReads>50000)blockers.push('想定日報読取が上限超過');
 if(workerRequests>100000)blockers.push('Workers要求数が上限超過');
 if(doRequests>100000)blockers.push('Durable Objects要求数が上限超過');
 if(plannedLogicalWrites>100000)blockers.push('論理書込だけでSQL書込行上限超過');
 return {users,hours,sendEverySec,listEverySec,diaryOtherReads,workerOtherRequests,preflightsPerRequest,
  perUser:{send,claim,eligibility,list},writerReadsLowerBound,plannedDiaryReads,workerRequests,doRequests,
  plannedLogicalWrites,googleLookups:apiRequests*2,blockers,
  status:blockers.length?'既知の上限に抵触':'回数の一次比較のみ・採用未決定',
  productionReady:false,unmeasured:['実日報と他Workerの使用量','認証API割当','CPU時間','DO実課金行数/索引/再試行','DO実行時間/容量','停止/設定変更/オフライン復帰']};
}
const api={counts,estimate,estimateEdgeCandidate};module.exports=api;
if(require.main===module)process.stdout.write(JSON.stringify({asOf:'2026-11-01',method:'静的回数モデル。全員同時稼働・候補100件未満。再送/停止/設定変更/実日報・履歴/インデックス等を含まない。実利用の保証ではない。',
 sources:['https://firebase.google.com/docs/firestore/quotas','https://developers.google.com/apps-script/guides/services/quotas'],
 scenarios:[1,2,10].flatMap(users=>[15,90].map(sendEverySec=>estimate({users,sendEverySec})))},null,2)+'\n');
