'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
assert.match(html,/<title>TAXIAPP v0\.3\.110 — 乗務日報<\/title>/);
const action=html.slice(html.indexOf("if(action==='beginBreak')"),html.indexOf("if(action==='breakBoard'"));
assert.match(action,/const now=new Date\(\);shift\.breakActive=\{id:'break-'\+now\.getTime\(\),startedAt:stamp\(now\),startedIso:now\.toISOString\(\),place:''\}/,
  'break starts with local clock and an ISO timestamp');
assert.match(action,/save\(\);render\(\);getBreakPlaceGps\(/,
  'break timestamp is saved before the independent GPS reverse-geocode');
assert.match(html,/safeText\(shortTime\(resting\.startedAt\)\)/,
  'break start timestamp must remain in the displayed dashboard');
const active=html.slice(html.indexOf('if(resting){const completed=shift.breakSessions||[]'),
                        html.indexOf('function renderNewAction(shift)'));
for(const act of ['endBreak','breakBoard','breakDispatch']){
 assert.ok(active.includes('data-action="'+act+'"'),'break screen action missing: '+act);
}
assert.ok(active.includes('☕ 休憩開始'),'disabled start button missing during active break');
assert.match(css,/html\[data-ui-screen-mode\]\[data-ui-orientation-mode\] \.break-page \.break-actions/);
assert.match(css,/html \.break-page \.break-actions\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;/,
  'break actions must override portrait and half-screen one-column rules');
assert.match(css,/\.break-page \.break-actions \.btn\s*\{[\s\S]*?min-height:var\(--ui-button-touch\)!important;/);
assert.match(css,/@media screen \{[\s\S]*?\.card\{padding:16px;margin-bottom:11px\}/);
assert.match(css,/@media screen and \(max-width:700px\)\{/);
assert.match(css,/\.details>summary\{padding:12px 14px\}/);
assert.match(css,/\.field \.field-label\{margin-bottom:4px\}/);
assert.match(css,/\.actions\{gap:7px;margin-top:10px\}/);
assert.match(css,/\.btn\{padding:7px 10px\}/);
assert.match(css,/\.control\{padding:8px 10px\}/);
// Match the actual foreground/background color pairs, rather than only selectors.
const luminance=hex=>{
 const channels=hex.match(/[0-9a-f]{2}/gi).map(h=>parseInt(h,16)/255);
 return channels.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4)
                .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const day=contrast('e8f0fa','18324c'),night=contrast('263d56','f5faff');
assert.ok(day>=7,'daytime clock contrast too low: '+day);
assert.ok(night>=7,'nighttime clock contrast too low: '+night);
assert.match(css,/html\[data-ui-theme="day"\] \.break-page \.break-dashboard>div/);
assert.match(css,/html\[data-ui-theme="night"\] \.break-page \.break-dashboard>div/);
assert.match(css,/html\[data-ui-theme="night"\] \.break-page \.break-dashboard strong/);
assert.match(css,/-webkit-text-fill-color:#f5faff/);
console.log('PASS break v0.3.94: saved start clock, 2x2 all modes, day/night high contrast, app-wide screen density');
