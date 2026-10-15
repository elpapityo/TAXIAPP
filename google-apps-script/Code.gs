/**
 * TAXIAPP -> Google Sheets bridge.
 * Install in Extensions > Apps Script on this spreadsheet, and deploy a Web App
 * ("Execute as: Me", "Who has access: Anyone"). A separate random shared key is
 * required for EVERY POST, so the /exec URL alone cannot write to this sheet.
 * No web credentials belong in public GitHub code.
 *
 * Spreadsheet:
 * https://docs.google.com/spreadsheets/d/1tBoPSm_hni7VE_TcP3n0gvGXexX9G4KSKUD3xPJZNS4/edit
 *
 * Does not print anything from the phone. The PC operator chooses a shift in
 * TAXIAPP_印刷操作!B17 and uses TAXIAPP 印刷 > 選択乗務を補助簿へ反映.
 * Existing printing sheet formatting, widths, merges and borders are not changed.
 */
var TAXIAPP_SHEET_ID = '1tBoPSm_hni7VE_TcP3n0gvGXexX9G4KSKUD3xPJZNS4';
var TAXIAPP_ORIGIN = 'https://elpapityo.github.io';
var TAXIAPP_MAX_RECORDS = 60;
var TAXIAPP_MAX_CHUNKS = 20;
var TAXIAPP_CHUNK_SIZE = 30000;
var TAXIAPP_RAW_KEYS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P',
 'Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH',
 'AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR'];

function onOpen() {
 SpreadsheetApp.getUi().createMenu('TAXIAPP 印刷')
  .addItem('初期設定・接続キーを確認', 'setupTAXIAPP')
  .addItem('選択乗務を補助簿へ反映', 'applySelectedPrintShift')
  .addToUi();
}

/** Run once from Apps Script or the sheet's "TAXIAPP 印刷" menu. */
function setupTAXIAPP() {
 var props = PropertiesService.getScriptProperties();
 var token = props.getProperty('TAXIAPP_WRITE_KEY');
 if (!token) {
  token = Utilities.getUuid().replace(/-/g, '') +
   Utilities.getUuid().replace(/-/g, '');
  props.setProperty('TAXIAPP_WRITE_KEY', token);
 }
 var ss = SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 ensureStorageSheets_(ss);
 var page = ss.getSheetByName('TAXIAPP_印刷操作');
 if (page) {
  page.getRange('A17').setValue('印刷対象の乗務ID');
  page.getRange('A18').setValue('最後に反映した乗務');
  page.getRange('A19').setValue('印刷帳票の確認');
  var ids = ss.getSheetByName('TAXIAPP_乗務一覧');
  var rule = SpreadsheetApp.newDataValidation()
   .requireValueInRange(ids.getRange('A2:A1200'), true)
   .setAllowInvalid(true).build();
  page.getRange('B17').setDataValidation(rule);
 }
 SpreadsheetApp.getUi().alert(
  'TAXIAPP 接続キー（外部へ公開しないでください）',
  'このキーをスマホの「設定 → Googleスプレッドシート」に入力してください。\n\n' +
   token + '\n\n' +
   'Webアプリをデプロイ後、表示された /exec のURLも入力してください。',
  SpreadsheetApp.getUi().ButtonSet.OK);
}

function doGet(e) {
 return HtmlService.createHtmlOutput(
  '<html><body><p>TAXIAPP bridge. Send signed requests from the TAXIAPP app.</p></body></html>');
}

function doPost(e) {
 var nonce = String((e && e.parameter && e.parameter.nonce) || '').slice(0, 100);
 try {
  var token = PropertiesService.getScriptProperties().getProperty('TAXIAPP_WRITE_KEY');
  if (!token || !e || !e.parameter ||
   String(e.parameter.key || '') !== token) throw Error('接続キーが違います');
  if (e.parameter.action !== 'sync') throw Error('未対応の処理です');
  var raw = String(e.parameter.payload || '');
  if (!raw || raw.length > 650000) throw Error('送信データのサイズが不正です');
  var data = JSON.parse(raw);
  validatePacket_(data);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw Error('別の送信を処理中です。再試行してください');
  try {
   var summary = savePacket_(data);
   return replyToPhone_(nonce, true, summary);
  } finally {
   lock.releaseLock();
  }
 } catch (err) {
  return replyToPhone_(nonce, false, String(err && err.message || err).slice(0, 250));
 }
}

