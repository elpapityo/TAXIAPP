// レビュー用ファイルの生成だけ。認証・接続・デプロイは行わない。
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const base=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const fragment=fs.readFileSync(path.join(root,'docs/gps-sharing-firestore.rules.fragment'),'utf8');
const marker='  match /{document=**}';
if(base.split(marker).length!==2)throw Error('既存ルールの挿入先を一意に確認できません');
const candidate=base.replace(marker,()=>fragment+'\n'+marker);
fs.writeFileSync(path.join(root,'docs/gps-sharing-firestore.rules.candidate'),candidate);
const original=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
fs.writeFileSync(path.join(root,'firebase.gps-review.json'),JSON.stringify({
 ...original,firestore:{rules:'docs/gps-sharing-firestore.rules.candidate'}
},null,2)+'\n');
console.log('未適用のFirestoreルール候補とfirebase.gps-review.jsonを生成しました。既存firebase.json/firestore.rulesと本番は変更していません。');
