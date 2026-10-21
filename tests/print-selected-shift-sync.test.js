'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
// The print tab displays selectedPrintShift() and MUST send that exact
// selection—not the most recent or active duty from another screen.
assert.match(html,/tab==='print'\?renderPrint\(selectedPrintShift\(\)\)/);
assert.match(html,/function selectedPrintShift\(\)\{return model\.shifts\.find\(s=>s\.id===printShiftId\)\|\|selectedShift\(\);\}/);
assert.match(html,/if\(action==='syncCurrentShift'\)\{googleSendShift\(tab==='print'\?selectedPrintShift\(\):latest,true\);return;\}/);
assert.match(html,/data-action="syncCurrentShift" type="button">↥ 選択した乗務をGoogleへ送信/);
assert.match(html,/↗ 既存の印刷シートを開く/);
assert.match(html,/target="_blank" rel="noopener noreferrer">↗ 既存の印刷シートを開く/);
assert.match(html,/既存の計算式・印刷書式をそのまま利用します/);
assert.doesNotMatch(html,/紙の位置・余白はPCでの試し刷り確認が必要/);
// There must be no new Firebase write, new pricing engine, Google print
// backend or bypass of the existing administrator+editor sync guard.
assert.match(html,/if\(!legacyDiary\(\)\)return Promise\.reject\(Error\('この利用者には管理者用Googleシートへの接続権限がありません'\)\)/);
assert.match(html,/if\(!canEditNow\(\)\)return false;\s*if\(memberDiary\(\)\)return syncUI\.run\(manual\)/);
assert.doesNotMatch(html,/printV2ExistingPublishDraft_|printV2ExistingReprintPublishDraft_/);
console.log('Print tab selected-duty upload regression PASS: selected duty, old Sheets link, admin-only existing sync');
