import assert from 'node:assert/strict';
import test from 'node:test';
import {createAttentionState,evaluateAttention,resetAttentionState,adaptBaseline} from './detection-core-v6.js';
const baseline={yaw:0,pitch:0,blink:0.04,ear:0.30,leftEar:0.30,rightEar:0.30};
const open={yaw:0,pitch:0,ear:0.30,leftEar:0.30,rightEar:0.30};
const closed={yaw:0,pitch:0,ear:0.08,leftEar:0.08,rightEar:0.08};
const turned={yaw:0.10,pitch:0.01,ear:0.30,leftEar:0.30,rightEar:0.30};
const blinkOpen={left:0.04,right:0.04,avg:0.04};
const blinkClosed={left:0.75,right:0.77,avg:0.76};
const run=(st,now,signals=open,blink=blinkOpen,hasFace=true)=>evaluateAttention({hasFace,signals,blink,baseline,now,state:st});

test('attentive face stays clear',()=>{const s=createAttentionState();for(let t=0;t<1200;t+=70)assert.deepEqual(run(s,t).reasons,[]);});
test('100ms blink is ignored',()=>{const s=createAttentionState();run(s,0);run(s,70,closed,blinkClosed);assert.deepEqual(run(s,140,closed,blinkClosed).reasons,[]);assert.deepEqual(run(s,210,open,blinkOpen).reasons,[]);});
test('sustained closed eyes triggers quickly',()=>{const s=createAttentionState();run(s,0);run(s,70,closed,blinkClosed);run(s,140,closed,blinkClosed);run(s,210,closed,blinkClosed);assert.ok(run(s,280,closed,blinkClosed).reasons.includes('eyes closed'));});
test('intermittent bad eye frames still accumulate evidence',()=>{const s=createAttentionState();run(s,0);run(s,70,closed,blinkClosed);run(s,140,closed,blinkClosed);run(s,210,open,blinkOpen);run(s,280,closed,blinkClosed);run(s,350,closed,blinkClosed);assert.ok(run(s,420,closed,blinkClosed).diagnostics.eyeEvidenceMs>150);});
test('head turn triggers after evidence',()=>{const s=createAttentionState();run(s,0);for(let t=70;t<=420;t+=70)run(s,t,turned,blinkOpen);assert.ok(run(s,490,turned,blinkOpen).reasons.includes('head turned'));});
test('missing face triggers and recovers',()=>{const s=createAttentionState();run(s,0);for(let t=70;t<=700;t+=70)run(s,t,null,blinkOpen,false);assert.ok(run(s,770,null,blinkOpen,false).reasons.includes('face missing'));for(let t=840;t<=1190;t+=70)run(s,t,open,blinkOpen,true);assert.deepEqual(run(s,1260,open,blinkOpen,true).reasons,[]);});
test('adaptive baseline moves only while attentive',()=>{const d={rawEyesClosed:false,rawAway:false,yawDelta:0.01,pitchDelta:0.01};const b=adaptBaseline(baseline,{...open,yaw:0.01,pitch:0.01},blinkOpen,d,0.02);assert.ok(b.yaw>0&&b.yaw<0.01);const frozen=adaptBaseline(baseline,turned,blinkOpen,{...d,rawAway:true},0.02);assert.equal(frozen,baseline);});
test('reset clears evidence',()=>{const s=createAttentionState();run(s,0);run(s,70,closed,blinkClosed);resetAttentionState(s);assert.equal(s.eyeEvidenceMs,0);assert.equal(s.awayEvidenceMs,0);assert.equal(s.missingEvidenceMs,0);});
