'use strict';
const assert=require('node:assert/strict');
require('../secure-transfer.js');
const secure=globalThis.TAXIAPP_TRANSFER;
async function main(){
 const password='A secure passphrase 123!';
 const payload={kind:'TAXIAPP_FULL_DEVICE_SNAPSHOT_V1',model:{
  version:1,shifts:[{id:'shift-1',records:[]}],
  prefs:{driver:'日本語',sheetTarget:{webAppUrl:'https://script.google.com/macros/s/example/exec'}}
 },googleAccessKey:'SHOULD_REMAIN_ENCRYPTED'};
 const output=await secure.encrypt(payload,password);
 assert.equal(output.kind,secure.KIND);
 assert.equal(output.version,1);
 assert.equal(output.iterations,310000);
 assert.ok(!JSON.stringify(output).includes('SHOULD_REMAIN_ENCRYPTED'));
 assert.ok(!JSON.stringify(output).includes('日本語'));
 assert.deepEqual(await secure.decrypt(output,password),payload);
 const next=await secure.encrypt(payload,password);
 assert.notEqual(next.salt,output.salt);
 assert.notEqual(next.iv,output.iv);
 await assert.rejects(()=>secure.decrypt(output,'wrong password 12345'),/違うか/);
 const corrupted={...output,ciphertext:output.ciphertext.slice(0,-4)+'AAAA'};
 await assert.rejects(()=>secure.decrypt(corrupted,password));
 await assert.rejects(()=>secure.encrypt(payload,'short'),/12文字/);
 assert.equal(secure.passwordOk(password),true);
 console.log('Encrypted migration tests passed: AES-GCM round trip, secrecy, tamper and password protections.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
