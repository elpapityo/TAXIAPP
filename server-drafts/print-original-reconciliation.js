'use strict';
/**
 * Stage 11 — READ ONLY reconciliation of legacy Google and Firestore originals.
 * No network, migration, printing, Sheet writes or deletion.
 * A Google legacy original is the administrator's live source until an
 * independently approved, fully verified Firestore cutover.
 */
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const canonical=value=>JSON.stringify(value,(_key,item)=>
 item&&typeof item==='object'&&!Array.isArray(item)?
  Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
function mapOriginals(value,label){
 if(!Array.isArray(value))throw Error(label+'の原本一覧を確認できません');
 const m=new Map();
 for(const s of value){
  if(!s||typeof s.id!=='string'||!ID.test(s.id)||m.has(s.id)||
     !Array.isArray(s.records)||s.records.length>60||
     !s.settings||typeof s.settings!=='object'||Array.isArray(s.settings))
   throw Error(label+'の原本ID・内容または重複が不正です');
  m.set(s.id,s);
 }
 return m;
}
function inspect({
 uid,cloudUid,legacyShifts,cloudShifts,selectedIds,
 cloudRevisions={},stageRevisions={},tombstones={}
}={}){
 if(typeof uid!=='string'||!uid||uid!==cloudUid)
  throw Error('管理者本人の同一認証UIDが必要です');
 const old=mapOriginals(legacyShifts,'Google同期原本');
 const cloud=mapOriginals(cloudShifts,'Firestore');
 if(!Array.isArray(selectedIds)||selectedIds.length>60||
    new Set(selectedIds).size!==selectedIds.length||
    selectedIds.some(id=>typeof id!=='string'||!ID.test(id)))
  throw Error('重複のない乗務IDを明示的に選んでください');
 const results=selectedIds.map(id=>{
  const sheet=old.get(id),remote=cloud.get(id),notes=[];
  let state='',possiblePrintSource='none',needsReprintPlan=false;
  if(!sheet&&!remote){
   state='not-found';notes.push('Google旧原本にもFirestoreにも存在しません');
  }else if(sheet&&!remote){
   state='legacy-only';possiblePrintSource='legacy';
   notes.push('旧Google原本が正式な印刷元です');
  }else{
   const rev=own(cloudRevisions,id)?cloudRevisions[id]:null;
   const marker=own(tombstones,id)?tombstones[id]:null;
   const stateOk=Number.isSafeInteger(rev)&&rev>=1&&
    marker?.format==='TAXIAPP_DUTY_TOMBSTONE_V1'&&
    marker.state==='active'&&marker.revision===rev&&
    Number.isSafeInteger(marker.generation)&&marker.generation>=1;
   if(!stateOk){
    state='cloud-unverified';
    notes.push('Firestoreの現在版と削除履歴が確認できません');
   }else if(sheet){
    if(canonical(sheet)===canonical(remote)){
     state='same-id-identical';possiblePrintSource='legacy';
     notes.push('両原本の内容は一致。ただし移行や印刷元切替の承認ではありません');
    }else{
     state='same-id-conflict';
     notes.push('同じ乗務IDのGoogle旧原本とFirestoreの内容が異なります');
    }
   }else{
    const staged=own(stageRevisions,id)?stageRevisions[id]:null;
    if(staged===null||staged===undefined){
     state='v2-stage-needed';
     notes.push('印刷V2ステージへの転送は別途本人認証付きで必要です');
    }else if(!Number.isSafeInteger(staged)||staged<1||staged>rev){
     state='stage-revision-conflict';
     notes.push('印刷ステージの更新番号が不正またはFirestoreより新しいです');
    }else if(staged<rev){
     state='reprint-preflight';
     needsReprintPlan=true;
     notes.push('Firestoreで修正済みのため、以前の印刷版との差分検査が必要です');
    }else{
     state='stage-recheck';
     notes.push('V2ステージ版番号は一致。印刷用4シートと現行原本の再照合が必要です');
    }
   }
  }
  return Object.freeze({
   id,state,possiblePrintSource,legacyOriginalPresent:Boolean(sheet),
   firestoreOriginalPresent:Boolean(remote),needsReprintPlan,
   notes,readOnly:true,writeAuthorized:false,cutoverAuthorized:false,
   printAuthorized:false,deleteAuthorized:false
  });
 });
 const counts=results.reduce((o,r)=>(o[r.state]=(o[r.state]||0)+1,o),{});
 return Object.freeze({format:'TAXIAPP_PRINT_ORIGINAL_RECONCILIATION_V1',uid,
  legacyCount:old.size,firestoreCount:cloud.size,selectedCount:selectedIds.length,
  results,counts,readOnly:true,writeAuthorized:false,
  cutoverAuthorized:false,printAuthorized:false,deleteAuthorized:false});
}
module.exports=Object.freeze({inspect});
