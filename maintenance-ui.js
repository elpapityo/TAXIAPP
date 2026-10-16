/* Pure UI and validation for TAXIAPP whole-shift administration and encrypted migration. */
(function(root){
'use strict';
function esc(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function shiftPanel(shifts,activeId){
 const list=[...(shifts||[])].sort((a,b)=>String(b.startedIso||'').localeCompare(String(a.startedIso||'')));
 const rows=list.map(s=>{
  const disabled=s.id===activeId||!s.endedAt;
  const action=disabled?'未入庫・削除不可':'<button type="button" class="linkbutton danger" data-action="deleteShift" data-id="'+esc(s.id)+'">この業務を削除</button>';
  return '<tr><td>'+esc(s.date||'—')+'</td><td>'+esc(s.startedAt||'').slice(0,5)+' ～ '+esc(s.endedAt||'').slice(0,5)+
   '</td><td>'+Number(s.records?.length||0)+'件</td><td>'+action+'</td></tr>';
 }).join('')||'<tr><td colspan="4">保存した業務はありません。</td></tr>';
 return '<section class="card"><details class="details"><summary>業務ごとの削除（'+list.length+'業務）</summary>'+
  '<div class="inner"><p class="helper">出庫から入庫までが1業務です。選んだ1業務のみ削除し、他の業務は残します。</p>'+
  '<p class="warn">削除はこの端末内だけです。Googleスプレッドシートに送信済みのデータは削除されません。</p>'+
  '<div class="table-wrap"><table class="data-table"><thead><tr><th>日付</th><th>出庫～入庫</th><th>営業件数</th><th>操作</th></tr></thead><tbody>'+
  rows+'</tbody></table></div></div></details></section>';
}
function transferPanel(){
 return '<section class="card" aria-label="暗号化したPCスマホの引き継ぎ">'+
  '<h2 class="h2">PC → スマホ 一括引き継ぎ</h2>'+
  '<p class="helper">業務記録、各種設定、GoogleシートURL、Apps Script WebアプリURL、接続キーをまとめて移行します。暗号化ファイルは外部のサーバーには送信されません。</p>'+
  '<p class="warn">接続キーも入ります。移行ファイルを公開しないでください。パスワードを忘れると復元できません。</p>'+
  '<h3 class="subsection">① PC側：一括ファイルを作成</h3>'+
  '<label class="field"><span class="field-label">移行用パスワード（12文字以上）</span><input id="migrationExportPassword" class="control" type="password" autocomplete="new-password" minlength="12"></label>'+
  '<label class="field"><span class="field-label">パスワードの再入力</span><input id="migrationExportConfirm" class="control" type="password" autocomplete="new-password" minlength="12"></label>'+
  '<div class="actions"><button type="button" class="btn primary" data-action="exportSecureMigration">暗号化して一括書き出し</button></div>'+
  '<h3 class="subsection">② スマホ側：PCの内容で上書き</h3>'+
  '<label class="field"><span class="field-label">暗号化した移行ファイル</span><input id="importSecureMigration" class="control" type="file" accept=".json,application/json"></label>'+
  '<label class="field"><span class="field-label">移行用パスワード</span><input id="migrationImportPassword" class="control" type="password" autocomplete="off"></label>'+
  '<div class="actions"><button type="button" class="btn red" data-action="importSecureMigration">スマホの業務・設定を一括上書き</button></div>'+
  '<p class="footnote">上書き前に暗号化したスマホのバックアップをダウンロードします。Googleのログイン状態・端末の位置情報許可・クラウド上の印刷シートは移しません。取り込み後は自動送信を停止し、手動送信で確認してください。</p>'+
  '</section>';
}
function validateSnapshot(data,maxRecords=60){
 if(!data||data.kind!=='TAXIAPP_FULL_DEVICE_SNAPSHOT_V1'||data.version!==1||
    !data.model||data.model.version!==1||!Array.isArray(data.model.shifts)||
    !data.model.prefs||typeof data.model.prefs!=='object'||Array.isArray(data.model.prefs)||
    typeof data.googleAccessKey!=='string'||data.googleAccessKey.length>512)
   throw Error('引き継ぎ用のデータ形式が不正です');
 const seen=new Set();
 for(const s of data.model.shifts){
  if(!s||typeof s.id!=='string'||!s.id||seen.has(s.id)||
    !Array.isArray(s.records)||s.records.length>maxRecords||
    !s.settings||typeof s.settings!=='object'||Array.isArray(s.settings)||
    s.records.some(r=>!r||!r.raw||typeof r.raw!=='object'||!['ride','empty','cancel'].includes(r.kind)))
     throw Error('引き継ぎファイル内の業務記録が不正です');
  seen.add(s.id);
 }
 if(data.model.activeId!==null&&data.model.activeId!==undefined&&!seen.has(data.model.activeId))
   throw Error('引き継ぎファイル内の乗務IDが不正です');
 return data;
}
root.TAXIAPP_MAINTENANCE=Object.freeze({shiftPanel,transferPanel,validateSnapshot});
})(typeof window!=='undefined'?window:globalThis);
