'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const start=source.indexOf('let dispatchSourcePopup=null;'),end=source.indexOf('function renderNow(){',start);
assert.ok(start>0&&end>start);
assert.match(source,/makeDispatch\(shift,new Date\(\),''\)/);
assert.match(source,/makeDispatch\(shift,now,''\)/);
assert.match(source,/function renderNow\(\)\{[\s\S]*?syncDispatchSourcePopup\(\);\n\}/);
for(const action of ['boardDispatch','cancelDispatch']){
 const at=source.indexOf(" if(action==='"+action+"'){",source.indexOf('function handleAction('));
 assert.match(source.slice(at,at+240),/if\(dispatchSourceRequired\(shift\)\)\{syncDispatchSourcePopup\(\);return;\}/);
}
const created=[],selected=[];
function makeDialog(){
 const handlers={};
 return {open:false,removed:false,handlers,addEventListener:(type,fn)=>handlers[type]=fn,
  setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},
  click(code){handlers.click({target:{closest:()=>({dataset:{source:code}})}});}};
}
let shift={id:'duty',draft:{id:'draft',kind:'dispatch',raw:{E:''},meta:{dispatchIso:'press-time',dispatchStartKm:'3.2'}}};
let editable=true;
const ctx=vm.createContext({
 DISPATCH_TYPES:[['G','GO'],['D','DiDi'],['U','Uber'],['乗','その他・無線']],
 tab:'drive',accountScopeGeneration:1,accountScope:{uid:'driver'},getShift:()=>shift,canEditNow:()=>editable,safeText:String,
 document:{createElement:t=>{assert.equal(t,'dialog');const d=makeDialog();created.push(d);return d;},body:{appendChild(){}}},
 handleSetCol:(col,val)=>{selected.push(val);shift.draft.raw[col]=val;}
});
vm.runInContext(source.slice(start,end),ctx);
const sync=()=>ctx.syncDispatchSourcePopup();
for(const code of ['G','D','U','乗']){
 shift.draft.raw.E='';sync();
 const d=created.at(-1),count=created.length;
 assert.equal(d.open,true);assert.match(d.innerHTML,/配車元を選択/);
 assert.equal((d.innerHTML.match(/data-source=/g)||[]).length,4);
 sync();assert.equal(created.length,count,'background render must not replace dialog');
 let canceled=false;d.handlers.cancel({preventDefault:()=>{canceled=true;}});assert.equal(canceled,true);
 d.click('incorrect');assert.equal(d.open,true);
 d.click(code);assert.equal(shift.draft.raw.E,code);assert.equal(d.removed,true);
 assert.equal(shift.draft.meta.dispatchIso,'press-time');assert.equal(shift.draft.meta.dispatchStartKm,'3.2');
 sync();assert.equal(created.length,count);
}
shift.draft.raw.E='';sync();const old=created.at(-1);
ctx.accountScopeGeneration=2;ctx.accountScope.uid='other';
shift={id:'next',draft:{id:'next-draft',kind:'dispatch',raw:{E:''}}};sync();
old.click('G');assert.equal(shift.draft.raw.E,'');assert.equal(old.removed,true);
editable=false;sync();assert.equal(created.at(-1).removed,true);
assert.deepEqual(selected,['G','D','U','乗']);
console.log('PASS required dispatch source, all selections, repeated rendering, account change and timestamp/distance protection');
