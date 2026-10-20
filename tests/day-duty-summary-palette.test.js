const fs=require('node:fs'),assert=require('node:assert/strict');const html=fs.readFileSync('index.html','utf8');
for(const selector of ['.preview-duty-summary','.preview-duty-stat','.preview-duty-route','.preview-duty-stat strong[data-duty-field="state"]']){assert.ok(html.includes('html:not([data-ui-theme="night"]) '+selector),'Day palette missing: '+selector);}
for(const selector of ['.preview-duty-summary','.preview-duty-stat','.preview-duty-route']){assert.ok(html.includes('html[data-ui-theme="night"] '+selector),'Night palette lost: '+selector);}
console.log('Day/night duty summary CSS palette passed');
