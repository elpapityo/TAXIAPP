'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('ui-layout-lab.html','utf8');
assert.match(html,/data-device="fold"/);
assert.match(html,/id="foldSubModes"/);
assert.match(html,/data-fold-view="half"/);
assert.match(html,/data-fold-view="full"/);
assert.match(html,/<option value="foldHalf">▥ 半画面<\/option>/);
assert.match(html,/id="workspaceHalfWidth"/);
assert.match(html,/min="300" max="380" step="10"/);
assert.match(html,/if\(model\.device!=='fold'\)openWorkspace\(\)/,
 'Fold selection must offer submode before replacing comparison with fullscreen iframe');
assert.match(html,/\.bottomNav \.compactNote\{display:none!important\}/,
 'Narrow view must keep fixed navigation usable');
for(const mode of ['compact','guided','detail','legacy'])assert.match(html,new RegExp('data-mode="'+mode+'"'));
const inline=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline);new Function(inline);
const presets=inline.match(/const devicePresets=([\s\S]*?);\s*const phases=/)?.[1];
const deviceFunction=inline.slice(inline.indexOf(' function deviceSize(){'),inline.indexOf(' function resizeWorkspace(){'));
assert.ok(presets&&deviceFunction);
const ctx={model:{device:'foldHalf',orientation:'portrait',foldHalfWidth:340}};
vm.createContext(ctx);vm.runInContext('const devicePresets='+presets+';\n'+deviceFunction,ctx);
function dim(){return JSON.parse(JSON.stringify(vm.runInContext('deviceSize()',ctx)));}
assert.deepEqual(dim(),[340,841],'half width is less than normal phone 393px');
ctx.model.foldHalfWidth=300;assert.deepEqual(dim(),[300,841]);
ctx.model.foldHalfWidth=380;assert.deepEqual(dim(),[380,841]);
ctx.model.orientation='landscape';assert.deepEqual(dim(),[841,380]);
ctx.model.orientation='portrait';ctx.model.device='fold';assert.deepEqual(dim(),[673,841]);
ctx.model.device='phone';assert.deepEqual(dim(),[393,852]);
ctx.model.device='tablet';assert.deepEqual(dim(),[834,1112]);
console.log('Fold half-screen preview passed: nested full/half selector, adjustable 300–380px viewport, orientations, all input modes and fixed-nav narrow CSS.');
