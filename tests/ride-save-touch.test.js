'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
for(const tag of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(tag[1]);
assert.match(html,/if\(saveTouchPress\)\{saveRenderPending=true;return;\}/);
assert.match(html,/skipSaveClick\?\.button===action&&Date\.now\(\)-skipSaveClick\.at<1500/);
assert.match(html,/showSaveProblem\('保存できません：'\+issues\.join\('、'\)\)/);
assert.match(html,/data-action="saveDraft"/);
const start=html.indexOf('// Make a failed save visible next to the save button');
const end=html.indexOf('const HIGHWAY_RAW_KEYS',start);
assert.ok(start>0&&end>start);
const appEvents={},docEvents={},winEvents=[],actions=[],renders=[],alerts=[],timers=new Map();
let nextTimer=1;
const button={isConnected:true,closest:()=>({before:()=>{}})};
const target={closest:selector=>selector==='[data-action="saveDraft"]'?button:null};
const scope={
 appEl:{addEventListener:(name,fn)=>{(appEvents[name]??=[]).push(fn);},
  querySelector:selector=>selector==='[data-action="saveDraft"]'?button:null},
 document:{addEventListener:(name,fn)=>{(docEvents[name]??=[]).push(fn);},
  createElement:()=>({dataset:{},setAttribute(){}})},
 window:{addEventListener:(name,fn)=>winEvents.push([name,fn])},
 getShift:()=>({draft:{id:'ride-1'}}),
 closeKeypad:(commit,suppressRender)=>actions.push('closeKeypad:'+commit+':'+suppressRender),
 handleAction:act=>actions.push(act),
 toast:(msg,isError)=>alerts.push([msg,isError]),
 setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},
 clearTimeout:id=>timers.delete(id),
 Date,console,renders
};
vm.createContext(scope);
vm.runInContext("let saveTouchPress=null,saveRenderPending=false,saveTouchTimeout=null,skipSaveClick=null;\nfunction render(){if(saveTouchPress){saveRenderPending=true;return;}renders.push('render');}",scope);
vm.runInContext(html.slice(start,end),scope);
assert.ok(appEvents.pointerdown?.length);
assert.ok(docEvents.pointerup?.length);
assert.ok(docEvents.pointercancel?.length);
const sendDown=(id=9)=>appEvents.pointerdown[0]({target,button:0,pointerId:id});
const sendUp=(id=9)=>docEvents.pointerup[0]({target,pointerId:id});
sendDown();
vm.runInContext('render()',scope);
assert.equal(renders.length,0,'GPS rerender must wait until save tap is released');
sendUp();
assert.deepEqual(actions,['closeKeypad:true:true','saveDraft']);
assert.equal(renders.length,1);
assert.equal(timers.size,0,'gesture timeout cleaned up');
assert.equal(vm.runInContext('saveTouchPress',scope),null);
actions.length=0;
renders.length=0;
sendDown(10);
vm.runInContext('render()',scope);
docEvents.pointercancel[0]({pointerId:10});
assert.equal(actions.length,0,'cancelled tap must not save');
assert.equal(renders.length,1,'deferred GPS redraw should run after cancellation');
actions.length=0;
sendDown(11);
docEvents.pointerup[0]({target:{closest:()=>null},pointerId:11});
assert.equal(actions.length,0,'releasing outside button must not save');
vm.runInContext("showSaveProblem('メーター金額未入力')",scope);
assert.ok(alerts.some(x=>x[0].includes('メーター金額未入力')&&x[1]));
console.log('Ride save touch regression passed: GPS redraw, pointerup save, pointercancel, outside release, error notice.');
