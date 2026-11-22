'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('index.html');
function source(start,end){
 const begin=html.indexOf(start),finish=html.indexOf(end,begin);
 assert.ok(begin>=0&&finish>begin,'Missing production source: '+start);
 return html.slice(begin,finish);
}

function fixture(){
 const inputs=new Map(),requests=[],positions=[];
 const responseCode=new Map();
 const settings={highwayNearbyIC:true};
 const shift={id:'fixture-shift',gpsTrip:{tripKm:12.4},records:[{id:'saved-original',raw:{Q:'保存済み'}}]};
 let writer=true,clock='20:11:00',saves=0;
 const scope=vm.createContext({
  model:{prefs:settings},tab:'drive',accountScopeGeneration:1,accountScope:{uid:'fixture-owner'},
  getShift:()=>shift,canEditNow:()=>writer,
  window:{isSecureContext:true,TAXIAPP_HIGHWAY_SECTIONS:require('../highway-sections.js')},
  navigator:{geolocation:{getCurrentPosition(resolve,reject){positions.push({resolve,reject});}}},
  safeText:value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]),
  stamp:()=>clock,distanceEnabled:()=>settings.highwayDistance!=='off',
  kmOne:value=>String(value??''),shortTime:String,kmControl:input=>input,numberInputMode:()=>'none',
  inputPrefs:()=>({keyboard:'custom'}),nativeAutoDistanceEnabled:()=>false,
  gpsTripUI:{trusted:()=>settings.trustedGps===true},
  saveLater:()=>{saves++;},updateEstimate:()=>{},mirrorDriveColumnInput:()=>{},
  RAW_COLUMNS:[],numberFields:new Set(),timeFields:new Set(),KM_KEYS:new Set(),
  appEl:{
   querySelector(selector){return inputs.get(selector)?.[0]??null;},
   querySelectorAll(selector){return inputs.get(selector)??[];}
  },
  fetch:async url=>{
   assert.ok(['./data/ic-positions.json','./data/ic-positions-osm.json'].includes(url),
    'GPS is used locally and only static data is fetched');
   requests.push(url);
   const status=responseCode.get(url)??200;
   return {status,ok:status===200,json:async()=>JSON.parse(read(url))};
  },
  Event,AbortController,setTimeout,clearTimeout
 });
 vm.runInContext(
  source('function hasRealHighway(raw)','function calculatedDiscount(raw)')+
  source('let highwayIcData;', 'let discountFoldOpen=')+
  source('function field(key,raw,opts={})','function locationField(')+
  source('function handleInput(e)','let keypadActive=null'),scope);
 function picker(key,index=''){
  const selector='[data-hwy-picker="'+key+'"][data-hwy-picker-index="'+index+'"]';
  const input={
   value:'',hidden:true,focused:false,
   dataset:index===''?{col:key}:{hwyIndex:String(index),hwyField:key},
   matches:()=>false,
   focus(){this.focused=true;},
   dispatchEvent(event){scope.handleInput({type:event.type,target:this});}
  };
  const button={},note={textContent:''};
  const select={innerHTML:'',value:'',closest:()=>host};
  const host={dataset:{hwyPicker:key,hwyPickerIndex:String(index)},querySelector:part=>{
   return {input,'[data-hwy-select]':select,'[data-hwy-nearby]':button,'[role=status]':note}[part];
  }};
  const siblings=inputs.get(selector)??[];
  inputs.set(selector,[...siblings,host]);
  const fields=index===''?shift.draft.raw:shift.draft.meta.highwaySections[index];
  input.value=String(fields[key]??'');
  const updateQuery=selector+' input';
  if(!inputs.has(updateQuery))inputs.set(updateQuery,[input]);
  return {host,input,button,select,note};
 }
 const locate=({latitude=34.779915,longitude=135.41373}={})=>{
  assert.ok(positions.length,'user action must request device location');
  positions.shift().resolve({coords:{latitude,longitude}});
 };
 const select=(a,value)=>{a.select.value=String(value);scope.changeHighwayIcChoice(a.select);};
 const search=a=>scope.searchHighwayIc(a.host);
 return {scope,settings,shift,picker,locate,select,search,requests,responseCode,positions,
  setClock:value=>{clock=value;},setWriter:value=>{writer=value;},saves:()=>saves};
}

