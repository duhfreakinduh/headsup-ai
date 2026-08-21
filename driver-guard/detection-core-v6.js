export const DEFAULT_DETECTION = Object.freeze({
  eyeTriggerMs: 220,
  awayTriggerMs: 300,
  missingTriggerMs: 650,
  yawDeltaLimit: 0.065,
  pitchDeltaLimit: 0.095,
  blinkFloor: 0.32,
  blinkDelta: 0.12,
  blinkCeiling: 0.60,
  earRatio: 0.74,
  eyeDecay: 2.6,
  awayDecay: 1.8,
  missingDecay: 3.0,
  maxFrameMs: 140,
});

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const blend=(a,b,alpha)=>a+(b-a)*alpha;

function eyeAspectRatio(k,idx){
  const pts=idx.map(i=>k[i]);
  if(pts.some(p=>!p))return 0;
  const [p1,p2,p3,p4,p5,p6]=pts;
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
    leftEar,rightEar,
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
  return {lastNow:null,eyeEvidenceMs:0,awayEvidenceMs:0,missingEvidenceMs:0};
}

export function resetAttentionState(state){
  state.lastNow=null;
  state.eyeEvidenceMs=0;
  state.awayEvidenceMs=0;
  state.missingEvidenceMs=0;
  return state;
}

function stepEvidence(value,active,dt,decay,cap){
  return clamp(active?value+dt:value-dt*decay,0,cap);
}

export function evaluateAttention({hasFace,signals,blink,baseline,now,state,limits=DEFAULT_DETECTION}){
  const previous=state.lastNow;
  state.lastNow=now;
  const dt=previous==null?70:clamp(now-previous,16,limits.maxFrameMs);
  const diagnostics={
    yawDelta:0,pitchDelta:0,blinkAvg:Number(blink?.avg)||0,ear:Number(signals?.ear)||0,
    leftEar:Number(signals?.leftEar)||0,rightEar:Number(signals?.rightEar)||0,
    rawEyesClosed:false,rawAway:false,rawMissing:false,
    eyeEvidenceMs:state.eyeEvidenceMs,awayEvidenceMs:state.awayEvidenceMs,missingEvidenceMs:state.missingEvidenceMs,
    blinkThreshold:0,earThreshold:0,eyeRatio:1,leftEyeRatio:1,rightEyeRatio:1,
  };

  if(!hasFace||!signals||!baseline){
    state.eyeEvidenceMs=stepEvidence(state.eyeEvidenceMs,false,dt,limits.eyeDecay,limits.eyeTriggerMs*2);
    state.awayEvidenceMs=stepEvidence(state.awayEvidenceMs,false,dt,limits.awayDecay,limits.awayTriggerMs*2);
    state.missingEvidenceMs=stepEvidence(state.missingEvidenceMs,true,dt,1,limits.missingTriggerMs*2);
    diagnostics.rawMissing=true;
    diagnostics.eyeEvidenceMs=state.eyeEvidenceMs;
    diagnostics.awayEvidenceMs=state.awayEvidenceMs;
    diagnostics.missingEvidenceMs=state.missingEvidenceMs;
    return {reasons:state.missingEvidenceMs>=limits.missingTriggerMs?['face missing']:[],diagnostics};
  }

  state.missingEvidenceMs=stepEvidence(state.missingEvidenceMs,false,dt,limits.missingDecay,limits.missingTriggerMs*2);
  const yawDelta=Math.abs(signals.yaw-baseline.yaw);
  const pitchDelta=Math.abs(signals.pitch-baseline.pitch);
  const blinkThreshold=clamp(Math.max(limits.blinkFloor,(baseline.blink||0)+limits.blinkDelta),limits.blinkFloor,limits.blinkCeiling);
  const earThreshold=Math.max(0.035,(baseline.ear||0)*limits.earRatio);
  const leftBase=Math.max(0.03,baseline.leftEar||baseline.ear||0.2);
  const rightBase=Math.max(0.03,baseline.rightEar||baseline.ear||0.2);
  const leftRatio=signals.leftEar>0?signals.leftEar/leftBase:1;
  const rightRatio=signals.rightEar>0?signals.rightEar/rightBase:1;
  const eyeRatio=signals.ear>0&&baseline.ear>0?signals.ear/baseline.ear:1;
  const blendshapeClosed=(Number(blink?.avg)||0)>=blinkThreshold || ((Number(blink?.left)||0)>0.46&&(Number(blink?.right)||0)>0.46);
  const geometricClosed=(signals.ear>0&&signals.ear<earThreshold) || (leftRatio<0.76&&rightRatio<0.76) || eyeRatio<0.62;
  const rawEyesClosed=blendshapeClosed||geometricClosed;
  const rawAway=yawDelta>limits.yawDeltaLimit||pitchDelta>limits.pitchDeltaLimit;

  state.eyeEvidenceMs=stepEvidence(state.eyeEvidenceMs,rawEyesClosed,dt,limits.eyeDecay,limits.eyeTriggerMs*2.5);
  state.awayEvidenceMs=stepEvidence(state.awayEvidenceMs,rawAway,dt,limits.awayDecay,limits.awayTriggerMs*2.5);

  diagnostics.yawDelta=yawDelta;
  diagnostics.pitchDelta=pitchDelta;
  diagnostics.blinkThreshold=blinkThreshold;
  diagnostics.earThreshold=earThreshold;
  diagnostics.eyeRatio=eyeRatio;
  diagnostics.leftEyeRatio=leftRatio;
  diagnostics.rightEyeRatio=rightRatio;
  diagnostics.rawEyesClosed=rawEyesClosed;
  diagnostics.rawAway=rawAway;
  diagnostics.eyeEvidenceMs=state.eyeEvidenceMs;
  diagnostics.awayEvidenceMs=state.awayEvidenceMs;
  diagnostics.missingEvidenceMs=state.missingEvidenceMs;

  const reasons=[];
  if(state.eyeEvidenceMs>=limits.eyeTriggerMs)reasons.push('eyes closed');
  if(state.awayEvidenceMs>=limits.awayTriggerMs)reasons.push(pitchDelta>limits.pitchDeltaLimit?'looking up/down':'head turned');
  return {reasons,diagnostics};
}

export function adaptBaseline(baseline,signals,blink,diagnostics,alpha=0.012,limits=DEFAULT_DETECTION){
  if(!baseline||!signals||!diagnostics)return baseline;
  if(diagnostics.rawEyesClosed||diagnostics.rawAway)return baseline;
  if(diagnostics.yawDelta>limits.yawDeltaLimit*0.35||diagnostics.pitchDelta>limits.pitchDeltaLimit*0.35)return baseline;
  if((Number(blink?.avg)||0)>0.22)return baseline;
  return {
    yaw:blend(baseline.yaw,signals.yaw,alpha),
    pitch:blend(baseline.pitch,signals.pitch,alpha),
    blink:blend(baseline.blink||0,Number(blink?.avg)||0,alpha*0.5),
    ear:blend(baseline.ear||signals.ear,signals.ear,alpha*0.6),
    leftEar:blend(baseline.leftEar||signals.leftEar,signals.leftEar,alpha*0.6),
    rightEar:blend(baseline.rightEar||signals.rightEar,signals.rightEar,alpha*0.6),
  };
}
