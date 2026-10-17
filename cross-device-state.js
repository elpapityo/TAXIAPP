/* Pure shift state mirror. The reader's cloud projection is never persisted. */
(function(root){
'use strict';
function isOpen(s){return !!s&&!s.endedAt&&!s.endedIso;}
function openShifts(shifts){return (shifts||[]).filter(isOpen);}
function selectActive(shifts,currentId='',blocked=[]){
 const list=Array.isArray(shifts)?shifts:[];
 const existing=list.find(s=>s.id===currentId);
 // Never switch a locally conflicted shift automatically.
 if(existing&&blocked.includes(currentId))return currentId;
 if(isOpen(existing))return currentId;
 const open=openShifts(list);
 return open.length===1?open[0].id:null;
}
function viewerProjection(local,shifts){
 const list=JSON.parse(JSON.stringify(shifts||[]));
 list.sort((a,b)=>String(b.startedIso||'').localeCompare(String(a.startedIso||'')));
 const open=openShifts(list);
 return {model:{...local,shifts:list,activeId:open.length===1?open[0].id:null},
  openCount:open.length};
}
root.TAXIAPP_SHIFT_MIRROR=Object.freeze({isOpen,openShifts,selectActive,viewerProjection});
})(typeof window!=='undefined'?window:globalThis);
