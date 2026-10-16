/**
 * TAXIAPP -> Google Sheets bridge.
 * ADD as a new .gs file in Extensions > Apps Script; do not replace any old
 * scripts or macros. Then deploy a Web App
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

// Unique menu handler: the original spreadsheet's onOpen() and macros remain intact.
function taxiappOpenMenu() {
 SpreadsheetApp.getUi().createMenu('TAXIAPP 印刷')
  .addItem('初期設定・接続キーを確認', 'setupTAXIAPP')
  .addItem('最新乗務を選択', 'selectLatestTAXIAPPShift')
  .addItem('印刷対象とメーター売上を確認', 'applySelectedPrintShift')
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
 // Keep all existing macros. Install only our independent on-open trigger once.
 if (!ScriptApp.getProjectTriggers().some(function(trigger) {
  return trigger.getHandlerFunction() === 'taxiappOpenMenu';
 })) ScriptApp.newTrigger('taxiappOpenMenu').forSpreadsheet(ss).onOpen().create();
 try { taxiappOpenMenu(); } catch(menuError) { Logger.log('メニュー表示はシートを再読み込みして確認: '+menuError); }
 var page = ss.getSheetByName('TAXIAPP_印刷操作');
 if (page) {
  page.getRange('A17').setValue('印刷対象の乗務（出庫日時・件数）');
  page.getRange('A18').setValue('最後に反映した乗務');
  page.getRange('A19').setValue('印刷帳票の確認');
  var ids = ss.getSheetByName('TAXIAPP_乗務一覧');
  var rule = SpreadsheetApp.newDataValidation()
   .requireValueInRange(ids.getRange('T2:T1200'), true)
   .setAllowInvalid(true).build();
  page.getRange('B17').setDataValidation(rule);
  page.getRange('A15').setValue('最新乗務を表示（チェックで切替）');
  // Do not force B15 back to false: the user may want follow-latest mode.
  var flag=page.getRange('B15');
  flag.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
 }
 Logger.log('TAXIAPP 接続キー（他人には見せない）: ' + token);
 Logger.log('このキーとデプロイ後の /exec URLをスマホTAXIAPPの設定へ入力してください。');
 try {
  SpreadsheetApp.getUi().alert(
   'TAXIAPP 接続キー（外部へ公開しないでください）',
   '接続キー：\n\n' + token + '\n\n' +
    'Webアプリの /exec URLと一緒にTAXIAPPの設定へ入力してください。',
   SpreadsheetApp.getUi().ButtonSet.OK);
 } catch(uiError) {
  Logger.log('画面のダイアログを開けない場合は上の実行ログからキーを控えてください。');
 }
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
  'window.top.postMessage(' + json + ',' +
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
 if (!/^\d{4}-\d{2}-\d{2}$/.test(String(shift.date || '')))
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
 // Keep the most recently departed shift at the top of the shift list.
 if (sheetName === 'TAXIAPP_乗務一覧') {
  all.sort(function(a,b) {
   var aId = String(a[0]||'').match(/^shift-(\d+)/);
   var bId = String(b[0]||'').match(/^shift-(\d+)/);
   return Number(bId?bId[1]:0)-Number(aId?aId[1]:0);
  });
 }
 if (sheet.getMaxRows() < all.length + 1)
  sheet.insertRowsAfter(sheet.getMaxRows(), all.length + 1 - sheet.getMaxRows());
 if (count) sheet.getRange(2, 1, count, width).clearContent();
 if (all.length) sheet.getRange(2, 1, all.length, width).setValues(all);
}

function safeCell_(item) {
 if (item === null || item === undefined) return '';
 if (typeof item === 'boolean') return item;
 if (typeof item === 'number') return Number.isFinite(item) ? item : '';
 if (Object.prototype.toString.call(item)==='[object Date]')
  return Number.isFinite(item.getTime()) ? item : '';
 if (typeof item !== 'string') item = JSON.stringify(item);
 // Do not interpret passenger-entered strings as executable spreadsheet formulas.
 return /^[=+@]/.test(item) ? "'" + item : item;
}
function numeric_(v) {
 if (v === null || v === undefined || String(v).trim() === '') return 0;
 var n = Number(v);
 return Number.isFinite(n) ? n : 0;
}

function shiftTimestamp_(iso, localDate, localTime) {
 if (iso) {
  var exact=new Date(String(iso));
  if(Number.isFinite(exact.getTime()))return exact;
 }
 if (/^\d{4}-\d{2}-\d{2}$/.test(String(localDate||'')) &&
     /^\d{1,2}:\d{2}/.test(String(localTime||''))) {
  var day=String(localDate).split('-').map(Number);
  var parts=String(localTime).split(':').map(Number);
  return new Date(Date.UTC(day[0],day[1]-1,day[2],parts[0]-9,parts[1],parts[2]||0));
 }
 return '';
}
// Google Sheets displays native Date cells in the spreadsheet's Asia/Tokyo time zone.
function selectLatestTAXIAPPShift() {
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var operation=ss.getSheetByName('TAXIAPP_印刷操作');
 if(!operation)throw Error('印刷操作シートがありません');
 var latest=ss.getSheetByName('TAXIAPP_乗務一覧').getRange('T2').getDisplayValue();
 if(!latest)throw Error('まだ受信した乗務がありません');
 // The visible selector must contain the friendly label, never shift-... IDs.
 // Follow-latest mode keeps working after new shifts arrive.
 operation.getRange('B15').setValue(true);
 operation.getRange('B17').setFormula('=IFERROR(\'TAXIAPP_乗務一覧\'!$T$2,"")');
 SpreadsheetApp.flush();
 try {SpreadsheetApp.getUi().alert('最新乗務を選択しました',latest,SpreadsheetApp.getUi().ButtonSet.OK);}
 catch(e){Logger.log('最新乗務を選択: '+latest);}
}
function savePacket_(data) {
 var ss = SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 ensureStorageSheets_(ss);
 // Ignore legacy 700-yen cancel fee values from older app versions.
 // A cancelled dispatch is recorded, but always has zero fare and zero revenue.
 var submitted=data.shift;
 var restoredGoCash=0,restoredGoPayments=0;
 var shift={...submitted,records:(submitted.records||[]).map(function(record){
  if(record.kind==='cancel'){
   return {...record,raw:{...(record.raw||{}),K:0},
    amounts:{...(record.amounts||{}),meter:0,cancellation:0,goFee:0,
     uberSurcharge:0,reservation:0,tip:0,customerBill:0,printedDetail:0,
     uberCommissionBase:0}};
  }
  // Older TAXIAPP clients wrongly deducted the 200-yen GO collection fee
  // from the company portion of the tender. Restore it even on resends.
  if(record.kind==='ride'&&record.status==='complete'&&record.raw&&record.raw.E==='G'&&numeric_(record.amounts&&record.amounts.goFee)>0){
   return {...record,payments:(record.payments||[]).map(function(p){
    var paid=numeric_(p.received),prior=numeric_(p.company);
    var missing=Math.max(0,paid-prior);
    restoredGoPayments+=missing;
    if(p.type==='現')restoredGoCash+=missing;
    return {...p,company:paid};
   })};
  }
  return record;
 })};
 var id=String(shift.id);
 var summary={...(data.summary||{}),cancellation:0};
 summary.cashRemittance=numeric_(summary.cashRemittance)+restoredGoCash;
 summary.paymentAllocated=numeric_(summary.paymentAllocated)+restoredGoPayments;
 // GO fees already belong to the tender received; do not add them twice.
 summary.totalRemittance=summary.cashRemittance+numeric_(summary.etcRemittance);
 var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
 var records = shift.records || [];
 var shiftRows = [[id,shift.date,shiftTimestamp_(shift.startedIso,shift.date,shift.startedAt),
  shiftTimestamp_(shift.endedIso,shift.date,shift.endedAt),shift.driver||'',shift.driverNo||'',
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
  // Cancellation is always a 0-yen operational event. Keep its time and label,
  // but do not include any fare in the printed or aggregate sales.
  var isCancellation=record.kind==='cancel'&&record.status==='complete';
  var meta=record.meta||{};
  print.push([id,num,raw.E||'',isCancellation?'キャンセル':raw.N||'',
   isCancellation?0:raw.K||'',
   isCancellation?(meta.dispatchAt||raw.C||''):raw.G||'',
   isCancellation?(meta.cancelAt||''):raw.M||'',
   raw.AL||'',raw.AM||'',raw.AQ||'',raw.W||'',raw.AI||'',raw.AR||'',
   meta.settledIso||'']);
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
 replaceRowsForShift_(ss,'TAXIAPP_同期原本',id,[originals],TAXIAPP_MAX_CHUNKS+3);
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
 var match=String(value||'').match(/^(\d{1,2}):(\d{2})/);
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
/**
 * Print sheets are now driven directly by the chosen shift ID in
 * TAXIAPP_印刷操作!B17. No legacy RAW/日報/チケット/まとめ2 content is copied
 * or changed; changing the dropdown automatically changes the printed data.
 */
