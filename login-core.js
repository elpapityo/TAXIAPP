/* TAXIAPP login helpers. No network, credentials or mutation. */
(function(root){
'use strict';
function firebaseConfigReady(v){
 return !!(v&&['apiKey','authDomain','projectId','appId'].every(
  k=>typeof v[k]==='string'&&v[k].trim()&& !/^(YOUR_|<|ここに)/.test(v[k])
 ));
}
function accessState(user,adminDoc,profile){
 if(!user)return 'signed-out';
 // Only trusted Firestore admins/{uid}, never profile, controls admin access.
 if(adminDoc?.enabled===true)return 'admin';
 if(profile?.status==='active')return 'active';
 if(profile?.status==='suspended')return 'suspended';
 return 'pending';
}
function summarizeLegacyModel(model){
 const shifts=Array.isArray(model?.shifts)?model.shifts:[];
 return {shiftCount:shifts.length,recordCount:shifts.reduce((n,s)=>n+(Array.isArray(s?.records)?s.records.length:0),0)};
}
root.TAXIAPP_LOGIN_UTILS={firebaseConfigReady,accessState,summarizeLegacyModel};
})(typeof window!=='undefined'?window:globalThis);
