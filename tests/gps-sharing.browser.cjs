// Chromium実DOM/IndexedDB/CSV。Firebase・GPS・通信状態は合成シミュレーション。
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  const options={headless:true};
  if(process.env.GPS_CHROMIUM_NPM==='1'){
   const chromiumPackage=require('@sparticuz/chromium');const binary=chromiumPackage.default||chromiumPackage;options.executablePath=await binary.executablePath();options.args=binary.args;
  }
  browser=await chromium.launch(options);
  const stopped=await browser.newContext();let firebaseRequests=0;
  await stopped.route('https://**',route=>{if(route.request().url().includes('gstatic.com/firebasejs/'))firebaseRequests++;return route.abort();});
  await stopped.addInitScript(()=>{
   localStorage.setItem('taxiapp-cost-stop-sentinel','未送信の既存データ');
   navigator.geolocation.watchPosition=()=>{throw Error('GPS停止中に測位を開始');};
  });
  for(const file of ['gps-sharing-test.html','gps-history-admin.html']){
   const stoppedPage=await stopped.newPage(),stoppedErrors=[];
   stoppedPage.on('pageerror',e=>stoppedErrors.push(e.message));
   await stoppedPage.goto('http://127.0.0.1:'+server.address().port+'/'+file);
   await stoppedPage.waitForFunction(()=>document.getElementById('connection')?.textContent.includes('日報の保存を優先')||document.getElementById('status')?.textContent.includes('日報の保存を優先'));
   assert.equal(await stoppedPage.locator('main button:enabled,main input:enabled,main select:enabled').count(),0);
   assert.equal(await stoppedPage.evaluate(()=>localStorage.getItem('taxiapp-cost-stop-sentinel')),'未送信の既存データ');
   assert.deepEqual(stoppedErrors,[]);await stoppedPage.close();
  }
  assert.equal(firebaseRequests,0); // single-process Chromiumではcontext.closeでブラウザごと終了するため最後に閉じる。
  console.log('日報優先停止：2画面でFirebase通信0・操作停止・保存データ維持を確認');
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  // 旧機能の合成試験専用。本番の停止方針を解除するコードは配布しない。
  await context.route('**/gps-cloud-policy.js',route=>route.fulfill({contentType:'text/javascript',body:'window.TAXIAPP_GPS_CLOUD_POLICY={enabled:true};'}));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   window.__online=true;Object.defineProperty(navigator,'onLine',{get:()=>window.__online});
   window.__writes=[];window.__cloud={};
   sessionStorage.setItem('taxiapp-current-session-v1-driver-12345678','s'.repeat(32));
   window.__fix=(offset=0)=>window.__gps?.({timestamp:Date.now()+offset,coords:{latitude:34.7,longitude:135.4,accuracy:8,speed:0,heading:0}});
   navigator.geolocation.watchPosition=callback=>{window.__gps=callback;return 1;};
   navigator.geolocation.clearWatch=()=>{window.__gps=null;};
   if(!localStorage.getItem('taxiapp-account-state-v1-driver-12345678'))localStorage.setItem('taxiapp-account-state-v1-driver-12345678',JSON.stringify({version:1,activeId:'shift-100',shifts:[{id:'shift-100',startedIso:new Date(Date.now()-60000).toISOString(),draft:null}]}));
  });
  const modules={
   app:`export const getApps=()=>[{name:'[DEFAULT]',options:{projectId:'taxiapp-2b6bd'}}];export const initializeApp=(options,name)=>{if(name!=='TAXIAPP_GPS'||options.projectId!=='taxigps-9f82e')throw Error('GPS接続先不一致');window.__gpsApp={options,name};return window.__gpsApp;};`,
   auth:`const user={uid:'driver-12345678',displayName:'合成テスト'};export const getAuth=()=>({currentUser:user});export const onAuthStateChanged=(auth,fn)=>{window.__authChanged=fn;setTimeout(()=>fn(user),0);};`,
   functions:`export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async data=>{
     const result={targetUid:data.targetUid,shiftId:data.shiftId,startedAtMs:Date.now()-60000,endedAtMs:Date.now(),points:[{lat:34,lon:135,accuracy:5,segmentNo:1,capturedAtMs:Date.now()-30000}]};
     window.__calls=(window.__calls||[]).concat(name);
     if(name==='adminListGpsHistory')return {data:{shifts:[{shiftId:'shift-900',startedAtMs:result.startedAtMs,endedAtMs:result.endedAtMs}]}};
     if(name==='adminViewGpsHistory'){if(window.__denyAudit)throw Error('合成：監査保存失敗');return {data:result};}
     if(name==='adminExportGpsHistory')return {data:result};
     if(name==='deleteGpsHistory')return {data:{status:'deleted'}};
     if(name==='adminListGpsHistoryAudit')return {data:{entries:[]}};
     return {data:{status:'saved',operationId:data.operationId}};
    };`,
   firestore:`export const getFirestore=()=>({});export const doc=(_db,...p)=>p.join('/');export const collection=doc;export const query=(...p)=>p;export const where=(...p)=>p;export const orderBy=(...p)=>p;export const limit=x=>x;
    export const serverTimestamp=()=>{const n=Date.now();return {toMillis:()=>n};};export const Timestamp={fromMillis:n=>({millis:n})};
    export async function getDocFromServer(p){if(!navigator.onLine)throw Error('offline');let value=window.__cloud[p];
     if(p.startsWith('admins/')&&window.__admin)value={enabled:true};
     if(p.startsWith('deviceSessions/'))value={sessionId:'s'.repeat(32)};
     if(p.startsWith('users/'))value={status:'active',openChatName:'合成テスト'};
     if(p.startsWith('gpsSharePrefs/')&&!value)value={public:localStorage.getItem('__serverPrefs')!=='0',revision:Number(localStorage.getItem('__serverRevision')||0),operationId:localStorage.getItem('__serverOperation')};
     return {exists:()=>!!value,data:()=>value};}
    export const getDoc=getDocFromServer;
    export const runTransaction=async(_db,fn)=>{const steps=[];const result=await fn({get:getDocFromServer,set:(p,v)=>steps.push(()=>setDoc(p,v)),delete:p=>steps.push(async()=>{delete window.__cloud[p];})});for(const write of steps)await write();return result;};
    export async function setDoc(p,value){if(!navigator.onLine)throw Error('offline');window.__cloud[p]=value;window.__writes.push({p,value});if(p.startsWith('gpsSharePrefs/')){localStorage.setItem('__serverPrefs',value.public?'1':'0');localStorage.setItem('__serverRevision',String(value.revision||0));localStorage.setItem('__serverOperation',value.operationId||'');}}
    export const writeBatch=()=>{const work=[];return {set:(p,v)=>work.push([p,v]),commit:async()=>{for(const [p,v] of work)await setDoc(p,v);}};};
    export const getDocsFromServer=async()=>({docs:[{id:'other-12345678',data:()=>({openChatName:'合成対象'})}],forEach(){}});
    export const onSnapshot=(q,options,callback)=>{const fn=callback||options;
     if(typeof q==='string'){
      if(q.startsWith('gpsSharePrefs/'))window.__remotePrivacy=value=>{localStorage.setItem('__serverPrefs',value?'1':'0');const row={public:value,revision:Number(localStorage.getItem('__serverRevision')||0)+1,operationId:crypto.randomUUID()};localStorage.setItem('__serverRevision',String(row.revision));fn({exists:()=>true,data:()=>row,metadata:{fromCache:false,hasPendingWrites:false}});};
      else getDocFromServer(q).then(snap=>fn({...snap,metadata:{fromCache:false,hasPendingWrites:false}}));
     }else fn({forEach(){}});return ()=>{};};`
  };
  await context.route('https://www.gstatic.com/firebasejs/**',route=>{
   const name=route.request().url().match(/firebase-(app|auth|firestore|functions)\.js/)[1];
   return route.fulfill({contentType:'text/javascript',body:modules[name]});
  });
  await context.route('https://unpkg.com/leaflet@1.9.4/dist/**',route=>{
   const basename=path.basename(new URL(route.request().url()).pathname);
   return route.fulfill({contentType:basename.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('leaflet')),basename))});
  });
  await context.route('https://cyberjapandata.gsi.go.jp/**',route=>route.abort());
  const url='http://127.0.0.1:'+server.address().port+'/gps-sharing-test.html';
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById('historyToggle').disabled);
  await page.waitForFunction(()=>window.__gps);
  assert.equal(await page.locator('#vehicleList').isVisible(),false);
  await page.locator('#historyToggle').check();await page.evaluate(()=>window.__fix());
  await page.waitForFunction(()=>document.getElementById('historyShiftSelect').options.length===1);
  await page.evaluate(()=>window.__fix(31000));
  await page.waitForFunction(()=>document.getElementById('historyDetail').textContent.includes('2地点'));
  const download=page.waitForEvent('download');await page.locator('#historyExport').click();const file=await download;
  const csv=fs.readFileSync(await file.path(),'utf8');assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/速度（km\/h）/);
  await page.evaluate(()=>{window.__online=false;});await page.locator('#privacyToggle').uncheck();
  await page.waitForFunction(()=>document.getElementById('privacyState').textContent==='非公開切替待ち');
  await page.reload();await page.waitForFunction(()=>!document.getElementById('privacyToggle').disabled);
  await page.waitForFunction(()=>document.getElementById('privacyState').textContent==='非公開中');
  assert.equal(await page.locator('#privacyToggle').isChecked(),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('__serverPrefs')),'0');
  // 履歴OFF区間、実IndexedDB容量・監査の保存を検査。
  assert.match(await page.locator('#storageSummary').innerText(),/概算/);
  await page.evaluate(()=>{window.__online=false;});
  const second=page.waitForEvent('download');await page.locator('#historyExport').click();await second;
  await page.waitForFunction(()=>document.getElementById('auditState').textContent.includes('同期待ち'));
  const queued=await page.evaluate(()=>TAXIAPP_GPS_HISTORY_STORE.pendingAudits('driver-12345678'));
  assert.equal(queued.length,1);
  await page.evaluate(()=>{window.__remotePrivacy(true);});
  await page.waitForFunction(()=>document.getElementById('privacyToggle').checked===true);
  await page.evaluate(()=>{window.__remotePrivacy(false);});
  await page.waitForFunction(()=>document.getElementById('privacyToggle').checked===false);
  assert.deepEqual(errors,[]);
  const adminPage=await context.newPage();adminPage.on('pageerror',e=>errors.push(e.message));
  await adminPage.addInitScript(()=>{window.__admin=true;});
  await adminPage.goto(url.replace('gps-sharing-test.html','gps-history-admin.html'));
  await adminPage.waitForFunction(()=>!document.getElementById('adminPanel').hidden);
  await adminPage.locator('#target').selectOption('other-12345678');
  await adminPage.waitForFunction(()=>!document.getElementById('view').disabled);
  await adminPage.locator('#view').click();
  await adminPage.waitForFunction(()=>document.getElementById('status').textContent.includes('閲覧監査済み'));
  assert.equal(await adminPage.locator('#export').isDisabled(),false);
  await adminPage.evaluate(()=>{window.__denyAudit=true;});
  await adminPage.locator('#view').click();
  await adminPage.waitForFunction(()=>document.getElementById('status').textContent.includes('閲覧不可'));
  assert.equal(await adminPage.locator('#export').isDisabled(),true);
  assert.equal(await adminPage.locator('#delete').isDisabled(),true);
  assert.equal(await adminPage.locator('.leaflet-interactive').count(),0);
  await adminPage.evaluate(()=>{window.__denyAudit=false;});
  await adminPage.locator('#view').click();
  await adminPage.waitForFunction(()=>document.getElementById('status').textContent.includes('閲覧監査済み'));
  adminPage.once('dialog',dialog=>dialog.accept());
  const adminDownload=adminPage.waitForEvent('download');await adminPage.locator('#export').click();
  const adminCsv=await adminDownload;assert.ok(fs.readFileSync(await adminCsv.path(),'utf8').startsWith('\ufeff'));
  adminPage.once('dialog',dialog=>dialog.accept());await adminPage.locator('#delete').click();
  await adminPage.waitForFunction(()=>document.getElementById('status').textContent.includes('履歴 1乗務'));
  assert.equal(await adminPage.locator('#export').isDisabled(),true);
  assert.ok((await adminPage.evaluate(()=>window.__calls)).includes('deleteGpsHistory'));
  await adminPage.locator('#auditRefresh').click();
  await adminPage.waitForFunction(()=>document.getElementById('status').textContent.includes('監査ログ 0件'));
  await adminPage.evaluate(()=>window.__authChanged(null));
  assert.equal(await adminPage.locator('#adminPanel').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('成功：390px実DOM・Leaflet・IndexedDB点列・BOM CSV・非公開切替/再起動再送・オフラインCSV監査・他端末設定受信・管理者閲覧/監査失敗/CSV/削除/ログアウト。Firebase/GPSは合成。');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
