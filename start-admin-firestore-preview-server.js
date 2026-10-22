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
 const url='http://localhost:8787/?adminFirestorePreview=1&build=v0.3.128-pr119';
 console.log('TAXIAPP v0.3.128 - PR #119 development preview');
 console.log('Server ready:',url);
 console.log('Keep this window open. Close it or press Ctrl+C to stop.');
 console.log('If the browser does not open automatically, paste the URL above.');
 // Bind to loopback before opening the browser: no race with server startup.
 if(process.platform==='win32'){
  const {execFile}=require('node:child_process');
  execFile('cmd.exe',['/d','/s','/c','start "" "'+url+'"'],
   {windowsHide:true},error=>{
    if(error)console.log('Could not open the browser automatically:',error.message);
   });
 }
}).on('error',error=>{
 console.error('Could not start TAXIAPP preview server:',error.message);
 console.error('If port 8787 is in use, close the previous TAXIAPP preview first.');
 process.exitCode=1;
});
