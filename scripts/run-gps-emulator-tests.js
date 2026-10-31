// GPS専用のローカル検証。既存firebase.json/firestore.rulesと本番を変更しない。
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'taxiapp-gps-'));
const base=fs.readFileSync(process.env.GPS_RULES_BASE?path.resolve(root,process.env.GPS_RULES_BASE):path.join(root,'firestore.rules'),'utf8');
const fragment=fs.readFileSync(path.join(root,'docs/gps-sharing-firestore.rules.fragment'),'utf8');
const marker=/^[ \t]*match \/\{document=\*\*\}/gm;
if([...base.matchAll(marker)].length!==1)throw Error('既存ルールの挿入先を一意に確認できません');
fs.writeFileSync(path.join(temp,'firestore.rules'),base.replace(marker,match=>fragment+'\n'+match));
const network=process.env.GPS_HTTP_TEST==='1';
const config={firestore:{rules:'firestore.rules'},emulators:{firestore:{host:'127.0.0.1',port:8189},ui:{enabled:false},singleProjectMode:true}};
if(network){
 config.emulators.auth={host:'127.0.0.1',port:9098};
}
fs.writeFileSync(path.join(temp,'firebase.json'),JSON.stringify(config));
const cli=require.resolve('firebase-tools/lib/bin/firebase.js');
const result=spawnSync(process.execPath,[cli,'emulators:exec','--only',network?'firestore,auth':'firestore','--project','demo-taxiapp-gps','--config',path.join(temp,'firebase.json'),
 '"'+process.execPath+'" --test "'+path.join(root,'tests/gps-firestore.emulator.cjs')+'"'+(network?' "'+path.join(root,'tests/gps-sharing.network.cjs')+'"':'')],{cwd:temp,stdio:'inherit',env:{...process.env,GPS_TEST_RULES:path.join(temp,'firestore.rules')}});
process.exitCode=result.status??1;
