'use strict';
// Localhost-only static server for TAXIAPP administrator Firestore preview.
// No dependencies, no Firebase credentials, no writes, no deployment.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const mime={
 '.html':'text/html; charset=utf-8',
 '.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8',
 '.json':'application/json; charset=utf-8',
 '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
 '.jpeg':'image/jpeg', '.webp':'image/webp'
};
http.createServer((req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){
  res.writeHead(405,{'Content-Type':'text/plain; charset=utf-8'});res.end('Method not allowed');return;
 }
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}
 catch{res.writeHead(400);res.end();return;}
 if(pathname==='/'||pathname==='')pathname='/index.html';
 const filename=path.resolve(root,'.'+pathname);
 if(!filename.startsWith(root+path.sep)||!Object.hasOwn(mime,path.extname(filename).toLowerCase())){
  res.writeHead(403);res.end();return;
 }
 fs.readFile(filename,(error,contents)=>{
  if(error){res.writeHead(error.code==='ENOENT'?404:500);res.end();return;}
  res.writeHead(200,{
   'Content-Type':mime[path.extname(filename).toLowerCase()],
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  });
  res.end(req.method==='HEAD'?undefined:contents);
 });
}).listen(8787,'127.0.0.1',()=>{
 console.log('TAXIAPP Firestore development preview: http://localhost:8787/?adminFirestorePreview=1');
 console.log('Loopback-only. Stop with Ctrl+C. No Firebase or Google configuration changes.');
});
