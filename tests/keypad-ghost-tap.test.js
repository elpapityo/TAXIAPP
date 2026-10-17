'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// Exercise actual handlers: a delayed Android click from the gesture that
// opened the overlay must never be interpreted as a digit/clear/Done press.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('// Process the digit on pointerdown');
const end=html.indexOf('// User scrolling to the next field',start);
assert.ok(start>0&&end>start,'keypad gesture handler missing');
const listeners={};
const digits=[],closed=[];
let counter=1;
const timers=new Map();
const scope={
 document:{addEventListener(name,fn){(listeners[name]??=[]).push(fn);}},
 keypadActive:{input:{}},
 keypadPress(key){digits.push(key);},
 closeKeypad(commit){closed.push(commit);scope.keypadActive=null;},
 setTimeout(fn){const id=counter++;timers.set(id,fn);return id;},
 clearTimeout(id){timers.delete(id);},
 Date,console
};
vm.createContext(scope);
vm.runInContext(html.slice(start,end),scope);
assert.ok(listeners.pointerdown&&listeners.pointerup&&listeners.click);
const digit=(value)=>({dataset:{keypadKey:value},});
const command=(value)=>({dataset:{keypadCommand:value}});
const target=button=>({closest(selector){
 return selector==='[data-keypad-key],[data-keypad-command]'?button:
  selector==='[data-keypad-command]'&&button.dataset.keypadCommand?button:null;
}});
const event=(button,detail=1)=>({
 target:target(button),detail,
 preventDefault(){},stopPropagation(){}
});
const pointer=(button)=>listeners.pointerdown[0](event(button,1));
const click=(button,detail=1)=>listeners.click[0](event(button,detail));
const release=(button)=>listeners.pointerup[0](event(button,1));

// Android touch opens the overlay on pointerup; the browser's delayed click
// may target a numeric key that didn't exist on pointerdown.
click(digit('5'));
click(command('clear'));
click(command('done'));
assert.deepEqual(digits,[],'a stale click should never insert a digit or clear');
assert.deepEqual(closed,[],'a stale click should never close the keypad');

// Explicit touch on a keypad key enters one digit immediately.
const seven=digit('7');
pointer(seven);
assert.deepEqual(digits,['7']);
click(seven);
assert.deepEqual(digits,['7'],'synthesized click must not double-enter the digit');

// A relocated click at a different key is also ignored.
click(digit('2'));
assert.deepEqual(digits,['7']);

// Another deliberate tap works even if the old click was lost.
const eight=digit('8');
pointer(eight);
pointer(digit('4'));
assert.deepEqual(digits,['7','8','4']);
click(eight);
assert.deepEqual(digits,['7','8','4']);

// Keyboard and assistive activation (click detail=0) is still supported.
click(digit('9'),0);
assert.deepEqual(digits,['7','8','4','9']);

// A deliberate Done press needs its own pointerdown and dismisses once.
const done=command('done');
pointer(done);
assert.deepEqual(closed,[],'do not remove overlay during finger press');
release(done);
click(done);
assert.deepEqual(closed,[true],'deliberate Done closes once');
assert.equal(timers.size,0,'pending dismiss timer cleared');

// Click after keypad closure has no effect.
click(digit('1'));
assert.deepEqual(digits,['7','8','4','9']);
console.log('Keypad ghost-tap regression passed: opening click ignored; deliberate digits, Done and keyboard work.');