function resolvePrintShiftId_(ss,operation) {
 var index=ss.getSheetByName('TAXIAPP_乗務一覧');
 var originals=ss.getSheetByName('TAXIAPP_同期原本');
 if(!index||!originals)throw Error('TAXIAPPの保存用シートがありません');
 var followLatest=operation.getRange('B15').getValue()===true;
 var choice=String(operation.getRange('B17').getDisplayValue()||'').trim();
 var derived=String(operation.getRange('C17').getDisplayValue()||'').trim();
 var length=Math.max(0,index.getLastRow()-1);
 if(!length)return '';
 var rows=index.getRange(2,1,length,21).getDisplayValues();
 var savedIds=new Set(originals.getRange(2,1,Math.max(1,originals.getLastRow()-1),1)
  .getDisplayValues().map(function(r){return String(r[0]||'').trim();}));
 // T is a sorted list of *labels* while A and U remain row-aligned.
 // A2 is NOT necessarily the same duty as the top (latest) label in T2.
 var requested=followLatest?String(index.getRange('T2').getDisplayValue()||'').trim():choice;
 if(!requested)return '';
 // Validate both the selected label and presence of the original snapshot.
 // Do not trust C17 by itself: its formula can lag behind B15/B17.
 for(var i=0;i<rows.length;i++){
  var id=String(rows[i][0]||'').trim();
  var label=String(rows[i][20]||'').trim();
  if(!savedIds.has(id))continue;
  if(requested===id||requested===label)return id;
 }
 // Compatible with older sheets where the row-aligned U formula is absent.
 // Only allow derived when it genuinely matches the selected ID/label;
 // otherwise selecting a different duty could silently print the wrong one.
 if(derived&&savedIds.has(derived)&&requested===derived)return derived;
 return '';
}
function applySelectedPrintShift() {
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var operation=ss.getSheetByName('TAXIAPP_印刷操作');
 if(!operation)throw Error('印刷操作シートがありません');
 // C17 is an internal ID formula; B17 is the human-readable shift label.
 // Resolve the ID against saved source data so older scripts that wrote
 // raw shift IDs directly to B17 cannot trigger false "not found" errors.
 var id=resolvePrintShiftId_(ss,operation);
 if(!id)throw Error('印刷対象が見つかりません。B15にチェックを入れるか、B17から乗務を選んでください');
 var shift=loadShift_(ss,id);
 if(!Array.isArray(shift.records)||shift.records.length>60)
  throw Error('営業データを確認してください');
 var first=ss.getSheetByName('補助簿印刷用');
 var second=ss.getSheetByName('補助簿印刷用_2頁');
 if(!first||!second)throw Error('補助簿の印刷用シートがありません');
 SpreadsheetApp.flush();
 var expected=shift.records.reduce(function(sum,r) {
  return sum + (r.status==='complete'&&r.kind==='ride'?numeric_(r.raw&&r.raw.K):0);
 },0);
 var actual=Number(first.getRange('X23').getValue()||0);
 if (Math.abs(expected-actual)>0.01)
  throw Error('集計表のメーター売上が一致しません。B17を再選択してください。');
 // Preserve live status and selection formulas in B18, B19, B3 and B4.
 // These formulas update automatically as soon as the dropdown changes.
 // Calling getUi().alert() pauses Apps Script until someone accepts the
 // modal. From the editor it may not appear on the spreadsheet at all,
 // leaving the run indefinitely suspended. Use nonblocking toast + logs.
 var notice='乗務 '+shift.date+' / '+shift.records.length+
  '件 / メーター '+expected+'円、原本と印刷用帳票を照合済み';
 Logger.log('TAXIAPP_PRINT_CHECK_OK id='+id+' : '+notice);
 try{
  ss.toast(notice,'TAXIAPP 印刷確認',8);
 }catch(toastError){
  Logger.log('印刷通知の表示を省略: '+String(toastError));
 }
 return {ok:true,shiftId:id,records:shift.records.length,meter:expected};
}
