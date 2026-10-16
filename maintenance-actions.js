/* Browser controller: secure device handoff and delete one complete duty. */
(function(root){
'use strict';
function createController(deps){
 const {getSnapshot,replaceSnapshot,removeShift,saveFile,toast,refresh,confirmAction,isSending}=deps;
 const cipher=root.TAXIAPP_TRANSFER,view=root.TAXIAPP_MAINTENANCE;
 const find=id=>document.getElementById(id);
 const datePart=()=>new Date().toISOString().slice(0,10);
 function snapshot(){return view.validateSnapshot(getSnapshot());}
 async function exportEncrypted(){
  try{
   const password=find('migrationExportPassword')?.value||'';
   const confirmPassword=find('migrationExportConfirm')?.value||'';
   if(!cipher.passwordOk(password))throw Error('パスワードは12文字以上256文字以内で入力してください');
   if(password!==confirmPassword)throw Error('パスワードが一致していません');
   const data=snapshot(),p=data.model.prefs?.sheetTarget||{};
   if((!data.googleAccessKey||!p.webAppUrl)&&
    !confirmAction('このPCのTAXIAPPには接続キーかWebアプリURLが保存されていません。不完全な接続設定のまま書き出しますか？'))return;
   const file=await cipher.encrypt(data,password);
   saveFile(JSON.stringify(file),'TAXIAPP_暗号化一括引継_'+datePart()+'.json');
   if(find('migrationExportPassword'))find('migrationExportPassword').value='';
   if(find('migrationExportConfirm'))find('migrationExportConfirm').value='';
   toast('暗号化した一括引き継ぎファイルを保存しました。パスワードも安全に控えてください。');
  }catch(error){toast('一括書き出しに失敗：'+String(error.message||error),true);}
 }
 async function importEncrypted(){
  const file=find('importSecureMigration')?.files?.[0],
    password=find('migrationImportPassword')?.value||'';
  if(!file){toast('PCで作った暗号化引き継ぎファイルを選択してください',true);return;}
  if(file.size>15*1024*1024){toast('ファイルが大きすぎます（15MBまで）',true);return;}
  if(isSending()){toast('Googleへの送信が終了してから移行してください',true);return;}
  try{
   const parsed=JSON.parse(await file.text()),data=view.validateSnapshot(await cipher.decrypt(parsed,password));
   const before=snapshot(),incoming=data.model.shifts.length,existing=before.model.shifts.length;
   if(!confirmAction('【PC→スマホ一括上書き】\nPC側 '+incoming+'業務／スマホ側 '+existing+
    '業務。スマホにしかない業務・設定は上書きで消えます。\n接続キー：'+
    (data.googleAccessKey?'含まれています':'設定されていません')+
    '\nバックアップを保存してから上書きしますか？'))return;
   const backup=await cipher.encrypt(before,password);
   saveFile(JSON.stringify(backup),'TAXIAPP_上書き直前_'+datePart()+'.json');
   if(!confirmAction('スマホの元データのバックアップを保存できたことを確認しましたか？\n保存できていなければ「キャンセル」で中止してください。'))return;
   await replaceSnapshot(data);
   refresh();
   toast('PCの'+incoming+'業務と設定を引き継ぎました。Google送信は手動に切り替えています。');
  }catch(error){toast('一括引き継ぎ失敗：'+String(error.message||error),true);}
 }
 async function deleteDuty(id){
  const data=snapshot(),shift=data.model.shifts.find(s=>s.id===id);
  if(!shift){toast('削除対象の業務が見つかりません',true);return;}
  if(shift.id===data.model.activeId||!shift.endedAt){toast('乗務中や未入庫の業務は削除できません',true);return;}
  const description=(shift.date||'日付なし')+' '+String(shift.startedAt||'').slice(0,5)+
    '〜'+String(shift.endedAt||'').slice(0,5)+' 営業'+shift.records.length+'件';
  if(!confirmAction('【1業務を完全削除】\n'+description+
    '\nこの業務の営業・待機・GPS情報を端末から削除します。ほかの業務は残します。'+
    '\nGoogleシートに送信済みのデータは削除されません。続けますか？'))return;
  try{await removeShift(id);refresh();toast('選択した1業務を削除しました。');}
  catch(error){toast('削除に失敗：'+String(error.message||error),true);}
 }
 return Object.freeze({exportEncrypted,importEncrypted,deleteDuty});
}
root.TAXIAPP_MAINTENANCE=Object.freeze({...root.TAXIAPP_MAINTENANCE,createController});
})(typeof window!=='undefined'?window:globalThis);