function replyToPhone_(nonce, success, detail) {
 var reply = {
  type: 'TAXIAPP_SYNC_RESULT',
  nonce: nonce,
  ok: Boolean(success),
  message: String(detail || '')
 };
 var json = JSON.stringify(reply).replace(/</g, '\\u003c');
 var html = '<!doctype html><html><body><script>' +
  'window.parent.postMessage(' + json + ',' +
  JSON.stringify(TAXIAPP_ORIGIN) + ');' +
  '</scr' + 'ipt></body></html>';
 return HtmlService.createHtmlOutput(html)
  .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function validatePacket_(packet) {
 if (!packet || packet.kind !== 'TAXIAPP_SHIFT_V1' || !packet.shift)
  throw Error('不明なデータ形式です');
 var shift = packet.shift;
 if (!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(String(shift.id || '')))
  throw Error('乗務IDが不正です');
 if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(shift.date || '')))
  throw Error('乗務日が不正です');
 if (!Array.isArray(shift.records) || shift.records.length > TAXIAPP_MAX_RECORDS)
  throw Error('営業件数が不正です');
 shift.records.forEach(function(record) {
  if (!record || !record.raw || typeof record.raw !== 'object')
   throw Error('営業のデータ構造が不正です');
 });
}

function ensureStorageSheets_(ss) {
 var headings = {
  'TAXIAPP_乗務一覧': ['乗務ID','乗務日','出庫日時','入庫日時','運転者','社員番号',
   '車両番号','営業件数','メーター売上','障がい者割引','GO手数料',
   'Uber配車手数料','現金納金','ETC','総入金額','更新日時','転送状態',
   '出庫km','入庫km'],
  'TAXIAPP_乗務保管': ['乗務ID','営業番号','レコード種別','状態','配車元',
   '支払金種','乗車時刻','降車時刻','乗車km','降車km','メーター売上','割引区分',
   '割引額','実車高速','空車高速','GO手数料','Uber手数料','精算完了日時','元データJSON'],
  'TAXIAPP_決済内訳': ['乗務ID','営業番号','決済内訳番号','支払金種','支払金額',
   'アプリ決済額','現金受取','高速料金','割引額','手数料','備考'],
  'TAXIAPP_集計': ['乗務ID','種類','金額','計算根拠','更新日時'],
  'TAXIAPP_印刷データ': ['乗務ID','営業番号','配車区分','支払表示','表示金額',
   '乗車時刻','降車時刻','乗車地','降車地','GO手数料確認','実車高速',
   '空車高速','障がい者割引','精算完了日時'],
  'TAXIAPP_同期原本': ['乗務ID','更新日時','分割数']
 };
 for (var key in headings) {
  var sh = ss.getSheetByName(key);
  if (!sh) sh = ss.insertSheet(key);
  var cols = headings[key];
  if (sh.getMaxColumns() < cols.length)
   sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
 }
}

/** Data is keyed by shift ID: repeat uploads REPLACE that shift, never duplicate it. */
function replaceRowsForShift_(ss, sheetName, id, incoming, width) {
 var sheet = ss.getSheetByName(sheetName);
 var count = Math.max(0, sheet.getLastRow() - 1);
 var retained = count ?
  sheet.getRange(2, 1, count, width).getValues().filter(function(row) {
   return String(row[0]) !== id && String(row[0]) !== '';
  }) : [];
 var all = retained.concat(incoming.map(function(row) {
  var padded = row.concat(Array(Math.max(0, width - row.length)).fill('')).slice(0, width);
  return padded.map(safeCell_);
 }));
 if (sheet.getMaxRows() < all.length + 1)
  sheet.insertRowsAfter(sheet.getMaxRows(), all.length + 1 - sheet.getMaxRows());
 if (count) sheet.getRange(2, 1, count, width).clearContent();
 if (all.length) sheet.getRange(2, 1, all.length, width).setValues(all);
}

function safeCell_(item) {
 if (item === null || item === undefined) return '';
 if (typeof item === 'boolean') return item;
 if (typeof item === 'number') return Number.isFinite(item) ? item : '';
 if (typeof item !== 'string') item = JSON.stringify(item);
 // Do not interpret passenger-entered strings as executable spreadsheet formulas.
 return /^[=+@]/.test(item) ? "'" + item : item;
}
function numeric_(v) {
 if (v === null || v === undefined || String(v).trim() === '') return 0;
 var n = Number(v);
 return Number.isFinite(n) ? n : 0;
}

