'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/<title>TAXIAPP v0\.3\.200 — 乗務日報<\/title>/);
assert.match(html,/meter-confirm\.js\?v=20261025-174/);
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.classList={add(){}};this.hidden=false;}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 append(...children){this.children.push(...children);}
 appendChild(child){this.children.push(child);return child;}
 replaceChildren(...children){this.children=children;}
 get childElementCount(){return this.children.length;}
 click(){for(const fn of this.listeners.click||[])fn({target:this});}
}
const ids=Object.fromEntries(['meterRecordNotice','meterRecordNoticeRows','meterRecordNoticeTitle','meterRecordNoticeClose','meterRecordNoticeEdit'].map(id=>[id,new Element()]));
const timers=[];
const window={};
vm.runInNewContext(fs.readFileSync('meter-confirm.js','utf8'),{window,document:{getElementById:id=>ids[id],createElement:tag=>new Element(tag)},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
const ui=window.TAXIAPP_METER_CONFIRM;ui.bind();
for(const label of ['乗車時刻','乗車時の走行距離','乗車地']){
 let called='';
 ui.show({key:label,title:'乗車情報',rows:[{label,value:'テスト値'}],editField:value=>{called=value;}});
 const row=ids.meterRecordNoticeRows.children[0];
 assert.equal(row.attributes.role,'button');
 row.children[1].textContent='テスト値';
 row.click();
 assert.equal(called,label,'タップした行の入力先を選ぶこと');
 assert.equal(ids.meterRecordNotice.hidden,true);
}
console.log('PASS 確認カード3項目のタップ修正・閉鎖・キャッシュ版更新');
