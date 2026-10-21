'use strict';
// Synthetic Firestore adapter: invalid data and delayed account changes must not overwrite duties.
const assert = require('node:assert/strict');
require('../account-diary-store.js');

const makeShift = (id, extra = {}) => ({id, records: [], settings: {}, startedAt: '06:00', ...extra});
const uid = 'synthetic-driver-A', id = 'shift-1234-safe';
const entries = new Map();
const clone = value => JSON.parse(JSON.stringify(value));
let writes = 0;
const firestore = {
  collection(_db, _collection, owner) { return {owner}; },
  doc(_db, _collection, owner, _shifts, shiftId) { return {owner, shiftId}; },
  async getDocsFromServer(ref) {
    return {docs: [...entries].filter(([key]) => key.startsWith(ref.owner + '/'))
      .map(([key, value]) => ({id: key.split('/')[1], data: () => clone(value)}))};
  },
  async getDocFromServer(ref) {
    const data = entries.get(ref.owner + '/' + ref.shiftId);
    return {exists: () => data !== undefined, data: () => clone(data)};
  },
  async runTransaction(_db, callback) {
    const pending = [];
    const tx = {
      async get(ref) {
        const record = entries.get(ref.owner + '/' + ref.shiftId);
        return {exists: () => record !== undefined, data: () => clone(record)};
      },
      set(ref, data) { pending.push([ref.owner + '/' + ref.shiftId, clone(data)]); }
    };
    const result = await callback(tx);
    for (const [key, row] of pending) { entries.set(key, row); writes++; }
    return result;
  },
  serverTimestamp: () => 'synthetic-time'
};
const auth = {currentUser: {uid}};
let editorSession = 's'.repeat(36);
const options = () => ({f: firestore, db: {}, auth,
  session: {sessionId: () => editorSession}, admin: false});
const adapter = globalThis.TAXIAPP_ACCOUNT_DIARY.create();
adapter.bind({uid}, options());
const packet = shift => JSON.stringify({kind: 'TAXIAPP_SHIFT_V1', shift});
const put = (shift, baseRevision = 0) =>
  adapter.request('syncPut', {payload: packet(shift), baseRevision});

(async () => {
  const valid = makeShift(id);
  assert.equal((await put(makeShift(id, {records: Array.from({length: 60}, () => ({}))}))).revision, 1,
    '60 rows remain supported');
  const key = uid + '/' + id;
  assert.equal(entries.get(key).shift.records.length, 60);
  const baseline = entries.get(key);
  const count = writes;

  await assert.rejects(() => adapter.request('syncPut', {
    payload: JSON.stringify({kind: 'UNKNOWN', shift: valid}), baseRevision: 1
  }), /種類が不正/);
  await assert.rejects(() => put(makeShift(id, {records: Array.from({length: 61}, () => ({}))}), 1),
    /形式が不正/);
  await assert.rejects(() => put(makeShift(id, {records: null}), 1), /形式が不正/);
  await assert.rejects(() => put(makeShift(id, {settings: null}), 1), /形式が不正/);
  await assert.rejects(() => put(makeShift('shift-1234/bad'), 1), /乗務IDが不正/);
  await assert.rejects(() => put(makeShift(id, {memo: 'あ'.repeat(300000)}), 1), /大きすぎ/);
  for (const revision of [-1, 1.5, 'invalid']) {
    await assert.rejects(() => put(valid, revision), /基準番号が不正/);
  }
  editorSession = '';
  await assert.rejects(() => put(valid, 1), /編集権/);
  editorSession = 's'.repeat(36);

  assert.equal(writes, count, 'rejected payloads must perform no write');
  assert.deepEqual(entries.get(key), baseline, 'stored original must remain untouched');

  entries.set(key, {...baseline, revision: 0});
  await assert.rejects(() => adapter.request('syncList'), /乗務一覧が不正/);
  entries.set(key, {...baseline, shift: makeShift(id, {records: null})});
  await assert.rejects(() => adapter.request('syncGet', {shiftId: id}), /形式が不正/);
  entries.set(key, baseline);

  // Rebinding the same UID during an outstanding server read is still a new session.
  const originalRead = firestore.getDocsFromServer;
  let resumeRead;
  firestore.getDocsFromServer = async ref => {
    await new Promise(resolve => { resumeRead = resolve; });
    return originalRead(ref);
  };
  const staleRead = adapter.request('syncList');
  assert.equal(typeof resumeRead, 'function');
  const epoch = adapter.scope().epoch;
  adapter.bind({uid}, options());
  assert.ok(adapter.scope().epoch > epoch);
  resumeRead();
  await assert.rejects(() => staleRead, /ログイン利用者が変更/);
  assert.equal(writes, count);
  assert.equal(entries.get(key).revision, 1);
  console.log('Private duty validation boundaries passed: malformed/oversize data, no writes, stale account read.');
})().catch(error => { console.error(error); process.exitCode = 1; });
