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
