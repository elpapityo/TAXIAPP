'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Execute the real settings rerender function in a tiny DOM stand-in.
// This guards against regressions where a saved choice closes sections
// or jumps the user back to the beginning of the settings screen.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('let settingsOpenState=null,lastRenderedTab=null;');
const end=html.indexOf('function titleBlock(',start);
assert.ok(start>0&&end>start,'settings rerender preservation code missing');
const code=html.slice(start,end);
const windowMock={
 location:{protocol:'https:'},scrollX:0,scrollY:0,
 scrollTo(x,y){this.scrollX=x;this.scrollY=y;}
};
let panels=[];
const appEl={
 querySelector(selector){return null;},
 querySelectorAll(selector){
  if(selector==='details.settings-advanced')return panels;
  if(selector==='[data-operation-panel]')return [];
  return [];
 },
 set innerHTML(content){
  // Replacing the whole page destroys details elements and their open state.
  // Simulate the browser clamping scroll back to the top on replacement.
  panels=String(content).includes('test-settings')
   ? Array.from({length:7},()=>({open:false})):[];
  windowMock.scrollX=0;windowMock.scrollY=0;
 }
};
const context={
 tab:'settings',keypadActive:null,saveTouchPress:null,
 pendingRender:false,renderAfterKeypad:false,saveRenderPending:false,
 window:windowMock,appEl,storageStatus:'IndexedDB',
 operationPanelOpen:{live:true,summary:false},
 applyUi(){},selectedShift(){return null;},header(){return '';},
 renderNav(){return '';},renderDrive(){return 'test-drive';},
 renderOperations(){return '';},renderHistory(){return '';},
 renderHighwayReport(){return '';},renderPrint(){return '';},
 selectedPrintShift(){return null;},renderShiftManager(){return '';},
 renderSettings(){return 'test-settings';},
 applyInputKeyboardMode(){},readGpsPermission(){}
};
vm.createContext(context);
vm.runInContext(code,context);
const render=()=>vm.runInContext('renderNow()',context);
render(); // first load
assert.equal(panels.length,7,'all seven settings sections must be present');
[1,3,5,6].forEach(i=>panels[i].open=true);
windowMock.scrollX=0;windowMock.scrollY=463;
render(); // saving a setting rebuilds the UI
assert.deepEqual(panels.map(p=>p.open),[false,true,false,true,false,true,true]);
assert.equal(windowMock.scrollY,463,'settings scroll should not reset on save');
panels[3].open=false; // deliberate close must remain closed
windowMock.scrollY=620;
render(); // background sync refresh
assert.deepEqual(panels.map(p=>p.open),[false,true,false,false,false,true,true]);
assert.equal(windowMock.scrollY,620,'background refresh should preserve location');
context.tab='drive';render();
assert.equal(windowMock.scrollY,0,'switching to a different menu should start at top');
context.tab='settings';render();
assert.deepEqual(panels.map(p=>p.open),[false,true,false,false,false,true,true],
 'returning to settings should remember which categories were expanded');
console.log('Settings view preservation passed: edits, background refresh, deliberate collapse and tab navigation.');

// Settings controls update their buttons and CSS without rebuilding the page.
function body(name,until){
 const from=html.indexOf('function '+name+'(');
 const to=html.indexOf('function '+until+'(',from+8);
 assert.ok(from>0&&to>from,'missing settings handler '+name);
 return html.slice(from,to);
}
assert.doesNotMatch(body('setUiOption','getShift'),/\brender\(\)/,
 'a display setting must not redraw the open Settings page');
assert.doesNotMatch(body('setInputOption','renderInputChoice'),/\brender\(\)/,
 'a keyboard setting must not redraw the open Settings page');
assert.doesNotMatch(body('handleSheetTargetSetting','renderDataManagement'),/\brender\(\)/,
 'a Google setting must not redraw the open Settings page');

// Execute the real cloud panel adapter with a stub sync engine. The 20-second
// background poll must never call full-page render(), even while Settings
// is expanded and the user is idle.
const cloudSource=fs.readFileSync(path.join(__dirname,'..','cloud-sync-ui.js'),'utf8');
const cloudStatus={busy:false,conflicts:[],lastError:'',lastSyncAt:0};
const node={
 status:{textContent:''},
 conflicts:{dataset:{},innerHTML:'',querySelector(){return null;}}
};
let fullRedraws=0;
const syncWindow={
 TAXIAPP_BIDIRECTIONAL_SYNC:{create(){
  return {
   async run(){cloudStatus.lastSyncAt=Date.now();return true;},
   status(){return cloudStatus;},
   async resolve(){return true;}
  };
 }},
 confirm(){return true;}
};
const cloudContext={window:syncWindow,document:{activeElement:null}};
vm.createContext(cloudContext);
vm.runInContext(cloudSource,cloudContext);
const cloud=syncWindow.TAXIAPP_SYNC_UI({
 prefs:()=>({syncMode:'on'}),configured:()=>true,
 getModel:()=>({shifts:[]}),getPacket:s=>s,
 endpoint:()=>'',request:async()=>({}),replace:async()=>{},
 root:{querySelector(selector){
  return selector==='[data-sync-status]'?node.status:
   selector==='[data-sync-conflicts]'?node.conflicts:null;
 }},
 setStatus(){},toast(){},
 render(){fullRedraws++;},isSettings:()=>true,escape:s=>s,
 download(){},dateStamp:()=> '20261017'
});
(async()=>{
 await cloud.run(false); // automatic refresh
 await cloud.run(true); // manual sync
 assert.equal(fullRedraws,0,'sync must never rebuild Settings');
 assert.match(node.status.textContent,/最終照合/);
 assert.match(cloud.panel(),/data-sync-conflicts/);
 console.log('Background-sync settings regression passed: neither automatic nor manual sync redraws Settings.');
})().catch(err=>{console.error(err);process.exitCode=1;});

