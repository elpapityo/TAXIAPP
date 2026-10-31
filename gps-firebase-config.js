/* GPS専用Web設定。Firebase WebのapiKeyは公開識別子であり秘密鍵ではない。
 * 日報用firebase-config.jsは変更しない。Analytics/Storageは初期化しない。
 * Consoleで登録したTAXIAPP GPS（2026-10-31）の値。
 */
(function(root){'use strict';
root.TAXIAPP_GPS_FIREBASE_CONFIG=Object.freeze({
 apiKey:'AIzaSyAKHiwHrgOFhNLMKeL_Yv_WBUu1J8p5DCY',
 authDomain:'taxigps-9f82e.firebaseapp.com',
 projectId:'taxigps-9f82e',
 messagingSenderId:'330658753332',
 appId:'1:330658753332:web:b55d2e136ca2cf618ad361'
});
})(typeof window!=='undefined'?window:globalThis);
