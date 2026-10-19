'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf("if(action==='endBreak')");
const finish=html.indexOf("if(action==='cancelWaiting')",start);
const endFnStart=html.indexOf("function endBreak(");
const endFnFinish=html.indexOf("function elapsedWaitingText(",endFnStart);
assert.ok(start>0&&finish>start&&endFnStart>0&&endFnFinish>endFnStart,
 'expected exact break ending action and session close function');
const handler=html.slice(start,finish);
assert.match(handler,/endBreak\(shift,new Date\(\)\);breakPageOpen=false;save\(\);render\(\);toast\('休憩を終了しました'\);return;/,
 'close the break page after recording a completed session, before rerender');
assert.match(html,/if\(resting\|\|breakPageOpen\)return renderBreakPage\(shift\);/,
 'closing the break page must return the normal cruising action grid');
assert.match(html,/class="action-grid cruising-action-grid cruising-action-compact"/);
assert.match(html,/if\(action==='beginBreak'\)/,'starting a new break remains available');
assert.match(html,/if\(action==='breakBoard'\|\|action==='breakDispatch'\)/,
 'ride and dispatch shortcuts must be unaffected');
const previous={id:'old',startedAt:'08:20',startedIso:'2026-10-20T08:20:00+09:00',endedAt:'08:35',endedIso:'2026-10-20T08:35:00+09:00',place:'伊丹1'};
const active={id:'running',startedAt:'09:00',startedIso:'2026-10-20T09:00:00+09:00',place:'北本町1',geo:{lat:34.76,lng:135.41}};
const shift={id:'shift-001',draft:null,waiting:null,breakActive:{...active},breakSessions:[{...previous}]};
let saves=0,renders=0,toasts=[],renderSnapshot=null;
const ctx={
 shift,action:'endBreak',breakPageOpen:true,Date,
 stamp(d){return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');},
 save(){saves++;assert.equal(shift.breakSessions.length,2,'session should be committed before save');},
 render(){renders++;renderSnapshot={active:shift.breakActive,open:ctx.breakPageOpen,
   destination:shift.breakActive||ctx.breakPageOpen?'休憩管理':'空車・流し'};},
 toast(v){toasts.push(v);}
};
vm.createContext(ctx);
vm.runInContext(html.slice(endFnStart,endFnFinish)+'\n(function(){'+handler+'})()',ctx);
assert.equal(saves,1);
assert.equal(renders,1);
assert.equal(renderSnapshot.destination,'空車・流し');
assert.equal(ctx.breakPageOpen,false);
assert.equal(shift.breakActive,null);
assert.equal(shift.breakSessions.length,2);
assert.deepEqual(shift.breakSessions[0],previous,'older break records unchanged');
const closed=shift.breakSessions[1];
assert.equal(closed.id,active.id);
assert.equal(closed.startedAt,active.startedAt);
assert.equal(closed.startedIso,active.startedIso);
assert.equal(closed.place,active.place);
assert.deepEqual(closed.geo,active.geo);
assert.ok(Number.isFinite(Date.parse(closed.endedIso)),'actual break end timestamp saved');
assert.match(closed.endedAt,/^\d\d:\d\d$/);
assert.deepEqual(toasts,['休憩を終了しました']);
const alreadyEnded={shift,action:'endBreak',Date,breakPageOpen:false,
 endBreak(){throw Error('must not end twice')},save(){throw Error('must not resave')},
 render(){throw Error('must not rerender')},toast(){throw Error('must not toast')}};
vm.createContext(alreadyEnded);
vm.runInContext('(function(){'+handler+'})()',alreadyEnded);
assert.equal(shift.breakSessions.length,2,'double tapping completed break is a no-op');
console.log('PASS break ending saves timing/place/history, clears page, returns to cruising once');
