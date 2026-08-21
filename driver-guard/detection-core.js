export const DEFAULT_DETECTION = Object.freeze({
  eyeDwellMs: 300,
  awayDwellMs: 350,
  missingDwellMs: 500,
  yawDeltaLimit: 0.075,
  pitchDeltaLimit: 0.11,
  blinkFloor: 0.38,
  blinkDelta: 0.18,
  blinkCeiling: 0.66,
  earRatio: 0.68,
});

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

function eyeAspectRatio(k,idx){
  const [p1,p2,p3,p4,p5,p6]=idx.map(i=>k[i]);
  if(!p1||!p2||!p3||!p4||!p5||!p6)return 0;
  return (dist(p2,p6)+dist(p3,p5))/(2*Math.max(0.0001,dist(p1,p4)));
}

export function landmarkSignals(k){
  if(!k||k.length<292)return null;
  const leftOuter=k[33],rightOuter=k[263],nose=k[1];
  const mouthMid=mid(k[61],k[291]);
  const eyeMid=mid(leftOuter,rightOuter);
  const eyeSpan=Math.max(0.001,dist(leftOuter,rightOuter));
  const leftEar=eyeAspectRatio(k,[33,160,158,133,153,144]);
  const rightEar=eyeAspectRatio(k,[362,385,387,263,373,380]);
  return {
    yaw:(nose.x-eyeMid.x)/eyeSpan,
    pitch:(nose.y-eyeMid.y)/Math.max(0.001,mouthMid.y-eyeMid.y),
    ear:(leftEar+rightEar)/2,
    leftEar,
    rightEar,
  };
}

export function blendshapeBlink(result){
  const cats=result?.faceBlendshapes?.[0]?.categories||[];
  let left=0,right=0;
  for(const c of cats){
    const name=c.categoryName||c.displayName||'';
    const score=Number(c.score)||0;
    if(name==='eyeBlinkLeft')left=score;
    if(name==='eyeBlinkRight')right=score;
  }
  return {left,right,avg:(left+right)/2};
}

export function createAttentionState(){
  return {eyesClosedSince:null,awaySince:null,faceMissingSince:null};
}

export function resetAttentionState(state){
  state.eyesClosedSince=null;
  state.awaySince=null;
  state.faceMissingSince=null;
  return state;
}

const persistent=(start,now,dwell)=>start!=null&&now-start>=dwell;

export function evaluateAttention({hasFace,signals,blink,baseline,now,state,limits=DEFAULT_DETECTION}){
  const reasons=[];
  const diagnostics={
    yawDelta:0,pitchDelta:0,blinkAvg:Number(blink?.avg)||0,ear:Number(signals?.ear)||0,
    rawEyesClosed:false,rawAway:false,eyesClosedForMs:0,awayForMs:0,missingForMs:0,
    blinkThreshold:0,earThreshold:0,
  };

  if(!hasFace||!signals||!baseline){
    if(state.faceMissingSince==null)state.faceMissingSince=now;
    state.eyesClosedSince=null;
    state.awaySince=null;
    diagnostics.missingForMs=now-state.faceMissingSince;
    if(persistent(state.faceMissingSince,now,limits.missingDwellMs))reasons.push('face missing');
    return {reasons,diagnostics};
  }

  state.faceMissingSince=null;
  const yawDelta=Math.abs(signals.yaw-baseline.yaw);
  const pitchDelta=Math.abs(signals.pitch-baseline.pitch);
  const blinkThreshold=clamp(Math.max(limits.blinkFloor,(baseline.blink||0)+limits.blinkDelta),limits.blinkFloor,limits.blinkCeiling);
  const earThreshold=Math.max(0.03,(baseline.ear||0)*limits.earRatio);
  const blendshapeClosed=(Number(blink?.avg)||0)>=blinkThreshold || ((Number(blink?.left)||0)>0.52&&(Number(blink?.right)||0)>0.52);
  const geometricClosed=(baseline.ear||0)>0 && signals.ear>0 && signals.ear<earThreshold;
  const rawEyesClosed=blendshapeClosed||geometricClosed;
  const rawAway=yawDelta>limits.yawDeltaLimit||pitchDelta>limits.pitchDeltaLimit;

  diagnostics.yawDelta=yawDelta;
  diagnostics.pitchDelta=pitchDelta;
  diagnostics.blinkThreshold=blinkThreshold;
  diagnostics.earThreshold=earThreshold;
  diagnostics.rawEyesClosed=rawEyesClosed;
  diagnostics.rawAway=rawAway;

  if(rawEyesClosed){
    if(state.eyesClosedSince==null)state.eyesClosedSince=now;
  }else state.eyesClosedSince=null;

  if(rawAway){
    if(state.awaySince==null)state.awaySince=now;
  }else state.awaySince=null;

  diagnostics.eyesClosedForMs=state.eyesClosedSince==null?0:now-state.eyesClosedSince;
  diagnostics.awayForMs=state.awaySince==null?0:now-state.awaySince;

  const eyesClosed=persistent(state.eyesClosedSince,now,limits.eyeDwellMs);
  const lookingAway=persistent(state.awaySince,now,limits.awayDwellMs);
  if(eyesClosed)reasons.push('eyes closed');
  if(lookingAway)reasons.push(pitchDelta>limits.pitchDeltaLimit?'looking up/down':'head turned');

  return {reasons,diagnostics};
}
