import { landmarkSignals, blendshapeBlink, createAttentionState, resetAttentionState, evaluateAttention } from './detection-core.js?v=5';

const HF_FACE_MODEL='https://huggingface.co/abiral1011/skin_detect/resolve/main/face_landmarker.task';
const HF_PHONE_MODEL='Xenova/yolos-tiny';
const $=id=>document.getElementById(id);
const els={
  video:$('video'),overlay:$('overlay'),snapshot:$('snapshot'),cameraMessage:$('cameraMessage'),alertBanner:$('alertBanner'),
  start:$('startBtn'),stop:$('stopBtn'),test:$('testBtn'),status:$('statusText'),reason:$('reasonText'),face:$('faceText'),faceDetail:$('faceDetail'),phone:$('phoneText'),phoneDetail:$('phoneDetail'),
  warnDelay:$('warnDelay'),alarmDelay:$('alarmDelay'),warnOut:$('warnOut'),alarmOut:$('alarmOut'),phoneToggle:$('phoneToggle'),gpsToggle:$('gpsToggle'),gpsBadge:$('gpsBadge'),
  speed:$('speedText'),speedDetail:$('speedDetail'),distance:$('distanceText'),duration:$('durationText'),triggerCount:$('triggerCount'),eventList:$('eventList'),eventSummary:$('eventSummary'),
  follow:$('followToggle'),recenter:$('recenterBtn'),fitRoute:$('fitRouteBtn'),exportJson:$('exportJsonBtn'),exportGpx:$('exportGpxBtn'),history:$('tripHistory'),loadTrip:$('loadTripBtn'),deleteTrip:$('deleteTripBtn')
};

let mp=null,hf=null,faceLandmarker=null,phoneDetector=null,stream=null,audioCtx=null,sirenTimer=null,wakeLock=null;
let running=false,calibrated=false,faceBusy=false,phoneBusy=false,lastFaceRun=0,lastPhoneRun=0,phoneSeenUntil=0;
let calibration=[],baseline=null,attention=createAttentionState(),missingSince=null,precalEyesSince=null;
let distractedSince=null,warningSent=false,alarmLogged=false,goodSince=null,lastReasons=[];
let map=null,routeLine=null,currentMarker=null,startMarker=null,endMarker=null,eventLayers=[];
let watchId=null,lastLocation=null,trip=null,reviewTrip=null,tripTimer=null,lastPersist=0;

const FACE_INTERVAL=100,PHONE_INTERVAL=2600,CAL_MS=2200,NO_FACE_PROTECT_MS=1200,EYE_PRECAL_MS=350,GOOD_RESET_MS=450;
const EARTH=6371000;
const nowIso=()=>new Date().toISOString();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mph=mps=>Number.isFinite(mps)?mps*2.236936:0;
const miles=m=>m/1609.344;
const mean=(arr,key)=>arr.reduce((s,x)=>s+(Number(x[key])||0),0)/Math.max(1,arr.length);

function setState(kind,status,reason){
  document.body.classList.remove('state-good','state-warn','state-alarm');
  document.body.classList.add(`state-${kind}`);els.status.textContent=status;els.reason.textContent=reason;
  els.alertBanner.classList.toggle('hidden',kind==='good');els.alertBanner.textContent=kind==='alarm'?'DISTRACTION — ALARM':'EYES ON THE ROAD';
}
function ensureAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});}
function speak(reasons=[]){
  const text=reasons.includes('eyes closed')?'Eyes open. Wake up.':reasons.includes('phone visible')?'Put the phone down. Eyes on the road.':'Eyes on the road.';
  try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.volume=1;u.rate=1.05;speechSynthesis.speak(u);}catch{}
  try{navigator.vibrate?.([250,90,250]);}catch{}
}
function alarmPulse(){ensureAudio();if(!audioCtx)return;const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(1100,t);o.frequency.linearRampToValueAtTime(620,t+.34);o.frequency.linearRampToValueAtTime(1100,t+.7);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.9,t+.02);g.gain.setValueAtTime(.9,t+.72);g.gain.exponentialRampToValueAtTime(.0001,t+.92);o.connect(g).connect(audioCtx.destination);o.start(t);o.stop(t+.95);try{navigator.vibrate?.([450,100,450]);}catch{}}
function startSiren(){if(sirenTimer)return;alarmPulse();sirenTimer=setInterval(alarmPulse,1000);}
function stopSiren(){if(sirenTimer)clearInterval(sirenTimer);sirenTimer=null;}

