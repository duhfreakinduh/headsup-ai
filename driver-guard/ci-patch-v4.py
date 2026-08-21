from pathlib import Path

app=Path('driver-guard/app.js')
s=app.read_text()

s=s.replace("import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm';", "import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm';\nimport { landmarkSignals, blendshapeBlink, createAttentionState, resetAttentionState, evaluateAttention } from './detection-core.js?v=4';")

if 'function landmarkMetrics(k)' in s:
    a=s.index('function landmarkMetrics(k) {')
    b=s.index('function setState(kind, status, reason) {')
    s=s[:a]+s[b:]

s=s.replace("let baseline = null;\nlet eyesClosedSince = null;\nlet awaySince = null;\nlet faceMissingSince = null;", "let baseline = null;\nlet attentionState = createAttentionState();")
for line in ["const EYE_DWELL_MS = 420;\n","const AWAY_DWELL_MS = 500;\n","const MISSING_DWELL_MS = 700;\n","const YAW_DELTA_LIMIT = 0.10;\n","const PITCH_DELTA_LIMIT = 0.14;\n"]:
    s=s.replace(line,'')
s=s.replace("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm", "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm")
s=s.replace("blink:mean(calibration,'blink')\n  };", "blink:mean(calibration,'blink'),\n    ear:mean(calibration,'ear')\n  };")
s=s.replace("function resetDwell(){\n  eyesClosedSince=null;awaySince=null;faceMissingSince=null;\n}\n\nfunction persistent(startValue, now, dwellMs){\n  return startValue!=null && now-startValue>=dwellMs;\n}\n", "function resetDwell(){\n  resetAttentionState(attentionState);\n}\n")
s=s.replace("const blink=blinkScore(result);\n    const metrics=hasFace?landmarkMetrics(landmarks):null;", "const blink=blendshapeBlink(result);\n    const signals=hasFace?landmarkSignals(landmarks):null;")
s=s.replace("if(hasFace&&metrics){\n        calibration.push({yaw:metrics.yaw,pitch:metrics.pitch,blink:blink.avg});", "if(hasFace&&signals){\n        calibration.push({yaw:signals.yaw,pitch:signals.pitch,blink:blink.avg,ear:signals.ear});")
s=s.replace("els.faceDetail.textContent=`Blink ${Math.round(blink.avg*100)}%`;", "els.faceDetail.textContent=`HF blink ${Math.round(blink.avg*100)}% · eye ratio ${signals.ear.toFixed(2)}`;")

marker="    const now=performance.now();\n    const reasons=[];"
phone="    if(els.phoneToggle.checked&&Date.now()<phoneSeenUntil)reasons.push('phone visible');"
if marker in s:
    a=s.index(marker,s.index('async function faceStep'))
    b=s.index(phone,a)
    block="""    const now=performance.now();
    const attention=evaluateAttention({hasFace,signals,blink,baseline,now,state:attentionState});
    const reasons=[...attention.reasons];
    const d=attention.diagnostics;

    if(!hasFace||!signals){
      els.face.textContent='NO FACE';
      els.faceDetail.textContent=`HF model running · missing ${Math.round(d.missingForMs)} ms`;
      drawFace(null);
    }else{
      const danger=reasons.includes('eyes closed')||reasons.includes('head turned')||reasons.includes('looking up/down');
      els.face.textContent=danger?'DISTRACTED':'OK';
      els.faceDetail.textContent=`HF blink ${Math.round(d.blinkAvg*100)}% · eye ${d.ear.toFixed(2)} · yaw Δ${d.yawDelta.toFixed(2)} · pitch Δ${d.pitchDelta.toFixed(2)}`;
      drawFace(landmarks,danger);
    }

"""
    s=s[:a]+block+s[b:]

s=s.replace("navigator.serviceWorker.register('./sw.js?v=3')","navigator.serviceWorker.register('./sw.js?v=4')")

required=[
    '@mediapipe/tasks-vision@0.10.21/+esm',
    "./detection-core.js?v=4",
    'evaluateAttention({hasFace,signals,blink,baseline,now,state:attentionState})',
]
for item in required:
    if item not in s:
        raise SystemExit(f'patch verification failed: {item}')
if '@mediapipe/tasks-vision@0.10.22' in s:
    raise SystemExit('old invalid MediaPipe version remains')
app.write_text(s)

index=Path('driver-guard/index.html')
i=index.read_text().replace('styles.css?v=3','styles.css?v=4').replace('app.js?v=3','app.js?v=4')
index.write_text(i)

sw=Path('driver-guard/sw.js')
w=sw.read_text().replace("driver-guard-v3","driver-guard-v4").replace("'./styles.css?v=3','./app.js?v=3'","'./styles.css?v=4','./app.js?v=4','./detection-core.js?v=4'")
sw.write_text(w)
