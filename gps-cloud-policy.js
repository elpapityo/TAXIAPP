/* 日報の無料枠を優先。GPSクラウドは全体使用量の制御を確立するまで停止する。
 * 端末別カウンタをプロジェクト全体の課金/無料枠制御とは扱わない。
 * URL・localStorageによる解除は設けない。既存保存データには触れない。
 */
(function(root){'use strict';
root.TAXIAPP_GPS_CLOUD_POLICY=Object.freeze({
 enabled:false,
 message:'日報の保存を優先し、GPS専用プロジェクトへの認証・権限連携が整うまでGPS共有・クラウド履歴は停止しています。課金プランへは変更しません。端末の保存データは削除していません。'
});
})(typeof window!=='undefined'?window:globalThis);