function resizeOverlay(){const r=els.video.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);els.overlay.width=Math.round(r.width*d);els.overlay.height=Math.round(r.height*d);}
function drawFace(points,danger=false){const c=els.overlay,x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);if(!points?.length)return;let minX=1,minY=1,maxX=0,maxY=0;for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)}x.lineWidth=Math.max(3,c.width/180);x.strokeStyle=danger?'#ff435a':'#35e08a';x.strokeRect(minX*c.width,minY*c.height,(maxX-minX)*c.width,(maxY-minY)*c.height);}

async function loadFaceAI(){
  if(faceLandmarker)return;
  els.face.textContent='LOADING';els.faceDetail.textContent='Loading face runtime…';
  mp=mp||await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
  const vision=await mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
  els.faceDetail.textContent='Downloading Hugging Face face model…';
  const r=await fetch(HF_FACE_MODEL,{cache:'force-cache'});if(!r.ok)throw new Error(`HF face model HTTP ${r.status}`);
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.byteLength<1000000)throw new Error('HF face model download incomplete');
  faceLandmarker=await mp.FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetBuffer:bytes,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.3,minFacePresenceConfidence:.3,minTrackingConfidence:.3,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:false});
  els.face.textContent='MODEL READY';els.faceDetail.textContent='Hugging Face face model loaded';
}
async function loadPhoneAI(){
  if(phoneDetector||phoneBusy||!els.phoneToggle.checked)return;phoneBusy=true;els.phone.textContent='LOADING';els.phoneDetail.textContent='Loading Hugging Face YOLOS…';
  try{hf=hf||await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');hf.env.allowLocalModels=false;hf.env.useBrowserCache=true;phoneDetector=await hf.pipeline('object-detection',HF_PHONE_MODEL,{dtype:'q8'});els.phone.textContent='READY';els.phoneDetail.textContent='HF YOLOS Tiny';}
  catch(e){console.error(e);els.phone.textContent='OFFLINE';els.phoneDetail.textContent=e?.message||'Phone AI failed';}
  finally{phoneBusy=false;}
}
async function startCamera(){stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:960},height:{ideal:720},frameRate:{ideal:20,max:24}}});els.video.srcObject=stream;await els.video.play();resizeOverlay();}

function evaluateReasons(reasons){
  const now=performance.now(),warn=Number(els.warnDelay.value)*1000,alarm=Math.max(Number(els.alarmDelay.value)*1000,warn+500);
  if(!reasons.length){if(!goodSince)goodSince=now;if(now-goodSince>=GOOD_RESET_MS){if(distractedSince!=null)addEvent('recovered','Attention restored',lastReasons,'recovery');distractedSince=null;warningSent=false;alarmLogged=false;stopSiren();setState('good',calibrated?'ATTENTIVE':'PROTECTION','No active trigger');}return;}
  goodSince=null;lastReasons=[...reasons];if(distractedSince==null){distractedSince=now;addEvent('distraction_start','Distraction detected',reasons,'trigger');}
  const elapsed=now-distractedSince,label=reasons.join(' • ');
  if(elapsed>=alarm){if(!warningSent){speak(reasons);warningSent=true;addEvent('warning','Spoken warning',reasons,'warning');}if(!alarmLogged){alarmLogged=true;addEvent('alarm','Loud distraction alarm',reasons,'alarm');}startSiren();setState('alarm','ALARM',label);}
  else if(elapsed>=warn){if(!warningSent){speak(reasons);warningSent=true;addEvent('warning','Spoken warning',reasons,'warning');}setState('warn','WARNING',label);}
  else setState('warn','CHECKING',label);
}

