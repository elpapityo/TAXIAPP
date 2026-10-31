// 実SDK12.4 + Auth/Firestore Emulator + Firebase公式CallableのTCP HTTPハンドラ + Chromium。GPS座標は合成。
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {initializeApp,getApps}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const projectId='demo-taxiapp-gps',uid='net-driver-12345678',admin='net-admin-12345678',outsider='net-other-12345678';
const password='Local-GPS-test-2026!',writer='s'.repeat(32),nextWriter='t'.repeat(32);
test('実HTTP認証・複数画面送信排他・操作端末切替・保存/管理者監査/CSV', {timeout:180000},async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8189');
 assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9098');
 if(!getApps().length)initializeApp({projectId});
 process.env.FUNCTIONS_EMULATOR='true';
 const adminDb=getFirestore(),auth=getAuth();
 const express=require('express'),app=express(),handlers=require('../functions/gps-history-operations');
 app.use(express.json());
 app.all('/demo-taxiapp-gps/asia-northeast1/:name',(req,res)=>{
  const fn=handlers[req.params.name];
  if(typeof fn!=='function'||!fn.__endpoint?.callableTrigger){res.status(404).end();return;}
  return fn(req,res);
 });
 const callableServer=await new Promise(resolve=>{const s=app.listen(5009,'127.0.0.1',()=>resolve(s));});
 for(const [id,name] of [[uid,'driver'],[admin,'admin'],[outsider,'other']]){
  await auth.createUser({uid:id,email:name+'@example.invalid',password});
  await adminDb.doc('users/'+id).set({status:'active',openChatName:'合成'+name});
 }
 await adminDb.doc('admins/'+admin).set({enabled:true});
 await adminDb.doc('deviceSessions/'+uid).set({sessionId:writer,updatedAt:Timestamp.now()});
 await adminDb.doc('gpsSharePrefs/'+uid).set({public:true,revision:1,operationId:require('node:crypto').randomUUID(),writerSessionId:writer,updatedAt:Timestamp.now()});
 const root=path.resolve(__dirname,'..'),sdkRoot=path.dirname(require.resolve('firebase-browser-sdk/package.json'));
 const fixtureShift={id:'shift-990000',startedIso:new Date(Date.now()-60000).toISOString(),draft:null};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');let file;
  if(url.pathname==='/__login.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="ja"><body>ローカル認証試験</body></html>');}
  if(url.pathname==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.TAXIAPP_FIREBASE_CONFIG='+JSON.stringify({apiKey:'demo-local-key',authDomain:'localhost',projectId})+';');}
  file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;let browser;
 const errors=[];
 try{
  const options={headless:true};
  if(process.env.GPS_CHROMIUM_NPM==='1'){
   const pack=require('@sparticuz/chromium'),binary=pack.default||pack;
   options.executablePath=await binary.executablePath();options.args=binary.args;
  }
  browser=await chromium.launch(options);
  async function open(name,token,point=34.7,adminPage=false){
   const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,
    permissions:['geolocation'],geolocation:{latitude:point,longitude:135.4,accuracy:8}});
   await context.addInitScript(({uid,token,shift})=>{
    if(token)sessionStorage.setItem('taxiapp-current-session-v1-'+uid,token);
    if(!localStorage.getItem('taxiapp-account-state-v1-'+uid))localStorage.setItem('taxiapp-account-state-v1-'+uid,JSON.stringify({version:1,activeId:shift.id,shifts:[shift]}));
    // 可視/不可視切替のみ試験から制御。GPSはChromiumのGeolocationエミュレーション。
    window.__visible='visible';Object.defineProperty(document,'visibilityState',{get:()=>window.__visible});
   },{uid,token,shift:fixtureShift});
   // Emulator結合試験だけで旧通信経路を検証。本番設定は停止を維持。
   await context.route('**/gps-cloud-policy.js',route=>route.fulfill({contentType:'text/javascript',body:'window.TAXIAPP_GPS_CLOUD_POLICY={enabled:true};'}));
   await context.route('https://www.gstatic.com/firebasejs/**',async route=>{
    const filename=path.basename(new URL(route.request().url()).pathname),module=filename.replace('firebase-','').replace('.js','');
    const realPath=origin+'/__sdk/'+filename;
    if(new URL(route.request().url()).hostname==='www.gstatic.com'){
     let wrapper='export * from '+JSON.stringify(realPath)+';';
     if(module==='auth')wrapper+=`import * as sdk from '${realPath}';export function getAuth(app){const a=sdk.getAuth(app);if(!window.__authReady){sdk.connectAuthEmulator(a,'http://127.0.0.1:9098',{disableWarnings:true});window.__authReady=true;}return a;}`;
     if(module==='firestore')wrapper+=`import * as sdk from '${realPath}';export function getFirestore(app){const db=sdk.getFirestore(app);if(!window.__fireReady){sdk.connectFirestoreEmulator(db,'127.0.0.1',8189);window.__fireReady=true;}window.__testDb=db;return db;}`;
     if(module==='functions')wrapper+=`import * as sdk from '${realPath}';export function getFunctions(app,region){const f=sdk.getFunctions(app,region);sdk.connectFunctionsEmulator(f,'127.0.0.1',5009);return f;}`;
     return route.fulfill({contentType:'text/javascript',body:wrapper});
    }
   });
   await context.route(origin+'/__sdk/**',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(sdkRoot,path.basename(new URL(route.request().url()).pathname)))}));
   await context.route('https://unpkg.com/leaflet@1.9.4/dist/**',route=>{
    const file=path.basename(new URL(route.request().url()).pathname);
    return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('leaflet')),file))});
   });
   await context.route('https://cyberjapandata.gsi.go.jp/**',route=>route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/__login.html');
   await page.evaluate(async({name,password})=>{
    const a=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js');
    const login=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js');
    const app=a.initializeApp({apiKey:'demo-local-key',authDomain:'localhost',projectId:'demo-taxiapp-gps'});
    await login.signInWithEmailAndPassword(login.getAuth(app),name+'@example.invalid',password);
   },{name,password});
   await page.goto(origin+(adminPage?'/gps-history-admin.html':'/gps-sharing-test.html'));
   return {context,page};
  }
  async function settled(page){await page.waitForFunction(()=>document.getElementById('authState').textContent.includes('既存TAXIAPPログイン'));}
  const unauth=await fetch('http://127.0.0.1:5009/demo-taxiapp-gps/asia-northeast1/adminViewGpsHistory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:{targetUid:uid,shiftId:fixtureShift.id}})});
  assert.equal(unauth.status,401);
  const invalid=await fetch('http://127.0.0.1:5009/demo-taxiapp-gps/asia-northeast1/adminViewGpsHistory',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer invalid-token'},body:JSON.stringify({data:{targetUid:uid,shiftId:fixtureShift.id}})});
  assert.equal(invalid.status,401);
  const a=await open('driver',writer);await settled(a.page);
  await a.page.waitForFunction(()=>document.getElementById('sendState').textContent.startsWith('送信済み'));
  const initial=(await adminDb.doc('gpsPresence/'+uid).get()).data();assert.equal(initial.lat,34.7);
  await a.page.locator('#historyToggle').check();await a.context.setGeolocation({latitude:34.7001,longitude:135.4,accuracy:8});
  await a.page.waitForFunction(()=>document.getElementById('historyShiftSelect').options.length===1);
  // opener付き新規タブではsessionStorageが複製される。送信元IDは重複させない。
  const popupWait=a.page.waitForEvent('popup');await a.page.evaluate(()=>window.open('/gps-sharing-test.html','_blank'));
  const popup=await popupWait;popup.on('pageerror',e=>errors.push(e.message));await settled(popup);
  await popup.waitForFunction(()=>document.getElementById('senderState').textContent.includes('別の位置共有画面'));
  const originalId=await a.page.evaluate(()=>sessionStorage.getItem('taxiapp-gps-sender-v1-net-driver-12345678'));
  const clonedId=await popup.evaluate(()=>sessionStorage.getItem('taxiapp-gps-sender-v1-net-driver-12345678'));
  assert.notEqual(originalId,clonedId);
  await popup.close();
  await a.page.reload();await settled(a.page);
  await a.page.waitForFunction(()=>document.getElementById('sendState').textContent.startsWith('送信済み'));
  assert.equal((await adminDb.doc('gpsPresence/'+uid).get()).data().senderId,originalId);
  const viewer=await open('driver','',35);await settled(viewer.page);
  assert.equal(await viewer.page.locator('#privacyToggle').isDisabled(),true);
  assert.equal((await adminDb.doc('deviceSessions/'+uid).get()).data().sessionId,writer);
  const b=await open('driver',writer,36);await settled(b.page);
  await b.page.waitForFunction(()=>document.getElementById('senderState').textContent.includes('別の位置共有画面'));
  assert.equal((await adminDb.doc('gpsPresence/'+uid).get()).data().senderId,initial.senderId);
  await a.page.evaluate(()=>{window.__visible='hidden';document.dispatchEvent(new Event('visibilitychange'));});
  await b.page.waitForFunction(()=>document.getElementById('sendState').textContent.startsWith('送信済み'));
  const after=(await adminDb.doc('gpsPresence/'+uid).get()).data();assert.equal(after.lat,36);assert.notEqual(after.senderId,initial.senderId);
  // Firestore Auth Token付き実HTTPで古い送信元の書込を試み、ルール拒否を確認。
  const denied=await a.page.evaluate(async({uid,old})=>{
   const f=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js');
   try{await f.setDoc(f.doc(window.__testDb,'gpsPresence',uid),{...old,updatedAt:f.serverTimestamp()});return false;}catch(e){return e.code==='permission-denied';}
  },{uid,old:{...after,senderId:initial.senderId}});assert.equal(denied,true);
  await adminDb.doc('deviceSessions/'+uid).set({sessionId:nextWriter,updatedAt:Timestamp.now()});
  await b.page.waitForFunction(()=>document.getElementById('privacyToggle').disabled);
  const d=await open('driver',nextWriter,37);await settled(d.page);
  await d.page.waitForFunction(()=>document.getElementById('sendState').textContent.startsWith('送信済み'));
  assert.equal((await adminDb.doc('gpsPresence/'+uid).get()).data().lat,37);
  // 実ネットワーク断中の古い公開操作と、別画面の新しい非公開が競合。
  await d.context.setOffline(true);
  await d.page.waitForFunction(()=>document.getElementById('senderState').textContent.includes('確認'));
  await d.page.locator('#privacyToggle').uncheck();await d.page.locator('#privacyToggle').check();
  const e=await open('driver',nextWriter,38);await settled(e.page);
  await e.page.waitForFunction(()=>!document.getElementById('privacyToggle').disabled);
  await e.page.locator('#privacyToggle').uncheck();
  await e.page.waitForFunction(()=>document.getElementById('privacyState').textContent==='非公開中').catch(async error=>{console.error('設定同期状態',await e.page.locator('#privacyState').innerText(),await e.page.locator('#connection').innerText());throw error;});
  await d.context.setOffline(false);
  await d.page.waitForFunction(()=>document.getElementById('privacyState').textContent.includes('他端末で設定変更'));
  assert.equal((await adminDb.doc('gpsSharePrefs/'+uid).get()).data().public,false);
  assert.equal((await adminDb.doc('gpsPresence/'+uid).get()).data().public,false);
  const beforeConfirmation=(await adminDb.doc('gpsSharePrefs/'+uid).get()).data().revision;
  await d.page.locator('#privacyToggle').uncheck();
  await d.page.waitForFunction(()=>document.getElementById('privacyState').textContent==='非公開中');
  assert.equal((await adminDb.doc('gpsSharePrefs/'+uid).get()).data().revision,beforeConfirmation+1);
  // 記録済みの旧端末GPS点は保持し、入庫日時の原データが揃った段階でHTTP Callable保存。
  await a.page.evaluate(({uid})=>{
   const key='taxiapp-account-state-v1-'+uid,model=JSON.parse(localStorage.getItem(key));
   model.shifts[0].endedIso=new Date().toISOString();model.activeId=null;localStorage.setItem(key,JSON.stringify(model));
   window.__visible='visible';document.dispatchEvent(new Event('visibilitychange'));
  },{uid});
  await a.page.waitForFunction(()=>document.getElementById('historyState').textContent.includes('保存済み 1'));
  assert.equal((await adminDb.doc('gpsHistory/'+uid+'/shifts/'+fixtureShift.id).get()).exists,true);
  const download=a.page.waitForEvent('download');await a.page.locator('#historyExport').click();
  const csv=fs.readFileSync(await(await download).path(),'utf8');assert.ok(csv.startsWith('\ufeff'));
  await a.page.waitForFunction(()=>document.getElementById('auditState').textContent==='CSV監査の未同期 0件');
  const adminUi=await open('admin','',34,true);
  await adminUi.page.waitForFunction(()=>!document.getElementById('adminPanel').hidden);
  await adminUi.page.locator('#target').selectOption(uid);
  await adminUi.page.waitForFunction(()=>!document.getElementById('view').disabled);
  await adminUi.page.locator('#view').click();
  await adminUi.page.waitForFunction(()=>document.getElementById('status').textContent.includes('閲覧監査済み'));
  const logs=await adminDb.collection('gpsHistoryAudit').where('targetUid','==',uid).get();
  assert.ok(logs.docs.some(x=>x.get('action')==='view'));assert.ok(logs.docs.some(x=>x.get('action')==='csv_export'));
  const other=await open('other','',34);await settled(other.page);
  const forbidden=await other.page.evaluate(async({uid,shiftId})=>{
   const a=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),f=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js');
   let roleDenied=false,actorDenied=false;
   const instance=f.getFunctions(a.getApp(),'asia-northeast1');
   try{await f.httpsCallable(instance,'adminViewGpsHistory')({actorUid:'net-other-12345678',targetUid:uid,shiftId});}catch(e){roleDenied=e.code==='functions/permission-denied';}
   try{await f.httpsCallable(instance,'recordOwnGpsCsvAudit')({actorUid:uid});}catch(e){actorDenied=e.code==='functions/failed-precondition';}
   return {roleDenied,actorDenied};
  },{uid,shiftId:fixtureShift.id});assert.deepEqual(forbidden,{roleDenied:true,actorDenied:true});
  await adminUi.page.evaluate(async()=>{const a=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),auth=await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js');await auth.signOut(auth.getAuth(a.getApp()));});
  await adminUi.page.waitForFunction(()=>document.getElementById('adminPanel').hidden);
  assert.equal(await adminUi.page.locator('.leaflet-interactive').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Auth/Firestore Emulator＋公式Callableハンドラの実ローカルTCP HTTP、SDK12.4、複数画面排他・操作端末切替・保存/監査/CSV/他UID拒否に成功。GPSと可視状態は合成。');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await new Promise(r=>callableServer.close(r));}
});
