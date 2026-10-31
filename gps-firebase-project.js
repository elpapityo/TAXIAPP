/* GPSだけを専用Firebase Appへ接続する。日報Appへのフォールバックは禁止。 */
(function(root){'use strict';
const PROJECT_ID='taxigps-9f82e',APP_NAME='TAXIAPP_GPS';
function configFor(gps,diary){
 if(!gps||gps.projectId!==PROJECT_ID)throw Error('GPS専用Firebaseの設定が不正です。接続を停止しました');
 if(diary?.projectId===gps.projectId)throw Error('GPSと日報の保存先が同じため接続を停止しました');
 if(gps.authDomain!==PROJECT_ID+'.firebaseapp.com'||typeof gps.apiKey!=='string'||!gps.apiKey||
    typeof gps.appId!=='string'||!gps.appId.startsWith('1:330658753332:web:'))
  throw Error('GPS専用Webアプリの設定が一致しません');
 return Object.freeze({...gps});
}
function initialize(sdk,gps,diary){
 const config=configFor(gps,diary);
 const existing=sdk.getApps().find(app=>app.name===APP_NAME);
 if(existing){
  for(const key of ['projectId','appId','apiKey','authDomain']){
   if(existing.options?.[key]!==config[key])throw Error('GPS専用Appの接続先が異なるため停止しました');
  }
  return existing;
 }
 return sdk.initializeApp(config,APP_NAME);
}
const api=Object.freeze({PROJECT_ID,APP_NAME,configFor,initialize});
root.TAXIAPP_GPS_FIREBASE_PROJECT=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
