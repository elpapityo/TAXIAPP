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
// 次の通常アーカイブ用候補。公開中の合成限定ファイル/本番を切り替えない。
let archive=code.replace("revision:'history-v3'","revision:'history-v4-archive'")
 .replace('var GPS_HISTORY_TRIAL_ONLY_=true; // 公開候補は固定1地点の合成試験だけ。実履歴は拒否。',
  'var GPS_HISTORY_TRIAL_ONLY_=false; // 保存済み履歴の手動操作用。測位/位置共有は開始しない。')
 .replace("function cleanupGpsHistoryAndAudit(){\n if(GPS_HISTORY_TRIAL_ONLY_)gpsBridgeFail_('failed-precondition');",
  "function cleanupGpsHistoryAndAudit(){\n gpsBridgeFail_('failed-precondition'); // 整理は今回も未承認のため常時拒否。");
if(!archive.includes("revision:'history-v4-archive'")||!archive.includes('GPS_HISTORY_TRIAL_ONLY_=false')||!archive.includes('整理は今回も未承認'))throw Error('通常アーカイブ候補の生成箇所が変わっています');
fs.writeFileSync(path.join(base,'history/Code.archive-candidate.gs'),archive);
// 版3/版4の生成内容を保持し、管理者利用者一覧だけ追加する次の候補。
const adminSource=fs.readFileSync(path.join(base,'history/Admin.gs'),'utf8');
const manager=archive.replace("revision:'history-v4-archive'","revision:'history-v5-admin'")
 .replace("'adminViewGpsHistory','adminExportGpsHistory'","'adminListGpsHistoryUsers','adminViewGpsHistory','adminExportGpsHistory'")
 .replace("case 'adminListGpsHistory':result=gpsHistoryList_(auth,true);break;", "case 'adminListGpsHistoryUsers':result=gpsHistoryAdminUsers_(auth);break;\n   case 'adminListGpsHistory':result=gpsHistoryList_(auth,true);break;")+ '\n'+adminSource;
if(!manager.includes("case 'adminListGpsHistoryUsers':")||!manager.includes("revision:'history-v5-admin'"))throw Error('管理者候補の生成箇所が変わっています');
fs.writeFileSync(path.join(base,'history/Code.manager-candidate.gs'),manager);
// 現在地共有の未公開候補。履歴版3/4/5と停止中の公開画面を変更しない。
const presence=manager.replace("revision:'history-v5-admin'","revision:'gps-v6-presence'")
 .replace("actions:['link'].concat(GPS_HISTORY_ACTIONS_)","actions:['link'].concat(GPS_HISTORY_ACTIONS_,GPS_PRESENCE_ACTIONS_)")
 .replace("data.action==='link'?gpsBridgeLink_(data):gpsHistoryDispatch_(data)","data.action==='link'?gpsBridgeLink_(data):(GPS_PRESENCE_ACTIONS_.indexOf(data.action)>=0?gpsPresenceDispatch_(data):gpsHistoryDispatch_(data))")+'\n'+fs.readFileSync(path.join(base,'history/Presence.gs'),'utf8');
if(!presence.includes('gpsPresenceDispatch_(data)')||!presence.includes("revision:'gps-v6-presence'"))throw Error('現在地候補の生成箇所が変わっています');
fs.writeFileSync(path.join(base,'history/Code.presence-candidate.gs'),presence);
