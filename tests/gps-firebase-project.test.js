'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const project=require('../gps-firebase-project');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const window={};vm.runInNewContext(source('gps-firebase-config.js'),{window});
const gps=window.TAXIAPP_GPS_FIREBASE_CONFIG,diary={projectId:'taxiapp-2b6bd'};
test('既存の日報AppがあってもGPS専用Appを新規作成する',()=>{
 const old={name:'[DEFAULT]',options:diary},calls=[];
 const sdk={getApps:()=>[old],initializeApp:(options,name)=>{calls.push({options,name});return {name,options};}};
 const result=project.initialize(sdk,gps,diary);
 assert.equal(calls.length,1);assert.equal(result.name,'TAXIAPP_GPS');
 assert.equal(result.options.projectId,'taxigps-9f82e');
 assert.equal(old.options.projectId,'taxiapp-2b6bd');
 assert.equal(Object.isFrozen(gps),true);
 assert.equal('storageBucket' in gps,false);assert.equal('measurementId' in gps,false);
});
test('一致したGPS専用Appだけを再利用し同名の誤接続Appは拒否する',()=>{
 const app={name:'TAXIAPP_GPS',options:gps};
 assert.equal(project.initialize({getApps:()=>[app]},gps,diary),app);
 assert.throws(()=>project.initialize({getApps:()=>[{name:'TAXIAPP_GPS',options:{...gps,projectId:diary.projectId}}]},gps,diary),/接続先が異なる/);
});
test('設定欠落・日報と同一・別プロジェクト・別アプリは接続前に拒否する',()=>{
 for(const invalid of [null,diary,{...gps,projectId:'other-project'},{...gps,authDomain:diary.projectId+'.firebaseapp.com'},{...gps,appId:'1:other:web:bad'}])
  assert.throws(()=>project.configFor(invalid,diary));
 assert.throws(()=>project.configFor(gps,{projectId:gps.projectId}),/保存先が同じ/);
});
for(const page of ['gps-sharing-test.js','gps-history-admin.js'])test(page+'：GPS設定欠落では停止設定を外してもSDK・測位・地図を開始しない',async()=>{
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{toggle(){}}});return nodes.get(id);};
 const window={TAXIAPP_GPS_CLOUD_POLICY:{enabled:true},TAXIAPP_GPS_FIREBASE_PROJECT:project,TAXIAPP_FIREBASE_CONFIG:diary,TAXIAPP_GPS_SHARING_CORE:{}};
 let imports=0;
 const context=vm.createContext({window,document:{getElementById:node},TextEncoder,
  navigator:new Proxy({},{get(){throw Error('測位開始は禁止');}})});
 await new vm.Script(source(page),{importModuleDynamically(){imports++;throw Error('SDK importは禁止');}}).runInContext(context);
 assert.equal(imports,0);assert.match(node(page==='gps-sharing-test.js'?'connection':'status').textContent,/GPS専用Firebase/);
});
