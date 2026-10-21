'use strict';
// Synthetic standalone device lab must never load real diary or cloud features.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','labs','print-v2-device-preview.html'),'utf8');
assert.match(html,/<title>TAXIAPP 印刷V2 実機テスト｜合成データ専用<\/title>/);
assert.match(html,/connect-src 'none'/);
assert.match(html,/form-action 'none'/);
assert.match(html,/合成データ専用・実運用禁止/);
assert.match(html,/id="latest"/);
assert.match(html,/id="selectDuty"/);
assert.match(html,/id="derived"/);
assert.match(html,/data-testid="pageCount/);
assert.match(html,/type="button" data-testid="runTests"/);
for(const blocked of [
 /<script\s+src=/i,/<link\s+rel="stylesheet"/i,/<iframe/i,/<form\b/i,
 /\bfetch\(/, /XMLHttpRequest/,/indexedDB/,/localStorage/,/sessionStorage/,
 /navigator\.geolocation/,/firebase\.auth/,/firestore\.collection/,/https?:\/\//
]){
 assert.doesNotMatch(html,blocked,'device lab cannot use network, browser data or external code');
}
const m=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(m,'self-contained inline JS must exist');
new vm.Script(m[1]);
const main=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.doesNotMatch(main,/labs\/print-v2-device-preview/,'production app must stay isolated');
console.log('V2 offline device test page source and no-data-write guards PASS');
