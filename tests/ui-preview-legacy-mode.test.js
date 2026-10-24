'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('ui-layout-lab.html','utf8');
for(const mode of ['compact','guided','detail','legacy']){
 assert.match(html,new RegExp('data-mode="'+mode+'"'));
 assert.match(html,new RegExp('data-selectmode="'+mode+'"'));
}
assert.match(html,/id="legacyMode"/);
assert.match(html,/data-legacy-action/);
assert.match(html,/function legacyAction\(action\)/);
const js=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
new Function(js);
const start=js.indexOf(' // Original v0.3.49 action order');
const end=js.indexOf(' function setMode(mode){',start);
assert.ok(start>=0&&end>start,'isolated legacy logic must be present');
let view='',lastCount=12;
const element={innerHTML:''},fieldElements=[];
const sandbox={
 document:{querySelectorAll:selector=>selector.includes('[data-legacy-field]')?fieldElements:[]},
 $:id=>{assert.equal(id,'legacyMode');return element;},
 model:{count:lastCount,locationIndex:0},
 demoLocations:['川西能勢口付近','川西池田駅付近'],
 render:()=>vm.runInContext('renderLegacy()',sandbox),
};
vm.createContext(sandbox);
vm.runInContext(js.slice(start,end),sandbox);
function action(value){vm.runInContext('legacyAction('+JSON.stringify(value)+')',sandbox);}
function htmlContains(...parts){for(const part of parts)assert.ok(element.innerHTML.includes(part),'Missing text: '+part);}
vm.runInContext('renderLegacy()',sandbox);
htmlContains('乗車','アプリ迎車','待機開始');
action('beginWait');htmlContains('待機中','待機場所','待機終了');
action('stopWait');htmlContains('空車・流し');
action('beginDispatch');htmlContains('迎車中','迎車受信時刻','お客様が乗車','迎車キャンセル');
action('cancelDispatch');htmlContains('0円','キャンセルをデモ登録');
action('saveCancel');assert.equal(sandbox.model.count,13);
action('beginRide');htmlContains('配車区分','男性人数','女性人数','乗車時の走行距離','高速道路');
action('alight');htmlContains('メーター金額','最初の金種','追加金種','降車時の走行距離');
action('save');assert.equal(sandbox.model.count,13,'must reject zero fare');
htmlContains('メーター金額を入力してください');
vm.runInContext('legacy.fields.fare="2400"',sandbox);
action('save');assert.equal(sandbox.model.count,14);
htmlContains('空車・流し');
action('beginDispatch');action('boardDispatch');htmlContains('乗車情報');
action('discard');htmlContains('空車・流し');
assert.match(html,/営業データは保存しません/);
console.log('UI legacy-mode simulation passed: four choices, wait, dispatch, cancel 0 yen, board, settle, validation and undo.');
