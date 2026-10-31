'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const bridge=require('../gps-account-bridge');
const source=fs.readFileSync(path.join(__dirname,'../google-apps-script/gps-account-broker/Code.gs'),'utf8');
const writer='s'.repeat(32),endpoint='https://script.google.com/macros/s/mock-deployment/exec';
function fixture(options={}){
 const calls=[],db=new Map(),now=Math.floor(Date.now()/1000);
 const name=(project,p)=>'projects/'+project+'/databases/(default)/documents/'+p;
 const field=x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='boolean'?{booleanValue:v}:{stringValue:v}]));
 const put=(project,p,x)=>db.set(name(project,p),{name:name(project,p),fields:field(x),updateTime:'2026-10-31T00:00:00.000001Z'});
 put(bridge.DIARY_PROJECT,'users/diary-user',{status:options.suspended?'suspended':'active',openChatName:'合成利用者'});
 if(options.admin)put(bridge.DIARY_PROJECT,'admins/diary-user',{enabled:true});
 put(bridge.DIARY_PROJECT,'deviceSessions/diary-user',{sessionId:writer});
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 function token(project,uid,subject){
  return encode({alg:'RS256',kid:'synthetic'})+'.'+encode({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid,
   exp:now+3600,iat:now-5,auth_time:now-10,email:'synthetic@example.invalid',email_verified:true,
   firebase:{sign_in_provider:'google.com',identities:{'google.com':[subject]}}})+'.synthetic-signature';
 }
 const day=token(bridge.DIARY_PROJECT,'diary-user','google-identity'),gps=token(bridge.GPS_PROJECT,'gps-user',options.otherGoogle?'different-google':'google-identity');
 const accounts=new Map([[day,{localId:'diary-user'}],[gps,{localId:'gps-user'}]]);
 for(const [key,user]of accounts){const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));Object.assign(user,{email:claims.email,emailVerified:true,validSince:String(now-100),providerUserInfo:[{providerId:'google.com',rawId:claims.firebase.identities['google.com'][0]}]});}
 let committed=false,lockReleased=false;
 const response=(status,body)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(body)});
 const context=vm.createContext({console:{log(){throw Error('認証情報をログ出力してはいけない');}},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  Utilities:{base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})},
  ScriptApp:{getOAuthToken:()=> 'mock-owner'},
  LockService:{getScriptLock:()=>({tryLock:()=>!options.busy,releaseLock:()=>{lockReleased=true;}})},
  UrlFetchApp:{fetch:(url,req)=>{
   calls.push({url,req});const payload=req.payload?JSON.parse(req.payload):null;
   if(url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=')){
    if(options.badToken)return response(400,{error:{message:'INVALID_ID_TOKEN'}});
    let user=accounts.get(payload.idToken);
    if(user&&options.lookupMismatch)user={...user,localId:'different-user'};
    if(user&&options.revoked)user={...user,validSince:String(now)};
    if(user&&options.unverified)user={...user,emailVerified:false};
    return user?response(200,{users:[user]}):response(400,{});
   }
   assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/'));
   const resource=url.slice('https://firestore.googleapis.com/v1/'.length),primary=resource.includes('/'+bridge.DIARY_PROJECT+'/');
   if(primary){assert.equal(req.headers.Authorization,'Bearer '+day);assert.match(resource,/\/documents\/(users|admins|deviceSessions)\/diary-user$/);}
   else assert.equal(req.headers.Authorization,'Bearer mock-owner');
   if(req.method==='get'){
    const doc=db.get(resource);if(!doc)return response(404,{});
    if(committed&&options.badReadback&&resource.endsWith('/users/gps-user'))return response(200,{...doc,fields:field({status:'active',diaryUid:'wrong',googleSubject:'google-identity'})});
    return response(200,doc);
   }
   assert.equal(primary,false);assert.ok(resource.endsWith('/documents:commit'));
   if(options.commitFailed)return response(503,{});
   for(const write of payload.writes){const old=db.get(write.update.name);
    if(write.currentDocument.exists===false&&old||write.currentDocument.updateTime&&old?.updateTime!==write.currentDocument.updateTime)return response(409,{});
   }
   for(const write of payload.writes)db.set(write.update.name,{...write.update,updateTime:'2026-10-31T00:00:01.000001Z'});
   committed=true;return response(200,{writeResults:payload.writes.map(()=>({updateTime:'2026-10-31T00:00:01.000001Z'}))});
  }}
 });vm.runInContext(source,context);
 const post=data=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({action:'link',diaryIdToken:day,gpsIdToken:gps,writerSessionId:writer,...data})}}).text);
 return {post,db,calls,name,put,day,gps,lockReleased:()=>lockReleased};
}
test('GAS連携：別UIDの同一Google利用者を照合しGPSだけへ権限/操作端末を保存・読戻し',()=>{
 const f=fixture({admin:true}),result=f.post({isAdmin:false});
 assert.equal(result.ok,true);assert.equal(result.data.diaryUid,'diary-user');assert.equal(result.data.gpsUid,'gps-user');
 assert.equal(result.data.writerSessionId,writer);
 assert.equal(f.db.get(f.name(bridge.GPS_PROJECT,'admins/gps-user')).fields.enabled.booleanValue,true);
 assert.equal(f.db.get(f.name(bridge.GPS_PROJECT,'deviceSessions/gps-user')).fields.sessionId.stringValue,writer);
 assert.ok(f.lockReleased());
 for(const doc of f.db.values())assert.equal(/synthetic-signature|synthetic@example/.test(JSON.stringify(doc)),false);
 assert.equal(f.calls.filter(x=>x.req.method==='post'&&x.url.startsWith('https://firestore')).length,1);
});
test('GAS連携：本人が送った管理者フラグを採用せず、閲覧端末は操作権を取得しない',()=>{
 const f=fixture(),result=f.post({writerSessionId:null,isAdmin:true,diaryUid:'other'});
 assert.equal(result.ok,true);
 assert.equal(f.db.get(f.name(bridge.GPS_PROJECT,'admins/gps-user')).fields.enabled.booleanValue,false);
 assert.equal(f.db.has(f.name(bridge.GPS_PROJECT,'deviceSessions/gps-user')),false);
});
for(const [name,options,data,code]of [
 ['別Googleアカウント',{otherGoogle:true},{},'account-mismatch'],
 ['失効/不正トークン',{badToken:true},{},'unavailable'],
 ['検証済みUIDとJWTの不一致',{lookupMismatch:true},{},'unauthenticated'],
 ['再認証前に失効させたトークン',{revoked:true},{},'unauthenticated'],
 ['メール未確認',{unverified:true},{},'unauthenticated'],
 ['日報の利用資格なし',{suspended:true},{},'permission-denied'],
 ['古い操作端末',{}, {writerSessionId:'t'.repeat(32)},'not-editor'],
 ['ロック競合',{busy:true},{},'busy'],
 ['コミット失敗',{commitFailed:true},{},'unavailable'],
 ['保存内容不一致',{badReadback:true},{},'readback-mismatch']
])test('GAS連携：'+name+'で成功応答を返さない',()=>{
 const f=fixture(options),result=f.post(data);assert.equal(result.ok,false);assert.equal(result.code,code);
 if(!options.badReadback)assert.equal(f.db.has(f.name(bridge.GPS_PROJECT,'users/gps-user')),false);
});
test('GAS連携：既存の別UID対応表を無断上書きしない',()=>{
 const f=fixture();f.put(bridge.GPS_PROJECT,'gpsAccountLinks/diary-user',{gpsUid:'other-gps',googleSubject:'google-identity'});
 assert.equal(f.post().code,'link-conflict');assert.ok(f.lockReleased());
 assert.equal(f.db.get(f.name(bridge.GPS_PROJECT,'gpsAccountLinks/diary-user')).fields.gpsUid.stringValue,'other-gps');
});
test('GAS連携：GETは状態だけ返し、未対応の履歴操作や壊れたPOSTを拒否',()=>{
 const f=fixture();assert.equal(f.post({action:'saveOwnGpsHistory'}).code,'invalid-argument');
 assert.equal(f.calls.length,0);
});
test('GAS連携：日報とGPSのトークン取り違えを外部照会前に拒否',()=>{
 const f=fixture(),r=f.post({diaryIdToken:f.gps});assert.equal(r.code,'unauthenticated');assert.equal(f.calls.length,0);
});
function clientFixture({pendingTokens=false,pendingResponse=false}={}){
 const calls=[],user=(uid)=>({uid,emailVerified:true,providerData:[{providerId:'google.com',uid:'google-identity'}],getIdToken:async()=>uid+'-synthetic-token'});
 const d=user('diary-user'),g=user('gps-user');let release;
 const deferred=new Promise(resolve=>release=resolve);
 if(pendingTokens)d.getIdToken=()=>deferred;
 const diaryAuth={app:{options:{projectId:bridge.DIARY_PROJECT}},currentUser:d},gpsAuth={app:{options:{projectId:bridge.GPS_PROJECT}},currentUser:g};
 const fetch=async(url,options)=>{calls.push({url,options});if(pendingResponse)await deferred;return {ok:true,json:async()=>({ok:true,data:{diaryUid:d.uid,gpsUid:g.uid,writerSessionId:JSON.parse(options.body).writerSessionId,validUntilMs:Date.now()+300000}})};};
 return {diaryAuth,gpsAuth,calls,release,client:bridge.create({diaryAuth,gpsAuth,endpoint,fetch})};
}
test('ブラウザ連携：トークンをURLに含めず専用POST本文へ送る',async()=>{
 const f=clientFixture(),r=await f.client.link(writer);assert.equal(r.diaryUid,'diary-user');assert.equal(r.gpsUid,'gps-user');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,endpoint);assert.equal(f.calls[0].options.credentials,'omit');
 assert.equal(JSON.parse(f.calls[0].options.body).diaryIdToken,'diary-user-synthetic-token');
});
test('ブラウザ連携：別Googleアカウント/未確認メール/保存先の混同を拒否',()=>{
 const user={uid:'a',emailVerified:true,providerData:[{providerId:'google.com',uid:'subject'}]};
 assert.throws(()=>bridge.pair(user,{...user,uid:'b',providerData:[{providerId:'google.com',uid:'different'}]}));
 assert.throws(()=>bridge.pair(user,{...user,emailVerified:false}));
 const f=clientFixture();assert.throws(()=>bridge.create({diaryAuth:f.diaryAuth,gpsAuth:f.diaryAuth,endpoint}));
 for(const url of ['',endpoint+'?token=bad','https://example.invalid/exec',endpoint.replace('/exec','/dev')])
  assert.throws(()=>bridge.create({diaryAuth:f.diaryAuth,gpsAuth:f.gpsAuth,endpoint:url}));
});
test('ブラウザ連携：トークン取得中のログイン切替では送信しない',async()=>{
 const f=clientFixture({pendingTokens:true}),p=f.client.link();await Promise.resolve();f.diaryAuth.currentUser=null;f.release('synthetic');
 await assert.rejects(p,/切り替わりました/);assert.equal(f.calls.length,0);
});
test('ブラウザ連携：応答待ち/待ち行列中に切り替わった利用者を確定しない',async()=>{
 const f=clientFixture({pendingResponse:true}),p=f.client.link(),queued=f.client.link();
 for(let n=0;n<10&&!f.calls.length;n++)await Promise.resolve();
 f.client.invalidate();f.release();await assert.rejects(p,/切り替わりました/);await assert.rejects(queued,/切り替わりました/);
 assert.equal(f.calls.length,1);
});
