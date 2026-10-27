'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const live=fs.readFileSync('index.html','utf8');
const demo=fs.readFileSync('demo/index.html','utf8');
assert.match(demo,/<title>TAXIAPP v0\.3\.212 — 公開操作デモ<\/title>/);
assert.match(demo,/<html lang="ja">/,'login-free demo must start without authentication lock');
assert.doesNotMatch(demo,/<html\b[^>]*class="[^"]*taxi-auth-locked/,'never hide the demo app behind production login CSS');
assert.match(demo,/html\.taxi-auth-locked #accountBar,[\s\S]*?#app/,'production style is still present, so keeping auth lock would blank the demo');
assert.match(demo,/connect-src 'self' https:\/\/mreversegeocoder\.gsi\.go\.jp;/,'GSI + site-local lookup only');
assert.match(demo,/default-src 'none'/);
assert.doesNotMatch(demo,/<script\s+src=|<iframe\b|<link\s+rel="preload"/i);
assert.equal((demo.match(/<script\b/g)||[]).length,1,'all scripts inline');
for(const [,code] of demo.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(code.trim())new Function(code);}
assert.match(demo,/const localStorage=demoMemoryStorage,navigator=demoNavigator,fetch=demoBlockedFetch,indexedDB=undefined/);
assert.match(demo,/get geolocation\(\)\{return window\.navigator\.geolocation;\}/,'device geolocation is exposed only when used');
assert.match(demo,/get permissions\(\)\{return window\.navigator\.permissions;\}/,'permission API is available in demo');
assert.match(demo,/navigator\.geolocation\.getCurrentPosition/,'production location capture is enabled');
assert.match(demo,/TAXIAPP_GPS_TRIP=Object\.freeze/,'browser GPS distance engine stays embedded');
assert.match(demo,/TAXIAPP_GPS_UI=/,'the production trip UI stays embedded');
assert.match(demo,/function reverseAddress\(gps\)/,'offline GPS location labeling is enabled');
assert.match(demo,/国土地理院へ送信して町名・丁目に変換/,'disclose third-party position lookup');
assert.match(demo,/demoGsiConsent=window\.confirm\(/,'requires permission before GSI request');
assert.match(demo,/fetch\('\.\.\/municipalities\.json'/,'municipalities data available from parent folder');
assert.match(demo,/https:\/\/mreversegeocoder\.gsi\.go\.jp\/reverse-geocoder\/LonLatToAddress/);
assert.match(demo,/deviceGpsEnabled:true/);
assert.doesNotMatch(demo,/demoForbiddenActions=\/[^\n]*\|gps\|permission\|/,'GPS controls must be accessible');
assert.match(demo,/const gsi=url\.startsWith\('https:\/\/mreversegeocoder\.gsi\.go\.jp\/reverse-geocoder\/LonLatToAddress\?'\)/);
assert.match(demo,/return Promise\.reject\(Error\('独立デモでは未許可の通信を遮断しました'\)\)/);
assert.doesNotMatch(demo,/window\.TAXIAPP_SYNC_UI\(\{|window\.TAXIAPP_ACCOUNT_DIARY\.create\(\)/,'other production services remain unavailable');

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
