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

// The choice is visible on the ride screen, not just in collapsed Settings.
const labels={full:'全画面',half:'半画面',phone:'スマホ',tablet:'タブレット',pc:'PC'};
const initial=chooser();
assert.match(initial,/表示サイズを選択/);
assert.match(initial,/aria-label="端末の表示方式"/);
for(const [mode,label] of Object.entries(labels)){
 assert.ok(initial.includes('data-ui-key="screenMode" data-ui-value="'+mode+'"'),mode+' must be clickable');
 assert.ok(initial.includes('>'+label+'</button>'),mode+' must be labeled');
}
assert.match(initial,/class="btn active" data-ui-key="screenMode" data-ui-value="phone"[^>]*aria-pressed="true"/);
assert.match(initial,/data-ui-key="driveLayout" data-ui-value="guided"/,
 'four existing ride input modes must still be present');

// Selecting a screen size uses existing saved UI preferences; business data is untouched.
const preserved=JSON.stringify(model.shifts);
vm.runInContext("setUiOption('screenMode','tablet')",context);
assert.equal(model.prefs.ui.screenMode,'tablet');
assert.equal(model.prefs.ui.driveLayout,'guided');
assert.equal(doc.documentElement.dataset.uiScreenMode,'tablet');
assert.equal(JSON.stringify(model.shifts),preserved);
assert.equal(saved,1);
assert.match(chooser(),/class="btn active" data-ui-key="screenMode" data-ui-value="tablet"[^>]*aria-pressed="true"/);
vm.runInContext("setUiOption('screenMode','invalid')",context);
assert.equal(model.prefs.ui.screenMode,'tablet');
assert.equal(saved,1,'invalid choice must not persist');

// Manual sizing wins over the newer full-width dashboard CSS.
for(const mode of ['half','phone','tablet','pc']){
 assert.ok(html.includes('html[data-ui-screen-mode="'+mode+'"] #main-content'),'missing main-width rule for '+mode);
}
assert.match(html,/<summary>入力方式・スマホ／タブレット表示<\/summary>/);
console.log('Visible manual device layout passed: options, active state, persistence, no business-data edits.');
