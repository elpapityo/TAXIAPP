// ローカルの候補生成だけ。既存公開Code.gs/manifest/本番には触れない。
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.join(root,'google-apps-script/gps-account-broker');
let code=fs.readFileSync(path.join(base,'Code.gs'),'utf8');
code=code.replace("revision:'lease-v2',actions:['link']","revision:'history-v3',actions:['link'].concat(GPS_HISTORY_ACTIONS_),historyTrialOnly:GPS_HISTORY_TRIAL_ONLY_");
code=code.replace("raw.length>24000","raw.length>850000||Utilities.newBlob(raw).getBytes().length>850000");
code=code.replace("if(!data||data.action!=='link')gpsBridgeFail_('invalid-argument');\n  return gpsBridgeJson_({ok:true,data:gpsBridgeLink_(data)});",
 "if(!data||typeof data.action!=='string')gpsBridgeFail_('invalid-argument');\n  if(data.action==='link'&&raw.length>24000)gpsBridgeFail_('invalid-argument');\n  return gpsBridgeJson_({ok:true,data:data.action==='link'?gpsBridgeLink_(data):gpsHistoryDispatch_(data)});");
if(!code.includes('gpsHistoryDispatch_(data)')||!code.includes("revision:'history-v3'")||!code.includes('historyTrialOnly:GPS_HISTORY_TRIAL_ONLY_'))throw Error('連携コードの挿入箇所が変わっています');
const validation=fs.readFileSync(path.join(root,'functions/gps-history-validation.js'),'utf8');
code+='\n// 同じ共有検証ソースを埋込み。Apps ScriptではUTF-8容量検査だけを補う。\nvar gpsHistoryValidationCache_;\nfunction gpsHistoryValidation_(){\nif(gpsHistoryValidationCache_)return gpsHistoryValidationCache_;\nvar module={exports:{}};\nvar TextEncoder=function(){};TextEncoder.prototype.encode=function(s){return Utilities.newBlob(s).getBytes();};\n'+validation+'\nreturn gpsHistoryValidationCache_=module.exports;\n}\n';
code+='\n'+fs.readFileSync(path.join(base,'history/History.gs'),'utf8');
fs.writeFileSync(path.join(base,'history/Code.candidate.gs'),code);
console.log('GPS履歴GASの未公開候補を生成。既存公開ソース/本番には変更なし。');
