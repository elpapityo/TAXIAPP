// 実DOM＋本人連携UI。Firebaseと利用者は合成。LIVE時も不正な合成tokenだけを送る。
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),live=process.env.GPS_LIVE_BROKER==='1';
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const binaryModule=require('@sparticuz/chromium'),binary=binaryModule.default||binaryModule;
  const options={headless:true,executablePath:process.env.GPS_CHROMIUM_EXECUTABLE||await binary.executablePath(),args:binary.args};
  // 実通信では実行環境に指定された既定プロキシを使う。TLS検証は解除しない。
  if(live&&(process.env.HTTPS_PROXY||process.env.HTTP_PROXY)){
   const proxy=new URL(process.env.HTTPS_PROXY||process.env.HTTP_PROXY);
   options.proxy={server:proxy.origin,bypass:'127.0.0.1,localhost'};
   if(proxy.username)options.proxy.username=decodeURIComponent(proxy.username);
   if(proxy.password)options.proxy.password=decodeURIComponent(proxy.password);
  }
  browser=await chromium.launch(options);
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],requests=[],failures=[];
  page.on('requestfailed',r=>failures.push({host:new URL(r.url()).hostname,error:r.failure()?.errorText}));
  let firebaseImports=0,mode='success',trialEnabled=false,archiveEnabled=false;const trialRows=new Map(),trialTombs=new Set();page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   navigator.geolocation.getCurrentPosition=()=>{throw Error('合成試験で実GPSを取得してはいけない');};
   navigator.geolocation.watchPosition=()=>{throw Error('本人連携中に測位を開始してはいけない');};
   localStorage.setItem('taxiapp-diary-protection-sentinel','未同期の日報を保持');
  });
  await context.route('**/gps-account-config.js*',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'gps-account-config.js'),'utf8').replace(/historyTrialEnabled:(true|false)/,'historyTrialEnabled:'+trialEnabled).replace(/historyArchiveEnabled:(true|false)/,'historyArchiveEnabled:'+archiveEnabled)}));
  await context.route('https://unpkg.com/**',route=>route.abort());
  await context.route('https://www.gstatic.com/firebasejs/**',route=>{
   firebaseImports++;
   if(route.request().url().endsWith('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:`
    const apps=[{name:'[DEFAULT]',options:{projectId:'taxiapp-2b6bd'}}];window.__createdAuthApps=[];export const getApps=()=>apps;export const initializeApp=(options,name='[DEFAULT]')=>{window.__createdAuthApps.push(name);const app={name,options};apps.push(app);return app;};`});
   if(route.request().url().endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:`
    const auths=new Map();window.__popupCalls=[];const user=uid=>({uid,emailVerified:true,email:'synthetic@example.invalid',providerData:[{providerId:'google.com',uid:'same-google-subject'}],getIdToken:async()=>uid+'-invalid-synthetic-token'});
    export function getAuth(app){if(app.name==='[DEFAULT]')throw Error('日報本体のAuthを開始してはいけない');if(!auths.has(app.name))auths.set(app.name,{app,currentUser:window.__testSignedOut&&!window.__testTrial?null:user(app.options.projectId==='taxiapp-2b6bd'?'diary-ui-user':'gps-ui-user'),authStateReady:async()=>{}});return auths.get(app.name);}
    export function onAuthStateChanged(auth,fn){fn(auth.currentUser);(auth.listeners||(auth.listeners=[])).push(fn);window.__testSwitchAccounts=()=>{for(const a of auths.values()){a.currentUser=user('changed-user');for(const f of a.listeners||[])f(a.currentUser);}};return()=>{};}
    export class GoogleAuthProvider{setCustomParameters(){}}
    export async function signInWithPopup(auth){if(!navigator.userActivation.isActive)throw Error('popupは明示クリック内だけ');window.__popupCalls.push(auth.app.name);auth.currentUser=user(auth.app.options.projectId==='taxiapp-2b6bd'?'diary-ui-user':'gps-ui-user');}`});
   return route.abort();
  });
  if(!live)await context.route('https://script.google.com/macros/s/**/exec',route=>{
   const body=route.request().postDataJSON();requests.push(body);
   let response;
   if(mode!=='success')response={ok:false,code:'unauthenticated'};
   else if(body.action==='link')response={ok:true,data:{diaryUid:'diary-ui-user',gpsUid:'gps-ui-user',writerSessionId:null,validUntilMs:Date.now()+300000}};
   else{
    assert.equal(body.actorUid,'gps-ui-user');const d=body.data;
    if(body.action==='saveOwnGpsHistory'){trialRows.set(d.payload.shiftId,{...d.payload,uid:'gps-ui-user',contentHash:d.contentHash,expiresAt:Date.now()+60000});response={ok:true,data:{status:'saved',shiftId:d.payload.shiftId,contentHash:d.contentHash}};}
    else if(body.action==='getOwnGpsHistory')response=trialRows.has(d.shiftId)?{ok:true,data:{history:trialRows.get(d.shiftId)}}:{ok:false,code:'not-found'};
    else if(body.action==='listOwnGpsHistory')response={ok:true,data:{targetUid:'gps-ui-user',shifts:[...trialRows.values()].map(row=>({shiftId:row.shiftId,startedAtMs:row.startedAtMs,endedAtMs:row.endedAtMs}))}};
    else if(body.action==='recordOwnGpsCsvAudit')response={ok:true,data:{operationId:d.operationId,status:'saved'}};
    else if(body.action==='deleteGpsHistory'){trialRows.delete(d.shiftId);trialTombs.add(d.shiftId);response={ok:true,data:{targetUid:'gps-ui-user',shiftId:d.shiftId,status:'deleted'}};}
    else if(body.action==='getOwnGpsHistoryTombstone')response={ok:true,data:{deleted:trialTombs.has(d.shiftId)}};
    else throw Error('予期しない合成履歴操作');
   }
   return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(response)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/gps-sharing-test.html');
  await page.waitForFunction(()=>!document.getElementById('gpsAccountPanel').hidden);
  assert.equal(firebaseImports,0);assert.equal(requests.length,0);
  assert.equal(await page.locator('main button:enabled,main input:enabled').count(),0);
  await page.locator('#gpsAccountLink').click();
  if(live){
   await page.waitForFunction(()=>document.getElementById('gpsAccountStatus').textContent.includes('完了できません'),null,{timeout:45000});
   const state=await page.locator('#gpsAccountStatus').innerText();
   assert.match(state,/unauthenticated/,JSON.stringify({state,failures}));
   assert.match(await page.locator('#gpsAccountStatus').innerText(),/完了できません/);
   console.log('実公開GAS：ブラウザの単純POST・CORS/リダイレクトで不正合成tokenの拒否応答を取得。実Google認証・成功書込は未検証。');
  }else{
   await page.waitForFunction(()=>document.getElementById('gpsAccountStatus').textContent.includes('連携を確認しました'));
   assert.equal(requests.length,1);assert.equal(requests[0].writerSessionId,null);
   assert.equal(requests[0].diaryIdToken,'diary-ui-user-invalid-synthetic-token');
   assert.equal(requests[0].gpsIdToken,'gps-ui-user-invalid-synthetic-token');
   assert.equal(firebaseImports,2);
   assert.deepEqual(await page.evaluate(()=>window.__createdAuthApps),['TAXIAPP_GPS_DIARY_IDENTITY','TAXIAPP_GPS']);
   mode='reject';await page.locator('#gpsAccountLink').click();
   await page.waitForFunction(()=>document.getElementById('gpsAccountStatus').textContent.includes('unauthenticated'));
   assert.equal(requests.length,2);assert.match(await page.locator('#gpsAccountStatus').innerText(),/完了できません/);
   // 初回ログアウト状態：SDK準備→日報→GPSは各々別クリック。
   mode='success';await page.addInitScript(()=>{window.__testSignedOut=true;});await page.reload();
   await page.locator('#gpsAccountLink').click();
   await page.waitForFunction(()=>document.getElementById('gpsAccountLink').textContent==='日報のGoogleアカウントを確認する');
   assert.deepEqual(await page.evaluate(()=>window.__popupCalls),[]);assert.equal(requests.length,2);
   await page.locator('#gpsAccountLink').click();
   await page.waitForFunction(()=>document.getElementById('gpsAccountLink').textContent.includes('GPSでも確認'));
   assert.deepEqual(await page.evaluate(()=>window.__popupCalls),['TAXIAPP_GPS_DIARY_IDENTITY']);assert.equal(requests.length,2);
   await page.locator('#gpsAccountLink').click();
   await page.waitForFunction(()=>document.getElementById('gpsAccountStatus').textContent.includes('連携を確認しました'));
   assert.deepEqual(await page.evaluate(()=>window.__popupCalls),['TAXIAPP_GPS_DIARY_IDENTITY','TAXIAPP_GPS']);assert.equal(requests.length,3);
   trialEnabled=true;await page.addInitScript(()=>{window.__testTrial=true;});await page.reload();
   await page.locator('#gpsAccountLink').click();await page.waitForFunction(()=>document.getElementById('gpsAccountStatus').textContent.includes('連携を確認しました'));
   const beforeTrial=requests.length;await page.locator('#gpsHistoryBackendTrial').click();
   await page.waitForFunction(()=>document.getElementById('gpsHistoryBackendStatus').textContent.includes('削除確認に成功'));
   assert.deepEqual(requests.slice(beforeTrial).map(r=>r.action),['saveOwnGpsHistory','getOwnGpsHistory','deleteGpsHistory','getOwnGpsHistoryTombstone']);
   assert.equal(trialRows.size,0);assert.equal(trialTombs.size,1);
   assert.deepEqual(requests[beforeTrial].data.payload.points.map(p=>[p.lat,p.lon]),[[0,0]]);
   archiveEnabled=true;trialEnabled=false;await page.reload();
   await page.evaluate(async()=>{
    const store=window.TAXIAPP_GPS_HISTORY_STORE,now=Date.now();
    for(const [uid,id]of [['diary-ui-user','shift-9100'],['gps-ui-user','shift-9200']]){
     await store.record(uid,id,now-60000,{capturedAtMs:now-30000,lat:34,lon:135,accuracy:5,speed:null,heading:null});await store.finish(uid,id,now-1000);
    }
   });
   const beforeArchive=requests.length;await page.locator('#gpsAccountLink').click();
   await page.waitForFunction(()=>document.getElementById('gpsAccountStatus').textContent.includes('連携を確認しました'));
   assert.deepEqual(requests.slice(beforeArchive).map(r=>r.action),['link']);
   assert.equal(await page.locator('#historyShiftSelect option').count(),1);assert.equal(await page.locator('#historyShiftSelect').inputValue(),'shift-9100');
   await page.locator('#historyResend').click();await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent.includes('保存を確認しました'));
   assert.ok(trialRows.has('shift-9100'));assert.equal(trialRows.get('shift-9100').uid,'gps-ui-user');assert.equal(trialRows.has('shift-9200'),false);
   await page.locator('#historyFetchCloud').click();await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent.includes('クラウド一覧'));
   const cloudOnly=await page.evaluate(async()=>{
    const api=window.TAXIAPP_GPS_HISTORY_SYNC,now=Date.now();const payload=api.prepare({uid:'gps-ui-user',shiftId:'shift-9300',startedAtMs:now-120000,endedAtMs:now-60000,points:[{capturedAtMs:now-90000,lat:35,lon:136,accuracy:5,segmentNo:1}]});
    return {...payload,uid:'gps-ui-user',contentHash:await api.sha256(payload,crypto.subtle),expiresAt:now+60000};
   });trialRows.set('shift-9300',cloudOnly);
   const beforeMetadata=requests.length;await page.locator('#historyFetchCloud').click();await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent.includes('クラウド一覧 2'));
   assert.deepEqual(requests.slice(beforeMetadata).map(r=>r.action),['listOwnGpsHistory']);
   await page.locator('#historyShiftSelect').selectOption('shift-9300');await page.waitForFunction(()=>document.getElementById('historyDetail').textContent.includes('クラウド｜1地点'));
   assert.equal(requests.at(-1).action,'getOwnGpsHistory');assert.equal(requests.at(-1).data.shiftId,'shift-9300');
   await page.locator('#historyShiftSelect').selectOption('shift-9100');await page.waitForFunction(()=>document.getElementById('historyDetail').textContent.includes('端末内｜1地点'));
   const beforeCsv=requests.length;
   const downloadWait=page.waitForEvent('download');await page.locator('#historyExport').click();const download=await downloadWait;
   assert.match(download.suggestedFilename(),/shift-9100_gps.csv/);
   await page.waitForFunction(()=>document.getElementById('auditState').textContent.includes('サーバー保存を確認'));
   assert.ok(requests.slice(beforeCsv).some(r=>r.action==='recordOwnGpsCsvAudit'));
   await context.setOffline(true);const beforeOffline=requests.length;
   const offlineDownload=page.waitForEvent('download');await page.locator('#historyExport').click();await offlineDownload;
   await page.waitForFunction(()=>document.getElementById('auditState').textContent.includes('通信復旧'));
   assert.equal(requests.length,beforeOffline);assert.equal(await page.evaluate(async()=>(await window.TAXIAPP_GPS_HISTORY_STORE.pendingAudits('diary-ui-user')).length),1);
   await context.setOffline(false);await page.waitForFunction(()=>document.getElementById('auditState').textContent.includes('サーバー保存を確認'));
   assert.equal(await page.evaluate(async()=>(await window.TAXIAPP_GPS_HISTORY_STORE.pendingAudits('diary-ui-user')).length),0);
   page.once('dialog',d=>d.accept());await page.locator('#historyDeleteCloud').click();
   await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent.includes('クラウド削除'));
   assert.equal(trialRows.has('shift-9100'),false);
   const protectedRows=await page.evaluate(async()=>({local:await window.TAXIAPP_GPS_HISTORY_STORE.fetchOne('diary-ui-user','shift-9100'),other:await window.TAXIAPP_GPS_HISTORY_STORE.fetchOne('gps-ui-user','shift-9200')}));
   assert.equal(protectedRows.local.points.length,1);assert.equal(protectedRows.local.serverStatus,'削除済み');assert.equal(protectedRows.other.serverStatus,'未送信');
   const beforeSwitch=requests.length;await page.evaluate(()=>window.__testSwitchAccounts());
   assert.equal(await page.locator('#historyShiftSelect option').count(),0);assert.equal(await page.locator('#historyFetchCloud').isDisabled(),true);
   await page.evaluate(()=>window.dispatchEvent(new Event('online')));assert.equal(requests.length,beforeSwitch);
   console.log('実DOM＋合成認証：通常履歴のUID分離同期/選択乗務だけの取得/オフラインCSV監査再送/削除時原本保持/本人切替の表示消去を確認。');
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('taxiapp-diary-protection-sentinel')),'未同期の日報を保持');
  if(!archiveEnabled)assert.equal(await page.locator('main button:enabled,main input:enabled').count(),0);
  assert.equal(await page.locator('#privacyToggle').isDisabled(),true);assert.equal(await page.locator('#historyToggle').isDisabled(),true);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
