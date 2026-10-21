'use strict';
// A cloud request returning after an account switch may not update the new account.
const assert = require('node:assert/strict');
require('../bidirectional-sync.js');
const factory = globalThis.TAXIAPP_BIDIRECTIONAL_SYNC;
const clone = value => JSON.parse(JSON.stringify(value));
const makeShift = id => ({id, records: [], settings: {}, startingOdo: '123'});
const memory = new Map();
const storage = {
  getItem: key => memory.get(key) || null,
  setItem: (key, value) => memory.set(key, value)
};
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}
const packet = shift => ({kind: 'TAXIAPP_SHIFT_V1', shift: clone(shift)});

(async () => {
  // An old account's syncList returns after switching accounts.
  let endpoint = 'firestore-duties://synthetic-A';
  let model = {shifts: [makeShift('shift-100-a')]};
  const oldModel = model;
  const waitList = deferred();
  const requests = [];
  let replacements = 0;
  const app = factory.create({
    getEndpoint: () => endpoint, getModel: () => model, getPacket: packet,
    localStorage: storage,
    request: async action => {
      requests.push([endpoint, action]);
      if (action !== 'syncList') throw Error('Old account must not send or download a duty');
      if (endpoint.endsWith('synthetic-A')) return waitList.promise;
      return {shifts: []};
    },
    replaceRemoteShift: async () => { replacements++; },
    saveLocal: async () => {}
  });
  const pending = app.run();
  endpoint = 'firestore-duties://synthetic-B';
  model = {shifts: []};
  waitList.resolve({shifts: []});
  assert.equal(await pending, false);
  assert.match(app.status().lastError, /ログインまたは保存先が変わった/);
  assert.deepEqual(oldModel.shifts, [makeShift('shift-100-a')]);
  assert.deepEqual(model.shifts, []);
  assert.equal(replacements, 0);
  assert.deepEqual(requests, [['firestore-duties://synthetic-A', 'syncList']]);
  assert.equal(memory.size, 0, 'old account must not seed the new account baseline');
  assert.equal(await app.run(), true, 'new account may sync independently');
  assert.deepEqual(model.shifts, []);

  // A downloaded old-account duty must not be inserted after syncGet returns late.
  endpoint = 'firestore-duties://synthetic-A';
  model = {shifts: []};
  const waitGet = deferred(), getStarted = deferred();
  const remote = makeShift('shift-200-a');
  const reader = factory.create({
    getEndpoint: () => endpoint, getModel: () => model, getPacket: packet,
    localStorage: storage,
    request: async action => {
      if (action === 'syncList') return {shifts: [{id: remote.id, revision: 3}]};
      if (action === 'syncGet') { getStarted.resolve(); return waitGet.promise; }
      throw Error('A read must not trigger a cloud write');
    },
    replaceRemoteShift: async () => { replacements++; },
    saveLocal: async () => {}
  });
  const download = reader.run();
  await getStarted.promise;
  endpoint = 'firestore-duties://synthetic-B';
  model = {shifts: []};
  waitGet.resolve({id: remote.id, revision: 3, shift: clone(remote)});
  assert.equal(await download, false);
  assert.equal(replacements, 0, 'stale download must not replace or append a shift');
  assert.deepEqual(model.shifts, []);
  assert.equal(memory.size, 0, 'stale read must not commit a sync baseline');
  console.log('Cloud in-flight account-switch protection passed: stale list/get discarded, no cross-account writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
