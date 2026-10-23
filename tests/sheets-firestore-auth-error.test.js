'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('google-apps-script/FirestoreSheetDirectImport.gs','utf8');
const ctx={Date,JSON,Number,String,Object,Array,Error,RegExp,console,
 PropertiesService:{getScriptProperties:()=>({getProperty:key=>({
 TAXIAPP_PRINT_OWNER_EMAIL:'owner@example.com',TAXIAPP_FIREBASE_WEB_API_KEY:'A'.repeat(30)})[key]||''})},
 Session:{getActiveUser:()=>({getEmail:()=> 'owner@example.com'}),getEffectiveUser:()=>({getEmail:()=> 'owner@example.com'})},
 ScriptApp:{getIdentityToken:()=> 'eyJ.aGVsbG8.signature'},
 firestorePrintConfigDraft_:()=>({project:'test-project',uid:'owner-uid'}),
 UrlFetchApp:{fetch:()=>({getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:{
 message:'INVALID_IDP_RESPONSE : Token rejected',private:'private-oauth'}})})}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
assert.throws(()=>ctx.firestoreSheetFirebaseToken_(),e=>{
 assert.match(e.message,/HTTP 400／理由 INVALID_IDP_RESPONSE/);
 assert.doesNotMatch(e.message,/private-oauth/);return true;
});
ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:{message:'private-oauth'}})});
assert.throws(()=>ctx.firestoreSheetFirebaseToken_(),e=>{
 assert.match(e.message,/理由 UNKNOWN/);assert.doesNotMatch(e.message,/private-oauth/);return true;
});
console.log('Firebase認証失敗の原因だけを安全表示');
