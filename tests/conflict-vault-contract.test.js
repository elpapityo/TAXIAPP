const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','cloud-sync-ui.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
for(const action of ['conflictSave','conflictList','conflictGet','conflictTrash','conflictRestore']){
 assert.match(server,new RegExp("'"+action+"'"),action+' must be handled by server');
}
assert.match(server,/TAXIAPP_競合保管庫/);
assert.match(server,/TAXIAPP_VAULT_CHUNK=35000/);
assert.match(server,/function conflictVaultGet_/);
assert.match(server,/function conflictVaultSetTrash_/);
assert.doesNotMatch(server.slice(server.indexOf('function syncListV2_'),server.indexOf('function syncGetV2_')),/競合保管庫/,'vault must not enter normal duty list');
assert.match(ui,/await saveConflictCopies\(\)/);
assert.match(ui,/archiveAction/);
assert.match(ui,/data-sync-archive/);
assert.match(html,/data-sync-archive/);
console.log('Conflict vault isolated review and reversible-trashing contract passed');