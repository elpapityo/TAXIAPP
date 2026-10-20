'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const cut=(a,b)=>{
 const i=html.indexOf(a),j=html.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,'expected boundaries: '+a);
 return html.slice(i,j);
};
assert.match(html,/<title>TAXIAPP v0\.3\.112 — 乗務日報<\/title>/);
const defaultsSource=cut('function renderDriverDefaults(){','function renderShiftManager(');
const dutySource=cut('function renderDutyPlanSettings(){','function currentDutySummary(');
const settings=cut('function renderSettings(shift){','function download(');
const ctx={model:{prefs:{company:'テスト会社',driver:'テスト運転者',driverNo:'123',vehicle:'44',
 dutyPlan:{type:'フレックス',hours:'13',distanceKm:'275'}}},
 safeText:String,driverDutyPlan:()=>({type:'フレックス',hours:13,distanceKm:275})};
vm.createContext(ctx);
vm.runInContext(defaultsSource+dutySource,ctx);
const defaults=vm.runInContext('renderDriverDefaults()',ctx);
const duty=vm.runInContext('renderDutyPlanSettings()',ctx);
for(const [key,val] of [['company','テスト会社'],['driver','テスト運転者'],
                        ['driverNo','123'],['vehicle','44']]){
 const regex=new RegExp('data-pref="'+key+'" value="'+val+'"');
 assert.match(defaults,regex);
 assert.equal(defaults.split('data-pref="'+key+'"').length,2,'duplicate pref '+key);
}
const profile=defaults.indexOf('<details class="details" data-driver-profile-settings>');
const vehicle=defaults.indexOf('<details class="details" data-vehicle-profile-settings>');
assert.ok(profile>=0&&vehicle>profile,'driver and vehicle must have their own folds');
assert.ok(defaults.slice(profile,vehicle).includes('data-pref="driverNo"'));
assert.ok(!defaults.slice(profile,vehicle).includes('data-pref="vehicle"'));
assert.ok(defaults.slice(vehicle).includes('data-pref="vehicle"'));
for(const [key,value] of [['type','フレックス'],['hours','13'],['distanceKm','275']]){
 assert.ok(duty.includes('data-duty-plan="'+key+'"'),key+' duty input missing');
 assert.ok(duty.includes('value="'+value+'"'),value+' duty value missing');
}
const start=settings.indexOf('<details class="details settings-advanced" data-driver-registration>');
const end=settings.indexOf('<details class="details settings-advanced" data-wait-place-settings>',start);
assert.ok(start>=0&&end>start);
const panel=settings.slice(start,end);
assert.match(panel,/<summary>乗務員登録・車両・キャンセル設定<\/summary>/);
assert.ok(panel.includes('renderDriverDefaults()'),'original driver defaults renderer retained');
const ordered=[
 ['data-cancel-settings','キャンセル設定'],
 ['data-fee-settings','計算用金額・手数料設定'],
 ['data-duty-plan-settings','勤務形態・1乗務の予定']
];
let last=-1;
for(const [attr,label] of ordered){
 const token='<details class="details" '+attr+'>';
 const pos=panel.indexOf(token);
 assert.ok(pos>last,'nested section absent/incorrect order: '+attr);
 assert.equal(panel.split(token).length,2,'duplicated child '+attr);
 assert.ok(panel.slice(pos,pos+150).includes('<summary>'+label+'</summary>'));
 assert.ok(!settings.includes('<details class="details settings-advanced" '+attr+'>'),
  'no standalone menu for '+attr);
 last=pos;
}
assert.ok(panel.indexOf('data-cancel-meter-mode')>panel.indexOf('data-cancel-settings'));
assert.ok(panel.includes('data-cancel-meter-amount'),'existing cancel amount retained');
assert.ok(panel.includes('shift?'),'fee controls remain conditional on selected shift');
assert.ok(panel.includes('data-setting="'),'fee input bindings unchanged');
assert.ok(panel.includes('renderDutyPlanSettings()'),'duty plan renderer retained');
assert.ok(settings.slice(end).startsWith('<details class="details settings-advanced" data-wait-place-settings>'));
for(const attr of ['data-driver-profile-settings','data-vehicle-profile-settings',
                   'data-cancel-settings','data-fee-settings','data-duty-plan-settings']){
 const tag='details['+attr+']';
 assert.equal(html.split(tag).length,3,'save and restore selectors must include '+tag);
}
assert.match(html,/const DB_NAME='taxiapp-store-v1';const STORE='state';const KEY='taxiapp';/);
console.log('PASS nested registration: unchanged prefs, driver/vehicle, cancel/fee/duty folds and state retention');
