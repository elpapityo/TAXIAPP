/* TAXIAPP device migration and whole-shift deletion.
 * Pure functions, no browser storage or network side effects.
 */
(function(root){
'use strict';
const KIND='TAXIAPP_FULL_DEVICE_SNAPSHOT_V1';
function copy(value){return JSON.parse(JSON.stringify(value));}
function validModel(value){
 if(!value||value.version!==1||!Array.isArray(value.shifts)||!value.prefs||
   typeof value.prefs!=='object'||Array.isArray(value.prefs))return false;
 const ids=new Set();
 for(const shift of value.shifts){
  if(!shift||typeof shift.id!=='string'||!shift.id||ids.has(shift.id)||
    !Array.isArray(shift.records)||shift.records.length>60||
    !shift.settings||typeof shift.settings!=='object'||Array.isArray(shift.settings)||
    shift.records.some(r=>!r||!r.raw||typeof r.raw!=='object'||
      !['ride','empty','cancel'].includes(r.kind)))return false;
  ids.add(shift.id);
 }
 return value.activeId===null||value.activeId===undefined||ids.has(value.activeId);
}
function snapshot(model,accessKey){
 if(!validModel(model))throw Error('保存中の乗務データに問題があります');
 if(typeof accessKey!=='string'||accessKey.length>512)throw Error('接続キーが不正です');
 return {kind:KIND,version:1,exportedAt:new Date().toISOString(),model:copy(model),googleAccessKey:accessKey};
}
function validate(snapshotData){
 if(!snapshotData||snapshotData.kind!==KIND||snapshotData.version!==1||
   !validModel(snapshotData.model)||typeof snapshotData.googleAccessKey!=='string'||
   snapshotData.googleAccessKey.length>512)throw Error('TAXIAPP一括移行データの形式が正しくありません');
 return snapshotData;
}
function prepareImport(value){
 const data=validate(value);
 const updated=copy(data.model);
 updated.prefs.sheetTarget={...(updated.prefs.sheetTarget||{}),mode:'manual'};
 for(const shift of updated.shifts){
  if(shift.gpsTrip?.enabled){
   shift.gpsTrip.enabled=false;shift.gpsTrip.status='off';
   shift.gpsTrip.lastFix=null;shift.gpsTrip.unresolvedGap=true;
   shift.gpsTrip.lastError='端末移行中のGPS距離は未計測です。車両トリップと照合してください';
  }
 }
 return {model:updated,googleAccessKey:data.googleAccessKey};
}
function deleteShift(model,shiftId){
 if(!validModel(model))throw Error('保存中の乗務データに問題があります');
 const target=model.shifts.find(s=>s.id===shiftId);
 if(!target)throw Error('削除対象の乗務が見つかりません');
 if(model.activeId===shiftId||!target.endedAt)throw Error('入庫が完了していない乗務は削除できません');
 const updated=copy(model);
 updated.shifts=updated.shifts.filter(s=>s.id!==shiftId);
 if(updated.activeId===shiftId)updated.activeId=null;
 return {model:updated,deleted:copy(target)};
}
root.TAXIAPP_DEVICE_DATA=Object.freeze({KIND,validModel,snapshot,validate,prepareImport,deleteShift});
})(typeof window!=='undefined'?window:globalThis);