async function faceStep(ts){
  if(!running||faceBusy||!faceLandmarker||ts-lastFaceRun<FACE_INTERVAL||els.video.readyState<2)return;faceBusy=true;lastFaceRun=ts;
  try{
    const result=faceLandmarker.detectForVideo(els.video,ts),points=result?.faceLandmarks?.[0],hasFace=Boolean(points?.length),blink=blendshapeBlink(result),signals=hasFace?landmarkSignals(points):null,now=performance.now();
    if(!hasFace||!signals){
      calibration=[];if(missingSince==null)missingSince=now;const ms=now-missingSince;els.face.textContent='NO FACE';els.faceDetail.textContent=`HF model running · missing ${Math.round(ms)} ms`;els.cameraMessage.textContent=calibrated?'Face lost — protection active':'Face not found — protection active';drawFace(null);
      evaluateReasons(ms>=NO_FACE_PROTECT_MS?['face missing']:[]);return;
    }
    missingSince=null;
    if(!calibrated){
      const rawClosed=blink.avg>.55||(signals.ear>0&&signals.ear<.18);if(rawClosed){if(precalEyesSince==null)precalEyesSince=now;}else precalEyesSince=null;
      const eyeDanger=precalEyesSince!=null&&now-precalEyesSince>=EYE_PRECAL_MS;if(eyeDanger){els.face.textContent='DISTRACTED';els.faceDetail.textContent=`Eyes closed before calibration · blink ${Math.round(blink.avg*100)}% · eye ${signals.ear.toFixed(2)}`;drawFace(points,true);evaluateReasons(['eyes closed']);return;}
      calibration.push({yaw:signals.yaw,pitch:signals.pitch,blink:blink.avg,ear:signals.ear,time:now});
      const first=calibration[0]?.time??now,elapsed=now-first,pct=Math.min(100,Math.round(elapsed/CAL_MS*100));els.face.textContent='CALIBRATE';els.faceDetail.textContent=`HF face found · blink ${Math.round(blink.avg*100)}% · eye ${signals.ear.toFixed(2)}`;els.cameraMessage.textContent=`Face found — look straight ahead ${pct}%`;drawFace(points,false);evaluateReasons([]);
      if(elapsed>=CAL_MS&&calibration.length>=8){baseline={yaw:mean(calibration,'yaw'),pitch:mean(calibration,'pitch'),blink:mean(calibration,'blink'),ear:mean(calibration,'ear')};calibrated=true;resetAttentionState(attention);els.cameraMessage.classList.add('hidden');addEvent('calibrated','Driver pose calibrated',[],'info',false);setState('good','ATTENTIVE','Calibration complete');}
      return;
    }
    const out=evaluateAttention({hasFace:true,signals,blink,baseline,now,state:attention}),reasons=[...out.reasons],d=out.diagnostics;if(els.phoneToggle.checked&&Date.now()<phoneSeenUntil)reasons.push('phone visible');const danger=reasons.length>0;els.face.textContent=danger?'DISTRACTED':'OK';els.faceDetail.textContent=`HF blink ${Math.round(d.blinkAvg*100)}% · eye ${d.ear.toFixed(2)} · yaw Δ${d.yawDelta.toFixed(2)} · pitch Δ${d.pitchDelta.toFixed(2)}`;drawFace(points,danger);evaluateReasons(reasons);
  }catch(e){console.error(e);els.face.textContent='ERROR';els.faceDetail.textContent=e?.message||'Face inference failed';evaluateReasons(['face missing']);}
  finally{faceBusy=false;}
}
async function phoneStep(ts){if(!running||!calibrated||!els.phoneToggle.checked||!phoneDetector||phoneBusy||ts-lastPhoneRun<PHONE_INTERVAL||els.video.readyState<2)return;phoneBusy=true;lastPhoneRun=ts;try{const c=els.snapshot,x=c.getContext('2d',{willReadFrequently:true}),a=els.video.videoWidth/els.video.videoHeight||4/3;c.width=320;c.height=Math.round(320/a);x.drawImage(els.video,0,0,c.width,c.height);const img=hf.RawImage.fromCanvas(c),res=await phoneDetector(img,{threshold:.42}),hit=res.find(v=>String(v.label).toLowerCase()==='cell phone'&&v.score>=.42);if(hit){phoneSeenUntil=Date.now()+2800;els.phone.textContent='PHONE';els.phoneDetail.textContent=`HF ${Math.round(hit.score*100)}% confidence`;addEvent('phone_detected','Phone detected',['phone visible'],'trigger');}else{els.phone.textContent='CLEAR';els.phoneDetail.textContent='HF YOLOS: no phone';}}catch(e){els.phone.textContent='RETRY';els.phoneDetail.textContent=e?.message||'Phone scan failed';}finally{phoneBusy=false;}}
function loop(ts){if(!running)return;faceStep(ts);phoneStep(ts);requestAnimationFrame(loop);}

