const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../gps-sharing-core.js');

const duty = {id:'shift-123',startedIso:'2026-10-31T01:00:00Z',endedAt:'',
  draft:{kind:'ride',status:'active'}};
test('営業状態を確認できない場合は送信しない',()=>{
  assert.equal(core.activeDuty(null),null);
  assert.equal(core.activeDuty({version:1,activeId:'shift-123',shifts:[]}),null);
  assert.equal(core.activeDuty({version:1,activeId:'shift-123',shifts:[{...duty,endedAt:'06:00'}]}),null);
  assert.equal(core.activeDuty({version:1,activeId:'shift-123',shifts:[duty]}).id,duty.id);
});
test('既存乗務の操作状態を5つの表示へ変換する',()=>{
  assert.equal(core.businessStatus(duty),'実車');
  assert.equal(core.businessStatus({...duty,draft:{kind:'dispatch'}}),'迎車');
  assert.equal(core.businessStatus({...duty,draft:{kind:'ride',status:'alighted'}}),'支払い');
  assert.equal(core.businessStatus({...duty,draft:null,waiting:{}}),'待機');
  assert.equal(core.businessStatus({...duty,draft:null,waiting:null}),'空車');
});
test('位置値を数値検査する',()=>{
  const ok=core.fixFromPosition({coords:{latitude:34.8,longitude:135.5,accuracy:15,speed:0,heading:0},timestamp:1000});
  assert.equal(ok.heading,0);
  assert.equal(ok.speed,0);
  assert.equal(core.fixFromPosition({coords:{latitude:95,longitude:135,accuracy:10},timestamp:2000}),null);
});
test('GPS時間逆転と位置飛びを採用しない',()=>{
  const one={lat:34.7,lon:135.5,capturedAtMs:1000};
  assert.equal(core.fixDecision(one,{lat:34.7,lon:135.5,capturedAtMs:1000}).ok,false);
  assert.equal(core.fixDecision(one,{lat:35.7,lon:135.5,capturedAtMs:2000}).ok,false);
});
test('非公開・入庫後・5分切れを表示しない',()=>{
  const p={public:true,onDuty:true,lat:34.7,lon:135.5,updatedAt:{toMillis:()=>100000}};
  assert.equal(core.presenceView(p,200000).show,true);
  assert.equal(core.presenceView(p,200000).stale,true);
  assert.equal(core.presenceView({...p,public:false},200000).show,false);
  assert.equal(core.presenceView({...p,onDuty:false},200000).show,false);
  assert.equal(core.presenceView(p,400001).show,false);
});
test('走行15秒・停車90秒の送信目標',()=>{
  assert.equal(core.sendIntervalMs({speed:12},null),15000);
  assert.equal(core.sendIntervalMs({speed:0},null),90000);
});
test('CSVはBOM付きUTF-8で速度km/h、北方位0度を保持',()=>{
  const csv=core.historyCsv([{
    capturedAtMs:Date.parse('2026-10-31T00:00:00.000Z'),
    lat:34.5,lon:135.5,accuracy:12,segmentNo:1,speed:10,heading:0
  }]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv,/"速度（km\/h）"/);
  assert.match(csv,/"36"/);
  assert.match(csv,/"0"/);
  assert.match(csv,/"2026-10-31 09:00:00"/);
});
