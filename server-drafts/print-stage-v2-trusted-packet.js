'use strict';
/**
 * Stage 15 - independent, conservative server-side pricing subset.
 *
 * No browser calculations or client-supplied "amounts"/"payments"/"summary"
 * are trusted. The input MUST come from a verified Firestore transaction.
 * Unsupported charge types fail CLOSED rather than inventing a fare.
 *
 * Currently covers ordinary rides, GO driver-collected fees, simple or
 * manually allocated two-tender settlements, real tolls and canceled calls.
 * NO Uber, disability/elderly discounts, empty highway, projected toll
 * sections, tips or reservation pricing until independently ported/tested.
 *
 * Undeployed: this module does not initialize Firebase/Google or expose HTTP.
 */
const MAX_RECORDS=60,DEFAULT_GO_FEE=200;
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const ACCEPTED_TYPES=new Set(['現','Q','QR','ク','交','G','D','乗','チ']);
const NOT_DRIVER=new Set(['G','D','U','乗','キ']);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validMoney=(value,label,{defaultZero=false}={})=>{
 if(defaultZero&&(value===''||value===undefined||value===null))return 0;
 if(value===undefined||value===null||String(value).trim()==='')throw Error(label+'が未確定です');
 const v=Number(value);
 if(!Number.isSafeInteger(v)||v<0||v>100000000)throw Error(label+'の金額が不正です');
 return v;
};
const nonEmpty=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
const copy=x=>JSON.parse(JSON.stringify(x));
function makeTrustedPrintPacket(shift){
 if(!isObject(shift)||!ID.test(String(shift.id||''))||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(shift.date||''))||
    (!shift.endedAt&&!shift.endedIso)||
    !isObject(shift.settings)||!Array.isArray(shift.records)||
    shift.records.length>MAX_RECORDS)
  throw Error('Firestore原本の乗務形式が不正です');
 const goFee=validMoney(shift.settings.goFee,'GO手数料',{defaultZero:false});
 const out=copy(shift),sum={
  meter:0,discount:0,goFee:0,uberSurcharge:0,
  cashRemittance:0,etcRemittance:0,totalRemittance:0,
  realToll:0,emptyToll:0,cancellation:0,tip:0,reservation:0,
  cashReceived:0,paymentAllocated:0
 };
 const paymentCompany=new Map();
 out.records=shift.records.map((record,i)=>{
  if(!isObject(record)||!isObject(record.raw)||!['ride','cancel'].includes(record.kind)||
     record.status!=='complete')
   throw Error('未対応または未確定の営業があります：'+(i+1));
  const r=copy(record),raw=r.raw,meta=isObject(r.meta)?r.meta:{};
  if(!Number.isSafeInteger(Number(raw.A))||Number(raw.A)!==i+1)
   throw Error('営業番号が連続していません：'+(i+1));
  // The actual browser performs a more elaborate projection when sections,
  // discount codes, Uber app-paid or empty highway are present. Refuse those
  // cases until parity has been demonstrated.
  if(Array.isArray(meta.highwaySections)||raw.E==='U'||
     (raw.O&&String(raw.O).trim())||
     String(raw.P||'').includes('空')||
     nonEmpty(raw.AI)&&Number(raw.AI)!==0||
     nonEmpty(meta.uberTip)||nonEmpty(meta.uberReservation)||
     nonEmpty(meta.uberAppDisplayed)||
     (nonEmpty(raw.AN)&&record.kind==='ride'))
   throw Error('サーバー側の料金再計算が未対応の営業条件です：'+(i+1));
  if(record.kind==='cancel'){
   // A canceled meter may show a dispatch-check amount; it never enters sales.
   raw.K=0;raw.AQ=0;raw.N='キ';r.payments=[];r.amounts={meter:0,
    cancellation:0,goFee:0,realToll:0,emptyToll:0,discount:0};
   return r;
  }
  const meter=validMoney(raw.K,'メーター金額');
  const toll=validMoney(raw.W,'実車高速',{defaultZero:true});
  if(validMoney(raw.AR,'割引額',{defaultZero:true})!==0)
   throw Error('割引計算を伴う営業は未対応です');
  if(nonEmpty(raw.AQ)&&Number(raw.AQ)!==0&&Number(raw.AQ)!==goFee)
   throw Error('GO手数料の保存値が設定値と一致しません');
  const first=String(raw.N||'');
  const split=isObject(meta.splitPayment)?meta.splitPayment:{};
  const second=String(split.second||'');
  if(!ACCEPTED_TYPES.has(first)||
     second&&(first===second||!ACCEPTED_TYPES.has(second)))
   throw Error('支払金種が不正です：'+(i+1));
  const driver=type=>!NOT_DRIVER.has(type);
  const selectedGo=raw.E==='G'&&(driver(first)||second&&driver(second));
  const go=selectedGo?goFee:0;
  const due=meter+toll+go;
  if(!Number.isSafeInteger(due)||due>100000000)
   throw Error('精算金額が不正です');
  const rawSlot=split.manualSlot;
  const slot=rawSlot===0||rawSlot===1?rawSlot:null;
  const hasManual=nonEmpty(split.manualAmount);
  let firstAmount=due,secondAmount=0;
  if(second){
   if(slot===null||!hasManual)
    throw Error('複合決済の配分金額が未確定です：'+(i+1));
   const manual=validMoney(split.manualAmount,'複合決済の金額');
   if(manual>due)throw Error('複合決済の受取額が請求額を超えています');
   firstAmount=slot===0?manual:due-manual;
   secondAmount=slot===1?manual:due-manual;
  }else if(slot!==null||hasManual)
   throw Error('単独金種に複合決済の設定が残っています');
  raw.AQ=go;
  raw.AR=0;
  r.payments=[{type:first,received:firstAmount,company:firstAmount},
   ...(second?[{type:second,received:secondAmount,company:secondAmount}]:[])];
  r.amounts={meter,realToll:toll,emptyToll:0,cancellation:0,
   goFee:go,discount:0,uberSurcharge:0,tip:0,reservation:0};
  sum.meter+=meter;sum.realToll+=toll;sum.goFee+=go;
  for(const p of r.payments){
   if(p.type==='現')sum.cashReceived+=p.received;
   if(p.type!=='キ')sum.paymentAllocated+=p.company;
   paymentCompany.set(p.type,(paymentCompany.get(p.type)||0)+p.company);
  }
  return r;
 });
 const noncash=[...paymentCompany.entries()].reduce((n,[type,value])=>
  n+(type!=='現'&&type!=='キ'?value:0),0);
 sum.cashRemittance=sum.meter+sum.goFee-sum.discount-noncash-sum.emptyToll;
 sum.etcRemittance=sum.realToll+sum.emptyToll;
 sum.totalRemittance=sum.cashRemittance+sum.etcRemittance;
 if(!Object.values(sum).every(Number.isSafeInteger))
  throw Error('印刷用集計が整数範囲を超えています');
 return Object.freeze({kind:'TAXIAPP_SHIFT_V1',shift:out,summary:sum});
}
module.exports=Object.freeze({makeTrustedPrintPacket});
