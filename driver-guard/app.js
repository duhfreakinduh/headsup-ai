import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'), overlay: $('overlay'), snapshot: $('snapshot'), cameraMessage: $('cameraMessage'), alertBanner: $('alertBanner'),
  start: $('startBtn'), stop: $('stopBtn'), test: $('testBtn'), status: $('statusText'), reason: $('reasonText'),
  face: $('faceText'), faceDetail: $('faceDetail'), phone: $('phoneText'), phoneDetail: $('phoneDetail'),
  warnDelay: $('warnDelay'), alarmDelay: $('alarmDelay'), warnOut: $('warnOut'), alarmOut: $('alarmOut'), phoneToggle: $('phoneToggle')
};

let stream = null;
let faceDetector = null;
let phoneDetector = null;
let phoneModelLoading = false;
let running = false;
let monitoring = false;
let faceBusy = false;
let phoneBusy = false;
let lastFaceRun = 0;
let lastPhoneRun = 0;
let phoneSeenUntil = 0;
let wakeLock = null;
let audioCtx = null;
let sirenTimer = null;
let distractedSince = null;
let warningSent = false;
let calibration = [];
let baseline = null;
let goodSince = null;
let currentReasons = [];

const CALIBRATION_MS = 2600;
const FACE_INTERVAL_MS = 120;
const PHONE_INTERVAL_MS = 2600;
const PHONE_HOLD_MS = 2800;
const RESET_GOOD_MS = 500;

const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const mid = (a,b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
const mean = (arr,key) => arr.reduce((s,x)=>s+x[key],0)/Math.max(1,arr.length);

function eyeRatio(k, idx) {
  const [p1,p2,p3,p4,p5,p6] = idx.map(i => k[i]);
  return (dist(p2,p6)+dist(p3,p5))/(2*Math.max(1,dist(p1,p4)));
}

function faceMetrics(face) {
  const k = face.keypoints;
  if (!k || k.length < 292) return null;
  const leftOuter = k[33], rightOuter = k[263], nose = k[1];
  const mouthMid = mid(k[61], k[291]);
  const eyeMid = mid(leftOuter, rightOuter);
  const eyeSpan = Math.max(1, dist(leftOuter, rightOuter));
  const yaw = (nose.x-eyeMid.x)/eyeSpan;
  const pitch = (nose.y-eyeMid.y)/Math.max(1, mouthMid.y-eyeMid.y);
  const leftEar = eyeRatio(k,[33,160,158,133,153,144]);
  const rightEar = eyeRatio(k,[362,385,387,263,373,380]);
  return { yaw, pitch, eye:(leftEar+rightEar)/2 };
}

function setState(kind, status, reason) {
  document.body.classList.remove('state-good','state-warn','state-alarm');
  document.body.classList.add(`state-${kind}`);
  els.status.textContent = status;
  els.reason.textContent = reason;
  els.alertBanner.classList.toggle('hidden', kind === 'good');
  els.alertBanner.textContent = kind === 'alarm' ? 'DISTRACTION — ALARM' : 'EYES ON THE ROAD';
}

function resizeOverlay() {
  const rect = els.video.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  els.overlay.width = Math.round(rect.width*dpr);
  els.overlay.height = Math.round(rect.height*dpr);
}

function drawFace(face, danger=false) {
  const c = els.overlay, ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  if (!face?.box || !els.video.videoWidth) return;
  const sx = c.width/els.video.videoWidth, sy = c.height/els.video.videoHeight;
  const b = face.box;
  ctx.lineWidth = Math.max(3, c.width/180);
  ctx.strokeStyle = danger ? '#ff435a' : '#35e08a';
  ctx.strokeRect(b.xMin*sx,b.yMin*sy,b.width*sx,b.height*sy);
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function speakWarning() {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('Eyes on the road.');
    u.rate = 1.05; u.pitch = 0.95; u.volume = 1;
    speechSynthesis.speak(u);
  } catch {}
  try { navigator.vibrate?.([180,100,180]); } catch {}
}

function alarmPulse() {
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(980,now);
  osc.frequency.linearRampToValueAtTime(620,now+0.35);
  osc.frequency.linearRampToValueAtTime(980,now+0.72);
  gain.gain.setValueAtTime(0.0001,now);
  gain.gain.exponentialRampToValueAtTime(0.82,now+0.025);
  gain.gain.setValueAtTime(0.82,now+0.72);
  gain.gain.exponentialRampToValueAtTime(0.0001,now+0.9);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now); osc.stop(now+0.92);
  try { navigator.vibrate?.([350,120,350]); } catch {}
}

function startSiren() {
  if (sirenTimer) return;
  alarmPulse();
  sirenTimer = setInterval(alarmPulse, 1050);
}

function stopSiren() {
  if (sirenTimer) clearInterval(sirenTimer);
  sirenTimer = null;
}

