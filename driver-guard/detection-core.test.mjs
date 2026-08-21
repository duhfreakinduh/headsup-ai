import assert from 'node:assert/strict';
import test from 'node:test';
import {createAttentionState,evaluateAttention,resetAttentionState} from './detection-core.js';
const baseline={yaw:0,pitch:0,blink:0.05,ear:0.25};
const open={yaw:0,pitch:0,ear:0.25};
const closed={yaw:0,pitch:0,ear:0.10};
const blinkOpen={left:0.05,right:0.05,avg:0.05};
const blinkClosed={left:0.8,right:0.82,avg:0.81};
function evalAt(state,now,signals=open,blink=blinkOpen,hasFace=true){return evaluateAttention({hasFace,signals,blink,baseline,now,state});}

test('normal attentive face does not trigger',()=>{
  const st=createAttentionState();
  assert.deepEqual(evalAt(st,0).reasons,[]);
  assert.deepEqual(evalAt(st,1000).reasons,[]);
});

test('normal quick blink is ignored',()=>{
  const st=createAttentionState();
  assert.deepEqual(evalAt(st,0,closed,blinkClosed).reasons,[]);
  assert.deepEqual(evalAt(st,200,closed,blinkClosed).reasons,[]);
  assert.deepEqual(evalAt(st,220,open,blinkOpen).reasons,[]);
});

test('sustained closed eyes triggers using geometric fallback',()=>{
  const st=createAttentionState();
  evalAt(st,0,closed,blinkOpen);
  assert.deepEqual(evalAt(st,299,closed,blinkOpen).reasons,[]);
  assert.ok(evalAt(st,301,closed,blinkOpen).reasons.includes('eyes closed'));
});

test('sustained closed eyes triggers using HF blendshape signal',()=>{
  const st=createAttentionState();
  evalAt(st,0,open,blinkClosed);
  assert.ok(evalAt(st,301,open,blinkClosed).reasons.includes('eyes closed'));
});

test('head turn triggers after dwell',()=>{
  const st=createAttentionState();
  const turned={yaw:0.12,pitch:0.01,ear:0.25};
  evalAt(st,0,turned,blinkOpen);
  assert.deepEqual(evalAt(st,340,turned,blinkOpen).reasons,[]);
  assert.ok(evalAt(st,351,turned,blinkOpen).reasons.includes('head turned'));
});

test('face missing triggers and recovery clears dwell',()=>{
  const st=createAttentionState();
  evalAt(st,0,null,blinkOpen,false);
  assert.deepEqual(evalAt(st,499,null,blinkOpen,false).reasons,[]);
  assert.ok(evalAt(st,501,null,blinkOpen,false).reasons.includes('face missing'));
  resetAttentionState(st);
  assert.deepEqual(evalAt(st,502,open,blinkOpen,true).reasons,[]);
});
