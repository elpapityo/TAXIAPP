/* TAXIAPP trash selection/review screen model (UNWIRED PREVIEW ONLY).
 * No data writes, deletions, session changes, or background actions.
 * Intended for linking to the verified trash client AFTER Emulator approval.
 */
(function(root){
'use strict';
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
function review({uid,serverUid,shifts,trash,selectedId}={}){
 if(typeof uid!=='string'||!uid||serverUid!==uid)
  throw Error('日報一覧とログイン中の本人UIDが一致しません');
 if(!Array.isArray(shifts)||!Array.isArray(trash))
  throw Error('サーバーの乗務一覧を確認できません');
 const seen=new Set();
 for(const item of [...shifts,...trash]){
  if(!item||!ID.test(String(item.id||''))||seen.has(item.id))
   throw Error('日報IDの形式が不正または重複しています');
  seen.add(item.id);
 }
 const result={
  uid,normalCount:shifts.length,trashCount:trash.length,items:[],
  selection:null,actionAuthorized:false
 };
 for(const x of shifts){
  const running=!x.endedAt&&!x.endedIso;
  const rev=Number(x.revision);
  const validRevision=Number.isSafeInteger(rev)&&rev>0;
  result.items.push({
   id:x.id,location:'normal',date:String(x.date||''),
   startedAt:String(x.startedAt||''),endedAt:String(x.endedAt||''),
   recordCount:Array.isArray(x.records)?x.records.length:
    Number.isSafeInteger(x.recordCount)?x.recordCount:0,
   fare:String(x.fare??'未取得'),
   running,revision:validRevision?rev:null,
   canChoose:!running&&validRevision,
   label:running?'未入庫のため対象外':!validRevision?'更新番号が未確認':'ゴミ箱への移動候補'
  });
 }
 for(const x of trash){
  result.items.push({
   id:x.id,location:'trash',date:String(x.date||''),
   recordCount:Number.isSafeInteger(x.recordCount)?x.recordCount:0,
   expiresAt:String(x.expiresAt||''),
   label:'保管中（復元は別途本人の確認が必要）',
   canChoose:false
  });
 }
 const found=result.items.find(x=>x.id===selectedId);
 if(found&&found.location==='normal')result.selection=found;
 return result;
}
function renderView(view){
 if(!view||!Array.isArray(view.items))throw Error('確認画面のデータが不正です');
 const normal=view.items.filter(x=>x.location==='normal');
 const trash=view.items.filter(x=>x.location==='trash');
 const cards=normal.map(x=>
  '<article class="card" data-trash-candidate="'+escapeHtml(x.id)+'">'+
   '<strong>'+escapeHtml(x.date||'日付未設定')+'</strong>'+
   '<p>出庫 '+escapeHtml(x.startedAt||'不明')+
   '　入庫 '+escapeHtml(x.endedAt||'未入庫')+'</p>'+
   '<p>営業 '+x.recordCount+'件／売上 '+escapeHtml(x.fare)+
   '／更新番号 '+escapeHtml(x.revision??'未確認')+'</p>'+
   '<p class="helper">'+escapeHtml(x.label)+'</p>'+
   '<label><input type="radio" name="duty-to-trash" value="'+escapeHtml(x.id)+'"'+
   (x.canChoose?'':' disabled')+
   (view.selection?.id===x.id?' checked':'')+'> この日報を削除候補として選ぶ</label>'+
   '</article>'
 ).join('');
 const bin=trash.map(x=>'<li>'+escapeHtml(x.date||'日付未設定')+
   '　営業 '+x.recordCount+'件／期限 '+escapeHtml(x.expiresAt)+
   '　'+escapeHtml(x.id)+'</li>').join('');
 return '<section aria-label="ゴミ箱移動の確認用プレビュー">'+
  '<h2>日報の選択（確認専用）</h2>'+
  '<p>通常の日報 '+normal.length+'件／ゴミ箱 '+trash.length+'件</p>'+
  (cards||'<p>日報はありません。</p>')+
  '<p class="warn">この画面は確認専用です。本人が内容を確認し、サーバーの更新番号・バックアップ・編集権限を照合するまで削除しません。</p>'+
  '<h3>ゴミ箱に保管中</h3><ul>'+(bin||'<li>現在は空です</li>')+'</ul>'+
  '<p>期限切れの日報は30日経過後、本人の次回ログイン時に整理する予定です（現時点では未接続）。</p>'+
  '</section>';
}
root.TAXIAPP_TRASH_REVIEW=Object.freeze({review,renderView});
})(typeof window!=='undefined'?window:globalThis);