function savePacket_(data) {
 var ss = SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 ensureStorageSheets_(ss);
 var shift = data.shift, id = String(shift.id);
 var summary = data.summary || {};
 var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
 var records = shift.records || [];
 var shiftRows = [[id,shift.date,shift.startedIso||shift.startedAt||'',
  shift.endedIso||shift.endedAt||'',shift.driver||'',shift.driverNo||'',
  shift.vehicle||'',records.length,numeric_(summary.meter),numeric_(summary.discount),
  numeric_(summary.goFee),numeric_(summary.uberSurcharge),
  numeric_(summary.cashRemittance),numeric_(summary.etcRemittance),
  numeric_(summary.totalRemittance),now,'受信済み',shift.startingOdo||'',shift.endingOdo||'']];
 replaceRowsForShift_(ss,'TAXIAPP_乗務一覧',id,shiftRows,19);
 var storage=[],payments=[],print=[];
 records.forEach(function(record) {
  var raw = record.raw||{},amounts=record.amounts||{};
  var num = raw.A||'';
  storage.push([id,num,record.kind||'',record.status||'',raw.E||'',raw.N||'',
   raw.G||'',raw.M||'',raw.F||'',raw.L||'',raw.K||'',raw.O||'',
   raw.AR||'',raw.W||'',raw.AI||'',raw.AQ||'',numeric_(amounts.uberSurcharge),
   (record.meta&&record.meta.settledIso)||'',JSON.stringify(record)]);
  (record.payments||[]).forEach(function(p,i) {
   payments.push([id,num,i+1,p.type||'',numeric_(p.received),
    p.type==='U'?numeric_(p.received):'',p.type==='現'?numeric_(p.received):'',
    numeric_(raw.W),numeric_(raw.AR),
    numeric_(p.received)-numeric_(p.company),
    p.type===raw.N?'主金種':'複合決済']);
  });
  print.push([id,num,raw.E||'',raw.N||'',raw.K||'',raw.G||'',raw.M||'',
   raw.AL||'',raw.AM||'',raw.AQ||'',raw.W||'',raw.AI||'',raw.AR||'',
   (record.meta&&record.meta.settledIso)||'']);
 });
 replaceRowsForShift_(ss,'TAXIAPP_乗務保管',id,storage,19);
 replaceRowsForShift_(ss,'TAXIAPP_決済内訳',id,payments,11);
 replaceRowsForShift_(ss,'TAXIAPP_印刷データ',id,print,14);
 var items = ['meter','discount','goFee','uberSurcharge','cashRemittance',
  'etcRemittance','totalRemittance','realToll','emptyToll','cancellation','tip',
  'reservation','cashReceived','paymentAllocated'];
 var aggregate = items.map(function(key){
  return [id,key,numeric_(summary[key]),'TAXIAPP 計算済み',now];
 });
 replaceRowsForShift_(ss,'TAXIAPP_集計',id,aggregate,5);
 // Save a lossless shift snapshot in 30,000-character chunks (under cell limit).
 var json = JSON.stringify(shift);
 var chunks = [];
 for (var start = 0; start < json.length; start += TAXIAPP_CHUNK_SIZE)
  chunks.push(json.slice(start,start+TAXIAPP_CHUNK_SIZE));
 if (chunks.length > TAXIAPP_MAX_CHUNKS) throw Error('乗務データが大きすぎます');
 var originals = [id,now,chunks.length].concat(chunks);
 replaceRowsForShift_(ss,'TAXIAPP_同期原本',id,[originals],originals.length);
 return '保存完了：' + shift.date + ' / ' + records.length + '件';
}

function loadShift_(ss,id) {
 var originals=ss.getSheetByName('TAXIAPP_同期原本');
 if (!originals || originals.getLastRow()<2) throw Error('乗務データがまだありません');
 var all=originals.getRange(2,1,originals.getLastRow()-1,
  Math.min(originals.getLastColumn(),TAXIAPP_MAX_CHUNKS+3)).getValues();
 for(var i=0;i<all.length;i++){
  if(String(all[i][0])!==id)continue;
  var n=Number(all[i][2]);
  if(!Number.isInteger(n)||n<1||n>TAXIAPP_MAX_CHUNKS)throw Error('原本データが不正です');
  return JSON.parse(all[i].slice(3,3+n).join(''));
 }
 throw Error('指定の乗務IDが見つかりません');
}

