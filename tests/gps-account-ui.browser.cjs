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
  const options={headless:true,executablePath:await binary.executablePath(),args:binary.args};
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
  let firebaseImports=0,mode='success';page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   navigator.geolocation.watchPosition=()=>{throw Error('本人連携中に測位を開始してはいけない');};
   localStorage.setItem('taxiapp-diary-protection-sentinel','未同期の日報を保持');
  });
  await context.route('https://unpkg.com/**',route=>route.abort());
  await context.route('https://www.gstatic.com/firebasejs/**',route=>{
   firebaseImports++;
   if(route.request().url().endsWith('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:`
    const apps=[{name:'[DEFAULT]',options:{projectId:'taxiapp-2b6bd'}}];window.__createdAuthApps=[];export const getApps=()=>apps;export const initializeApp=(options,name='[DEFAULT]')=>{window.__createdAuthApps.push(name);const app={name,options};apps.push(app);return app;};`});
   if(route.request().url().endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:`
    const auths=new Map();const user=uid=>({uid,emailVerified:true,email:'synthetic@example.invalid',providerData:[{providerId:'google.com',uid:'same-google-subject'}],getIdToken:async()=>uid+'-invalid-synthetic-token'});
    export function getAuth(app){if(app.name==='[DEFAULT]')throw Error('日報本体のAuthを開始してはいけない');if(!auths.has(app.name))auths.set(app.name,{app,currentUser:user(app.options.projectId==='taxiapp-2b6bd'?'diary-ui-user':'gps-ui-user'),authStateReady:async()=>{}});return auths.get(app.name);}
    export function onAuthStateChanged(auth,fn){fn(auth.currentUser);return()=>{};}
    export class GoogleAuthProvider{setCustomParameters(){}}
    export async function signInWithPopup(){throw Error('この試験はログイン操作を合成済み');}`});
   return route.abort();
  });
  if(!live)await context.route('https://script.google.com/macros/s/**/exec',route=>{
   const body=route.request().postDataJSON();requests.push(body);
   const response=mode==='success'?{ok:true,data:{diaryUid:'diary-ui-user',gpsUid:'gps-ui-user',writerSessionId:null,validUntilMs:Date.now()+300000}}:{ok:false,code:'unauthenticated'};
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
   console.log('実DOM＋合成認証：明示ボタン後だけ認証連携・別UIDの照合・失敗表示・GPS停止・日報保持を確認。');
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('taxiapp-diary-protection-sentinel')),'未同期の日報を保持');
  assert.equal(await page.locator('main button:enabled,main input:enabled').count(),0);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
