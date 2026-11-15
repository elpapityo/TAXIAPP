/* TAXIAPP: 端末間引き継ぎの保護判定。既存の同期・CAS・認証処理を変更しない。 */
(function handoffPolicyFactory(root){
 'use strict';
 function gate(p){
  if(!p?.ownerVerified)return {ok:false,reason:'本人のログイン・UIDを確認できません'};
  if(!p.writer)return {ok:false,reason:'この端末は操作端末ではありません'};
  if(!p.online)return {ok:false,reason:'通信を確認できません'};
  if(!p.activeId)return {ok:false,reason:'引き継ぐ乗務がありません'};
  if(p.ended)return {ok:false,reason:'入庫済みの乗務です'};
  if(!p.remoteReady)return {ok:false,reason:'同じ本人アカウントのクラウド同期が有効ではありません'};
  if(p.busy||p.conflicts>0||p.remoteError)return {ok:false,reason:'同期中・競合または通信エラーのため保留しました'};
  if(!p.localSaved)return {ok:false,reason:'端末への保存が確認できません'};
  if(!p.settingsConfirmed)return {ok:false,reason:'設定のクラウド読戻しを確認できません'};
  if(!p.syncSucceeded||!p.remoteConfirmed||!p.allLocalConfirmed)
   return {ok:false,reason:'本人クラウド原本の読戻しが一致しません'};
  if(!p.unchanged)return {ok:false,reason:'保存確認中に営業データが変更されました。再度確認してください'};
  return {ok:true,reason:'保存と読戻しを確認しました'};
 }
 function resumePlan(local,candidate){
  if(!Array.isArray(local))return {ok:false,reason:'端末内乗務が不正です'};
  if(!candidate||candidate.deleted||candidate.ended)return {ok:true,fetch:false,reason:'未入庫の再開候補なし'};
  if(typeof candidate.id!=='string'||!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(candidate.id)||
   !Number.isSafeInteger(candidate.revision)||candidate.revision<1)
   return {ok:false,reason:'クラウド再開候補の形式が不正です'};
  if(local.some(shift=>shift?.id===candidate.id))return {ok:true,fetch:false,reason:'同一乗務が端末に存在します'};
  if(local.some(shift=>shift&&!shift.endedAt&&!shift.endedIso))
   return {ok:false,reason:'端末とクラウドに異なる未入庫乗務があります。両方保護して停止します'};
  return {ok:true,fetch:true,id:candidate.id,revision:candidate.revision,reason:'未入庫の本人乗務を追加受信'};
 }
 root.TAXIAPP_HANDOFF_POLICY={gate,resumePlan};
})(typeof window!=='undefined'?window:globalThis);
