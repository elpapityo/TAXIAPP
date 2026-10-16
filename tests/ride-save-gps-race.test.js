'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const gpsUi=fs.readFileSync(path.join(root,'gps-trip-ui.js'),'utf8');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
assert.match(html,/function flushVisibleDraftInputs\(shift\)/);
assert.match(html,/function discardInvalidAutoDropDistance\(draft\)/);
assert.match(html,/flushVisibleDraftInputs\(shift\);const gpsAutoDropDiscarded=discardInvalidAutoDropDistance\(d\)/);
assert.match(gpsUi,/if\(field==='L'&&number\(record\.raw\.F\)!==null&&Number\(km\)<number\(record\.raw\.F\)\)return false/);

// None of the asynchronous geolocation/reverse-address events may replace an
// in-progress sale's DOM: the former intermittent click fix was insufficient.
const gpsStart=html.indexOf('async function getGps(');
const gpsEnd=html.indexOf('function requestDropLocation(',gpsStart);
assert.ok(gpsStart>0&&gpsEnd>gpsStart);
const gpsFunction=html.slice(gpsStart,gpsEnd);
assert.doesNotMatch(gpsFunction,/\brender\(\)/);
assert.match(gpsFunction,/refreshDraftGpsFields\(shift\.id,d\.id\)/);

const begin=html.indexOf('function flushVisibleDraftInputs(');
const end=html.indexOf('function handleAction(',begin);
assert.ok(begin>0&&end>begin);
const fakeInputs=[];
const ctx={
 number:value=>value===null||value===undefined||String(value).trim()===''?null:Number(value),
 updateDiscountForDraft:()=>{},
 splitPaymentMeta:()=>({second:'',manualSlot:null,manualAmount:''}),
 appEl:{querySelector:q=>{
   if(q==='.hero')return {querySelectorAll:selector=>selector==='[data-col]'?fakeInputs:[]};
   return null;
 }},
 document:{activeElement:null},
 Date,Number,String,console
};
vm.createContext(ctx);
vm.runInContext(html.slice(begin,end),ctx);
const mkDraft=(f,l,meta)=>({kind:'ride',raw:{F:f,L:l},meta});
const auto=mkDraft('10.0','3.0',{gpsFilledFields:{L:{km:'3.0',source:'tracking'}}});
assert.equal(ctx.discardInvalidAutoDropDistance(auto),true);
assert.equal(auto.raw.L,'');
assert.equal(auto.meta.gpsInvalidDropBeforeSave.value,'3.0');
assert.equal(auto.meta.gpsFilledFields.L,undefined);
const manual=mkDraft('10.0','3.0',{gpsFilledFields:{L:{km:'2.9'}}});
assert.equal(ctx.discardInvalidAutoDropDistance(manual),false);
assert.equal(manual.raw.L,'3.0','driver-entered distance must remain intact');
assert.equal(ctx.discardInvalidAutoDropDistance(mkDraft('10.0','11.0',{})),false);

const shift={draft:mkDraft('10.0','',{})};
fakeInputs.push({
 dataset:{col:'K'},value:'2550',disabled:false,
 closest:()=>null,getClientRects:()=>[{}]
});
ctx.flushVisibleDraftInputs(shift);
assert.equal(shift.draft.raw.K,'2550','active Android input is flushed before save validation');
console.log('Ride save GPS regression passed: no async form redraw, impossible GPS drop excluded, manual values protected, input flushed.');
