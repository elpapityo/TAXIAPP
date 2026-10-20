const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const login=fs.readFileSync(path.join(__dirname,'..','account-auto-sync.js'),'utf8');
assert.doesNotMatch(html,/id="accountViewSignIn"/);
assert.doesNotMatch(login,/accountViewSignIn/);
assert.match(html,/id="accountSignIn"/);
assert.match(html,/syncUI\.bootstrapWriter\(\)/);
console.log('Only operator login is exposed; cloud-first writer gate remains.');
