'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
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
console.log('高速時刻・距離の双方向ボタン、メーター金額入力、修正先、保存表示の構造検証成功');