function evaluate(reasons) {
  currentReasons = reasons;
  const now = performance.now();
  const warnMs = Number(els.warnDelay.value)*1000;
  const alarmMs = Math.max(Number(els.alarmDelay.value)*1000, warnMs+600);

  if (!reasons.length) {
    if (!goodSince) goodSince = now;
    if (now-goodSince >= RESET_GOOD_MS) {
      distractedSince = null; warningSent = false; stopSiren();
      setState('good','ATTENTIVE','No distraction detected');
    }
    return;
  }

  goodSince = null;
  if (distractedSince == null) distractedSince = now;
  const elapsed = now-distractedSince;
  const label = reasons.join(' • ');

  if (elapsed >= alarmMs) {
    if (!warningSent) { speakWarning(); warningSent = true; }
    startSiren();
    setState('alarm','ALARM',label);
  } else if (elapsed >= warnMs) {
    if (!warningSent) { speakWarning(); warningSent = true; }
    setState('warn','WARNING',label);
  } else {
    setState('warn','CHECKING',label);
  }
}

async function setupFaceModel() {
  if (faceDetector) return;
  els.face.textContent = 'LOADING';
  els.faceDetail.textContent = 'Face landmark AI';
  await tf.ready();
  try { await tf.setBackend('webgl'); } catch {}
  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  faceDetector = await faceLandmarksDetection.createDetector(model,{runtime:'tfjs',maxFaces:1,refineLandmarks:true});
}

async function setupPhoneModel() {
  if (phoneDetector || phoneModelLoading || !els.phoneToggle.checked) return;
  phoneModelLoading = true;
  els.phone.textContent = 'LOADING';
  els.phoneDetail.textContent = 'Hugging Face model';
  try {
    phoneDetector = await pipeline('object-detection','Xenova/yolos-tiny',{dtype:'q8'});
    els.phone.textContent = 'READY';
    els.phoneDetail.textContent = 'YOLOS Tiny on-device';
  } catch (err) {
    console.error(err);
    els.phone.textContent = 'OFFLINE';
    els.phoneDetail.textContent = 'Phone AI unavailable';
  } finally { phoneModelLoading = false; }
}

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio:false,
    video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}
  });
  els.video.srcObject = stream;
  await els.video.play();
  resizeOverlay();
}

function finishCalibration() {
  if (calibration.length < 5) return false;
  baseline = {yaw:mean(calibration,'yaw'),pitch:mean(calibration,'pitch'),eye:mean(calibration,'eye')};
  monitoring = true;
  els.cameraMessage.classList.add('hidden');
  els.face.textContent = 'READY';
  els.faceDetail.textContent = 'Forward pose learned';
  setState('good','ATTENTIVE','Calibration complete');
  return true;
}

async function faceStep(ts) {
  if (!running || faceBusy || ts-lastFaceRun < FACE_INTERVAL_MS || els.video.readyState < 2) return;
  faceBusy = true; lastFaceRun = ts;
  try {
    const faces = await faceDetector.estimateFaces(els.video,{flipHorizontal:false});
    const face = faces[0];

    if (!monitoring) {
      if (face) {
        const m = faceMetrics(face);
        if (m) calibration.push(m);
        drawFace(face,false);
        const elapsed = Math.min(CALIBRATION_MS, ts-(window.__calStart || ts));
        els.cameraMessage.textContent = `Look straight ahead — calibrating ${Math.round(elapsed/CALIBRATION_MS*100)}%`;
        if (elapsed >= CALIBRATION_MS) finishCalibration();
      } else {
        window.__calStart = ts;
        calibration = [];
        els.cameraMessage.textContent = 'Center your face in the camera';
        els.face.textContent = 'NO FACE';
      }
      return;
    }

    const reasons = [];
    if (!face) {
      els.face.textContent = 'NO FACE';
      els.faceDetail.textContent = 'Driver not visible';
      reasons.push('face missing');
      drawFace(null);
    } else {
      const m = faceMetrics(face);
      if (m) {
        const yawDelta = Math.abs(m.yaw-baseline.yaw);
        const pitchDelta = Math.abs(m.pitch-baseline.pitch);
        const eyesClosed = m.eye < baseline.eye*0.58;
        const lookingAway = yawDelta > 0.19 || pitchDelta > 0.22;
        if (eyesClosed) reasons.push('eyes closed');
        if (lookingAway) reasons.push(pitchDelta > 0.22 ? 'looking up/down' : 'head turned');
        els.face.textContent = eyesClosed || lookingAway ? 'DISTRACTED' : 'OK';
        els.faceDetail.textContent = eyesClosed ? 'Eyes closed' : lookingAway ? 'Not facing forward' : 'Face forward';
        drawFace(face,eyesClosed||lookingAway);
      }
    }

    if (els.phoneToggle.checked && Date.now() < phoneSeenUntil) reasons.push('phone visible');
    evaluate(reasons);
  } catch (err) {
    console.error('Face inference error',err);
    els.face.textContent = 'ERROR';
    els.faceDetail.textContent = 'Face AI retrying';
  } finally { faceBusy = false; }
}

