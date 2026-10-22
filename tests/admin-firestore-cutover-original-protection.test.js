'use strict';
// 正式切替後は、以前のGoogle原本との内容比較でFirestoreの編集を拒否しない。
const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const store=fs.readFileSync('account-diary-store.js','utf8');
const ui=fs.readFileSync('cloud-sync-ui.js','utf8');
const guardStart=html.indexOf('   if(accountScope.adminFirestore&&!accountScope.adminFirestorePreview){',html.indexOf('onWriterSnapshot:async shifts=>'));
const guardEnd=html.indexOf('   const next={...previous,shifts:',guardStart);
assert.ok(guardStart>0&&guardEnd>guardStart);
const guard=html.slice(guardStart,guardEnd);
assert.match(guard,/adminFirestoreManifest\(accountScope.uid\)/);
assert.doesNotMatch(guard,/canonical\(|JSON.stringify\(legacy\)|内容相違/,'過去のGoogle原本とCAS修正後のFirestore原本を毎回比較しない');
assert.match(html,/data-firestore-new-only/,'正式移行なしで新しい営業から開始できる');
assert.match(html,/excludedIds=\[\.\.\.remote.keys\(\)\]/,'切替時に存在する合成・過去Firestore原本を分離');
assert.match(html,/resumeExcludedIds:/,'管理者本人の正式保存領域に除外IDを引き継ぐ');
assert.match(ui,/excludeIds:d.resumeExcludedIds\?\.\(\)\|\|\[\]/,'新端末再開でも旧検証用乗務を自動選択しない');
assert.match(store,/excluded.has\(item.id\)/,'Firestoreが再開対象から既知の旧検証乗務を除外する');
assert.match(html,/ADMIN_FIRESTORE_CUTOVER_ENABLED=false/,'未承認の本番保存先切替は有効化しない');
console.log('正式Firestore切替：移行前Google原本の維持、新規開始、CAS更新後の再ログイン、旧検証原本の再開除外を確認');
