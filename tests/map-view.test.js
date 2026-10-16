'use strict';
// Run: node tests/map-view.test.js
// Synthetic DOM + GSI/Leaflet stand-ins. Tests shell interactions without GPS/cloud.
const assert=require('node:assert/strict'),vm=require('node:vm'),
  fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const source=n=>fs.readFileSync(path.join(base,n),'utf8');
function fakeElement(id){
 return {id,dataset:{},style:{},value:'',disabled:false,textContent:'',children:[],handlers:{},attrs:{},
  addEventListener(name,cb){this.handlers[name]=cb;},setAttribute(key,val){this.attrs[key]=val;},
  append(...a){this.children.push(...a);},replaceChildren(...a){this.children=[...a];},
  querySelectorAll(){return [];},classList:{toggle(){}}};
}
async function run(){
 const ids=['layoutSelect','syncStatus','mapShiftSelect','mapMessage','pinList','googleSearchBtn',
  'googleRouteBtn','locateBtn','followBtn','fitPinsBtn','mapFallback','mapShiftLabel','appFrame'];
 const elems=new Map(ids.map(id=>[id,fakeElement(id)])),events={},
  document={body:{dataset:{}},visibilityState:'visible',
   getElementById:id=>elems.get(id),createElement:tag=>fakeElement(tag),
   addEventListener:(type,fn)=>{events['document:'+type]=fn;}};
 // Respect the initial disabled attributes on both Google buttons in map.html.
 elems.get('googleSearchBtn').disabled=true;
 elems.get('googleRouteBtn').disabled=true;
 const calls=[],storage=new Map();
 const record={id:'ride-1',kind:'ride',status:'complete',
  raw:{A:1,AL:'甲町',AM:'乙町',D:'35.0,135.0',H:'35.02,135.02'},meta:{}};
 const shift={id:'shift-100',date:'2026-10-16',startedAt:'07:30',endedAt:'',
  records:[record],gpsTrip:{lastFix:{lat:35.01,lng:135.01,t:Date.now()},
   lastSeenMs:Date.now(),status:'tracking'}};
 const data={version:1,activeId:shift.id,shifts:[shift]};
 storage.set('taxiapp-v1',JSON.stringify(data));
 let writeKeys=[];
 const localStorage={getItem:key=>storage.get(key)||null,
  setItem:(key,value)=>{writeKeys.push(key);storage.set(key,value);}};
 const map={zoom:11,setView(_,z){this.zoom=z;return this;},getZoom(){return this.zoom;},
  on(){return this;},fitBounds(){calls.push('fit');return this;},
  invalidateSize(){return this;},panTo(){return this;}};
 const L={map:()=>map,tileLayer:()=>({addTo(){return this;}}),
  layerGroup:()=>({addTo(){return this;},clearLayers(){return this;}}),
  circleMarker:()=>({addTo(){return this;},bindPopup(){return this;},on(){return this;}}),
  latLngBounds:points=>({pad:()=>points})};
 const window={L,innerWidth:380,isSecureContext:true,addEventListener(type,fn){events[type]=fn;},
  open(url){calls.push(url);}};
 const timers=[],setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  setInterval=(fn,ms)=>{timers.push({fn,ms,interval:true});return timers.length;};
 const navigator={geolocation:{getCurrentPosition(ok){ok({coords:{latitude:35.01,longitude:135.01,accuracy:9}});}}};
 const ctx={window,document,navigator,localStorage,setTimeout,setInterval,requestAnimationFrame:fn=>fn(),console,Date,Math,Number,JSON};
 vm.runInNewContext(source('map-shared.js'),ctx,{filename:'map-shared.js'});
 vm.runInNewContext(source('map-view.js'),ctx,{filename:'map-view.js'});
 assert.equal(document.body.dataset.layout,'stack');
 elems.get('layoutSelect').value='side';
 elems.get('layoutSelect').handlers.change();
 assert.equal(document.body.dataset.layout,'side');
 assert.equal(storage.get('taxiapp-map-layout-v1'),'side');
 window.innerWidth=260;
 events.resize();
 assert.equal(document.body.dataset.layout,'side'); // no orientation override
 const kick=timers.find(t=>t.ms===200&&!t.interval);
 assert.ok(kick);kick.fn();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elems.get('mapShiftSelect').children.length,1);
 assert.equal(elems.get('pinList').children.length,2);
 assert.ok(elems.get('syncStatus').textContent.includes('localStorage'));
 assert.equal(elems.get('googleRouteBtn').disabled,true);
 elems.get('pinList').children[0].handlers.click();
 assert.equal(elems.get('googleRouteBtn').disabled,false);
 elems.get('googleRouteBtn').handlers.click();
 assert.ok(calls.some(x=>typeof x==='string'&&x.startsWith('https://www.google.com/maps/dir/?api=1')));
 assert.equal(JSON.parse(storage.get('taxiapp-v1')).shifts[0].records.length,1);
 assert.deepEqual([...new Set(writeKeys)],['taxiapp-map-layout-v1']); // no TAXIAPP data mutation
 elems.get('layoutSelect').value='map';
 elems.get('layoutSelect').handlers.change();
 assert.equal(document.body.dataset.layout,'map');
 assert.equal(storage.get('taxiapp-map-layout-v1'),'map');
 // New sales are reflected in the map after next poll, without a write from the map.
 data.shifts[0].records.push({id:'ride-2',kind:'ride',status:'complete',
  raw:{A:2,D:'35.05,135.05',H:'35.06,135.06'},meta:{}});
 storage.set('taxiapp-v1',JSON.stringify(data));
 const poll=timers.find(t=>t.ms===4000&&t.interval);
 assert.ok(poll);poll.fn();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elems.get('pinList').children.length,4);
 console.log('Map shell tests passed: orientation-independent modes, same-origin state, read-only map, marker sync, Google URLs.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
