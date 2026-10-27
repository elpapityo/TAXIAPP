'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const live=fs.readFileSync('index.html','utf8');
const demo=fs.readFileSync('demo/index.html','utf8');
assert.match(demo,/<title>TAXIAPP v0\.3\.207 — 公開操作デモ<\/title>/);
assert.match(demo,/connect-src 'none'/);
assert.match(demo,/default-src 'none'/);
assert.doesNotMatch(demo,/<script\s+src=|<iframe\b|<link\s+rel="preload"/i);
assert.equal((demo.match(/<script\b/g)||[]).length,1,'all scripts inline');
for(const [,code] of demo.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(code.trim())new Function(code);}
assert.match(demo,/const localStorage=demoMemoryStorage,navigator=demoNavigator,fetch=demoBlockedFetch,indexedDB=undefined/);
assert.match(demo,/const syncUI=demoSync/);
assert.match(demo,/const accountDiary=demoDiary/);
assert.doesNotMatch(demo,/window\.TAXIAPP_ACCOUNT_AUTO\.create\(\{|window\.TAXIAPP_SYNC_UI\(\{|window\.TAXIAPP_ACCOUNT_DIARY\.create\(\)/);
assert.match(demo,/model\.prefs\.ui=\{\.\.\.displayPrefs\(\),driveLayout:'meter',simpleMode:'on',screenMode:'phone'\}/);
assert.match(demo,/function renderDriveLogbook\(/);
assert.match(demo,/function renderMeterDrive\(/);
assert.match(demo,/function renderHighwaySections\(/);
assert.match(demo,/function simpleModeActive\(/);
for(const mark of ['function pricing(','function totals(','function settledTenderAmounts(','function renderDriveLogbook(','function renderMeterDrive(']){
 assert.ok(live.includes(mark)&&demo.includes(mark),'missing shared production component '+mark);
 const signature=live.slice(live.indexOf(mark),live.indexOf(mark)+140);
 assert.equal(demo.slice(demo.indexOf(mark),demo.indexOf(mark)+140),signature,
   'demo function must originate from production: '+mark);
}
assert.match(demo,/window\.__TAXIAPP_DEMO__=Object\.freeze/);
console.log('PASS: current UI source, isolation, CSP, volatile storage, production computations');