function initMap(){if(map||!window.L)return;map=L.map('tripMap',{zoomControl:true,preferCanvas:true}).setView([39.5,-98.35],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);routeLine=L.polyline([],{color:'#5cb8ff',weight:5,opacity:.88}).addTo(map);map.on('dragstart zoomstart',()=>{if(running)els.follow.checked=false});}
function clearMap(){if(!map)return;routeLine?.setLatLngs([]);for(const m of [currentMarker,startMarker,endMarker,...eventLayers])if(m)map.removeLayer(m);currentMarker=startMarker=endMarker=null;eventLayers=[];}
function hav(a,b){const r=d=>d*Math.PI/180,dLat=r(b.lat-a.lat),dLon=r(b.lng-a.lng),la1=r(a.lat),la2=r(b.lat),h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*EARTH*Math.asin(Math.sqrt(h));}
function point(pos){const c=pos.coords;return{lat:c.latitude,lng:c.longitude,accuracy:Number.isFinite(c.accuracy)?c.accuracy:null,heading:Number.isFinite(c.heading)?c.heading:null,speedMps:Number.isFinite(c.speed)?Math.max(0,c.speed):null,time:new Date(pos.timestamp||Date.now()).toISOString()};}
function onPos(pos){if(!trip||!els.gpsToggle.checked)return;const p=point(pos),prev=trip.route.at(-1);if(prev&&p.speedMps==null){const dt=(Date.parse(p.time)-Date.parse(prev.time))/1000;if(dt>0)p.speedMps=hav(prev,p)/dt;}p.speedMps=clamp(Number(p.speedMps)||0,0,90);if(prev){const seg=hav(prev,p),dt=Math.max(1,(Date.parse(p.time)-Date.parse(prev.time))/1000);if(seg<=Math.max(120,dt*75)&&seg>1.5)trip.stats.distanceMeters+=seg;}trip.route.push(p);trip.stats.maxSpeedMps=Math.max(trip.stats.maxSpeedMps||0,p.speedMps||0);lastLocation=p;els.gpsBadge.textContent=p.accuracy?`GPS ±${Math.round(p.accuracy*3.28084)} ft`:'GPS active';drawRoute(p);updateStats();if(Date.now()-lastPersist>30000){lastPersist=Date.now();saveTrip(trip).catch(()=>{});}}
function onGeoErr(e){els.gpsBadge.textContent=({1:'GPS permission denied',2:'GPS unavailable',3:'GPS timeout'})[e?.code]||'GPS error';}
function startGPS(){if(!trip||!els.gpsToggle.checked||!navigator.geolocation)return;els.gpsBadge.textContent='Requesting GPS…';watchId=navigator.geolocation.watchPosition(onPos,onGeoErr,{enableHighAccuracy:true,maximumAge:1000,timeout:12000});}
function stopGPS(){if(watchId!=null)navigator.geolocation.clearWatch(watchId);watchId=null;if(lastLocation&&map&&trip)endMarker=L.circleMarker([lastLocation.lat,lastLocation.lng],{radius:7,color:'#fff',fillColor:'#ff435a',fillOpacity:1}).addTo(map).bindPopup('Drive end');}
function drawRoute(p){if(!map)return;const ll=[p.lat,p.lng];routeLine.addLatLng(ll);if(!startMarker)startMarker=L.circleMarker(ll,{radius:7,color:'#35e08a',fillColor:'#35e08a',fillOpacity:1}).addTo(map).bindPopup('Drive start');if(!currentMarker)currentMarker=L.circleMarker(ll,{radius:7,color:'#fff',fillColor:'#5cb8ff',fillOpacity:1}).addTo(map);else currentMarker.setLatLng(ll);if(els.follow.checked)map.setView(ll,Math.max(map.getZoom(),15),{animate:false});els.recenter.disabled=false;els.fitRoute.disabled=trip.route.length<2;}

