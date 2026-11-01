'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
for(const page of ['gps-sharing-test.js','gps-history-admin.js']){
 for(const missing of [false,true])test(page+'：停止設定'+(missing?'欠落':'あり')+'で通信・測位・保存を開始しない',async()=>{
  const nodes=new Map(),controls=[{disabled:false},{disabled:false}];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,classList:{toggle(){}}});return nodes.get(id);};
  const context=vm.createContext({window:{},document:{getElementById:node,querySelectorAll:()=>controls},
   navigator:new Proxy({}, {get(){throw Error('測位などを開始してはいけない');}}),
   localStorage:{getItem(){throw Error('既存データに触れてはいけない');},setItem(){throw Error('既存データに触れてはいけない');}},
   setInterval(){throw Error('バックグラウンド処理を開始してはいけない');}});
  if(!missing)vm.runInContext(source('gps-cloud-policy.js'),context);
  let imports=0;
  await new vm.Script(source(page),{importModuleDynamically(){imports++;throw Error('Firebase importは禁止');}}).runInContext(context);
  assert.equal(imports,0);assert.ok(controls.every(x=>x.disabled));
  assert.match(node(page==='gps-sharing-test.js'?'connection':'status').textContent,/日報/);
  if(!missing){assert.equal(context.window.TAXIAPP_GPS_CLOUD_POLICY.enabled,false);assert.ok(Object.isFrozen(context.window.TAXIAPP_GPS_CLOUD_POLICY));}
 });
}
