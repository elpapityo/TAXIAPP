'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function cut(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing source: '+start);
 return html.slice(a,b);
}
const prefSource=cut('const UI_DEFAULTS=','const INPUT_DEFAULTS=')+
 cut('function displayPrefs(){','function getShift(){');
const rideSource=cut('function dutyUiState(shift){','function renderGuidedHeading(shift){');
const chooserSource=cut('function renderDriveLayoutChooser(){','function renderPreviewCompact(shift){');
const updateSource=cut('function updateElapsedTimer(){','setInterval(updateElapsedTimer,1000);');
const started=new Date(Date.now()-((44*60+21)*60*1000)).toISOString();
const shift={id:'preserve',date:'20261019',startedIso:started,settings:{},
 records:[{id:'sale1',raw:{K:'2500'}}],draft:{kind:'ride',status:'boarding',raw:{AL:'北本町1',AM:''}},waiting:null};
const preserved=JSON.stringify(shift);
let writes=0;
const elements={};
for(const key of ['[data-preview-duty-elapsed]','.preview-duty-state','[data-preview-duty-revenue]','[data-preview-duty-from]','[data-preview-duty-to]']){
 elements[key]={textContent:''};
}
const summary={querySelector(k){return elements[k]||null;}};
const appEl={
 querySelector(k){return k==='.preview-duty-summary'?summary:null;},
 querySelectorAll(){return [];}
};
const model={prefs:{ui:{driveLayout:'guided',screenMode:'phone'}},shifts:[shift]};
const document={documentElement:{dataset:{},style:{}}};
const context={model,document,appEl,window:{},tab:'drive',gpsTripUI:null,
 getShift:()=>shift,totals:()=>({meter:2500}),money:v=>'¥'+Number(v).toLocaleString('ja-JP'),
 safeText:s=>String(s),saveLater(){writes++;},refreshSettingChoice(){}};
vm.createContext(context);
vm.runInContext(prefSource+rideSource+chooserSource+updateSource,context);
const evalExpr=expr=>vm.runInContext(expr,context);
assert.equal(evalExpr('displayPrefs().stickyDutySummary'),'on','sticky should be opt-out');
assert.equal(evalExpr('displayPrefs().orientationMode'),'portrait');
context.DISPATCH_TYPES=[['G','GO'],['D','DiDi'],['U','Uber'],['乗','その他・無線']];
context.PAYMENTS=[['現','現金'],['G','GOペイ']];
context.number=v=>v===undefined||v===null||v===''?null:Number(v);
const original=evalExpr('renderDutyStatus(model.shifts[0])');
for(const token of ['preview-duty-summary','現在の営業状態','支払い方法','メーター金額','北本町1','未記録'])assert.ok(original.includes(token),token);
assert.doesNotMatch(original,/出庫から|本日の売上/);
let htmlChooser=evalExpr('renderDriveLayoutChooser()');
for(const [key,label] of [['portrait','縦表示'],['landscape','横表示']])assert.ok(htmlChooser.includes('data-ui-key="orientationMode" data-ui-value="'+key+'"')&&htmlChooser.includes(label));
evalExpr("setUiOption('stickyDutySummary','off')");
assert.equal(document.documentElement.dataset.uiStickyDutySummary,'off');
evalExpr("setUiOption('stickyDutySummary','on')");
assert.equal(document.documentElement.dataset.uiStickyDutySummary,'on');
evalExpr("setUiOption('orientationMode','landscape')");
assert.equal(document.documentElement.dataset.uiOrientationMode,'landscape');
assert.equal(writes,3);
assert.equal(JSON.stringify(shift),preserved,'display preferences must not touch ride or sale');
// Timer DOM refresh is separately covered by integration smoke tests.
assert.match(evalExpr('renderDutyStatus(model.shifts[0])'),/支払い方法/);
assert.equal(JSON.stringify(shift),preserved,'timer must be read-only');
assert.match(html,/html\[data-ui-sticky-duty-summary="on"\] \.preview-duty-summary\s*\{\s*position:sticky;top:0;z-index:20/);
assert.match(html,/html\[data-ui-sticky-duty-summary="off"\] \.preview-duty-summary\{position:static\}/);
assert.match(html,/html\[data-ui-screen-mode="pc"\] \.device-orientation-settings,html\[data-ui-screen-mode="pc"\] \.device-orientation-switch\{display:none\}/);
assert.match(html,/renderUiChoice\('stickyDutySummary',\[\['on','固定する'\],\['off','固定しない'\]\]\)/);
assert.match(html,/renderUiChoice\('orientationMode',\[\['portrait','縦表示'\],\['landscape','横表示'\]\]\)/);
console.log('Sticky ride header and manual orientation passed: live fields, controls, default, OFF, no ride mutation.');
