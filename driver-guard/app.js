import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm';
import { landmarkSignals, blendshapeBlink, createAttentionState, resetAttentionState, evaluateAttention } from './detection-core.js?v=4';

env.allowLocalModels = false;
env.useBrowserCache = true;

const HF_FACE_MODEL = 'https://huggingface.co/abiral1011/skin_detect/resolve/main/face_landmarker.task';
const HF_PHONE_MODEL = 'Xenova/yolos-tiny';

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'), overlay: $('overlay'), snapshot: $('snapshot'), cameraMessage: $('cameraMessage'), alertBanner: $('alertBanner'),
  start: $('startBtn'), stop: $('stopBtn'), test: $('testBtn'), status: $('statusText'), reason: $('reasonText'),
  face: $('faceText'), faceDetail: $('faceDetail'), phone: $('phoneText'), phoneDetail: $('phoneDetail'),
  warnDelay: $('warnDelay'), alarmDelay: $('alarmDelay'), warnOut: $('warnOut'), alarmOut: $('alarmOut'),
  phoneToggle: $('phoneToggle'), gpsToggle: $('gpsToggle'), gpsBadge: $('gpsBadge'),
  speed: $('speedText'), speedDetail: $('speedDetail'), distance: $('distanceText'), duration: $('durationText'), triggerCount: $('triggerCount'),
  eventList: $('eventList'), eventSummary: $('eventSummary'), followToggle: $('followToggle'), recenter: $('recenterBtn'), fitRoute: $('fitRouteBtn'),
  exportJson: $('exportJsonBtn'), exportGpx: $('exportGpxBtn'), history: $('tripHistory'), loadTrip: $('loadTripBtn'), deleteTrip: $('deleteTripBtn')
};

let stream = null;
let faceLandmarker = null;
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
let alarmLogged = false;
let goodSince = null;
let currentReasons = [];
let lastActiveReasons = [];
let lastReasonKey = '';
let lastReasonChangeAt = 0;

let calibration = [];
let baseline = null;
let attentionState = createAttentionState();

let map = null;
let routeLine = null;
let currentMarker = null;
let startMarker = null;
let endMarker = null;
let eventLayers = [];
let geoWatchId = null;
let lastLocation = null;
let trip = null;
let reviewTrip = null;
let tripTimer = null;
let lastPersistAt = 0;

const CALIBRATION_MS = 2800;
const FACE_INTERVAL_MS = 90;
const PHONE_INTERVAL_MS = 2300;
const PHONE_HOLD_MS = 2700;
const RESET_GOOD_MS = 450;


const EARTH_M = 6371000;
const DB_NAME = 'DriverGuardAI';
const DB_VERSION = 1;
const STORE_NAME = 'trips';

