// Native GameHub persistence; curriculum rules reused from Type Safari.
// No fetch interception, account system, or standalone progress store.
import {emptyProgress, unlocked, practiceText, lessonRound, scoreSession, recordRound} from './curriculum.js';
export const GAME_ID = 'type-safari';
export function createSafariAdapter(Hub) {
  function profile(expectedId) {
    const p = Hub.getActiveProfile();
    if (!p) throw new Error('Choose a GameHub profile to start typing.');
    if (expectedId && p.id !== expectedId) throw Object.assign(new Error('The GameHub profile changed. Return to the Hub and reopen Type Safari.'), {status:409});
    if (!Hub.isGameEnabled(p.id, GAME_ID)) throw new Error('Type Safari is disabled for this profile. Ask your parent to enable it in GameHub.');
    return p;
  }
  function config(p=profile()) {return Hub.getGameConfig(p.id,GAME_ID) || {};}
  function progress() {return {...emptyProgress(), ...(config().typingProgress || {})};}
  function preferences(patch, expectedId) {
    const p=profile(expectedId), cfg=config(p);
    if (!patch) return cfg.preferences || {};
    const next={...cfg,preferences:{...cfg.preferences,...patch}};
    if (Hub.setGameConfig(p.id,GAME_ID,next)===false) throw new Error('Could not save your preferences. Check browser storage and try again.');
    return next.preferences;
  }
  function round(id) {
    const p=progress();
    if (!Number.isInteger(id) || id< -1 || id>unlocked(p)) throw new Error('Lesson unavailable.');
    return id===-1?{id:-1,text:practiceText(p),accuracy:90,wpm:0}:lessonRound(p,id);
  }
  function finish(b) {
    if (typeof b.profileId !== 'string' || !b.profileId) throw new Error('Choose a GameHub profile to save this round.');
    const owner=profile(b.profileId), cfg=config(owner), p={...emptyProgress(),...(cfg.typingProgress || {})};
    const old=p.history.find(h=>h.id===b.id);
    if (old) return {progress:p,result:old};
    if (typeof b.id!=='string' || !b.id || b.id.length>100) throw new Error('Invalid attempt.');
    if (!Number.isFinite(b.duration) || b.duration<0 || b.duration>86400) throw new Error('Invalid duration.');
    if (!Array.isArray(b.events) || b.events.length>50000 || b.events.some(k=>typeof k!=='string'||k.length!==1)) throw new Error('Invalid keystrokes.');
    const r=round(b.lesson);
    if (r.text!==b.text || (b.lesson>=0 && r.roundKey!==b.roundKey)) throw Object.assign(new Error('This round changed. Load the current round; your saved progress is safe.'),{status:409});
    const score=scoreSession(r.text,b.events,b.duration);
    const outcome=b.lesson>=0?recordRound(p,b.lesson,r,score):{passed:score.accuracy>=85,mastered:false,phase:'personal'};
    for (const [k,v] of Object.entries(score.keys)) {
      p.keys[k]??={attempts:0,correct:0};p.keys[k].attempts+=v.attempts;p.keys[k].correct+=v.correct;
    }
    const result={id:b.id,lesson:b.lesson,date:new Date().toISOString(),accuracy:score.accuracy,wpm:score.wpm,...outcome};
    p.xp+=outcome.passed?30:10;p.history.push(result);p.history=p.history.slice(-500);
    // One transactional Hub write keeps mastery and dashboard counts together.
    // The owner is checked again inside recordPlay before any mutation.
    if (!Hub.recordPlay(GAME_ID,score.accuracy,b.duration,{profileId:owner.id,id:b.id,config:{...cfg,typingProgress:p}})) throw new Error('Could not save on this computer. Check browser storage and try saving again.');
    return {progress:p,result};
  }
  return {profile,progress,preferences,round,finish};
}
