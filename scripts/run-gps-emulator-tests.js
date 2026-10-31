// GPS専用のローカル検証。既存firebase.json/firestore.rulesと本番を変更しない。
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'taxiapp-gps-'));
const base=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const fragment=fs.readFileSync(path.join(root,'docs/gps-sharing-firestore.rules.fragment'),'utf8');
const marker='  match /{document=**}';
if(!base.includes(marker))throw Error('既存ルールの挿入先がありません');
fs.writeFileSync(path.join(temp,'firestore.rules'),base.replace(marker,()=>fragment+'\n'+marker));
fs.writeFileSync(path.join(temp,'firebase.json'),JSON.stringify({firestore:{rules:'firestore.rules'},emulators:{firestore:{host:'127.0.0.1',port:8189},ui:{enabled:false},singleProjectMode:true}}));
const cli=require.resolve('firebase-tools/lib/bin/firebase.js');
const result=spawnSync(process.execPath,[cli,'emulators:exec','--only','firestore','--project','demo-taxiapp-gps','--config',path.join(temp,'firebase.json'),
 '"'+process.execPath+'" --test "'+path.join(root,'tests/gps-firestore.emulator.cjs')+'"'],{cwd:temp,stdio:'inherit',env:{...process.env,GPS_TEST_RULES:path.join(temp,'firestore.rules')}});
process.exitCode=result.status??1;