function newTrip(){reviewTrip=null;trip={version:5,id:`trip-${Date.now()}`,startedAt:nowIso(),endedAt:null,route:[],events:[],stats:{distanceMeters:0,maxSpeedMps:0},settings:{warningSeconds:+els.warnDelay.value,alarmSeconds:+els.alarmDelay.value,phoneDetection:els.phoneToggle.checked,gpsTracking:els.gpsToggle.checked,faceModel:'HF face_landmarker.task',phoneModel:HF_PHONE_MODEL}};lastLocation=null;clearMap();renderEvents(trip);addEvent('trip_start','Drive started',[],'info',false);clearInterval(tripTimer);tripTimer=setInterval(updateStats,1000);updateStats();}
function addEvent(type,label,reasons=[],severity='trigger',marker=true){if(!trip)return;const ev={id:`e-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,type,label,reasons:[...reasons],severity,time:nowIso(),location:lastLocation?{...lastLocation}:null};trip.events.push(ev);renderEvent(ev);if(marker&&ev.location)addMarker(ev);updateStats();}
function addMarker(ev){if(!map||!ev.location)return;const color=({trigger:'#b392f0',warning:'#ffcc4d',alarm:'#ff435a',recovery:'#35e08a'})[ev.severity]||'#5cb8ff',m=L.circleMarker([ev.location.lat,ev.location.lng],{radius:ev.severity==='alarm'?9:7,color:'#06101c',weight:2,fillColor:color,fillOpacity:1}).addTo(map);m.bindPopup(`${ev.label}<br>${(ev.reasons||[]).join(', ')}<br>${new Date(ev.time).toLocaleTimeString()}`);eventLayers.push(m);}
function renderEvent(ev){if(els.eventList.querySelector('.empty-event'))els.eventList.innerHTML='';const li=document.createElement('li'),i=document.createElement('span'),copy=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small'),time=document.createElement('time');i.className=`event-icon ${ev.severity||'info'}`;strong.textContent=ev.label;small.textContent=[ev.reasons?.join(' • '),ev.location?.speedMps!=null?`${Math.round(mph(ev.location.speedMps))} mph`:null].filter(Boolean).join(' · ')||ev.type;copy.className='event-copy';copy.append(strong,small);time.textContent=new Date(ev.time).toLocaleTimeString();li.append(i,copy,time);els.eventList.prepend(li);}
function renderEvents(t){els.eventList.innerHTML='';if(!t?.events?.length){els.eventList.innerHTML='<li class="empty-event">No events recorded.</li>';return;}[...t.events].reverse().forEach(renderEvent);}
function updateStats(){const t=trip||reviewTrip;if(!t){els.speed.textContent='0 mph';els.distance.textContent='0.00 mi';els.duration.textContent='00:00';els.triggerCount.textContent='0';return;}const end=t.endedAt?Date.parse(t.endedAt):Date.now(),sec=Math.max(0,Math.floor((end-Date.parse(t.startedAt))/1000)),mm=Math.floor(sec/60),ss=sec%60,last=t.route.at(-1);els.speed.textContent=`${Math.round(mph(lastLocation?.speedMps??last?.speedMps??0))} mph`;els.distance.textContent=`${miles(t.stats.distanceMeters||0).toFixed(2)} mi`;els.duration.textContent=`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;els.triggerCount.textContent=String(t.events.filter(e=>e.severity!=='info').length);els.eventSummary.textContent=`${t.events.length} events • ${t.route.length} GPS points`;}

const DB='DriverGuardAI',STORE='trips';function db(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'});};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
async function saveTrip(t){const d=await db();await new Promise((ok,no)=>{const tx=d.transaction(STORE,'readwrite');tx.objectStore(STORE).put(structuredClone(t));tx.oncomplete=ok;tx.onerror=()=>no(tx.error)});d.close();}
async function listTrips(){const d=await db(),arr=await new Promise((ok,no)=>{const r=d.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error)});d.close();return arr.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));}
async function getTrip(id){const d=await db(),v=await new Promise((ok,no)=>{const r=d.transaction(STORE).objectStore(STORE).get(id);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});d.close();return v;}
async function delTrip(id){const d=await db();await new Promise((ok,no)=>{const tx=d.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=ok;tx.onerror=()=>no(tx.error)});d.close();}
async function refreshHistory(){let arr=[];try{arr=await listTrips()}catch{}els.history.innerHTML='';if(!arr.length){els.history.innerHTML='<option value="">No saved drives yet</option>';els.loadTrip.disabled=els.deleteTrip.disabled=true;return;}els.history.append(new Option('Choose a saved drive…',''));for(const t of arr.slice(0,30))els.history.append(new Option(`${new Date(t.startedAt).toLocaleString()} — ${miles(t.stats?.distanceMeters||0).toFixed(1)} mi`,t.id));}
function showTrip(t){reviewTrip=t;trip=null;clearMap();const ll=t.route.map(p=>[p.lat,p.lng]);routeLine.setLatLngs(ll);if(ll.length>1)map.fitBounds(routeLine.getBounds(),{padding:[20,20]});for(const e of t.events)if(e.location&&e.severity!=='info')addMarker(e);renderEvents(t);updateStats();els.exportJson.disabled=els.exportGpx.disabled=false;}
function download(name,data,type){const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportJSON(){const t=trip||reviewTrip;if(t)download(`driver-guard-${t.startedAt.slice(0,10)}.json`,JSON.stringify(t,null,2),'application/json');}
function exportGPX(){const t=trip||reviewTrip;if(!t)return;const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])),pts=t.route.map(p=>`<trkpt lat="${p.lat}" lon="${p.lng}"><time>${esc(p.time)}</time></trkpt>`).join(''),w=t.events.filter(e=>e.location).map(e=>`<wpt lat="${e.location.lat}" lon="${e.location.lng}"><time>${esc(e.time)}</time><name>${esc(e.label)}</name><desc>${esc(e.reasons.join(', '))}</desc></wpt>`).join('');download(`driver-guard-${t.startedAt.slice(0,10)}.gpx`,`<?xml version="1.0"?><gpx version="1.1" creator="Driver Guard AI" xmlns="http://www.topografix.com/GPX/1/1">${w}<trk><trkseg>${pts}</trkseg></trk></gpx>`,'application/gpx+xml');}

