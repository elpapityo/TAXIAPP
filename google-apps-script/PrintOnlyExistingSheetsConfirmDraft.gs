/**
 * TAXIAPP stage 10: selected-duty confirmation for ORIGINAL Google Sheets
 * paper forms, backed by a verified Firebase-derived V2 print projection.
 *
 * UNDEPLOYED, internal-only. Does not modify B15/B17/C17, paper formulas,
 * Google legacy originals or other drivers' records.
 * The legacy applySelectedPrintShift() is left unchanged for old originals.
 */
function printV2ConfirmExistingSelectedDraft_(ss,stageSheet,verifiedAdminUid,verifyActive){
 if(typeof verifyActive!=='function'||typeof verifiedAdminUid!=='string'||!verifiedAdminUid)
  throw Error('Firestore本人原本の署名・管理者権限確認がありません');
 if(!ss||typeof ss.getSheetByName!=='function')
  throw Error('既存Google印刷帳票を取得できません');
 var operation=ss.getSheetByName('TAXIAPP_印刷操作');
 var index=ss.getSheetByName('TAXIAPP_乗務一覧');
 var first=ss.getSheetByName('補助簿印刷用');
 var second=ss.getSheetByName('補助簿印刷用_2頁');
 if(!operation||!index||!first||!second)
  throw Error('既存印刷操作と補助簿2ページがありません');
 if(typeof SpreadsheetApp!=='undefined'&&SpreadsheetApp.flush)SpreadsheetApp.flush();
 var follow=operation.getRange('B15').getValue()===true;
 var requested=follow?String(index.getRange('T2').getDisplayValue()||'').trim():
  String(operation.getRange('B17').getDisplayValue()||'').trim();
 var derived=String(operation.getRange('C17').getDisplayValue()||'').trim();
 if(!requested||!derived||!TAXIAPP_PRINT_V2_ID.test(derived))
  throw Error('選択した乗務IDを安全に解決できません');
 var length=Math.max(0,index.getLastRow()-1);
 if(!length)throw Error('印刷対象の乗務一覧が空です');
 var rows=index.getRange(2,1,length,21).getDisplayValues();
 var match=rows.filter(function(row){
  var rowId=String(row[0]||'').trim(),label=String(row[20]||'').trim();
  return rowId===derived&&(requested===rowId||requested===label);
 });
 if(match.length!==1)throw Error('乗務選択欄と内部IDが一致していません');
 var staged=printV2ReadLatestDraft_(stageSheet,derived,verifiedAdminUid);
 if(!staged||staged.id!==derived||
    staged.projection?.format!=='TAXIAPP_PRINT_STAGE_V2')
  throw Error('本人Firestore由来の印刷データがありません');
 var plan=printV2ExistingPlan_(ss,stageSheet,derived,verifiedAdminUid);
 if(plan.needsWrite!==0||plan.revision!==staged.revision||
    plan.digest!==staged.digest)
  throw Error('印刷元4シートの転送・照合が未完了です');
 var trusted={uid:verifiedAdminUid,id:derived,revision:staged.revision,
  digest:staged.digest,transferId:staged.transferId};
 if(verifyActive(trusted)!==true)
  throw Error('印刷対象のFirestore原本が更新または削除されました');
 var expected=staged.projection.rows['TAXIAPP_乗務一覧']?.[0]?.[8];
 var actual=Number(first.getRange('X23').getValue());
 if(!Number.isSafeInteger(expected)||expected<0||
    !Number.isFinite(actual)||Math.abs(expected-actual)>0.01)
  throw Error('既存補助簿のメーター売上がFirestore原本と一致しません');
 if(verifyActive(trusted)!==true)
  throw Error('印刷確認中に本人Firestore原本が更新されました');
 // Pure confirmation: do not call getUi, print, original loadShift_ or setValue.
 return {state:'existing-paper-sheets-verified',shiftId:derived,
  revision:staged.revision,meter:expected,
  records:staged.projection.rows['TAXIAPP_印刷データ'].length,
  accountVerified:true,legacyOriginalUnchanged:true,
  printTriggered:false};
}
