'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
assert.match(source,/let focusDispatchSourceAfterRender=false;/);
assert.match(source,/data-dispatch-source/);
assert.match(source,/shift\.draft=makeDispatch\(shift,new Date\(\),'G'\);saveOperationalEvent\(shift\);focusDispatchSourceAfterRender=true;render\(\);/);
assert.match(source,/if\(tab==='drive'&&typeof focusDispatchSourceAfterRender!=='undefined'&&focusDispatchSourceAfterRender\)/);
assert.match(source,/appEl\.querySelector\('#main-content \[data-dispatch-source\]'\)/);
assert.match(source,/window\.scrollTo\(0,Math\.max\(0,group\.getBoundingClientRect\(\)\.top\+window\.scrollY-offset\)\);/);
assert.match(source,/const offset=Math\.min\(280,Math\.round\(window\.innerHeight\*0\.34\)\);/);

const start=source.indexOf(" if(tab==='drive'&&typeof focusDispatchSourceAfterRender");
const stop=source.indexOf(" if(tab==='settings'&&rideSettingsJumpRequested)",start);
const scrollSource=source.slice(start,stop);
function dispatchScroll({sticky=true,summaryHeight=0,actionTop,groupTop=0,initialScroll,innerHeight,phase='dispatch',tab='drive'}){
 const calls=[];
 const frame=[];
 const elements={
  '#main-content .meter-console .meter-actions':actionTop===undefined?null:{getBoundingClientRect:()=>({top:actionTop})},
  '#main-content .preview-duty-summary':{getBoundingClientRect:()=>({height:summaryHeight})},
  '#main-content [data-dispatch-source]':{getBoundingClientRect:()=>({top:groupTop})}
 };
 const window={scrollY:initialScroll,innerHeight,scrollTo:(...args)=>calls.push(args)};
 const context={tab,focusDispatchSourceAfterRender:true,window,appEl:{querySelector:s=>elements[s]},
  getShift:()=>({draft:{kind:phase}}),displayPrefs:()=>({stickyDutySummary:sticky?'on':'off'}),
  requestAnimationFrame:callback=>frame.push(callback),syncFloatingDutySummary:()=>calls.push('sync')};
 vm.runInNewContext(scrollSource,context);
 frame.forEach(callback=>callback());
 return JSON.parse(JSON.stringify(calls));
}

// In the tablet split view with the app set to portrait, the detailed form is closed.
// The visible row, rather than the hidden dispatch-source selector, sets the scroll position.
assert.deepEqual(dispatchScroll({summaryHeight:128.5,actionTop:91,initialScroll:430,innerHeight:700}),
 [[{top:380,behavior:'instant'}],'sync']);
assert.deepEqual(dispatchScroll({summaryHeight:71,actionTop:166,initialScroll:90,innerHeight:390}),
 [[{top:173,behavior:'instant'}],'sync']);
assert.deepEqual(dispatchScroll({sticky:false,summaryHeight:130,actionTop:91,initialScroll:430,innerHeight:700}),
 [[{top:509,behavior:'instant'}],'sync']);
assert.deepEqual(dispatchScroll({groupTop:302,initialScroll:72,innerHeight:700}),[[0,136]]);
assert.deepEqual(dispatchScroll({summaryHeight:111,actionTop:91,initialScroll:430,innerHeight:700,phase:'cancel'}),[]);
console.log('PASS 迎車開始後の操作ボタン、固定表示の高さ、従来の配車元への移動');