async function phoneStep(ts) {
  if (!running || !monitoring || !els.phoneToggle.checked || !phoneDetector || phoneBusy || ts-lastPhoneRun < PHONE_INTERVAL_MS || els.video.readyState < 2) return;
  phoneBusy = true; lastPhoneRun = ts;
  try {
    const c = els.snapshot, ctx = c.getContext('2d',{willReadFrequently:true});
    const aspect = els.video.videoWidth/els.video.videoHeight || 4/3;
    c.width = 320; c.height = Math.round(320/aspect);
    ctx.drawImage(els.video,0,0,c.width,c.height);
    const img = RawImage.fromCanvas(c);
    const result = await phoneDetector(img,{threshold:0.48});
    const hit = result.find(x => String(x.label).toLowerCase() === 'cell phone' && x.score >= 0.48);
    if (hit) {
      phoneSeenUntil = Date.now()+PHONE_HOLD_MS;
      els.phone.textContent = 'PHONE';
      els.phoneDetail.textContent = `${Math.round(hit.score*100)}% confidence`;
    } else {
      phoneSeenUntil = 0;
      els.phone.textContent = 'CLEAR';
      els.phoneDetail.textContent = 'No phone visible';
    }
  } catch (err) {
    console.error('Phone inference error',err);
    els.phone.textContent = 'RETRY';
    els.phoneDetail.textContent = 'Phone scan delayed';
  } finally { phoneBusy = false; }
}

function loop(ts) {
  if (!running) return;
  faceStep(ts);
  phoneStep(ts);
  requestAnimationFrame(loop);
}

async function startMonitoring() {
  if (running) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    els.cameraMessage.textContent = 'Camera access is not supported in this browser.';
    return;
  }
  ensureAudio();
  els.start.disabled = true;
  els.cameraMessage.classList.remove('hidden');
  els.cameraMessage.textContent = 'Starting camera…';
  try {
    await startCamera();
    els.cameraMessage.textContent = 'Loading face AI…';
    await setupFaceModel();
    running = true; monitoring = false; calibration=[]; baseline=null; window.__calStart=performance.now();
    distractedSince=null; warningSent=false; phoneSeenUntil=0;
    els.stop.disabled = false;
    els.face.textContent = 'CALIBRATE';
    els.faceDetail.textContent = 'Look straight ahead';
    els.cameraMessage.textContent = 'Look straight ahead — calibrating 0%';
    setState('good','CALIBRATING','Learn your normal forward pose');
    requestWakeLock();
    if (els.phoneToggle.checked) setupPhoneModel();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    els.start.disabled = false;
    els.cameraMessage.textContent = 'Could not start. Allow camera permission and use HTTPS.';
    els.reason.textContent = err?.message || 'Camera/model error';
  }
}

function stopMonitoring() {
  running=false; monitoring=false; stopSiren(); speechSynthesis?.cancel?.();
  stream?.getTracks().forEach(t=>t.stop()); stream=null; els.video.srcObject=null;
  wakeLock?.release?.().catch(()=>{}); wakeLock=null;
  els.start.disabled=false; els.stop.disabled=true;
  els.cameraMessage.classList.remove('hidden'); els.cameraMessage.textContent='Tap Start while parked';
  els.overlay.getContext('2d').clearRect(0,0,els.overlay.width,els.overlay.height);
  els.face.textContent='—'; els.faceDetail.textContent='Waiting';
  setState('good','READY','Monitoring is off');
}

async function testAlerts() {
  ensureAudio();
  els.test.disabled=true;
  setState('warn','TEST WARNING','Voice + vibration');
  speakWarning();
  await new Promise(r=>setTimeout(r,1200));
  setState('alarm','TEST ALARM','Siren + vibration');
  alarmPulse();
  await new Promise(r=>setTimeout(r,1200));
  stopSiren();
  if (running) setState('good','ATTENTIVE','Test complete'); else setState('good','READY','Test complete');
  els.test.disabled=false;
}

els.warnDelay.addEventListener('input',()=>els.warnOut.textContent=`${Number(els.warnDelay.value).toFixed(1)} s`);
els.alarmDelay.addEventListener('input',()=>els.alarmOut.textContent=`${Number(els.alarmDelay.value).toFixed(1)} s`);
els.phoneToggle.addEventListener('change',()=>{
  if (!els.phoneToggle.checked) { phoneSeenUntil=0; els.phone.textContent='OFF'; els.phoneDetail.textContent='Disabled'; }
  else { els.phone.textContent=phoneDetector?'READY':'—'; els.phoneDetail.textContent=phoneDetector?'YOLOS Tiny on-device':'Loads after Start'; if(running) setupPhoneModel(); }
});
els.start.addEventListener('click',startMonitoring);
els.stop.addEventListener('click',stopMonitoring);
els.test.addEventListener('click',testAlerts);
window.addEventListener('resize',resizeOverlay);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && running) requestWakeLock(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
setState('good','READY','Monitoring is off');
