'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
async function fixture() {
  const {createSafariAdapter} = await import('../assets/type-safari/hub-adapter.js');
  const values = new Map();
  let fail = false;
  const storage = {getItem:k=>values.get(k)||null,setItem(k,v){if(fail)throw Error('quota');values.set(k,v);}};
  const context = {localStorage:storage,window:{location:{origin:'http://localhost'}},console:{warn(){},error(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},Date,Math,JSON};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'assets/hub.js'),'utf8'),context);
  const Hub = context.window.Hub;
  await Hub.whenReady();
  const a=Hub.addProfile({name:'Ada',ageGroup:'early-elem'}),b=Hub.addProfile({name:'Ben',ageGroup:'adult'});
  Hub.setActiveProfile(a.id);
  const adapter=createSafariAdapter(Hub);
  return {Hub,a,b,adapter,storage,setFail:v=>fail=v};
}
function payload(adapter,id='round-1',lesson=0,duration=30) {
  const round=adapter.round(lesson);
  return {id,lesson,text:round.text,roundKey:round.roundKey,profileId:adapter.profile().id,events:[...round.text],duration};
}
test('Safari uses native age groups, enablement, and profile-scoped progress',async()=>{
  const {Hub,a,b,adapter}=await fixture();
  const game=Hub.GAMES.find(g=>g.id==='type-safari');
  assert.deepEqual(Array.from(game.ageGroups),['early-elem','adult']);
  const toddler=Hub.addProfile({name:'Tot',ageGroup:'toddler'});
  assert.equal(Hub.isGameEnabled(toddler.id,game.id),false);
  const p=payload(adapter); const saved=adapter.finish(p);
  assert.equal(saved.progress.mastery[0].practice,1);
  assert.equal(Hub.getProgress(a.id,game.id).plays,1);
  Hub.setActiveProfile(b.id); assert.equal(adapter.progress().history.length,0);
  assert.throws(()=>adapter.finish(p),/profile changed/i);
  assert.equal(Hub.getProgress(b.id,game.id).plays,0);
  Hub.setGameEnabled(b.id,game.id,false);assert.throws(()=>adapter.round(0),/disabled/i);
  Hub.setActiveProfile(null); assert.throws(()=>adapter.round(0),/choose.*profile/i);
});
test('retry is idempotent, settings merge, failed storage rolls back both records',async()=>{
  const {Hub,a,adapter,setFail}=await fixture();
  Hub.setGameConfig(a.id,'type-safari',{parentSetting:42,preferences:{sound:false}});
  const p=payload(adapter);setFail(true);assert.throws(()=>adapter.finish(p),/save/i);
  assert.equal(adapter.progress().history.length,0);assert.equal(Hub.getProgress(a.id,'type-safari').plays,0);
  setFail(false);adapter.finish(p);adapter.finish(p);
  assert.equal(adapter.progress().history.length,1);assert.equal(Hub.getProgress(a.id,'type-safari').plays,1);
  adapter.preferences({hands:false});const cfg=Hub.getGameConfig(a.id,'type-safari');
  assert.equal(cfg.parentSetting,42);assert.equal(cfg.preferences.sound,false);assert.equal(cfg.preferences.hands,false);assert.equal(cfg.typingProgress.history.length,1);
});
test('curriculum retains all 16 lessons, six-round mastery, checks, and weak-key adaptation',async()=>{
  const {adapter}=await fixture(); const c=await import('../assets/type-safari/curriculum.js');
  assert.equal(c.lessons.length,16);
  for(let n=0;n<6;n++)adapter.finish(payload(adapter,'master-'+n));
  assert.deepEqual(adapter.progress().completed,[0]);assert.equal(adapter.round(1).id,1);
  assert.throws(()=>adapter.round(2),/unavailable/i);
  const p=c.emptyProgress();p.keys.f={attempts:10,correct:4};assert.equal(c.weakKeys(p)[0].key,'f');assert.match(c.practiceText(p),/f/);
  const check=c.emptyProgress();check.mastery[0]={practice:3,checks:2,attempts:5,review:false,mastered:false};
  const r=c.lessonRound(check,0);const score=c.scoreSession(r.text,['x','x','x',...[...r.text].flatMap(k=>k==='f'?['x',k]:[k])],30);c.recordRound(check,0,r,score);
  assert.equal(check.mastery[0].checks,0);assert.equal(check.mastery[0].review,true);assert.equal(c.lessonRound(check,0).phase,'refresher');
});
test('rejects stale/tampered/incomplete rounds and invalid timing',async()=>{
  const {adapter}=await fixture();const p=payload(adapter);
  assert.throws(()=>adapter.finish({...p,text:'wrong'}),/round changed/i);
  assert.throws(()=>adapter.finish({...p,events:['f']}),/whole lesson/i);
  assert.throws(()=>adapter.finish({...p,duration:NaN}),/duration/i);
  adapter.finish(p);assert.throws(()=>adapter.finish({...p,id:'stale'}),/round changed/i);
});
test('entire 16-lesson trail remains playable with original mastery thresholds',async()=>{
  const {Hub,a,adapter}=await fixture();
  for(let lesson=0;lesson<16;lesson++){
    for(let n=0;n<6;n++)adapter.finish(payload(adapter,`trail-${lesson}-${n}`,lesson,1));
    assert.equal(adapter.progress().mastery[lesson].mastered,true);
  }
  assert.equal(adapter.progress().completed.length,16);
  assert.equal(adapter.progress().history.length,96);
  assert.equal(Hub.getProgress(a.id,'type-safari').plays,96);
  const replay=adapter.round(15);assert.equal(replay.phase,'replay');
});
test('legacy three-argument Hub play recording and session API remain compatible',async()=>{
  const {Hub,a}=await fixture();Hub.recordPlay('snake',12,4);Hub.startSession('snake');Hub.endSession(8);Hub.endSession(8);
  assert.equal(Hub.getProgress(a.id,'snake').plays,2);
  assert.equal(Hub.getProgress(a.id,'snake').bestScore,12);
  assert.equal(Hub.getProgress(a.id,'snake').totalSeconds,4);
});
test('offline cache covers every local Safari dependency, without a second shell/API',()=>{
  const dir=path.join(root,'assets/type-safari');const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  for(const file of fs.readdirSync(dir).filter(f=>/\.(js|css|png)$/.test(f)))assert.ok(sw.includes('./assets/type-safari/'+file),file+' missing from PWA cache');
  assert.ok(sw.includes('./games/type-safari.html'));
  const app=fs.readFileSync(path.join(dir,'app.js'),'utf8'),html=fs.readFileSync(path.join(root,'games/type-safari.html'),'utf8');
  assert.doesNotMatch(app,/\/api\/(session|progress)|initFamily|typeSafariTheme|typeSafariHandHelp/);
  assert.doesNotMatch(html,/iframe|family-overlay|download-offline|sign-in/i);
  for(const file of ['style.css','theme.css','hub.css'])assert.doesNotMatch(fs.readFileSync(path.join(dir,file),'utf8'),/https?:\/\/|@import/);
});