const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const mid = (a,b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
const mean = (arr,key) => arr.reduce((s,x)=>s+(Number(x[key])||0),0)/Math.max(1,arr.length);
const mph = (mps) => Number.isFinite(mps) ? mps * 2.236936 : 0;
const miles = (meters) => meters / 1609.344;
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const nowIso = () => new Date().toISOString();

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

function drawFace(landmarks, danger=false) {
  const c = els.overlay, ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  if (!landmarks?.length) return;

  let minX=1,minY=1,maxX=0,maxY=0;
  for (const p of landmarks) {
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
  }
  ctx.lineWidth=Math.max(3,c.width/180);
  ctx.strokeStyle=danger?'#ff435a':'#35e08a';
  ctx.strokeRect(minX*c.width,minY*c.height,(maxX-minX)*c.width,(maxY-minY)*c.height);
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function speakWarning(reasons=[]) {
  let text='Eyes on the road.';
  if (reasons.includes('eyes closed')) text='Eyes open. Wake up.';
  else if (reasons.includes('phone visible')) text='Put the phone down. Eyes on the road.';
  try {
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.rate=1.05; u.pitch=0.95; u.volume=1;
    speechSynthesis.speak(u);
  } catch {}
  try { navigator.vibrate?.([220,90,220]); } catch {}
}

function alarmPulse() {
  ensureAudio();
  if (!audioCtx) return;
  const now=audioCtx.currentTime;
  const osc=audioCtx.createOscillator();
  const gain=audioCtx.createGain();
  osc.type='sawtooth';
  osc.frequency.setValueAtTime(1060,now);
  osc.frequency.linearRampToValueAtTime(620,now+0.32);
  osc.frequency.linearRampToValueAtTime(1060,now+0.66);
  gain.gain.setValueAtTime(0.0001,now);
  gain.gain.exponentialRampToValueAtTime(0.9,now+0.02);
  gain.gain.setValueAtTime(0.9,now+0.68);
  gain.gain.exponentialRampToValueAtTime(0.0001,now+0.9);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now); osc.stop(now+0.92);
  try { navigator.vibrate?.([400,100,400]); } catch {}
}

function startSiren() {
  if (sirenTimer) return;
  alarmPulse();
  sirenTimer=setInterval(alarmPulse,1000);
}

function stopSiren() {
  if (sirenTimer) clearInterval(sirenTimer);
  sirenTimer=null;
}

function initMap() {
  if (map || !window.L) return;
  map=L.map('tripMap',{zoomControl:true,preferCanvas:true}).setView([39.5,-98.35],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  routeLine=L.polyline([],{color:'#5cb8ff',weight:5,opacity:.88}).addTo(map);
  map.on('dragstart zoomstart',()=>{if(running) els.followToggle.checked=false;});
}

function clearMapLayers() {
  if (!map) return;
  routeLine?.setLatLngs([]);
  if(currentMarker)map.removeLayer(currentMarker);
  if(startMarker)map.removeLayer(startMarker);
  if(endMarker)map.removeLayer(endMarker);
  eventLayers.forEach(layer=>map.removeLayer(layer));
  currentMarker=startMarker=endMarker=null;
  eventLayers=[];
}

function haversine(a,b) {
  const toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lng-a.lng);
  const la1=toRad(a.lat),la2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*EARTH_M*Math.asin(Math.sqrt(h));
}

function formatDuration(ms) {
  const sec=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function eventColor(severity) {
  return ({trigger:'#b392f0',warning:'#ffcc4d',alarm:'#ff435a',recovery:'#35e08a',info:'#5cb8ff'})[severity]||'#5cb8ff';
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function activeTrip(){return trip||reviewTrip;}

function updateTripStats(){
  const t=activeTrip();
  if(!t){
    els.speed.textContent='0 mph';els.distance.textContent='0.00 mi';els.duration.textContent='00:00';els.triggerCount.textContent='0';
    els.eventSummary.textContent='No events yet';return;
  }
  const endMs=t.endedAt?Date.parse(t.endedAt):Date.now();
  const startMs=Date.parse(t.startedAt);
  const lastPoint=t.route?.[t.route.length-1];
  const speedMps=running&&lastLocation?lastLocation.speedMps:(lastPoint?.speedMps||0);
  els.speed.textContent=`${Math.round(mph(speedMps))} mph`;
  els.speedDetail.textContent=lastLocation?.accuracy?`±${Math.round(lastLocation.accuracy*3.28084)} ft GPS accuracy`:'GPS speed';
  els.distance.textContent=`${miles(t.stats?.distanceMeters||0).toFixed(2)} mi`;
  els.duration.textContent=formatDuration(endMs-startMs);
  els.triggerCount.textContent=String((t.events||[]).filter(e=>e.severity&&e.severity!=='info').length);
  els.eventSummary.textContent=`${(t.events||[]).length} events • ${(t.route||[]).length} GPS points`;
}

function makePointFromPosition(pos){
  const c=pos.coords;
  return{
    lat:c.latitude,lng:c.longitude,
    accuracy:Number.isFinite(c.accuracy)?c.accuracy:null,
    altitude:Number.isFinite(c.altitude)?c.altitude:null,
    altitudeAccuracy:Number.isFinite(c.altitudeAccuracy)?c.altitudeAccuracy:null,
    heading:Number.isFinite(c.heading)?c.heading:null,
    speedMps:Number.isFinite(c.speed)?Math.max(0,c.speed):null,
    time:new Date(pos.timestamp||Date.now()).toISOString()
  };
}

function handlePosition(pos){
  if(!trip||!els.gpsToggle.checked)return;
  const p=makePointFromPosition(pos);
  const prev=trip.route[trip.route.length-1];
  if(prev&&p.speedMps==null){
    const dt=(Date.parse(p.time)-Date.parse(prev.time))/1000;
    if(dt>0)p.speedMps=haversine(prev,p)/dt;
  }
  p.speedMps=clamp(Number(p.speedMps)||0,0,90);
  lastLocation=p;
  els.gpsBadge.textContent=p.accuracy!=null?`GPS ±${Math.round(p.accuracy*3.28084)} ft`:'GPS active';
  els.gpsBadge.classList.remove('subtle');
  els.recenter.disabled=false;

  let accept=true;
  if(prev){
    const segment=haversine(prev,p);
    const dt=Math.max(1,(Date.parse(p.time)-Date.parse(prev.time))/1000);
    if(segment>Math.max(120,dt*75))accept=false;
    if(accept&&segment>1.5)trip.stats.distanceMeters+=segment;
  }
  if(accept){
    trip.route.push(p);
    trip.stats.maxSpeedMps=Math.max(trip.stats.maxSpeedMps||0,p.speedMps||0);
    drawRoutePoint(p);
  }
  updateTripStats();
  if(Date.now()-lastPersistAt>30000){
    lastPersistAt=Date.now();
    saveTripToDb(trip).catch(()=>{});
  }
}

function handleLocationError(err){
  const messages={1:'GPS permission denied',2:'GPS unavailable',3:'GPS timed out'};
  els.gpsBadge.textContent=messages[err?.code]||'GPS error';
  els.gpsBadge.classList.add('subtle');
  if(trip)addTripEvent('gps_error',messages[err?.code]||'GPS error',[],'info',false);
}

function drawRoutePoint(p){
  if(!map)return;
  const latlng=[p.lat,p.lng];
  routeLine.addLatLng(latlng);
  if(!startMarker)startMarker=L.circleMarker(latlng,{radius:7,color:'#35e08a',fillColor:'#35e08a',fillOpacity:1,weight:2}).addTo(map).bindPopup('Drive start');
  if(!currentMarker)currentMarker=L.circleMarker(latlng,{radius:7,color:'#fff',fillColor:'#5cb8ff',fillOpacity:1,weight:2}).addTo(map);
  else currentMarker.setLatLng(latlng);
  if(els.followToggle.checked)map.setView(latlng,Math.max(map.getZoom(),15),{animate:false});
  els.fitRoute.disabled=trip.route.length<2;
}

function startLocationTracking(){
  if(!trip||!els.gpsToggle.checked){els.gpsBadge.textContent='GPS off';return;}
  if(!navigator.geolocation){els.gpsBadge.textContent='GPS unsupported';return;}
  els.gpsBadge.textContent='Requesting GPS…';
  geoWatchId=navigator.geolocation.watchPosition(handlePosition,handleLocationError,{
    enableHighAccuracy:true,maximumAge:1000,timeout:12000
  });
}

function stopLocationTracking(){
  if(geoWatchId!=null)navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId=null;
  if(lastLocation&&map&&trip){
    endMarker=L.circleMarker([lastLocation.lat,lastLocation.lng],{radius:7,color:'#fff',fillColor:'#ff435a',fillOpacity:1,weight:2}).addTo(map).bindPopup('Drive end');
  }
}

function newTrip(){
  reviewTrip=null;
  trip={
    version:3,
    id:`trip-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    startedAt:nowIso(),endedAt:null,route:[],events:[],
    stats:{distanceMeters:0,maxSpeedMps:0},
    settings:{
      warningSeconds:Number(els.warnDelay.value),
      alarmSeconds:Number(els.alarmDelay.value),
      phoneDetection:els.phoneToggle.checked,
      gpsTracking:els.gpsToggle.checked,
      faceModel:'abiral1011/skin_detect:face_landmarker.task',
      phoneModel:HF_PHONE_MODEL
    }
  };
  lastLocation=null;
  clearMapLayers();
  renderEvents(trip);
  addTripEvent('trip_start','Drive started',[],'info',false);
  els.exportJson.disabled=true;els.exportGpx.disabled=true;
  updateTripStats();
  clearInterval(tripTimer);
  tripTimer=setInterval(updateTripStats,1000);
}

function locationSnapshot(){return lastLocation?{...lastLocation}:null;}

function addTripEvent(type,label,reasons=[],severity='trigger',addMarker=true){
  if(!trip)return;
  const event={
    id:`evt-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type,label,severity,reasons:[...reasons],time:nowIso(),location:locationSnapshot()
  };
  trip.events.push(event);
  renderEvent(event);
  if(addMarker&&event.location)addEventMarker(event);
  updateTripStats();
  if(severity==='warning'||severity==='alarm')saveTripToDb(trip).catch(()=>{});
}

function addEventMarker(event){
  if(!map||!event.location)return;
  const p=event.location;
  const marker=L.circleMarker([p.lat,p.lng],{
    radius:event.severity==='alarm'?9:7,color:'#06101c',weight:2,
    fillColor:eventColor(event.severity),fillOpacity:1
  }).addTo(map);
  const reasonText=event.reasons?.length?`<br>${escapeHtml(event.reasons.join(', '))}`:'';
  const speedText=Number.isFinite(p.speedMps)?`<br>${Math.round(mph(p.speedMps))} mph`:'';
  marker.bindPopup(`<strong>${escapeHtml(event.label)}</strong>${reasonText}${speedText}<br>${new Date(event.time).toLocaleTimeString()}`);
  eventLayers.push(marker);
}

function renderEvent(event){
  if(els.eventList.querySelector('.empty-event'))els.eventList.innerHTML='';
  const li=document.createElement('li');li.dataset.eventId=event.id;
  const icon=document.createElement('span');icon.className=`event-icon ${event.severity||'info'}`;
  const copy=document.createElement('div');copy.className='event-copy';
  const title=document.createElement('strong');title.textContent=event.label;
  const details=document.createElement('small');
  const parts=[];
  if(event.reasons?.length)parts.push(event.reasons.join(' • '));
  if(event.location?.speedMps!=null)parts.push(`${Math.round(mph(event.location.speedMps))} mph`);
  if(event.location?.accuracy!=null)parts.push(`GPS ±${Math.round(event.location.accuracy*3.28084)} ft`);
  if(!event.location&&event.severity!=='info')parts.push('location unavailable');
  details.textContent=parts.join(' · ')||event.type.replaceAll('_',' ');
  copy.append(title,details);
  const time=document.createElement('time');time.dateTime=event.time;time.textContent=new Date(event.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
  li.append(icon,copy,time);els.eventList.prepend(li);
}

function renderEvents(t){
  els.eventList.innerHTML='';
  if(!t?.events?.length){els.eventList.innerHTML='<li class="empty-event">No events recorded.</li>';return;}
  [...t.events].reverse().forEach(renderEvent);
}

function evaluate(reasons){
  const now=performance.now();
  const warnMs=Number(els.warnDelay.value)*1000;
  const alarmMs=Math.max(Number(els.alarmDelay.value)*1000,warnMs+500);
  const reasonKey=[...reasons].sort().join('|');

  if(!reasons.length){
    if(!goodSince)goodSince=now;
    if(now-goodSince>=RESET_GOOD_MS){
      if(distractedSince!=null)addTripEvent('recovered','Attention restored',lastActiveReasons,'recovery');
      distractedSince=null;warningSent=false;alarmLogged=false;lastReasonKey='';
      stopSiren();setState('good','ATTENTIVE','No distraction detected');
    }
    currentReasons=[];
    return;
  }

  currentReasons=[...reasons];
  lastActiveReasons=[...reasons];
  goodSince=null;
  if(distractedSince==null){
    distractedSince=now;lastReasonKey=reasonKey;lastReasonChangeAt=now;
    addTripEvent('distraction_start','Distraction detected',reasons,'trigger');
  }else if(reasonKey!==lastReasonKey&&now-lastReasonChangeAt>800){
    lastReasonKey=reasonKey;lastReasonChangeAt=now;
    addTripEvent('trigger_change','Trigger changed',reasons,'trigger');
  }

  const elapsed=now-distractedSince;
  const label=reasons.join(' • ');
  if(elapsed>=alarmMs){
    if(!warningSent){
      speakWarning(reasons);warningSent=true;
      addTripEvent('warning','Spoken warning',reasons,'warning');
    }
    if(!alarmLogged){
      alarmLogged=true;addTripEvent('alarm','Loud distraction alarm',reasons,'alarm');
    }
    startSiren();setState('alarm','ALARM',label);
  }else if(elapsed>=warnMs){
    if(!warningSent){
      speakWarning(reasons);warningSent=true;
      addTripEvent('warning','Spoken warning',reasons,'warning');
    }
    setState('warn','WARNING',label);
  }else{
    setState('warn','CHECKING',label);
  }
}

async function setupFaceModel(){
  if(faceLandmarker)return;
  els.face.textContent='LOADING';
  els.faceDetail.textContent='Downloading HF face model…';

  const vision=await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
  );

  const options={
    baseOptions:{modelAssetPath:HF_FACE_MODEL,delegate:'GPU'},
    runningMode:'VIDEO',
    numFaces:1,
    minFaceDetectionConfidence:0.45,
    minFacePresenceConfidence:0.45,
    minTrackingConfidence:0.45,
    outputFaceBlendshapes:true,
    outputFacialTransformationMatrixes:true
  };

  try{
    faceLandmarker=await FaceLandmarker.createFromOptions(vision,options);
  }catch(err){
    console.warn('GPU face model failed, retrying CPU',err);
    options.baseOptions={modelAssetPath:HF_FACE_MODEL,delegate:'CPU'};
    faceLandmarker=await FaceLandmarker.createFromOptions(vision,options);
  }
}

async function setupPhoneModel(){
  if(phoneDetector||phoneModelLoading||!els.phoneToggle.checked)return;
  phoneModelLoading=true;
  els.phone.textContent='LOADING';
  els.phoneDetail.textContent='Downloading HF YOLOS…';
  try{
    phoneDetector=await pipeline('object-detection',HF_PHONE_MODEL,{dtype:'q8'});
    els.phone.textContent='READY';
    els.phoneDetail.textContent='HF YOLOS Tiny';
  }catch(err){
    console.error(err);
    els.phone.textContent='OFFLINE';
    els.phoneDetail.textContent='HF phone AI unavailable';
  }finally{phoneModelLoading=false;}
}

async function requestWakeLock(){
  try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}
}

async function startCamera(){
  stream=await navigator.mediaDevices.getUserMedia({
    audio:false,
    video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}
  });
  els.video.srcObject=stream;
  await els.video.play();
  resizeOverlay();
}

function finishCalibration(){
  if(calibration.length<8)return false;
  baseline={
    yaw:mean(calibration,'yaw'),
    pitch:mean(calibration,'pitch'),
    blink:mean(calibration,'blink'),
    ear:mean(calibration,'ear')
  };
  monitoring=true;
  els.cameraMessage.classList.add('hidden');
  els.face.textContent='READY';
  els.faceDetail.textContent=`HF face ready · blink base ${Math.round(baseline.blink*100)}%`;
  addTripEvent('calibrated','Driver pose calibrated',[],'info',false);
  setState('good','ATTENTIVE','Calibration complete');
  return true;
}

function resetDwell(){
  resetAttentionState(attentionState);
}

async function faceStep(ts){
  if(!running||faceBusy||ts-lastFaceRun<FACE_INTERVAL_MS||els.video.readyState<2)return;
  faceBusy=true;lastFaceRun=ts;
  try{
    const result=faceLandmarker.detectForVideo(els.video,ts);
    const landmarks=result?.faceLandmarks?.[0];
    const hasFace=Boolean(landmarks?.length);
    const blink=blendshapeBlink(result);
    const signals=hasFace?landmarkSignals(landmarks):null;

    if(!monitoring){
      if(hasFace&&signals){
        calibration.push({yaw:signals.yaw,pitch:signals.pitch,blink:blink.avg,ear:signals.ear});
        drawFace(landmarks,false);
        const elapsed=Math.min(CALIBRATION_MS,ts-(window.__calStart||ts));
        els.cameraMessage.textContent=`Look straight ahead with eyes open — calibrating ${Math.round(elapsed/CALIBRATION_MS*100)}%`;
        els.face.textContent='CALIBRATE';
        els.faceDetail.textContent=`HF blink ${Math.round(blink.avg*100)}% · eye ratio ${signals.ear.toFixed(2)}`;
        if(elapsed>=CALIBRATION_MS)finishCalibration();
      }else{
        window.__calStart=ts;calibration=[];
        els.cameraMessage.textContent='Center your face in the camera';
        els.face.textContent='NO FACE';els.faceDetail.textContent='HF face model cannot see you';
      }
      return;
    }

    const now=performance.now();
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

    if(els.phoneToggle.checked&&Date.now()<phoneSeenUntil)reasons.push('phone visible');
    evaluate(reasons);
  }catch(err){
    console.error('HF face inference error',err);
    els.face.textContent='ERROR';
    els.faceDetail.textContent='HF face AI retrying';
  }finally{faceBusy=false;}
}

async function phoneStep(ts){
  if(!running||!monitoring||!els.phoneToggle.checked||!phoneDetector||phoneBusy||ts-lastPhoneRun<PHONE_INTERVAL_MS||els.video.readyState<2)return;
  phoneBusy=true;lastPhoneRun=ts;
  try{
    const c=els.snapshot,ctx=c.getContext('2d',{willReadFrequently:true});
    const aspect=els.video.videoWidth/els.video.videoHeight||4/3;
    c.width=320;c.height=Math.round(320/aspect);
    ctx.drawImage(els.video,0,0,c.width,c.height);
    const img=RawImage.fromCanvas(c);
    const result=await phoneDetector(img,{threshold:0.42});
    const hit=result.find(x=>String(x.label).toLowerCase()==='cell phone'&&x.score>=0.42);
    if(hit){
      const newlySeen=Date.now()>=phoneSeenUntil;
      phoneSeenUntil=Date.now()+PHONE_HOLD_MS;
      els.phone.textContent='PHONE';
      els.phoneDetail.textContent=`HF ${Math.round(hit.score*100)}% confidence`;
      if(newlySeen)addTripEvent('phone_detected',`Phone detected (${Math.round(hit.score*100)}%)`,['phone visible'],'trigger');
    }else{
      phoneSeenUntil=0;
      els.phone.textContent='CLEAR';
      els.phoneDetail.textContent='HF YOLOS: no phone';
    }
  }catch(err){
    console.error('HF phone inference error',err);
    els.phone.textContent='RETRY';
    els.phoneDetail.textContent='HF phone scan delayed';
  }finally{phoneBusy=false;}
}

function loop(ts){
  if(!running)return;
  faceStep(ts);
  phoneStep(ts);
  requestAnimationFrame(loop);
}

async function startMonitoring(){
  if(running)return;
  if(!navigator.mediaDevices?.getUserMedia){
    els.cameraMessage.textContent='Camera access is not supported in this browser.';return;
  }
  ensureAudio();initMap();newTrip();
  els.start.disabled=true;
  els.cameraMessage.classList.remove('hidden');
  els.cameraMessage.textContent='Starting camera + GPS…';

  try{
    startLocationTracking();
    await startCamera();
    els.cameraMessage.textContent='Loading Hugging Face face AI…';
    await setupFaceModel();

    running=true;monitoring=false;calibration=[];baseline=null;window.__calStart=performance.now();
    distractedSince=null;warningSent=false;alarmLogged=false;phoneSeenUntil=0;lastReasonKey='';lastActiveReasons=[];
    goodSince=null;resetDwell();

    els.stop.disabled=false;
    els.face.textContent='CALIBRATE';
    els.faceDetail.textContent='HF model · look straight ahead';
    els.cameraMessage.textContent='Look straight ahead with eyes open — calibrating 0%';
    setState('good','CALIBRATING','Hugging Face face model learning your forward pose');
    requestWakeLock();
    if(els.phoneToggle.checked)setupPhoneModel();
    requestAnimationFrame(loop);
  }catch(err){
    console.error(err);
    stopLocationTracking();
    if(trip){
      trip.endedAt=nowIso();
      addTripEvent('start_error','Could not start camera/AI',[],'info',false);
      saveTripToDb(trip).catch(()=>{});
      reviewTrip=trip;trip=null;
    }
    clearInterval(tripTimer);tripTimer=null;
    els.start.disabled=false;
    els.cameraMessage.textContent='Could not start. Allow camera + location, then reload.';
    els.reason.textContent=err?.message||'Camera/Hugging Face model error';
  }
}

async function stopMonitoring(){
  if(!trip&&!running)return;
  running=false;monitoring=false;resetDwell();stopSiren();speechSynthesis?.cancel?.();
  stopLocationTracking();
  stream?.getTracks().forEach(t=>t.stop());stream=null;els.video.srcObject=null;
  wakeLock?.release?.().catch(()=>{});wakeLock=null;
  clearInterval(tripTimer);tripTimer=null;

  if(trip){
    addTripEvent('trip_end','Drive stopped and saved',[],'info',false);
    trip.endedAt=nowIso();
    await saveTripToDb(trip).catch(err=>console.warn('Trip save failed',err));
    reviewTrip=trip;trip=null;await refreshHistory();
  }

  els.start.disabled=false;els.stop.disabled=true;
  els.cameraMessage.classList.remove('hidden');els.cameraMessage.textContent='Drive saved — tap Start drive while parked';
  els.overlay.getContext('2d').clearRect(0,0,els.overlay.width,els.overlay.height);
  els.face.textContent='—';els.faceDetail.textContent='HF face model waiting';
  els.exportJson.disabled=!reviewTrip;els.exportGpx.disabled=!reviewTrip;
  els.gpsBadge.textContent='Drive saved';els.gpsBadge.classList.add('subtle');
  updateTripStats();setState('good','READY','Drive saved locally');
}

async function testAlerts(){
  ensureAudio();els.test.disabled=true;
  setState('warn','TEST WARNING','Voice + vibration');
  speakWarning(['eyes closed']);
  await new Promise(r=>setTimeout(r,1200));
  setState('alarm','TEST ALARM','Siren + vibration');
  alarmPulse();
  await new Promise(r=>setTimeout(r,1200));
  stopSiren();
  if(running)setState('good','ATTENTIVE','Test complete');else setState('good','READY','Test complete');
  els.test.disabled=false;
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB'in window))return reject(new Error('IndexedDB unavailable'));
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE_NAME)){
        const store=db.createObjectStore(STORE_NAME,{keyPath:'id'});
        store.createIndex('startedAt','startedAt');
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function saveTripToDb(t){
  if(!t)return;
  const db=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).put(structuredClone(t));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

async function listTripsFromDb(){
  const db=await openDb();
  const trips=await new Promise((resolve,reject)=>{
    const req=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
  });
  db.close();
  return trips.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
}

async function getTripFromDb(id){
  const db=await openDb();
  const value=await new Promise((resolve,reject)=>{
    const req=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).get(id);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
  });
  db.close();return value;
}

