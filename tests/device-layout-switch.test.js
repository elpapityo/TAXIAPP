'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const extract=(start,end)=>{
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing source section: '+start);
 return html.slice(a,b);
};
const code=[
 extract('const UI_DEFAULTS=','const INPUT_DEFAULTS='),
 extract('function displayPrefs(){','function getShift(){'),
 extract('function renderDriveLayoutChooser(){','function renderPreviewCompact(shift){')
].join('\n');
let saved=0;
const model={prefs:{ui:{driveLayout:'guided',screenMode:'phone'}},shifts:[{id:'existing-sale',records:[{id:123}]}]};
const doc={documentElement:{dataset:{},style:{}}};
const context={model,document:doc,saveLater(){saved++;},refreshSettingChoice(){}};
vm.createContext(context);
vm.runInContext(code,context);
const chooser=()=>vm.runInContext('renderDriveLayoutChooser()',context);

// The settings menu owns layout selection; the driving screen only references it.
const initial=chooser();
assert.match(initial,/入力方式・表示サイズ・画面の向きは「設定」から変更できます/);
assert.doesNotMatch(initial,/data-ui-key="screenMode"/);
assert.match(html,/<summary>営業入力の画面サイズ・向き<\/summary>/);
assert.match(html,/renderUiChoice\('screenMode'/);
const labels={full:'全画面',half:'半画面',phone:'スマホ',tablet:'タブレット',pc:'PC'};
const choices=Object.entries(labels);
const picker=()=>vm.runInContext('renderUiChoice("screenMode",'+JSON.stringify(choices)+')',context);
for(const [mode,label] of choices){
 assert.ok(picker().includes('data-ui-key="screenMode" data-ui-value="'+mode+'"'),mode+' must be selectable in Settings');
 assert.ok(picker().includes('>'+label+'</button>'),mode+' must be labeled');
}
assert.match(picker(),/class="chip active" data-ui-key="screenMode" data-ui-value="phone"[^>]*aria-pressed="true"/);
// Changing screen mode persists user UI preferences, not the business shifts.
const preserved=JSON.stringify(model.shifts);
vm.runInContext("setUiOption('screenMode','tablet')",context);
assert.equal(model.prefs.ui.screenMode,'tablet');
assert.equal(model.prefs.ui.driveLayout,'guided');
assert.equal(doc.documentElement.dataset.uiScreenMode,'tablet');
assert.equal(JSON.stringify(model.shifts),preserved);
assert.equal(saved,1);
assert.match(picker(),/class="chip active" data-ui-key="screenMode" data-ui-value="tablet"[^>]*aria-pressed="true"/);
vm.runInContext("setUiOption('screenMode','invalid')",context);
assert.equal(model.prefs.ui.screenMode,'tablet');
assert.equal(saved,1,'invalid choice must not persist');
for(const mode of ['half','phone','tablet','pc'])assert.ok(html.includes('html[data-ui-screen-mode="'+mode+'"] #main-content'),'missing width rule '+mode);
console.log('Settings-based device layout passed: options, active state, persistence, no business-data edits.');
