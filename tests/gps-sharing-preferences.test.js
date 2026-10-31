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
 c.choose(false);const first=c.sync();await new Promise(setImmediate);c.choose(true);release();await first;
 assert.equal(c.state().pending,true);assert.equal(c.state().confirmed,false);
 const next=c.sync();await new Promise(setImmediate);release();await next;assert.equal(c.state().confirmed,true);
});

test('他端末のサーバー確定設定を受信し、手元の未同期操作は上書きしない',async()=>{
 const f=fixture(),c=f.newClient();await c.sync();c.receive(false);
 assert.equal(c.state().public,false);assert.equal(c.state().confirmed,true);
 c.choose(true);c.receive(false);assert.equal(c.state().public,true);assert.equal(c.state().confirmed,false);
});
