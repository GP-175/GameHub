// Functional hand-position diagram. Coordinates come from the visible keys.
export function drawHands(keyboard,char,fingerFor,{enabled=true,pressed=false,correct=true}={}){
 const old=keyboard.querySelector('.hands-overlay');
 if(!enabled){old?.remove();keyboard.classList.remove('has-hands');return;}
 keyboard.classList.add('has-hands');
 const box=keyboard.getBoundingClientRect(),width=box.width;
 if(!width)return;
 const point=key=>{const el=[...keyboard.querySelectorAll('[data-key]')].find(e=>e.dataset.key===key);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left-box.left+r.width/2,y:r.top-box.top+r.height/2,w:r.width};};
 const homes=['a','s','d','f','j','k','l',';'].map(point);if(homes.some(p=>!p))return;
 const shifted={'!':'1','?':'/','"':"'",':':';','(':'9',')':'0'};
 const key=shifted[char]||char?.toLowerCase();let target=point(key),active=fingerFor(char)?.id;
 const space=point(' '),homeY=homes[0].y,palmY=homeY+48,height=Math.max(box.height+62,palmY+70);
 const scale=Math.min(1,homes[0].w/36),fingerWidth=17*scale;
 const needShift=/[A-Z]/.test(char||'')||'!?":()'.includes(char||'~');
 const shiftHand=needShift?(fingerFor(char)?.hand==='Left'?'Right':'Left'):null;
 let content='';
 ['Left','Right'].forEach((hand,side)=>{
  const list=homes.slice(side*4,side*4+4),left=list[0].x-fingerWidth*.7,right=list[3].x+fingerWidth*.7,center=(left+right)/2;
  const palm=`M ${left} ${palmY-12} Q ${center} ${palmY-32} ${right} ${palmY-12} L ${right+5*scale} ${palmY+23} Q ${right} ${palmY+48} ${center+25*scale} ${palmY+55} L ${center+22*scale} ${height-5} L ${center-22*scale} ${height-5} L ${center-25*scale} ${palmY+55} Q ${left} ${palmY+45} ${left-5*scale} ${palmY+23} Z`;
  content+=`<path class="palm-diagram" d="${palm}"/>`;
  const ids=side?['ri','rm','rr','rp']:['lp','lr','lm','li'];
  list.forEach((home,i)=>{
   const id=ids[i],isActive=id===active&&target,shiftActive=(hand===shiftHand)&&(i===(side?3:0));
   const tip=shiftActive?point(side?'right-shift':'left-shift')||home:isActive?target:home;
   const baseX=home.x+(center-home.x)*.1,baseY=palmY;
   const midX=baseX*.4+tip.x*.6,midY=tip.y+(baseY-tip.y)*.58;
   const d=`M ${baseX} ${baseY} Q ${baseX} ${midY+8} ${midX} ${midY} Q ${tip.x} ${tip.y+19*scale} ${tip.x} ${tip.y}`;
   content+=`<g class="diagram-finger ${isActive||shiftActive?'active-finger':''} ${pressed&&(isActive||shiftActive)?'finger-tap':''}" data-finger="${id}"><path class="finger-outline" d="${d}" style="stroke-width:${fingerWidth+4}px"/><path class="finger-body" d="${d}" style="stroke-width:${fingerWidth}px"/><ellipse class="finger-nail" cx="${tip.x}" cy="${tip.y+3*scale}" rx="${fingerWidth*.31}" ry="${fingerWidth*.4}"/>${isActive||shiftActive?`<circle class="finger-target ${correct?'':'miss'}" cx="${tip.x}" cy="${tip.y}" r="${fingerWidth*.7}"/>`:''}</g>`;
  });
  const thumbBase=side?left+7*scale:right-7*scale,thumbTarget=char===' '?{x:space.x+(side?14:-14)*scale,y:space.y}:{x:side?space.x+39*scale:space.x-39*scale,y:space.y+14*scale};
  const thumbPath=`M ${thumbBase} ${palmY+29*scale} Q ${thumbBase+(side?-15:15)*scale} ${palmY+24*scale} ${thumbTarget.x} ${thumbTarget.y}`;
  content+=`<g class="diagram-finger ${char===' '?'active-finger':''} ${pressed&&char===' '?'finger-tap':''}" data-finger="${side?'right':'left'}-thumb"><path class="finger-outline" d="${thumbPath}" style="stroke-width:${fingerWidth+7}px"/><path class="finger-body" d="${thumbPath}" style="stroke-width:${fingerWidth+3}px"/>${char===' '?`<circle class="finger-target" cx="${thumbTarget.x}" cy="${thumbTarget.y}" r="${fingerWidth*.65}"/>`:''}</g>`;
  content+=`<text class="hand-name" x="${center}" y="${height-13}" text-anchor="middle">${hand} hand</text>`;
 });
 const svg=old||document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','hands-overlay');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('aria-hidden','true');svg.innerHTML=content;if(!old)keyboard.append(svg);
}