async function requestWake(){try{wakeLock=await navigator.wakeLock?.request('screen')}catch{}}
async function start(){if(running)return;if(!navigator.mediaDevices?.getUserMedia){els.reason.textContent='Camera API unavailable';return;}ensureAudio();initMap();newTrip();els.start.disabled=true;els.cameraMessage.classList.remove('hidden');els.cameraMessage.textContent='Starting camera…';try{startGPS();await startCamera();els.cameraMessage.textContent='Loading Hugging Face face AI…';await loadFaceAI();running=true;calibrated=false;calibration=[];baseline=null;missingSince=null;precalEyesSince=null;resetAttentionState(attention);distractedSince=null;warningSent=false;alarmLogged=false;goodSince=null;els.stop.disabled=false;els.face.textContent='SEARCHING';els.faceDetail.textContent='HF model ready — finding face';setState('good','PROTECTION','Face protection active while calibrating');requestWake();requestAnimationFrame(loop);if(els.phoneToggle.checked)loadPhoneAI();}catch(e){console.error(e);stopGPS();stream?.getTracks().forEach(t=>t.stop());stream=null;els.video.srcObject=null;els.start.disabled=false;els.face.textContent='ERROR';els.faceDetail.textContent=e?.message||'Face AI startup failed';els.cameraMessage.textContent='START FAILED — see FACE / EYES error';setState('warn','START FAILED',e?.message||'Camera/HF model error');}}
async function stop(){running=false;calibrated=false;stopSiren();speechSynthesis?.cancel?.();stopGPS();stream?.getTracks().forEach(t=>t.stop());stream=null;els.video.srcObject=null;clearInterval(tripTimer);tripTimer=null;if(trip){addEvent('trip_end','Drive stopped and saved',[],'info',false);trip.endedAt=nowIso();await saveTrip(trip).catch(()=>{});reviewTrip=trip;trip=null;await refreshHistory();}els.start.disabled=false;els.stop.disabled=true;els.face.textContent='—';els.faceDetail.textContent='HF face model waiting';els.cameraMessage.classList.remove('hidden');els.cameraMessage.textContent='Drive saved — tap Start drive while parked';els.exportJson.disabled=els.exportGpx.disabled=!reviewTrip;setState('good','READY','Drive saved locally');}
async function testAlerts(){ensureAudio();els.test.disabled=true;setState('warn','TEST WARNING','Voice + vibration');speak(['eyes closed']);await new Promise(r=>setTimeout(r,1000));setState('alarm','TEST ALARM','Siren + vibration');alarmPulse();await new Promise(r=>setTimeout(r,1100));stopSiren();setState('good',running?'PROTECTION':'READY','Test complete');els.test.disabled=false;}

