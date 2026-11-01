/* 承認済みGPS本人連携窓口。位置・走行履歴の停止設定は解除しない。 */
(function(root){'use strict';
root.TAXIAPP_GPS_ACCOUNT_CONFIG=Object.freeze({
 enabled:true,
 historyArchiveEnabled:true, // 開発ブランチのみ。通常履歴の公開は別途承認後。
 historyTrialEnabled:true, // 未公開候補：合成履歴の本番試験は別途承認後に適用。
 endpoint:'https://script.google.com/macros/s/AKfycbyk2Hlh70tzGrU8vBw2Aqp2nrqvjEtjE-RUr3TD9JUCqs_zb2o2slAdPJ4D2JT6R6kp/exec'
});
})(typeof window!=='undefined'?window:globalThis);
