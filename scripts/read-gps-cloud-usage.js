// 管理環境専用の読取。API tokenをブラウザ/応答/ログへ渡さない。
'use strict';
async function readWorkerUsage({accountId,token,fetch=globalThis.fetch,now=()=>Date.now()}){
 if(typeof accountId!=='string'||!/^[a-f0-9]{32}$/.test(accountId)||typeof token!=='string'||!token)throw Error('管理環境のCloudflare読取資格が必要です');
 const observedAtMs=now(),day=new Date(observedAtMs).toISOString().slice(0,10),start=day+'T00:00:00Z';
 const query='query($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } } } } }';
 const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
  body:JSON.stringify({query,variables:{accountTag:accountId,start,end:new Date(observedAtMs).toISOString()}})});
 // 失敗内容をそのまま出すと資格情報を含む可能性があるため固定文のみ。
 if(!response.ok)throw Error('Cloudflare利用量の取得失敗（HTTP '+response.status+'）');
 const body=await response.json();
 if(body.errors?.length)throw Error('Cloudflare解析APIが取得を拒否しました。利用量は未確認です');
 const accounts=body.data?.viewer?.accounts;
 if(!Array.isArray(accounts)||accounts.length!==1)throw Error('Cloudflareアカウントの集計範囲を確認できません');
 const rows=accounts[0].workersInvocationsAdaptive;
 // 空配列/欠落を0とみなさない。明示されたrequests:0だけを0として扱う。
 if(!Array.isArray(rows)||rows.length!==1||!Number.isSafeInteger(rows[0]?.sum?.requests)||rows[0].sum.requests<0)
  throw Error('Cloudflareアカウント全体の利用量が未確認です');
 return {scope:'account',source:'cloudflare-workers-analytics',accuracy:'analytics-estimate',observedAtMs,
  windows:{workerRequests:{used:rows[0].sum.requests,resetAtMs:Date.parse(start)+86400000}}};
}
module.exports={readWorkerUsage};
if(require.main===module)readWorkerUsage({accountId:process.env.GPS_CLOUDFLARE_ACCOUNT_ID,token:process.env.GPS_CLOUDFLARE_READ_TOKEN})
 .then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'))
 .catch(()=>{process.stderr.write('クラウド利用量は未確認です。GPS通信は休止を維持してください。\n');process.exitCode=1;});
