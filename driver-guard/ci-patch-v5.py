from pathlib import Path

app=Path('driver-guard/app.js')
s=app.read_text()
if "./detection-core.js?v=5" in s and "let hfLib = null;" in s:
    print('v5 already applied')
    raise SystemExit(0)
old="""import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';\nimport { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm';\nimport { landmarkSignals, blendshapeBlink, createAttentionState, resetAttentionState, evaluateAttention } from './detection-core.js?v=4';\n\nenv.allowLocalModels = false;\nenv.useBrowserCache = true;\n"""
new="""import { landmarkSignals, blendshapeBlink, createAttentionState, resetAttentionState, evaluateAttention } from './detection-core.js?v=5';\n\nlet hfLib = null;\nlet mpLib = null;\n"""
if old not in s: raise SystemExit('expected v4 imports not found')
s=s.replace(old,new,1)

a=s.index('async function setupFaceModel(){'); b=s.index('async function setupPhoneModel(){',a)
s=s[:a]+"""async function setupFaceModel(){
  if(faceLandmarker)return;
  els.face.textContent='LOADING';els.faceDetail.textContent='Loading face runtime…';
  if(!mpLib)mpLib=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
  const {FaceLandmarker,FilesetResolver}=mpLib;
  els.faceDetail.textContent='Loading face WASM…';
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
  els.faceDetail.textContent='Downloading Hugging Face face model…';
  const modelResp=await fetch(HF_FACE_MODEL,{cache:'force-cache'});
  if(!modelResp.ok)throw new Error(`Hugging Face face model HTTP ${modelResp.status}`);
  const modelBytes=new Uint8Array(await modelResp.arrayBuffer());
  if(modelBytes.byteLength<1000000)throw new Error('Hugging Face face model download incomplete');
  const base={modelAssetBuffer:modelBytes};
  const opts={baseOptions:{...base,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:0.30,minFacePresenceConfidence:0.30,minTrackingConfidence:0.30,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:false};
  faceLandmarker=await FaceLandmarker.createFromOptions(vision,opts);
  els.face.textContent='MODEL READY';els.faceDetail.textContent='HF face model loaded';
}

"""+s[b:]

a=s.index('async function setupPhoneModel(){'); b=s.index('async function requestWakeLock(){',a)
s=s[:a]+"""async function setupPhoneModel(){
  if(phoneDetector||phoneModelLoading||!els.phoneToggle.checked)return;
  phoneModelLoading=true;els.phone.textContent='LOADING';els.phoneDetail.textContent='Loading Hugging Face runtime…';
  try{
    if(!hfLib){hfLib=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');hfLib.env.allowLocalModels=false;hfLib.env.useBrowserCache=true;}
    els.phoneDetail.textContent='Downloading HF YOLOS…';
    phoneDetector=await hfLib.pipeline('object-detection',HF_PHONE_MODEL,{dtype:'q8'});
    els.phone.textContent='READY';els.phoneDetail.textContent='HF YOLOS Tiny';
  }catch(err){console.error(err);els.phone.textContent='OFFLINE';els.phoneDetail.textContent=`HF phone AI: ${err?.message||'load failed'}`;}
  finally{phoneModelLoading=false;}
}

"""+s[b:]
s=s.replace('const img=RawImage.fromCanvas(c);','const img=hfLib.RawImage.fromCanvas(c);')
s=s.replace("els.cameraMessage.textContent='Could not start. Allow camera + location, then reload.';\n    els.reason.textContent=err?.message||'Camera/Hugging Face model error';","els.cameraMessage.textContent='START FAILED — see error below';\n    els.face.textContent='ERROR';\n    els.faceDetail.textContent=err?.message||'Face AI failed';\n    els.reason.textContent=err?.message||'Camera/Hugging Face model error';")
s=s.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=4').catch(()=>{});","window.addEventListener('error',e=>{if(!running){const m=e.message||'unknown';els.reason.textContent='App error: '+m;els.faceDetail.textContent=m;}});\nwindow.addEventListener('unhandledrejection',e=>{if(!running){const m=e.reason?.message||String(e.reason||'unknown');els.reason.textContent='Load error: '+m;els.faceDetail.textContent=m;}});\nif('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=5').catch(()=>{});")
app.write_text(s)

index=Path('driver-guard/index.html'); i=index.read_text().replace('styles.css?v=4','styles.css?v=5').replace('app.js?v=4','app.js?v=5'); index.write_text(i)
sw=Path('driver-guard/sw.js'); w=sw.read_text().replace('driver-guard-v4','driver-guard-v5').replace("'./styles.css?v=4','./app.js?v=4','./detection-core.js?v=4'","'./styles.css?v=5','./app.js?v=5','./detection-core.js?v=5'"); sw.write_text(w)
for need in ["detection-core.js?v=5","await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm')","await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1')","modelAssetBuffer:modelBytes","START FAILED"]:
    if need not in s: raise SystemExit('missing '+need)
if "import { pipeline" in s or "import { FaceLandmarker" in s: raise SystemExit('external static import remains')