(async()=>{
 const f=fixture();
 const real={mode:'実',fee:'1430'},empty={mode:'空',fee:'740',entryTime:'21:30'};
 f.shift.draft={id:'ride-draft',kind:'ride',raw:{K:'2800',N:'現'},meta:{highwaySections:[real,empty]}};
 f.settings.trustedGps=true;
 const originals=JSON.stringify(f.shift.records);
 const markup=f.scope.renderHighwaySections(f.shift.draft,'実');
 assert.match(markup,/<select class="control" data-hwy-select aria-label="入口ICの候補"/);
 assert.match(markup,/data-hwy-field="fee" data-number-kind="money"/);
 assert.deepEqual(f.requests,[],'opening a ride or rendering a field never starts a lookup');

 const entry=f.picker('entryIC',0),entryCopy=f.picker('entryIC',0),exit=f.picker('exitIC',0);
 const request=f.search(entry);
 assert.equal(entry.button.disabled,true);
 assert.equal(entryCopy.button.disabled,true);
 assert.equal(real.entryTime,'20:11');
 assert.equal(real.entryKm,'12.4');
 f.setClock('20:22:00');
 f.locate();
 await request;
 assert.equal(real.entryIC,'池田');
 assert.equal(real.entryTime,'20:11','keep the operation time and not the lookup completion time');
 assert.equal(entryCopy.input.value,'池田');
 assert.match(entry.select.innerHTML,/<option value="0" selected>池田/);
 assert.match(entry.select.innerHTML,/大阪空港/);
 assert.equal(exit.input.value,'');
 f.select(entry,1);
 assert.equal(real.entryIC,'大阪空港');
 assert.equal(entryCopy.input.value,'大阪空港');

 const exiting=f.search(exit);
 f.locate();
 await exiting;
 assert.equal(real.exitIC,'池田');
 assert.equal(real.exitTime,'20:22');
 assert.equal(real.entryIC,'大阪空港');
 assert.equal(f.requests.length,2,'a second lookup reuses the downloaded point data');
 const manualEntry=f.picker('entryIC',1);
 const pending=f.search(manualEntry);
 f.select(manualEntry,'manual');
 assert.equal(manualEntry.input.hidden,false);
 manualEntry.input.value='手入力IC';
 manualEntry.input.dispatchEvent(new Event('input'));
 f.locate();
 await pending;
 assert.equal(empty.entryIC,'手入力IC','do not overwrite a manual edit made during the async lookup');
 assert.equal(empty.entryTime,'21:30');
 const retry=f.search(manualEntry);
 f.locate();
 await retry;
 assert.equal(empty.entryIC,'手入力IC','do not replace a prefilled IC when searching again');
 assert.match(f.scope.renderHighwaySections(f.shift.draft,'空'),/value="manual" selected/);

 const oldExit=f.picker('exitIC',1);
 const oldRequest=f.search(oldExit);
 const beforeOther={mode:'空',entryIC:'別記録'};
 f.shift.draft={kind:'ride',raw:{},meta:{highwaySections:[real,beforeOther]}};
 f.locate();
 await oldRequest;
 assert.equal(empty.exitIC,undefined);
 assert.equal(beforeOther.exitIC,undefined);
 assert.equal(JSON.stringify(f.shift.records),originals);

 // Standalone empty-highway draft uses old raw columns, including up to three toll payments.
 const legacy=fixture();
 legacy.shift.draft={kind:'empty',raw:{P:'空',AF:'300',AG:'440',Z:'',AC:''},meta:{}};
 assert.match(legacy.scope.field('Z',legacy.shift.draft.raw,{highwayIc:true}),/data-hwy-picker="Z"/);
 legacy.settings.highwayDistance='off';
 legacy.settings.trustedGps=true;
 const legacyEntry=legacy.picker('Z'),legacyExit=legacy.picker('AC');
 const legacyRequest=legacy.search(legacyEntry);
 legacy.locate();
 await legacyRequest;
 assert.equal(legacy.shift.draft.raw.Z,'池田');
 assert.equal(legacy.shift.draft.raw.AA,'20:11');
 assert.equal(legacy.shift.draft.raw.AB,undefined,'distance OFF prevents automatic distance entry');
 assert.deepEqual([legacy.shift.draft.raw.AF,legacy.shift.draft.raw.AG],['300','440']);
 const noPermission=legacy.search(legacyExit);
 legacy.positions.shift().reject({code:1});
 await noPermission;
 assert.match(legacyExit.note.textContent,/位置情報が許可されていません/);
 assert.equal(legacy.shift.draft.raw.AC,'');
 legacy.select(legacyExit,'manual');
 assert.equal(legacyExit.input.focused,true);
 legacyExit.input.value='出口手入力';
 legacyExit.input.dispatchEvent(new Event('input'));
 assert.equal(legacy.shift.draft.raw.AC,'出口手入力');
 legacy.setWriter(false);
 const viewerSaves=legacy.saves();
 await legacy.search(legacyExit);
 assert.equal(legacy.saves(),viewerSaves);
 assert.equal(legacy.positions.length,0);
 legacy.settings.highwayNearbyIC=false;
 assert.doesNotMatch(legacy.scope.field('Z',legacy.shift.draft.raw,{highwayIc:true}),/data-hwy-picker/);

 const removed=fixture();
 const oldRaw={P:'実',Q:'',W:'900'};
 removed.shift.draft={kind:'ride',raw:oldRaw,meta:{}};
 const removal=removed.search(removed.picker('Q'));
 oldRaw.P='';
 removed.locate();
 await removal;
 assert.equal(oldRaw.Q,'','removing a legacy highway route discards its pending lookup');

 const failure=fixture();
 failure.shift.draft={kind:'empty',editId:'saved-original',raw:{Z:''},meta:{}};
 const onlyOfficial=failure.picker('Z');
 const extra='./data/ic-positions-osm.json';
 const official='./data/ic-positions.json';
 failure.responseCode.set(official,503);
 let attempt=failure.search(onlyOfficial);
 failure.locate();
 await attempt;
 assert.match(onlyOfficial.note.textContent,/HTTP 503/);
 assert.equal(failure.shift.draft.raw.Z,'');
 assert.equal(failure.shift.draft.raw.AA,undefined,'an archived record never receives present-time values');
 failure.responseCode.delete(official);
 failure.responseCode.set(extra,503);
 attempt=failure.search(onlyOfficial);
 failure.locate();
 await attempt;
 assert.match(onlyOfficial.note.textContent,/補完データを取得できませんでした/);
 assert.match(onlyOfficial.select.innerHTML,/池田/);
 assert.equal(failure.shift.draft.raw.Z,'','partial data is selectable but is not auto-filled');
 failure.responseCode.delete(extra);
 attempt=failure.search(onlyOfficial);
 failure.locate({latitude:30,longitude:135});
 await attempt;
 assert.match(onlyOfficial.note.textContent,/5km以内に候補がありません/);
 assert.equal(failure.shift.draft.raw.Z,'');

 console.log('高速IC本体統合：最寄り、標準選択、手入力保護、実車・空車、失敗時、別乗務保護を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});
