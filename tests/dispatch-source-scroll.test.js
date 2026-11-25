'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
assert.match(source,/let dutyInputAfterRender='';/);
assert.match(source,/data-dispatch-source/);
assert.match(source,/shift\.draft=makeDispatch\(shift,new Date\(\),''\);saveOperationalEvent\(shift\);dutyInputAfterRender='dispatch';render\(\);/);
assert.match(source,/const d=boardDispatch\(shift,new Date\(\)\);gpsTripUI\?\.board\(shift,d\);saveOperationalEvent\(shift\);dutyInputAfterRender='ride';render\(\);/);
assert.match(source,/saveOperationalEvent\(shift\);dutyInputAfterRender='waiting';render\(\);getWaitGps\(shift,w\);/);
assert.match(source,/appEl\.querySelector\('#main-content \[data-dispatch-source\]'\)/);
assert.match(source,/window\.scrollTo\(0,Math\.max\(0,group\.getBoundingClientRect\(\)\.top\+window\.scrollY-offset\)\);/);
assert.match(source,/const offset=Math\.min\(280,Math\.round\(window\.innerHeight\*0\.34\)\);/);

const start=source.indexOf(" if(tab==='drive'&&dutyInputAfterRender)");
const stop=source.indexOf(" if(tab==='settings'&&rideSettingsJumpRequested)",start);
const scrollSource=source.slice(start,stop);
function dutyScroll({sticky=true,summaryHeight=0,summaryTop=0,actionTop,rideEditorTop,meterStateTop,groupTop=0,initialScroll,innerHeight,phase='dispatch',requestedPhase='dispatch',tab='drive'}){
 const calls=[];
 const frame=[];
 const elements={
  '#main-content .meter-console .meter-actions':actionTop===undefined?null:{getBoundingClientRect:()=>({top:actionTop})},
  '#main-content .meter-console [aria-label="実車入力"]':rideEditorTop===undefined?null:{getBoundingClientRect:()=>({top:rideEditorTop})},
  '#main-content .preview-duty-summary':summaryTop===null?null:{getBoundingClientRect:()=>({height:summaryHeight,top:summaryTop})},
  '#main-content .meter-console [data-meter-state]':meterStateTop===undefined?null:{getBoundingClientRect:()=>({top:meterStateTop})},
  '#main-content [data-dispatch-source]':{getBoundingClientRect:()=>({top:groupTop})}
 };
 const window={scrollY:initialScroll,innerHeight,scrollTo:(...args)=>calls.push(args)};
 const context={tab,dutyInputAfterRender:requestedPhase,window,appEl:{querySelector:s=>elements[s]},
  getShift:()=>phase==='waiting'?{waiting:{id:'wait-1'}}:{draft:{kind:phase}},
  displayPrefs:()=>({stickyDutySummary:sticky?'on':'off'}),
  requestAnimationFrame:callback=>frame.push(callback),syncFloatingDutySummary:()=>calls.push('sync')};
 vm.runInNewContext(scrollSource,context);
 frame.forEach(callback=>callback());
 return JSON.parse(JSON.stringify(calls));
}

// In the tablet split view with the app set to portrait, the detailed form is closed.
// The visible row, rather than the hidden dispatch-source selector, sets the scroll position.
assert.deepEqual(dutyScroll({summaryHeight:128.5,actionTop:91,initialScroll:430,innerHeight:700}),
 [[{top:380,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({summaryHeight:71,actionTop:166,initialScroll:90,innerHeight:390}),
 [[{top:173,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({sticky:false,summaryHeight:130,actionTop:91,initialScroll:430,innerHeight:700}),
 [[{top:509,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({groupTop:302,initialScroll:72,innerHeight:700}),[[0,136]]);
assert.deepEqual(dutyScroll({summaryHeight:111,actionTop:91,initialScroll:430,innerHeight:700,phase:'cancel'}),[]);
assert.deepEqual(dutyScroll({summaryHeight:196.5,actionTop:81,rideEditorTop:148,initialScroll:430,innerHeight:700,phase:'ride',requestedPhase:'ride'}),
 [[{top:373,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({sticky:false,summaryTop:-45,rideEditorTop:148,initialScroll:430,innerHeight:700,phase:'ride',requestedPhase:'ride'}),
 [[{top:377,behavior:'instant'}],'sync']);
const waiting={phase:'waiting',requestedPhase:'waiting',summaryHeight:128.5,summaryTop:-82,actionTop:105,initialScroll:430,innerHeight:420};
assert.deepEqual(dutyScroll(waiting),[[{top:398,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({...waiting,sticky:false}),[[{top:348,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({...waiting,actionTop:undefined}),[[{top:348,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({...waiting,summaryTop:null,meterStateTop:37}),[[{top:467,behavior:'instant'}],'sync']);
assert.deepEqual(dutyScroll({...waiting,phase:'dispatch'}),[]);
console.log('PASS 待機・迎車・実車後の表示位置と固定表示の高さ、従来の配車元への移動');
