'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/hub.js'),'utf8');
function makeHub(values,fetcher,timers) {
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const context={localStorage:storage,window:{location:{origin:'http://test'},fetch:fetcher},fetch:fetcher,console:{warn(){},error(){}},setTimeout:fn=>{timers?.push(fn);return timers?.length||0;},clearTimeout(){},setInterval:()=>0,clearInterval(){},Date,Math,JSON};
  vm.createContext(context);vm.runInContext(source,context);return context.window.Hub;
}
function response(state,revision=1){return {ok:true,json:async()=>({state,revision,updatedAt:'2026-10-04T00:00:00Z'})};}
test('refresh before debounce preserves completed attempt, active profile, and retries sync',async()=>{
  const values=new Map(),original=makeHub(values);await original.whenReady();
  const a=original.addProfile({name:'Ada',ageGroup:'early-elem'}),b=original.addProfile({name:'Ben',ageGroup:'adult'});
  original.setActiveProfile(a.id);
  const remote=original.debugState();delete remote._sync.localPending;
  original.recordPlay('type-safari',100,30,{id:'one',profileId:a.id,config:{typingProgress:{history:[{id:'one'}]}}});
  original.setActiveProfile(b.id);
  const refreshed=makeHub(values,async()=>response(remote,0));await refreshed.whenReady();
  assert.equal(refreshed.getActiveProfile().id,b.id);
  assert.equal(refreshed.getProgress(a.id,'type-safari').plays,1);
  assert.equal(refreshed.getGameConfig(a.id,'type-safari').typingProgress.history.length,1);
});
test('reload and reconnect push pending local state even when the remote is empty',async()=>{
  const values=new Map(),original=makeHub(values);await original.whenReady();
  const a=original.addProfile({name:'Ada',ageGroup:'early-elem'});original.setActiveProfile(a.id);
  original.recordPlay('type-safari',100,30,{id:'one',profileId:a.id,config:{typingProgress:{xp:30}}});
  const timers=[],posts=[];
  const Hub=makeHub(values,async(url,options)=>{if(options?.method==='POST'){posts.push(JSON.parse(options.body));return response(null,1);}return response(null,0);},timers);
  await Hub.whenReady();assert.equal(timers.length,1);timers[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts.length,1);assert.equal(posts[0].state.progress[a.id]['type-safari'].plays,1);
  assert.equal(Hub.debugState()._sync.revision,1);assert.equal(Hub.debugState()._sync.localPending,undefined);
});
test('late push acknowledgement does not erase a newer preference or profile selection',async()=>{
  const values=new Map(),original=makeHub(values);await original.whenReady();
  const a=original.addProfile({name:'Ada',ageGroup:'early-elem'});original.setActiveProfile(a.id);
  let acknowledge;
  const fetcher=async(url,options)=>options?.method==='POST'?new Promise(resolve=>acknowledge=resolve):{ok:false};
  const Hub=makeHub(values,fetcher);await Hub.whenReady();
  const first=Hub.syncRemoteState(Hub.debugState());
  await new Promise(resolve=>setImmediate(resolve));
  Hub.setGameConfig(a.id,'type-safari',{preferences:{hands:false}});
  acknowledge(response(null,2));await first;
  assert.equal(Hub.getGameConfig(a.id,'type-safari').preferences.hands,false);
  assert.equal(JSON.parse(values.get('gamehub.v1')).gameConfig[a.id]['type-safari'].preferences.hands,false);
  assert.ok(Hub.debugState()._sync.localPending);
  assert.equal(Hub.debugState()._sync.revision,2);
});
test('divergent remote revision reports conflict without losing offline progress',async()=>{
  const values=new Map(),original=makeHub(values);await original.whenReady();
  const a=original.addProfile({name:'Ada',ageGroup:'early-elem'});original.setActiveProfile(a.id);
  const remote=original.debugState();delete remote._sync.localPending;
  original.setGameConfig(a.id,'type-safari',{typingProgress:{xp:30}});
  const Hub=makeHub(values,async()=>response(remote,7));await Hub.whenReady();
  assert.equal(Hub.getGameConfig(a.id,'type-safari').typingProgress.xp,30);
  assert.equal(Hub.getRemoteSyncMeta().lastConflict,true);
});
