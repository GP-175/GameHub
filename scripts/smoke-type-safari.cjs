#!/usr/bin/env node
'use strict';
// Reproducible integration smoke without new npm dependencies. Node >=22 + Chromium.
// Runs a COPY in scratch, never a deployed service or its family data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const base=process.env.TMPDIR;
if(!base)throw Error('Set TMPDIR to a scratch directory for this test.');
const tmp=fs.mkdtempSync(path.join(base,'safari-smoke-'));
const output=path.resolve(process.argv[2]||path.join(base,'type-safari-smoke-results'));
fs.mkdirSync(output,{recursive:true});
const checks=[],errors=[];
let server,chrome,socket,evaluate,shot;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label){const end=Date.now()+20000;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await delay(50);}throw Error('Timed out: '+label);}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
function check(name,value){assert.ok(value,name);checks.push(name);}
(async()=>{
 try {
  for(const name of ['assets','games','server','index.html','parent.html','sw.js','manifest.webmanifest'])fs.cpSync(path.join(root,name),path.join(tmp,name),{recursive:true});
  fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  // Express sendFile rejects dot-directory ancestors in absolute paths. The
  // Linux inherited directory fd provides a non-dot alias for scratch without
  // changing server code or writing outside TMPDIR; static/API code is exact.
  const directoryFd=fs.openSync(tmp,'r');
  server=spawn(process.execPath,['--preserve-symlinks-main','/proc/self/fd/3/server/server.js'],{cwd:tmp,env:{...process.env,PORT:String(port),GP_HOOT_DB_PATH:path.join(tmp,'db.json'),GP_HOOT_UPLOAD_ROOT:path.join(tmp,'uploads'),GP_HOOT_SESSION_SECRET:'safari-smoke-only'},stdio:['ignore','ignore','ignore',directoryFd]});
  fs.closeSync(directoryFd);
  await waitFor(async()=>{const r=await fetch(origin+'/api/state');return r.ok;},'scratch server');
  chrome=spawn(process.env.CHROME_BIN||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--remote-allow-origins=*','--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(tmp,'chrome')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let debug='';chrome.stderr.on('data',d=>debug+=d);
  const wsUrl=await waitFor(()=>debug.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'Chromium CDP');
  const debugOrigin=wsUrl.replace('ws:','http:').split('/devtools')[0];
  const targets=await (await fetch(debugOrigin+'/json/list')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},20000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}));});
  evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const navigate=async pathname=>{await cdp('Page.navigate',{url:origin+pathname});await waitFor(()=>evaluate(`location.pathname===${JSON.stringify(pathname)}&&document.readyState==='complete'&&!!window.Hub`),'navigate '+pathname);await evaluate('Hub.whenReady()');await delay(100);};
  shot=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));};
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('/games/type-safari.html');
  check('no-profile guard',await evaluate("document.getElementById('main').innerText.includes('Choose a GameHub profile')&&!document.querySelector('[data-start]')"));
  const profiles=await evaluate("(()=>{const a=Hub.addProfile({name:'Ada Smoke',ageGroup:'early-elem',color:'#6c5ce7'}),b=Hub.addProfile({name:'Ben Smoke',ageGroup:'adult'}),t=Hub.addProfile({name:'Tot Smoke',ageGroup:'toddler'});Hub.setActiveProfile(a.id);return {a,b,t};})()");
  await navigate('/games/type-safari.html');
  check('immediate navigation keeps active profile',await evaluate(`Hub.getActiveProfile().id===${JSON.stringify(profiles.a.id)}`));
  await waitFor(()=>evaluate("!!document.querySelector('[data-start=\"0\"]')"),'lesson ready');
  await shot('safari-trail-light');
  await click('[data-start="0"]');
  check('hand instruction image available',await waitFor(()=>evaluate("document.querySelector('.hand-position-art').complete&&document.querySelector('.hand-position-art').naturalWidth>0"),'hand image decoded'));
  await shot('safari-hands-and-lesson');
  await click('#ready-to-type');
  const text=await evaluate("document.getElementById('typing-text').textContent");
  await evaluate("window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='gamehub.v1')throw Error('simulated quota');return window.__originalSetItem.call(this,k,v);};");
  for(const key of text){await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,text:key});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key});}
  await waitFor(()=>evaluate("!!document.getElementById('retry-save')"),'storage failure retry UI');
  check('storage failure does not partially count attempt',await evaluate("Hub.getProgress(Hub.getActiveProfile().id,'type-safari').plays===0&&Hub.getGameConfig(Hub.getActiveProfile().id,'type-safari')===null"));
  await evaluate('Storage.prototype.setItem=window.__originalSetItem');
  await click('#retry-save');
  await waitFor(()=>evaluate("document.getElementById('result').innerText.includes('1 of 3')"),'completed real round');
  check('completed round recorded once',await evaluate("Hub.getGameConfig(Hub.getActiveProfile().id,'type-safari').typingProgress.history.length===1&&Hub.getProgress(Hub.getActiveProfile().id,'type-safari').plays===1"));
  await shot('safari-round-complete');
  await navigate('/games/type-safari.html');
  check('immediate refresh retains mastery and dashboard count',await evaluate("Hub.getGameConfig(Hub.getActiveProfile().id,'type-safari').typingProgress.mastery[0].practice===1&&Hub.getProgress(Hub.getActiveProfile().id,'type-safari').plays===1"));
  await click('[data-view="progress"]');await shot('safari-progress-light');
  await click('#theme-toggle');check('shared theme storage',await evaluate("localStorage.getItem('gamehub.theme')==='dark'&&document.body.dataset.theme==='dark'"));await shot('safari-progress-dark');
  await click('.hub-return');await waitFor(()=>evaluate("location.pathname==='/index.html'&&!!document.getElementById('search-input')"),'Hub return');
  check('Hub return and theme',await evaluate("document.documentElement.dataset.theme==='dark'&&Hub.getActiveProfile().name==='Ada Smoke'"));
  await evaluate("const input=document.getElementById('search-input');input.value='typing';input.dispatchEvent(new Event('input',{bubbles:true}));");
  check('registry search',await evaluate("document.querySelectorAll('.game-card').length===1&&document.querySelector('.game-card').textContent.includes('Type Safari')"));
  await evaluate("document.getElementById('search-input').value='';document.getElementById('search-input').dispatchEvent(new Event('input',{bubbles:true}));");
  await click('[data-subject="Typing"]');check('Typing subject tab',await evaluate("document.querySelectorAll('.game-card').length===1"));await shot('hub-typing-filter-dark');
  await evaluate(`Hub.setActiveProfile(${JSON.stringify(profiles.b.id)})`);
  await navigate('/games/type-safari.html');check('second profile isolated',await evaluate("Hub.getActiveProfile().name==='Ben Smoke'&&document.querySelector('.profile b').textContent==='Ben Smoke'&&Hub.getGameConfig(Hub.getActiveProfile().id,'type-safari')===null&&Hub.getProgress(Hub.getActiveProfile().id,'type-safari').plays===0"));
  await click('[data-start="0"]');await click('#ready-to-type');
  await evaluate(`Hub.setActiveProfile(${JSON.stringify(profiles.a.id)})`);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'f',text:'f'});
  check('profile switch cannot save old round',await evaluate(`document.getElementById('modal').hidden&&Hub.getProgress(${JSON.stringify(profiles.b.id)},'type-safari').plays===0`));
  await navigate('/parent.html');
  // Public default PIN in our freshly generated fixture, not user credentials.
  for(const digit of '1234')await click(`[data-digit="${digit}"]`);
  await waitFor(()=>evaluate("!document.getElementById('view-dash').classList.contains('hidden')"),'parent fixture unlock');
  await click('[data-tab="progress"]');
  await waitFor(()=>evaluate("!!document.querySelector('input[data-gid=\"type-safari\"]')"),'parent game table');
  check('parent dashboard includes attempt',await evaluate("document.getElementById('progress-content').innerText.includes('Type Safari')&&Hub.getProgress(Hub.getProfiles()[0].id,'type-safari').plays===1"));
  await shot('parent-safari-progress');
  await click('input[data-gid="type-safari"]');
  check('parent per-profile toggle',await evaluate(`!Hub.isGameEnabled(${JSON.stringify(profiles.a.id)},'type-safari')`));
  await navigate('/games/type-safari.html');check('disabled deep-link guard',await evaluate("document.getElementById('main').innerText.includes('disabled')&&!document.querySelector('[data-start]')"));
  await navigate('/index.html');check('disabled activity hidden in Hub',await evaluate("![...document.querySelectorAll('.game-card')].some(a=>a.textContent.includes('Type Safari'))"));
  await navigate('/parent.html');for(const digit of '1234')await click(`[data-digit="${digit}"]`);
  await waitFor(()=>evaluate("!document.getElementById('view-dash').classList.contains('hidden')"),'parent reopen');
  await click('[data-tab="progress"]');await click('[data-gf="all"]');await click('input[data-gid="type-safari"]');
  check('parent can restore activity',await evaluate(`Hub.isGameEnabled(${JSON.stringify(profiles.a.id)},'type-safari')`));
  await navigate('/games/type-safari.html');
  await waitFor(()=>evaluate("(async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller;})()"),'PWA controller');
  const dependencies=['/games/type-safari.html','/assets/hub.js','/assets/type-safari/app.js','/assets/type-safari/hub-adapter.js','/assets/type-safari/curriculum.js','/assets/type-safari/hands.js','/assets/type-safari/style.css','/assets/type-safari/theme.css','/assets/type-safari/hub.css','/assets/type-safari/hand-position.png'];
  const cached=await evaluate("(async()=>{const key=(await caches.keys()).find(k=>k==='gamehub-v36');return (await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname);})()");
  check('every Safari offline dependency cached',dependencies.every(p=>cached.includes(p)));
  await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await navigate('/games/type-safari.html');
  check('offline refresh loads same profile and progress',await evaluate("document.getElementById('save-status').innerText.includes('ready')&&Hub.getGameConfig(Hub.getActiveProfile().id,'type-safari').typingProgress.history.length===1"));
  await click('[data-view="practice"]');await click('[data-practice]');await click('#ready-to-type');
  const practice=await evaluate("document.getElementById('typing-text').textContent");
  for(const key of practice){await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,text:key});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key});}
  await waitFor(()=>evaluate("Hub.getProgress(Hub.getActiveProfile().id,'type-safari').plays===2"),'offline round saved');
  check('offline round saved to shared Hub',await evaluate("Hub.getGameConfig(Hub.getActiveProfile().id,'type-safari').typingProgress.history.length===2"));
  await navigate('/games/type-safari.html');check('offline round survives refresh',await evaluate("Hub.getProgress(Hub.getActiveProfile().id,'type-safari').plays===2"));
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate('Hub.setRemoteUser();Hub.whenReady()');
  await waitFor(async()=>{const r=await (await fetch(origin+'/api/state')).json();return r.state?.progress?.[profiles.a.id]?.['type-safari']?.plays===2;},'offline progress reconnect sync');
  check('offline progress reconnects through existing state API',true);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate('/games/type-safari.html');check('narrow layout has no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));await shot('safari-mobile');
  check('no uncaught browser exceptions',errors.length===0);
  for(const file of ['failure.json','failure.png'])fs.rmSync(path.join(output,file),{force:true});
  fs.writeFileSync(path.join(output,'smoke-results.json'),JSON.stringify({checks,errors,screenshots:fs.readdirSync(output).filter(p=>p.endsWith('.png'))},null,2));
  console.log(JSON.stringify({passed:checks.length,checks,errors,output},null,2));
 } catch(error) {
  try {
   const diagnostics={error:String(error),checks,errors,page:await evaluate("({url:location.href,ready:document.readyState,text:document.body.innerText.slice(0,5000),state:window.Hub?.debugState()})")};
   fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(diagnostics,null,2));
   console.error(JSON.stringify(diagnostics,null,2));await shot('failure');
  } catch {}
  throw error;
 } finally {
  socket?.close();chrome?.kill('SIGTERM');server?.kill('SIGTERM');
  await delay(200);fs.rmSync(tmp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
