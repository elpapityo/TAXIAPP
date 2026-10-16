/* TAXIAPP encrypted PC-to-phone migration package.
 * Confidential business records and the Google Apps Script access key are
 * encrypted locally; no upload, paid API or external service is involved.
 */
(function(root){
'use strict';
const KIND='TAXIAPP_SECURE_MIGRATION_V1',ITERATIONS=310000;
const encoder=new TextEncoder(),decoder=new TextDecoder();
function crypt(){
 const c=root.crypto;
 if(!c?.subtle||!c.getRandomValues)throw Error('安全な暗号化機能を利用できません。HTTPSのChromeで開いてください。');
 return c;
}
function base64(arr){
 let result='';
 for(let i=0;i<arr.length;i+=8192)result+=String.fromCharCode(...arr.subarray(i,i+8192));
 return btoa(result);
}
function bytes(v){
 if(typeof v!=='string'||!v||v.length>24000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(v)||v.length%4!==0)
  throw Error('ファイル形式が不正です');
 try{return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
 catch{throw Error('暗号化データを読み取れません');}
}
async function keyFor(password,salt){
 const c=crypt();
 const material=await c.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 return c.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},
  material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function passwordOk(password){return typeof password==='string'&&password.length>=12&&password.length<=256;}
async function encrypt(value,password){
 if(!passwordOk(password))throw Error('移行用パスワードは12文字以上256文字以内で指定してください');
 const c=crypt(),salt=c.getRandomValues(new Uint8Array(16)),iv=c.getRandomValues(new Uint8Array(12));
 const key=await keyFor(password,salt);
 const data=encoder.encode(JSON.stringify(value));
 const cipher=await c.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(KIND)},
   key,data);
 return {kind:KIND,version:1,iterations:ITERATIONS,
  exportedAt:new Date().toISOString(),salt:base64(salt),iv:base64(iv),
  ciphertext:base64(new Uint8Array(cipher))};
}
async function decrypt(envelope,password){
 if(!passwordOk(password))throw Error('移行用パスワードを入力してください（12文字以上）');
 if(!envelope||envelope.kind!==KIND||envelope.version!==1||envelope.iterations!==ITERATIONS)
  throw Error('TAXIAPPの暗号化一括移行ファイルではありません');
 const salt=bytes(envelope.salt),iv=bytes(envelope.iv),cipher=bytes(envelope.ciphertext);
 if(salt.length!==16||iv.length!==12||cipher.length<17)
  throw Error('暗号化ファイルの内容が不正です');
 let plain;
 try{
   const key=await keyFor(password,salt);
   plain=await crypt().subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(KIND)},key,cipher);
 }catch{throw Error('パスワードが違うか、ファイルが破損しています');}
 try{return JSON.parse(decoder.decode(plain));}
 catch{throw Error('移行データの形式を読み取れません');}
}
root.TAXIAPP_TRANSFER=Object.freeze({KIND,encrypt,decrypt,passwordOk});
})(typeof window!=='undefined'?window:globalThis);
