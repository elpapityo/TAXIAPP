'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.ok(!html.includes('迎車依頼受信：'));
assert.ok(!html.includes('迎車中は売上や手数料を計上しません。待機履歴は別に保持しています。'));
const pos=html.indexOf('function renderDispatchForm(');
const end=html.indexOf('function amountDiscount(',pos);
assert.ok(pos>=0&&end>pos);
const ctx={
 selector:()=>'<div>配車元選択</div>',
 field:(key,_raw,options={})=>'<label>'+String(options.label||'')+'</label><input data-field="'+key+'">',
 locationField:()=>'<input data-location="AL">',
 safeText:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),
 renderAllFields:()=>'<div>全項目</div>',
 rideFieldDataShown:(_key,existing)=>true,
 DISPATCH_TYPES:[]
};
vm.createContext(ctx);
vm.runInContext(html.slice(pos,end),ctx);
const out=ctx.renderDispatchForm({},{
 raw:{C:'16:25',E:'G',F:'1000',AL:'神戸'},
 meta:{dispatchNote:'テスト'}
});
assert.ok(!out.includes('class="panel-strip"'));
assert.ok(out.includes('配車元'));
assert.ok(out.includes('迎車受信時刻（変更可）'));
assert.ok(out.includes('data-field="C"'));
assert.ok(out.includes('data-field="F"'));
assert.ok(out.includes('data-location="AL"'));
assert.ok(out.includes('data-action="boardDispatch"'));
assert.ok(out.includes('data-action="cancelDispatch"'));
assert.ok(out.includes('依頼メモ（任意）'));
assert.ok(out.includes('迎車中にキャンセルになった場合'));
console.log('Dispatch form banner removal passed; dispatch timestamp, inputs, GPS and actions remain present.');
