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
const api={counts,estimate};module.exports=api;
if(require.main===module)process.stdout.write(JSON.stringify({asOf:'2026-11-01',method:'静的回数モデル。全員同時稼働・候補100件未満。再送/停止/設定変更/実日報・履歴/インデックス等を含まない。実利用の保証ではない。',
 sources:['https://firebase.google.com/docs/firestore/quotas','https://developers.google.com/apps-script/guides/services/quotas'],
 scenarios:[1,2,10].flatMap(users=>[15,90].map(sendEverySec=>estimate({users,sendEverySec})))},null,2)+'\n');