function timeFraction_(value) {
 var match=String(value||'').match(/^(\\d{1,2}):(\\d{2})/);
 if(!match)return '';
 var h=Number(match[1]),m=Number(match[2]);
 return h<=23&&m<=59?(h*60+m)/1440:'';
}
function numericOrBlank_(value) {
 if(value===null||value===undefined||String(value).trim()==='')return '';
 var n=Number(value);
 return Number.isFinite(n)?n:'';
}

/** On the PC only; intentionally does NOT run when the phone uploads data. */
function applySelectedPrintShift() {
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('別の処理を実行中です');
 try {
  var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
  var operation=ss.getSheetByName('TAXIAPP_印刷操作');
  if(!operation)throw Error('印刷操作シートがありません');
  var id=String(operation.getRange('B17').getDisplayValue()||'').trim();
  if(!id)throw Error('B17で印刷対象の乗務IDを選択してください');
  var shift=loadShift_(ss,id);
  if(!Array.isArray(shift.records)||shift.records.length>60)
   throw Error('営業データを確認してください');
  // Preserve pre-switch legacy test data in hidden copies, once.
  snapshotLegacy_(ss,'入力_RAW_実車','旧テスト控え_RAW');
  snapshotLegacy_(ss,'日報','旧テスト控え_日報');
  var rawSheet=ss.getSheetByName('入力_RAW_実車');
  var report=ss.getSheetByName('日報');
  if(!rawSheet||!report)throw Error('原本の参照シートがありません');
  // 44-column source sheet drives all later-ride XLOOKUPs.
  // Clearing the previous 124 rows prevents stale trips when switching shifts.
  rawSheet.getRange(2,1,124,44).clearContent();
  var rides=(shift.records||[]).filter(function(r){
   return r&&r.status==='complete';
  }).sort(function(a,b){return numeric_(a.raw&&a.raw.A)-numeric_(b.raw&&b.raw.A)});
  var rawRows = rides.map(function(r){
   return TAXIAPP_RAW_KEYS.map(function(k){
    var v=(r.raw||{})[k];
    return safeCell_(v);
   });
  });
  if(rawRows.length)rawSheet.getRange(2,1,rawRows.length,44).setValues(rawRows);
  // Rows 4-25 are legacy typed values; row 26 onward contains XLOOKUP
  // formulas. Never overwrite those formulas or their styling.
  report.getRange('E4:P25').clearContent();
  var first = rides.slice(0,22).map(function(r){
   var x=r.raw||{};
   return [timeFraction_(x.C),x.AL||x.D||'',x.E||'',
    numericOrBlank_(x.F),timeFraction_(x.G),x.AM||x.H||'',
    numericOrBlank_(x.I),numericOrBlank_(x.J),numericOrBlank_(x.K),
    numericOrBlank_(x.L),timeFraction_(x.M),x.N||''].map(safeCell_);
  });
  if(first.length)report.getRange(4,5,first.length,12).setValues(first);
  var d=String(shift.date||'').split('-').map(Number);
  if(d.length===3&&d.every(Number.isFinite))report.getRange('B1')
   .setValue(new Date(d[0],d[1]-1,d[2],12,0,0));
  report.getRange('C2').setValue(timeFraction_(shift.startedAt));
  ['補助簿印刷用','補助簿印刷用_2頁'].forEach(function(name){
   var page=ss.getSheetByName(name);
   if(!page)return;
   page.getRange('D4').setValue(safeCell_(shift.driverNo||''));
   page.getRange('D5').setValue(safeCell_(shift.driver||''));
   page.getRange('J4').setValue(safeCell_(shift.vehicle||''));
  });
  SpreadsheetApp.flush();
  operation.getRange('B18').setValue(id+' / '+String(shift.date));
  operation.getRange('B19').setValue('反映済み（印刷前に金額・用紙位置を確認）');
  operation.getRange('B3').setValue('印刷用データを反映しました。2枚の補助簿を確認してください');
  operation.getRange('B4').setValue('乗務 '+String(shift.date)+' / 営業 '+rides.length+'件');
  SpreadsheetApp.getUi().alert('反映しました',
   '乗務：'+shift.date+' / '+rides.length+'件\n補助簿印刷用と補助簿印刷用_2頁を確認して印刷してください。',
   SpreadsheetApp.getUi().ButtonSet.OK);
 } finally {
  lock.releaseLock();
 }
}
function snapshotLegacy_(ss,sourceName,backupName){
 if(ss.getSheetByName(backupName))return;
 var original=ss.getSheetByName(sourceName);
 if(!original)throw Error('参照シート '+sourceName+' がありません');
 var backup=original.copyTo(ss).setName(backupName);
 backup.hideSheet();
}
