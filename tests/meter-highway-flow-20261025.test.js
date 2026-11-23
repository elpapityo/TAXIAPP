'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
// 画面の操作経路だけを検証。料金・距離の計算処理を複製しない。
assert.match(html,/button\('保存','saveDraft','meter-finish'\)/);
assert.doesNotMatch(html,/空車（営業完了）/);
assert.match(html,/field\('K',r,\{label:'メーター金額（円）',required:true\}\)/);
assert.doesNotMatch(html,/メーター金額は上のメーター型入力欄に入力します/);
assert.match(html,/snapshot\.action==='meterSettle'\?detail\?\.querySelector\('\[data-col="K"\]'\)/);
assert.match(html,/data-hwy-gps/);
assert.match(html,/data-hwy-distance-field/);
assert.match(html,/timeKey=key==='entryKm'\?'entryTime':'exitTime'/);
assert.match(html,/seg\[key\]=value;/);
assert.match(html,/if\(!String\(seg\[timeKey\]\?\?''\)\.trim\(\)\)seg\[timeKey\]=time;/);
assert.match(html,/showHighwayCaptureConfirm\(current,seg,index\)/);
assert.match(html,/!String\(seg\[distKey\]\?\?''\)\.trim\(\)/);
assert.match(html,/if\(!canEditNow\(\)\|\|accountScope\.uid!==uid\|\|current\?\.id!==shiftId\|\|current\.draft\?\.id!==recordId/);
const inline=html.slice(html.indexOf('function renderMeterHighwayInline('),html.indexOf('function renderMeterUberSettlement('));
for(const meta of [{highwaySections:[{mode:'実'},{mode:'空'}]},{}]){
 const shift={draft:{kind:'ride',meta,raw:{}}};
 const saved=JSON.stringify(shift);
 const context={shift,meterHighwayInlineOpen:true,
  renderHighwaySections:(_,mode)=>`区間:${mode}`,renderLegacyRideHighway:(_,mode)=>`旧形式:${mode}`};
 const visible=vm.runInNewContext(inline+'\nrenderMeterHighwayInline(shift)',context);
 assert.match(visible,/data-action="highwayAdd" data-id="実"/);
 assert.match(visible,/区間:実|旧形式:実/);
 assert.doesNotMatch(visible,/空車高速区間|data-id="空"|区間:空|旧形式:空/);
 assert.equal(JSON.stringify(shift),saved);
}
console.log('高速時刻・距離の双方向ボタン、メーター金額入力、修正先、保存表示の構造検証成功');
