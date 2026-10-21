'use strict';
// GAS print checks must reject ambiguous/missing data without editing live sheets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
const selectionStart = source.indexOf('function resolvePrintShiftId_(ss,operation) {');
const applyStart = source.indexOf('function applySelectedPrintShift() {');
assert.ok(selectionStart >= 0 && applyStart > selectionStart);
const select = {Set, String, Math, Error};
vm.runInNewContext(source.slice(selectionStart, applyStart), select);
const shiftId = 'shift-1792124520000';
const label = '10/16 13:22出庫・営業4件';
const rows = [[shiftId, ...Array(19).fill(''), label]];
const operation = {
  getRange: key => ({
    getValue: () => key === 'B15',
    getDisplayValue: () => key === 'B17' ? label : key === 'C17' ? shiftId : ''
  })
};
function selection({originals = [shiftId], indexPresent = true, sourcePresent = true, latest = label} = {}) {
  const index = {
    getLastRow: () => rows.length + 1,
    getRange: (...args) => args[0] === 'T2'
      ? {getDisplayValue: () => latest}
      : {getDisplayValues: () => rows}
  };
  const raw = {
    getLastRow: () => originals.length + 1,
    getRange: () => ({getDisplayValues: () => originals.map(id => [id])})
  };
  return {
    getSheetByName: name => name === 'TAXIAPP_乗務一覧' && indexPresent ? index :
      name === 'TAXIAPP_同期原本' && sourcePresent ? raw : null
  };
}
assert.equal(select.resolvePrintShiftId_(selection(), operation), shiftId);
assert.equal(select.resolvePrintShiftId_(selection({originals: []}), operation), '',
  'index list is not a printable original');
assert.equal(select.resolvePrintShiftId_(selection({latest: ''}), operation), '',
  'stale C17 cannot replace an unavailable latest selection');
assert.throws(() => select.resolvePrintShiftId_(selection({indexPresent: false}), operation), /保存用シート/);
assert.throws(() => select.resolvePrintShiftId_(selection({sourcePresent: false}), operation), /保存用シート/);

const notices = [], logs = [];
let loaded = 0, flushed = 0, mutations = 0, uiCalled = 0;
let selectedId = shiftId, sourceShift = null, meterOnSheet = 0;
let missingOperation = false, missingSecond = false, toastFails = false;
const baseRecords = [
  {kind: 'ride', status: 'complete', raw: {K: 1000}},
  {kind: 'ride', status: 'complete', raw: {K: 250}},
  {kind: 'ride', status: 'draft', raw: {K: 9000}},
  {kind: 'cancel', status: 'complete', raw: {K: 7000}}
];
sourceShift = {date: '2026-10-21', records: baseRecords};
meterOnSheet = 1250;
const readOnlyPrintSheet = {
  getRange: () => ({getValue: () => meterOnSheet,
    setValue: () => { mutations++; throw Error('test must not mutate'); }})
};
const spreadsheet = {
  getSheetByName: name => name === 'TAXIAPP_印刷操作' ? (missingOperation ? null : {}) :
    name === '補助簿印刷用' ? readOnlyPrintSheet :
    name === '補助簿印刷用_2頁' ? (missingSecond ? null : readOnlyPrintSheet) : null,
  toast: () => { if (toastFails) throw Error('notification unavailable'); notices.push('toast'); }
};
const runtime = {
  TAXIAPP_SHEET_ID: 'synthetic-no-real-access',
  SpreadsheetApp: {
    openById: () => spreadsheet, flush: () => { flushed++; },
    getUi: () => { uiCalled++; throw Error('blocking UI forbidden'); }
  },
  resolvePrintShiftId_: () => selectedId,
  loadShift_: () => { loaded++; return sourceShift; },
  numeric_: number => Number(number || 0),
  Logger: {log: message => logs.push(message)},
  Error, String, Number, Math, Array
};
vm.createContext(runtime);
vm.runInContext(source.slice(applyStart), runtime);
function reject(regex) { assert.throws(() => runtime.applySelectedPrintShift(), regex); }

selectedId = '';
reject(/印刷対象が見つかりません/);
assert.equal(loaded, 0, 'no original may be loaded without an explicit valid selection');
selectedId = shiftId;
missingOperation = true;
reject(/印刷操作シートがありません/);
missingOperation = false;
sourceShift = {date: '2026-10-21', records: Array(61).fill(baseRecords[0])};
reject(/営業データを確認/);
sourceShift = {date: '2026-10-21', records: baseRecords};
missingSecond = true;
reject(/印刷用シートがありません/);
missingSecond = false;
meterOnSheet = 1251;
reject(/メーター売上が一致しません/);
assert.equal(notices.length, 0, 'failed validation must not display success');
meterOnSheet = 1250;
toastFails = true;
assert.equal(runtime.applySelectedPrintShift().meter, 1250,
  'a toast delivery error must not block a verified print');
assert.ok(logs.some(s => s.includes('TAXIAPP_PRINT_CHECK_OK')));
assert.equal(mutations, 0, 'print verification should never change a sheet cell');
assert.equal(uiCalled, 0, 'modal dialogs must not block Apps Script');
assert.ok(flushed >= 2);
console.log('Print safety boundaries passed: source requirement, missing sheets, meter mismatch, nonblocking notification.');