async function deleteTripFromDb(id){
  const db=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

async function refreshHistory(){
  let trips=[];
  try{trips=await listTripsFromDb();}catch{}
  els.history.innerHTML='';
  if(!trips.length){
    els.history.innerHTML='<option value="">No saved drives yet</option>';
    els.loadTrip.disabled=true;els.deleteTrip.disabled=true;return;
  }
  const empty=document.createElement('option');empty.value='';empty.textContent='Choose a saved drive…';els.history.append(empty);
  trips.slice(0,30).forEach(t=>{
    const o=document.createElement('option');o.value=t.id;
    const date=new Date(t.startedAt);
    o.textContent=`${date.toLocaleDateString()} ${date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} — ${miles(t.stats?.distanceMeters||0).toFixed(1)} mi — ${(t.events||[]).filter(e=>e.severity&&e.severity!=='info').length} marks`;
    els.history.append(o);
  });
}

function showTripOnMap(t){
  initMap();clearMapLayers();reviewTrip=t;trip=null;lastLocation=null;
  const latlngs=(t.route||[]).map(p=>[p.lat,p.lng]);
  routeLine.setLatLngs(latlngs);
  if(latlngs.length){
    startMarker=L.circleMarker(latlngs[0],{radius:7,color:'#35e08a',fillColor:'#35e08a',fillOpacity:1,weight:2}).addTo(map).bindPopup('Drive start');
    endMarker=L.circleMarker(latlngs[latlngs.length-1],{radius:7,color:'#fff',fillColor:'#ff435a',fillOpacity:1,weight:2}).addTo(map).bindPopup('Drive end');
    if(latlngs.length>1)map.fitBounds(routeLine.getBounds(),{padding:[24,24]});else map.setView(latlngs[0],16);
  }
  (t.events||[]).forEach(e=>{if(e.location&&e.severity!=='info')addEventMarker(e);});
  renderEvents(t);updateTripStats();
  els.exportJson.disabled=false;els.exportGpx.disabled=false;
  els.fitRoute.disabled=latlngs.length<2;els.recenter.disabled=latlngs.length===0;
  els.gpsBadge.textContent='Saved drive loaded';els.gpsBadge.classList.add('subtle');
}

function xmlEscape(value=''){
  return String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
}

function tripToGpx(t){
  const pts=(t.route||[]).map(p=>`<trkpt lat="${p.lat}" lon="${p.lng}">${p.altitude!=null?`<ele>${p.altitude}</ele>`:''}<time>${xmlEscape(p.time)}</time>${p.speedMps!=null?`<extensions><speed>${p.speedMps.toFixed(3)}</speed></extensions>`:''}</trkpt>`).join('');
  const wpts=(t.events||[]).filter(e=>e.location).map(e=>`<wpt lat="${e.location.lat}" lon="${e.location.lng}"><time>${xmlEscape(e.time)}</time><name>${xmlEscape(e.label)}</name><desc>${xmlEscape((e.reasons||[]).join(', '))}</desc><type>${xmlEscape(e.severity||e.type)}</type></wpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Driver Guard AI" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Driver Guard AI trip</name><time>${xmlEscape(t.startedAt)}</time></metadata>${wpts}<trk><name>Drive route</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

function downloadBlob(name,content,type){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function exportTripJson(){
  const t=activeTrip();if(!t)return;
  const stamp=t.startedAt.slice(0,19).replaceAll(':','-');
  downloadBlob(`driver-guard-${stamp}.json`,JSON.stringify(t,null,2),'application/json');
}
function exportTripGpx(){
  const t=activeTrip();if(!t)return;
  const stamp=t.startedAt.slice(0,19).replaceAll(':','-');
  downloadBlob(`driver-guard-${stamp}.gpx`,tripToGpx(t),'application/gpx+xml');
}

els.warnDelay.addEventListener('input',()=>els.warnOut.textContent=`${Number(els.warnDelay.value).toFixed(1)} s`);
els.alarmDelay.addEventListener('input',()=>els.alarmOut.textContent=`${Number(els.alarmDelay.value).toFixed(1)} s`);
els.phoneToggle.addEventListener('change',()=>{
  if(!els.phoneToggle.checked){phoneSeenUntil=0;els.phone.textContent='OFF';els.phoneDetail.textContent='Disabled';}
  else{
    els.phone.textContent=phoneDetector?'READY':'—';
    els.phoneDetail.textContent=phoneDetector?'HF YOLOS Tiny':'Loads after Start';
    if(running)setupPhoneModel();
  }
});
els.gpsToggle.addEventListener('change',()=>{
  if(!running){els.gpsBadge.textContent=els.gpsToggle.checked?'GPS waiting':'GPS off';return;}
  if(els.gpsToggle.checked&&geoWatchId==null)startLocationTracking();
  if(!els.gpsToggle.checked){stopLocationTracking();els.gpsBadge.textContent='GPS off';}
});
els.followToggle.addEventListener('change',()=>{if(els.followToggle.checked&&lastLocation&&map)map.setView([lastLocation.lat,lastLocation.lng],Math.max(map.getZoom(),15));});
els.recenter.addEventListener('click',()=>{
  const p=lastLocation||activeTrip()?.route?.at(-1);if(p&&map)map.setView([p.lat,p.lng],Math.max(map.getZoom(),15));
});
els.fitRoute.addEventListener('click',()=>{
  const t=activeTrip();if(!map||!t?.route?.length)return;
  const latlngs=t.route.map(p=>[p.lat,p.lng]);
  if(latlngs.length>1)map.fitBounds(L.latLngBounds(latlngs),{padding:[24,24]});else map.setView(latlngs[0],16);
});
els.exportJson.addEventListener('click',exportTripJson);
els.exportGpx.addEventListener('click',exportTripGpx);
els.history.addEventListener('change',()=>{
  const yes=Boolean(els.history.value);els.loadTrip.disabled=!yes||running;els.deleteTrip.disabled=!yes||running;
});
els.loadTrip.addEventListener('click',async()=>{
  const t=await getTripFromDb(els.history.value).catch(()=>null);if(t)showTripOnMap(t);
});
els.deleteTrip.addEventListener('click',async()=>{
  const id=els.history.value;if(!id||running)return;
  await deleteTripFromDb(id).catch(()=>{});
  if(reviewTrip?.id===id){
    reviewTrip=null;clearMapLayers();renderEvents(null);updateTripStats();els.exportJson.disabled=true;els.exportGpx.disabled=true;
  }
  await refreshHistory();
});
els.start.addEventListener('click',startMonitoring);
els.stop.addEventListener('click',stopMonitoring);
els.test.addEventListener('click',testAlerts);
window.addEventListener('resize',()=>{resizeOverlay();setTimeout(()=>map?.invalidateSize(),50);});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&running){requestWakeLock();map?.invalidateSize();}
});

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=4').catch(()=>{});
initMap();refreshHistory();
setState('good','READY','Monitoring is off');
els.faceDetail.textContent='HF face model waiting';
els.phoneDetail.textContent='HF YOLOS loads after Start';
updateTripStats();
