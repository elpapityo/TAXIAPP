/* TAXIAPP v2 cloud-sync UI adapter. Opt-in, per-duty CAS, encrypted conflict backup. */
(function(root){
'use strict';
root.TAXIAPP_SYNC_UI=function(d){
 let timer=null;
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:d.getModel,getPacket:d.getPacket,getEndpoint:d.endpoint,
  localStorage:root.localStorage,request:d.request,replaceRemoteShift:d.replace
 });
 const enabled=()=>d.prefs().syncMode==='on'&&d.configured()&&(!d.canSync||d.canSync());
 const status=()=>engine.status();
 function message(){
  const s=status();
  if(s.lastError)return '同期エラー：'+s.lastError;
  if(s.conflicts.length)return s.conflicts.length+'乗務で競合。両方の記録を保持しています。';
  return s.lastSyncAt?'最終照合 '+new Date(s.lastSyncAt).toLocaleString('ja-JP'):'未同期';
 }
 async function run(manual=false){
  if(!enabled()){
   if(manual)d.toast('Google接続情報と双方向同期の設定を確認してください',true);
   return false;
  }
  const ok=await engine.run();
  d.setStatus(message());
  if(manual)d.toast(message(),!ok);
  refreshPanel();
  return ok;
 }
 function schedule(){
  if(!enabled()||timer!==null)return;
  timer=setTimeout(async()=>{
   timer=null;
   if(document.visibilityState==='visible')await run(false);
  },1500);
 }
 async function resolve(id,localWins){
  if(!enabled())return;
  const pass=String(d.root.querySelector('[data-sync-backup-password]')?.value||'');
  if(!root.TAXIAPP_TRANSFER.passwordOk(pass)){
   d.toast('競合の控えを暗号化する12文字以上のパスワードを入力してください',true);return;
  }
  if(!root.confirm('この端末とクラウドの双方を暗号化バックアップしてから、選択した版に置き換えます。続けますか？'))return;
  const ok=await engine.resolve(id,localWins,async backup=>{
   const encrypted=await root.TAXIAPP_TRANSFER.encrypt(backup,pass);
   d.download(JSON.stringify(encrypted),'TAXIAPP_競合両版_'+d.dateStamp()+'_'+id+'.json','application/json;charset=utf-8');
   return root.confirm('暗号化バックアップのダウンロード完了を確認しましたか？\n保存とパスワードを確認した場合のみ「OK」を押してください。');
  });
  d.setStatus(message());refreshPanel();
  d.toast(ok?'競合を解決しました。暗号化バックアップを保管してください。':status().lastError||'競合はそのまま保留しました',!ok);
 }
 function conflictMarkup(s){
  const conflicts=s.conflicts.map(c=>'<div class="card"><strong>競合乗務 '+d.escape(c.id)+'</strong>'+
   '<p class="warn">'+d.escape(c.reason)+'</p>'+
   '<div class="actions"><button class="btn" type="button" data-sync-resolve="remote" data-id="'+d.escape(c.id)+'">クラウド版を採用</button>'+
   '<button class="btn red" type="button" data-sync-resolve="local" data-id="'+d.escape(c.id)+'">この端末版を採用</button></div></div>').join('');
  return conflicts?'<h3 class="subsection">競合の解決</h3><p class="warn">採用する版を選ぶ前に、両方の版を暗号化バックアップします。</p>'+
   '<label class="field"><span class="field-label">バックアップ用パスワード（12文字以上）</span>'+
   '<input class="control" type="password" data-sync-backup-password autocomplete="new-password"></label>'+conflicts:'';
 }
 // A cloud poll may finish every ~20 seconds. Never rebuild the whole Settings
 // page: that would collapse native <details>, steal focus and reset scrolling.
 function refreshPanel(){
  const text=d.root.querySelector('[data-sync-status]');
  if(text)text.textContent=message();
  const holder=d.root.querySelector('[data-sync-conflicts]');
  if(!holder)return;
  const signature=JSON.stringify(status().conflicts);
  if(holder.dataset.syncSignature===signature)return;
  if(holder.querySelector('input:focus,textarea:focus,select:focus'))return;
  holder.innerHTML=conflictMarkup(status());
  holder.dataset.syncSignature=signature;
 }
 function panel(){
  const on=d.prefs().syncMode==='on',s=status();
  return '<hr class="divider"><h3 class="subsection">端末間の双方向同期（ブラウザ版・Android版／試験）</h3>'+
   '<p class="helper">端末内の保存は継続します。Google側の更新番号を照合し、別端末と同時に変更した乗務は自動上書きせず保留します。</p>'+
   '<label class="field"><span class="field-label">同期モード</span><select class="control" data-cloud-setting="syncMode">'+
   '<option value="off" '+(!on?'selected':'')+'>無効（従来どおり）</option>'+
   '<option value="on" '+(on?'selected':'')+'>双方向同期（Google受信API更新後）</option></select></label>'+
   '<div class="actions"><button class="btn primary" type="button" data-action="bidirectionalSyncNow">↕ 今すぐ照合</button></div>'+
   '<p class="caption-note" data-sync-status>'+d.escape(message())+'</p>'+
   '<div data-sync-conflicts>'+conflictMarkup(s)+'</div>'+
   '<p class="footnote">初回に同一乗務の内容が異なる場合も競合扱いです。クラウド側のコードを更新・再公開するまで有効にしないでください。端末ごとの表示設定・GPS権限は個別です。</p>';
 }
 return {enabled,run,schedule,panel,resolve,status,message};
};
})(typeof window!=='undefined'?window:globalThis);
