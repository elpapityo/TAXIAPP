/* TAXIAPP メーター型の記録確認。表示専用・日報や料金の更新なし。 */
(function(root){
'use strict';
const $=id=>document.getElementById(id);
let active=null,timer=null,onEdit=null;
function stopTimer(){if(timer!==null){clearTimeout(timer);timer=null;}}
function close(){stopTimer();active=null;onEdit=null;const el=$('meterRecordNotice');if(el)el.hidden=true;}
function update(rows,key){
 if(!active||active.key!==key)return;
 const body=$('meterRecordNoticeRows');if(!body)return;
 body.replaceChildren();
 for(const row of rows){
  if(!row||!row.label)continue;
  const cell=document.createElement('div');
  cell.className='meter-confirm-row'+(row.prominent?' prominent':'');
  const label=document.createElement('span');label.textContent=String(row.label);
  const value=document.createElement('strong');
  const displayed=row.value===null||row.value===undefined||row.value===''?'未取得':String(row.value);
  value.textContent=displayed;
  if(displayed==='取得中')value.classList.add('meter-confirm-pending');
  cell.append(label,value);body.appendChild(cell);
 }
 if(!body.childElementCount){
  const empty=document.createElement('p');empty.className='meter-confirm-empty';
  empty.textContent='記録結果を確認中です';body.appendChild(empty);
 }
}
function show({title,rows,key,edit}){
 const panel=$('meterRecordNotice');if(!panel||!key)return;
 stopTimer();
 active={key};onEdit=typeof edit==='function'?edit:null;
 const heading=$('meterRecordNoticeTitle');if(heading)heading.textContent=String(title||'記録内容を確認');
 panel.hidden=false;
 update(rows,key);
 timer=setTimeout(close,10000);
}
function bind(){
 const panel=$('meterRecordNotice');if(!panel)return;
 // 確認カードに触れた時点で自動終了を止める。画面外の営業操作は妨げない。
 for(const type of ['pointerdown','touchstart','wheel','keydown','focusin']){
  panel.addEventListener(type,stopTimer,{passive:type!=='keydown'});
 }
 $('meterRecordNoticeClose')?.addEventListener('click',close);
 $('meterRecordNoticeEdit')?.addEventListener('click',()=>{
  const edit=onEdit;close();edit?.();
 });
}
root.TAXIAPP_METER_CONFIRM={show,update,close,bind,activeKey:()=>active?.key||''};
})(typeof window!=='undefined'?window:globalThis);