els.warnDelay.addEventListener('input',()=>els.warnOut.textContent=`${(+els.warnDelay.value).toFixed(1)} s`);els.alarmDelay.addEventListener('input',()=>els.alarmOut.textContent=`${(+els.alarmDelay.value).toFixed(1)} s`);
els.start.addEventListener('click',start);els.stop.addEventListener('click',stop);els.test.addEventListener('click',testAlerts);els.phoneToggle.addEventListener('change',()=>{if(!els.phoneToggle.checked){phoneSeenUntil=0;els.phone.textContent='OFF';els.phoneDetail.textContent='Disabled'}else if(running)loadPhoneAI();});
els.gpsToggle.addEventListener('change',()=>{if(!running){els.gpsBadge.textContent=els.gpsToggle.checked?'GPS waiting':'GPS off';return;}if(els.gpsToggle.checked&&watchId==null)startGPS();else if(!els.gpsToggle.checked){stopGPS();els.gpsBadge.textContent='GPS off';}});
els.recenter.addEventListener('click',()=>{const p=lastLocation||(trip||reviewTrip)?.route.at(-1);if(p&&map)map.setView([p.lat,p.lng],15)});els.fitRoute.addEventListener('click',()=>{const t=trip||reviewTrip;if(t?.route?.length>1)map.fitBounds(L.latLngBounds(t.route.map(p=>[p.lat,p.lng])),{padding:[20,20]})});
els.exportJson.addEventListener('click',exportJSON);els.exportGpx.addEventListener('click',exportGPX);els.history.addEventListener('change',()=>{const y=!!els.history.value;els.loadTrip.disabled=els.deleteTrip.disabled=!y||running});els.loadTrip.addEventListener('click',async()=>{const t=await getTrip(els.history.value).catch(()=>null);if(t)showTrip(t)});els.deleteTrip.addEventListener('click',async()=>{if(!els.history.value||running)return;await delTrip(els.history.value).catch(()=>{});await refreshHistory()});
window.addEventListener('resize',()=>{resizeOverlay();setTimeout(()=>map?.invalidateSize(),50)});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&running)requestWake()});window.addEventListener('error',e=>{if(!running){els.faceDetail.textContent=e.message||'App error';els.reason.textContent='App error: '+(e.message||'unknown')}});window.addEventListener('unhandledrejection',e=>{if(!running){const m=e.reason?.message||String(e.reason||'unknown');els.faceDetail.textContent=m;els.reason.textContent='Load error: '+m}});
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=5').catch(()=>{});initMap();refreshHistory();setState('good','READY','Monitoring is off');updateStats();
