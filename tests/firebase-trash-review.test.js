'use strict';
const assert=require('node:assert/strict');
require('../firebase-trash-review.js');
const {review,renderView}=globalThis.TAXIAPP_TRASH_REVIEW;
const a={id:'shift-100-a',date:'2026-10-21',startedAt:'08:00',endedAt:'17:00',
 revision:2,recordCount:3,fare:'12,000円'};
const b={id:'shift-200-a',date:'2026-10-22',startedAt:'09:00',endedAt:'',
 revision:3,recordCount:1,fare:'4,000円'};
const c={id:'shift-300-a',date:'2026-10-12',recordCount:1,
 expiresAt:'2026-11-11'};
const cfg={uid:'uid-1',serverUid:'uid-1',shifts:[a,b],trash:[c],selectedId:a.id};
const out=review(cfg);
assert.equal(out.normalCount,2);
assert.equal(out.trashCount,1);
assert.equal(out.actionAuthorized,false,'no preview may grant deletion');
assert.equal(out.selection.id,a.id);
assert.equal(out.items[0].canChoose,true);
assert.equal(out.items[1].canChoose,false,'unfinished cannot be deleted');
assert.equal(out.items[2].canChoose,false,'bin rows cannot be re-deleted');
const markup=renderView(out);
assert.match(markup,/営業 3件/);
assert.match(markup,/12,000円/);
assert.match(markup,/期限 2026-11-11/);
assert.match(markup,/確認専用/);
assert.doesNotMatch(markup,/data-action="(?:delete|trash|purge)/);
assert.doesNotMatch(markup,/onclick=/);
assert.doesNotMatch(markup,/onchange=/);
assert.equal(review({...cfg,selectedId:b.id}).selection.canChoose,false);
assert.equal(review({...cfg,selectedId:'shift-999-a'}).selection,null);
assert.throws(()=>review({...cfg,serverUid:'uid-2'}),/UID/);
assert.throws(()=>review({...cfg,trash:[{...c,id:a.id}]}),/重複/);
assert.throws(()=>review({...cfg,shifts:[a,{...a,id:'invalid'}]}),/不正/);
const hostile={...a,date:'<script>alert("x")</script>',fare:'<img src=x onerror="alert(1)">'};
const safe=renderView(review({...cfg,shifts:[hostile]}));
assert.doesNotMatch(safe,/<script>|<img/);
assert.match(safe,/&lt;script&gt;/);
console.log('Trash review preview: UID isolation, no deletion actions, records/expiry, HTML escape passed');
