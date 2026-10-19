const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../gps-segment-audit.js');
const R = require('../gps-test-rows.js');

test('500m GPS versus 900m vehicle shows 400m shortfall', () => {
  let s = R.fresh();
  s = R.startGps(s, 4.2);
  s = R.captureRow(s, 0, 4.7);
  const x = A.compare(R.derive(s), ['0.9']);
  assert.equal(x[0].gpsKm, 0.5);
  assert.equal(x[0].differenceMeters, 400);
  assert.equal(x[0].differencePercent, 44.44);
});
test('manual baseline correction does not change actual GPS segment delta', () => {
  let s = R.fresh(); s = R.startGps(s, 4.2);
  s = R.captureRow(s, 0, 5.2);
  s = R.setManualKm(s, 0, 20);
  s = R.captureRow(s, 1, 5.95);
  const x = A.compare(R.derive(s), ['1.1','0.8']);
  assert.equal(x[1].gpsKm, 0.75);
  assert.equal(x[1].differenceMeters, 50);
});
test('no GPS capture means comparison unavailable, never fabricated', () => {
  assert.equal(A.compare(R.derive(R.fresh()), ['0.5'])[0].differenceKm, null);
});
test('vehicle reading zero cannot produce percentage', () => {
  let s = R.fresh(); s=R.startGps(s, 1);s=R.captureRow(s, 0, 1);
  assert.equal(A.compare(R.derive(s), ['0'])[0].differencePercent, null);
});
test('invalid vehicle number rejected', () => {
  assert.throws(()=>A.km(-1)); assert.throws(()=>A.km('NaN'));assert.equal(A.km('1,125'),1.125);
});
test('CSV escapes formulas, CRLF and quoted address strings', () => {
  const result = A.csv([{number:1,gpsKm:1,vehicleKm:2,differenceMeters:1000,differencePercent:50,at:null,place:'=HYPERLINK("x")'}]);
  assert.match(result,/\r\n/);assert.match(result,/"'=HYPERLINK\(""x""\)"/);
});
