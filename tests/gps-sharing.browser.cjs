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
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__online=true;Object.defineProperty(navigator,'onLine',{get:()=>window.__online});
   window.__writes=[];window.__cloud={};
   window.__fix=(offset=0)=>window.__gps?.({timestamp:Date.now()+offset,coords:{latitude:34.7,longitude:135.4,accuracy:8,speed:0,heading:0}});
   navigator.geolocation.watchPosition=callback=>{window.__gps=callback;return 1;};
   navigator.geolocation.clearWatch=()=>{window.__gps=null;};
   if(!localStorage.getItem('taxiapp-account-state-v1-driver-12345678'))localStorage.setItem('taxiapp-account-state-v1-driver-12345678',JSON.stringify({version:1,activeId:'shift-100',shifts:[{id:'shift-100',startedIso:new Date(Date.now()-60000).toISOString(),draft:null}]}));
  });
  const modules={
   app:`export const getApps=()=>[];export const initializeApp=()=>({});export const getApp=()=>({});`,
   auth:`const user={uid:'driver-12345678',displayName:'合成テスト'};export const getAuth=()=>({currentUser:user});export const onAuthStateChanged=(auth,fn)=>{setTimeout(()=>fn(user),0);};`,
   functions:`export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async data=>({data:{status:'saved',operationId:data.operationId}});`,
   firestore:`export const getFirestore=()=>({});export const doc=(_db,...p)=>p.join('/');export const collection=doc;export const query=(...p)=>p;export const where=(...p)=>p;export const orderBy=(...p)=>p;export const limit=x=>x;
    export const serverTimestamp=()=>Date.now();export const Timestamp={fromMillis:n=>({millis:n})};
    export async function getDocFromServer(p){if(!navigator.onLine)throw Error('offline');let value=window.__cloud[p];
     if(p.startsWith('users/'))value={status:'active',openChatName:'合成テスト'};
     if(p.startsWith('gpsSharePrefs/'))value={public:localStorage.getItem('__serverPrefs')!=='0'};
     return {exists:()=>!!value,data:()=>value};}
    export const getDoc=getDocFromServer;
    export async function setDoc(p,value){if(!navigator.onLine)throw Error('offline');window.__cloud[p]=value;window.__writes.push({p,value});if(p.startsWith('gpsSharePrefs/'))localStorage.setItem('__serverPrefs',value.public?'1':'0');}
    export const writeBatch=()=>{const work=[];return {set:(p,v)=>work.push([p,v]),commit:async()=>{for(const [p,v] of work)await setDoc(p,v);}};};
    export const getDocsFromServer=async()=>({forEach(){}});
    export const onSnapshot=(_q,fn)=>{fn({forEach(){}});return ()=>{};};`
  };
  await page.route('https://www.gstatic.com/firebasejs/**',route=>{
   const name=route.request().url().match(/firebase-(app|auth|firestore|functions)\.js/)[1];
   return route.fulfill({contentType:'text/javascript',body:modules[name]});
  });
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/**',route=>{
   const basename=path.basename(new URL(route.request().url()).pathname);
   return route.fulfill({contentType:basename.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('leaflet')),basename))});
  });
  await page.route('https://cyberjapandata.gsi.go.jp/**',route=>route.abort());
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
  assert.deepEqual(errors,[]);
  console.log('成功：390px実DOM・Leaflet・IndexedDB点列・BOM CSV・非公開切替/再起動再送・オフラインCSV監査。Firebase/GPSは合成。');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
