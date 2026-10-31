const {test}=require('node:test');const assert=require('node:assert/strict');
const {create}=require('../gps-sharing-preferences');
function fixture(){const rows=new Map();let server=true,connected=true;
 const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const newClient=()=>create({uid:'driver',storage,online:()=>connected,read:async()=>server,write:async v=>{server=v;}});
 return {newClient,rows,set connected(v){connected=v;},get server(){return server;}};}
test('通信断の非公開操作は再起動後もサーバー公開値より優先',async()=>{
 const f=fixture();let c=f.newClient();await c.sync();f.connected=false;c.choose(false);
 await assert.rejects(c.sync(),/オフライン/);c=f.newClient();
 assert.equal(c.state().public,false);assert.equal(c.state().confirmed,false);
 f.connected=true;await c.sync();assert.equal(f.server,false);assert.equal(c.state().confirmed,true);
});
test('切替中の逆操作を古い送信完了で確認済みにしない',async()=>{
 let release,server=true;const rows=new Map();
 const c=create({uid:'driver',storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},
  read:async()=>server,write:async v=>{await new Promise(r=>release=r);server=v;}});
 await c.sync();c.choose(false);const first=c.sync();await new Promise(setImmediate);c.choose(true);release();await first;
 assert.equal(c.state().pending,true);assert.equal(c.state().confirmed,false);
 const next=c.sync();await new Promise(setImmediate);release();await next;assert.equal(c.state().confirmed,true);
});

test('他端末のサーバー確定設定を受信し、手元の未同期操作は上書きしない',async()=>{
 const f=fixture(),c=f.newClient();await c.sync();c.receive(false);
 assert.equal(c.state().public,false);assert.equal(c.state().confirmed,true);
 c.choose(true);c.receive(false);assert.equal(c.state().public,true);assert.equal(c.state().confirmed,false);
});
test('古いオフライン公開操作は別端末の新しい非公開を上書きしない',async()=>{
 const rows=new Map();let server={public:true,revision:1,operationId:'old'};let writes=0;
 const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const c=create({uid:'driver',storage,read:async()=>server,write:async(v,op)=>{writes++;server={public:v,revision:op.baseRevision+1,operationId:op.id};}});
 await c.sync();c.choose(true);server={public:false,revision:2,operationId:'other'};
 await assert.rejects(c.sync(),/他端末/);assert.equal(writes,0);assert.equal(server.public,false);
 assert.equal(c.state().confirmed,false);assert.equal(c.state().conflict,true);
 c.choose(false);await c.sync();assert.equal(server.revision,3);assert.equal(c.state().confirmed,true);
});
test('別タブの新しい未同期操作を古い完了コールバックで消さない',async()=>{
 const rows=new Map();let server={public:true,revision:1,operationId:'old'},release;
 const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const read=async()=>server,write=async(v,op)=>{await new Promise(r=>release=r);server={public:v,revision:op.baseRevision+1,operationId:op.id};};
 const a=create({uid:'driver',storage,read,write}),b=create({uid:'driver',storage,read,write});
 await a.sync();await b.sync();a.choose(false);const sending=a.sync();await new Promise(setImmediate);
 b.choose(true);const latest=rows.get('taxiapp-location-pending-v1-driver');release();await sending;
 assert.equal(rows.get('taxiapp-location-pending-v1-driver'),latest);assert.equal(a.state().pending,true);
});
test('送信応答消失後も同じ操作IDのサーバー保存を読み戻して二重送信しない',async()=>{
 const rows=new Map();let server={public:true,revision:1,operationId:'old'},writes=0;
 const c=create({uid:'driver',storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},
  read:async()=>server,write:async(v,op)=>{writes++;server={public:v,revision:op.baseRevision+1,operationId:op.id};throw Error('応答消失');}});
 await c.sync();c.choose(false);await assert.rejects(c.sync(),/応答消失/);await c.sync();
 assert.equal(writes,1);assert.equal(c.state().confirmed,true);
});
