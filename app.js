import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
import { MAINTENANCE_LIBRARY, PHOTO_LABELS } from './maintenance-data.js';

const STORAGE_KEY = 'headsup_ai_v01';
const DAY = 86400000;
const DEFAULT_STATE = {
  profile: {
    owner: 'Josh',
    homeName: 'Rack & Splash Manor',
    city: 'Fort Worth, TX',
    homeYear: 1962,
    hasPool: true,
    tester: 'Josh'
  },
  tasks: [],
  history: [],
  feedback: [],
  selectedArea: 'All',
  installDate: new Date().toISOString(),
  aiUseCount: 0,
  photoUseCount: 0
};

let state = loadState();
let currentTab = 'home';
let embedder = null;
let libraryVectors = null;
let visionClassifier = null;
let pendingPhoto = null;

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const taskDialog = $('#taskDialog');
const taskDialogContent = $('#taskDialogContent');
const settingsDialog = $('#settingsDialog');
const settingsContent = $('#settingsContent');

function loadState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const merged = {...DEFAULT_STATE, ...(saved || {}), profile:{...DEFAULT_STATE.profile, ...(saved?.profile || {})}};
    if(!Array.isArray(merged.tasks) || merged.tasks.length === 0) merged.tasks = seedTasks();
    if(!Array.isArray(merged.history)) merged.history = [];
    if(!Array.isArray(merged.feedback)) merged.feedback = [];
    return merged;
  }catch(err){
    console.warn('State load failed', err);
    return {...DEFAULT_STATE, tasks: seedTasks()};
  }
}

function seedTasks(){
  const now = Date.now();
  const seedOffsets = {
    'pool-chemistry': -3,
    'pool-baskets': 2,
    'hvac-filter': 6,
    'vehicle-tires': 11,
    'pool-filter': 18,
    'smoke-test': 25,
    'gfci': 34,
    'vehicle-oil': 42,
    'pool-valves': 61,
    'dryer-vent': 73,
    'hvac-service': 88,
    'roof': 120,
    'water-heater': 160,
    'smoke-battery': 180,
    'fridge-coils': 200,
    'vehicle-battery': 215,
    'vehicle-wipers': 70,
    'pool-light': 145,
    'gutters': 110
  };
  return MAINTENANCE_LIBRARY.filter(x=>x.intervalDays>0 && x.id!=='propane-smell').map(item=>({
    id:item.id,
    enabled: item.area !== 'Vehicle' || ['vehicle-tires','vehicle-oil','vehicle-battery','vehicle-wipers'].includes(item.id),
    dueDate: new Date(now + (seedOffsets[item.id] ?? item.intervalDays) * DAY).toISOString(),
    customIntervalDays:item.intervalDays,
    notes:'',
    lastDone:null
  }));
}

function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function getLib(id){ return MAINTENANCE_LIBRARY.find(x=>x.id===id); }
function enabledTasks(){ return state.tasks.filter(t=>t.enabled).map(t=>({...t, lib:getLib(t.id)})).filter(x=>x.lib); }
function daysUntil(iso){ return Math.ceil((new Date(iso).getTime()-Date.now())/DAY); }
function money(n){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n); }
function escapeHtml(s=''){ return String(s).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c])); }
function formatDate(iso){ return new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function dueInfo(task){
  const d=daysUntil(task.dueDate);
  if(d<0) return {label:`${Math.abs(d)}d overdue`,cls:'due-overdue',rank:0};
  if(d===0) return {label:'Due today',cls:'due-overdue',rank:0};
  if(d<=14) return {label:`Due in ${d}d`,cls:'due-soon',rank:1};
  return {label:`${d}d`,cls:'due-good',rank:2};
}
function showToast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(showToast.t); showToast.t=setTimeout(()=>el.classList.remove('show'),2200); }

function render(){
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===currentTab));
  $('#homeLabel').textContent=`${state.profile.homeName} • ${state.profile.city}`;
  if(currentTab==='home') renderHome();
  else if(currentTab==='tasks') renderTasks();
  else if(currentTab==='ask') renderAsk();
  else if(currentTab==='history') renderHistory();
  else renderTest();
}

document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{currentTab=btn.dataset.tab; render(); window.scrollTo({top:0,behavior:'smooth'});}));
$('#settingsBtn').addEventListener('click',openSettings);

function taskCard(task){
  const info=dueInfo(task);
  return `<button class="task-card" data-task="${task.id}">
    <div class="task-row"><div><div class="task-title">${escapeHtml(task.lib.title)}</div><div class="task-meta"><span class="area-pill">${task.lib.area} • ${task.lib.asset}</span> · ${money(task.lib.costMin)}–${money(task.lib.costMax)}</div></div><span class="badge ${info.cls}">${info.label}</span></div>
  </button>`;
}
function wireTaskCards(){ document.querySelectorAll('[data-task]').forEach(el=>el.addEventListener('click',()=>openTask(el.dataset.task))); }

function renderHome(){
  const tasks=enabledTasks().sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
  const overdue=tasks.filter(t=>daysUntil(t.dueDate)<0).length;
  const next30=tasks.filter(t=>daysUntil(t.dueDate)>=0&&daysUntil(t.dueDate)<=30).length;
  const forecast=forecastCost(90);
  const urgent=tasks.filter(t=>daysUntil(t.dueDate)<=14).slice(0,5);
  view.innerHTML=`
    <section class="hero">
      <div class="eyebrow">Your maintenance heads-up</div>
      <h1>${greeting()}, ${escapeHtml(state.profile.owner)}.</h1>
      <p>Small jobs get expensive when nobody remembers them. Here’s what deserves attention next.</p>
      <div class="metrics">
        <div class="metric"><strong>${overdue}</strong><small>overdue</small></div>
        <div class="metric"><strong>${next30}</strong><small>next 30 days</small></div>
        <div class="metric"><strong>${money(forecast.mid)}</strong><small>90-day est.</small></div>
      </div>
    </section>
    <div class="section-title"><h2>Needs attention</h2><button id="seeAllTasks">See all</button></div>
    <div class="task-list">${urgent.length?urgent.map(taskCard).join(''):`<div class="empty">Nothing urgent. Nice.</div>`}</div>
    <div class="section-title"><h2>Smart tools</h2></div>
    <div class="quick-grid">
      <button class="quick-card" id="askQuick"><div class="emoji">✦</div><strong>Ask HeadsUp</strong><span class="muted">“Why is my pool suction weak?”</span></button>
      <button class="quick-card" id="photoQuick"><div class="emoji">▣</div><strong>Photo Scout</strong><span class="muted">Experimental AI identification</span></button>
      <button class="quick-card" id="forecastQuick"><div class="emoji">$</div><strong>Future costs</strong><span class="muted">See the next 90 days</span></button>
      <button class="quick-card" id="doneQuick"><div class="emoji">✓</div><strong>Log a job</strong><span class="muted">Mark maintenance complete</span></button>
    </div>
    <div class="section-title"><h2>90-day forecast</h2></div>
    ${forecastHtml(90)}
  `;
  wireTaskCards();
  $('#seeAllTasks').onclick=()=>{currentTab='tasks';render();};
  $('#askQuick').onclick=()=>{currentTab='ask';render();};
  $('#photoQuick').onclick=()=>{currentTab='ask';render();setTimeout(()=>$('#photoInput')?.click(),100);};
  $('#forecastQuick').onclick=()=>document.querySelector('.mini-table')?.scrollIntoView({behavior:'smooth'});
  $('#doneQuick').onclick=()=>{currentTab='tasks';render();};
}
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening';}
function forecastCost(days){
  const due=enabledTasks().filter(t=>{const d=daysUntil(t.dueDate);return d>=0&&d<=days;});
  const min=due.reduce((a,t)=>a+t.lib.costMin,0), max=due.reduce((a,t)=>a+t.lib.costMax,0);
  return {min,max,mid:Math.round((min+max)/2),due};
}
function forecastHtml(days){
  const f=forecastCost(days);
  if(!f.due.length) return `<div class="notice">No scheduled costs in the next ${days} days.</div>`;
  return `<div class="guide"><table class="mini-table">${f.due.slice(0,8).map(t=>`<tr><td>${escapeHtml(t.lib.title)}<br><span class="muted">${formatDate(t.dueDate)}</span></td><td>${money(t.lib.costMin)}–${money(t.lib.costMax)}</td></tr>`).join('')}<tr><td><strong>Possible total</strong></td><td><strong>${money(f.min)}–${money(f.max)}</strong></td></tr></table></div>`;
}

function renderTasks(){
  const areas=['All','Home','Pool','Vehicle'];
  const selected=state.selectedArea||'All';
  let tasks=enabledTasks();
  if(selected!=='All') tasks=tasks.filter(t=>t.lib.area===selected);
  tasks.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
  view.innerHTML=`<div class="section-title"><h2>Maintenance</h2><button id="manageTasks">Manage</button></div>
    <div class="chips">${areas.map(a=>`<button class="chip ${a===selected?'active':''}" data-area="${a}">${a}</button>`).join('')}</div>
    <div class="task-list" style="margin-top:12px">${tasks.map(taskCard).join('')}</div>`;
  document.querySelectorAll('[data-area]').forEach(b=>b.onclick=()=>{state.selectedArea=b.dataset.area;saveState();renderTasks();});
  wireTaskCards();
  $('#manageTasks').onclick=openManageTasks;
}

function openTask(id){
  const task=state.tasks.find(t=>t.id===id); const lib=getLib(id); if(!task||!lib)return;
  const info=dueInfo({...task,lib});
  taskDialogContent.innerHTML=`<div class="sheet-inner">
    <div class="sheet-head"><div><div class="eyebrow">${lib.area} • ${lib.asset}</div><h2>${escapeHtml(lib.title)}</h2><span class="badge ${info.cls}">${info.label}</span></div><button class="close-btn" data-close>×</button></div>
    <div class="guide safety-${lib.safety}"><h3>Why it matters</h3><div class="muted">${escapeHtml(lib.why)}</div></div>
    <div class="guide"><h3>Plain-English steps</h3><ol>${lib.steps.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol></div>
    <div class="guide"><h3>Cost & effort</h3><div>${money(lib.costMin)}–${money(lib.costMax)} · ${lib.difficulty}</div><div class="muted" style="margin-top:6px">You need: ${escapeHtml(lib.tools)}</div></div>
    ${['high','critical'].includes(lib.safety)?`<div class="notice warning"><strong>Safety stop:</strong> This item can involve serious hazards. Don’t use the app as a substitute for manufacturer instructions or a qualified professional.</div>`:''}
    <div class="field"><label>Next due date</label><input id="editDue" type="date" value="${task.dueDate.slice(0,10)}"></div>
    <div class="field"><label>Notes</label><textarea id="editNotes" placeholder="Filter size, model number, what you noticed…">${escapeHtml(task.notes||'')}</textarea></div>
    <div class="button-row"><button class="primary-btn" id="markDone">✓ I did it</button><button class="ghost-btn" id="saveTask">Save</button></div>
  </div>`;
  taskDialog.showModal();
  taskDialogContent.querySelector('[data-close]').onclick=()=>taskDialog.close();
  $('#saveTask').onclick=()=>{task.dueDate=new Date($('#editDue').value+'T12:00:00').toISOString();task.notes=$('#editNotes').value.trim();saveState();taskDialog.close();render();showToast('Task updated');};
  $('#markDone').onclick=()=>completeTask(id,$('#editNotes').value.trim());
}
function completeTask(id,notes=''){
  const task=state.tasks.find(t=>t.id===id); const lib=getLib(id); if(!task||!lib)return;
  const doneAt=new Date();
  state.history.unshift({id:crypto.randomUUID?.()||String(Date.now()),taskId:id,title:lib.title,area:lib.area,doneAt:doneAt.toISOString(),notes,cost:null,tester:state.profile.tester||state.profile.owner});
  task.lastDone=doneAt.toISOString(); task.notes=notes; task.dueDate=new Date(doneAt.getTime()+(task.customIntervalDays||lib.intervalDays)*DAY).toISOString();
  saveState(); taskDialog.close(); render(); showToast(`Logged: ${lib.title}`);
}

function openManageTasks(){
  const rows=MAINTENANCE_LIBRARY.filter(x=>x.intervalDays>0 && x.id!=='propane-smell').map(lib=>{
    const task=state.tasks.find(t=>t.id===lib.id);return `<label class="history-item" style="display:flex;gap:12px;align-items:center"><input type="checkbox" data-enable="${lib.id}" ${task?.enabled?'checked':''}><span><strong>${escapeHtml(lib.title)}</strong><br><span class="muted">${lib.area} · every ${lib.intervalDays} days</span></span></label>`;
  }).join('');
  taskDialogContent.innerHTML=`<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">Customize</div><h2>Choose what you track</h2></div><button class="close-btn" data-close>×</button></div>${rows}<button class="primary-btn" id="saveManage" style="width:100%">Save tracked items</button></div>`;
  taskDialog.showModal(); taskDialogContent.querySelector('[data-close]').onclick=()=>taskDialog.close();
  $('#saveManage').onclick=()=>{
    document.querySelectorAll('[data-enable]').forEach(box=>{
      let t=state.tasks.find(x=>x.id===box.dataset.enable); const lib=getLib(box.dataset.enable);
      if(!t){t={id:lib.id,enabled:false,dueDate:new Date(Date.now()+lib.intervalDays*DAY).toISOString(),customIntervalDays:lib.intervalDays,notes:'',lastDone:null};state.tasks.push(t);} t.enabled=box.checked;
    }); saveState(); taskDialog.close(); renderTasks(); showToast('Tracked items updated');
  };
}

function renderAsk(){
  view.innerHTML=`
    <div class="section-title"><h2>Ask HeadsUp AI</h2></div>
    <div class="ask-box">
      <div class="eyebrow">Runs in your browser</div>
      <h2 style="margin:7px 0">What’s going on?</h2>
      <div class="field"><textarea id="aiQuestion" placeholder="Examples: My pool vacuum has weak suction. What should I check?\nMy smoke detector keeps chirping.\nWhat maintenance is coming up soon?"></textarea></div>
      <button class="primary-btn" id="askBtn" style="width:100%">✦ Find the best answer</button>
      <div class="ai-status"><span class="dot"></span><span id="aiStatus">Free local AI model loads only when you ask.</span></div>
      <div id="aiProgress"></div>
    </div>
    <div id="aiAnswer"></div>
    <div class="section-title"><h2>Photo Scout <span class="badge due-soon">Experimental</span></h2></div>
    <div class="guide">
      <div class="notice warning">Photo Scout is optional and much heavier than text AI. First use can download a large vision model. It suggests a component type; it does not diagnose dangerous equipment.</div>
      <div class="field"><label>Take or choose a photo</label><input id="photoInput" type="file" accept="image/*" capture="environment"></div>
      <img id="photoPreview" class="photo-preview" hidden alt="Selected maintenance item" />
      <button class="ghost-btn" id="scanPhoto" style="width:100%" disabled>▣ Analyze photo</button>
      <div id="photoResult"></div>
    </div>`;
  $('#askBtn').onclick=askAI;
  $('#photoInput').onchange=handlePhoto;
  $('#scanPhoto').onclick=scanPhoto;
}

function corpusText(lib){ return `${lib.title}. Area ${lib.area}. Equipment ${lib.asset}. ${lib.why} Keywords: ${lib.keywords}. Steps: ${lib.steps.join(' ')}`; }
async function ensureEmbedder(){
  if(embedder&&libraryVectors)return;
  const status=$('#aiStatus'); const prog=$('#aiProgress');
  if(status)status.textContent='Loading a small free AI model… first use is the slowest.';
  if(prog)prog.innerHTML='<div class="loader"><span></span></div>';
  embedder = await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{dtype:'q8'});
  const docs=MAINTENANCE_LIBRARY.map(corpusText);
  const out=await embedder(docs,{pooling:'mean',normalize:true});
  libraryVectors=out.tolist();
  if(status)status.textContent='AI ready on this device.';
  if(prog)prog.innerHTML='';
}
function cosine(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function lexicalMatches(q){
  const terms=q.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
  return MAINTENANCE_LIBRARY.map((lib,i)=>{const hay=corpusText(lib).toLowerCase();const score=terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0)/(terms.length||1);return {lib,index:i,score};}).sort((a,b)=>b.score-a.score).slice(0,3);
}
async function semanticMatches(q){
  await ensureEmbedder();
  const vec=(await embedder(q,{pooling:'mean',normalize:true})).tolist()[0];
  return MAINTENANCE_LIBRARY.map((lib,i)=>({lib,index:i,score:cosine(vec,libraryVectors[i])})).sort((a,b)=>b.score-a.score).slice(0,3);
}
async function askAI(){
  const q=$('#aiQuestion').value.trim(); if(!q){showToast('Type a question first');return;}
  $('#askBtn').disabled=true; $('#aiAnswer').innerHTML='';
  let matches,mode='AI semantic match';
  try{matches=await semanticMatches(q);state.aiUseCount++;saveState();}
  catch(err){console.warn('AI model unavailable, using fallback',err);matches=lexicalMatches(q);mode='Offline keyword fallback';$('#aiStatus').textContent='AI model could not load, so HeadsUp used its offline maintenance matcher.';$('#aiProgress').innerHTML='';}
  $('#askBtn').disabled=false;
  const best=matches[0];
  const safety=best.lib.safety;
  const upcoming=enabledTasks().find(t=>t.id===best.lib.id);
  $('#aiAnswer').innerHTML=`<div class="answer safety-${safety}">
    <div class="eyebrow">${mode}</div><h3>${escapeHtml(best.lib.title)}</h3>
    <p><strong>Why this matched:</strong> ${escapeHtml(best.lib.why)}</p>
    ${upcoming?`<p><strong>Your tracker:</strong> ${dueInfo(upcoming).label} (${formatDate(upcoming.dueDate)}).</p>`:''}
    <div class="guide"><h3>Start here</h3><ol>${best.lib.steps.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol></div>
    ${['high','critical'].includes(safety)?`<div class="notice warning"><strong>Stop point:</strong> ${safety==='critical'?'Treat this as a safety situation, not a DIY repair.':'This can involve serious hazards. Follow manufacturer instructions and use a qualified pro when needed.'}</div>`:''}
    <div class="muted" style="font-size:12px;margin-top:12px">Top matches</div>
    ${matches.map(m=>`<div class="match"><strong>${escapeHtml(m.lib.title)}</strong><div class="confidence">Match ${(Math.max(0,m.score)*100).toFixed(0)}%</div></div>`).join('')}
    <div class="button-row"><button class="ghost-btn" id="openMatched">Open maintenance card</button><button class="ghost-btn" id="rateAnswer">Rate this answer</button></div>
  </div>`;
  $('#openMatched').onclick=()=>{const t=state.tasks.find(x=>x.id===best.lib.id); if(t)openTask(t.id); else showToast('Add this item from Manage Tasks');};
  $('#rateAnswer').onclick=()=>{currentTab='test';render();setTimeout(()=>$('#feedbackNotes')?.focus(),100);};
}

function handlePhoto(e){
  const file=e.target.files?.[0]; if(!file)return;
  if(file.size>12*1024*1024){showToast('Please use a photo under 12 MB');return;}
  pendingPhoto=file;
  const url=URL.createObjectURL(file); const img=$('#photoPreview'); img.src=url; img.hidden=false; $('#scanPhoto').disabled=false; $('#photoResult').innerHTML='';
}
async function scanPhoto(){
  if(!pendingPhoto)return;
  $('#scanPhoto').disabled=true; $('#photoResult').innerHTML='<div class="ai-status"><span class="dot"></span>Loading vision AI… first use can be a large download.</div><div class="loader"><span></span></div>';
  try{
    if(!visionClassifier) visionClassifier=await pipeline('zero-shot-image-classification','Xenova/clip-vit-base-patch32',{dtype:'q8'});
    const dataUrl=await fileToDataURL(pendingPhoto);
    const results=await visionClassifier(dataUrl,PHOTO_LABELS);
    const top=results.slice(0,3); state.photoUseCount++;saveState();
    const lib=photoLabelToLib(top[0].label);
    $('#photoResult').innerHTML=`<div class="answer"><div class="eyebrow">Photo Scout guess</div><h3>${escapeHtml(top[0].label)}</h3><p>Confidence ${(top[0].score*100).toFixed(0)}%. Treat this as a clue, not a diagnosis.</p>${lib?`<div class="guide safety-${lib.safety}"><strong>${escapeHtml(lib.title)}</strong><div class="muted" style="margin-top:6px">${escapeHtml(lib.why)}</div></div>`:''}<div class="muted" style="font-size:12px">Other guesses: ${top.slice(1).map(x=>`${escapeHtml(x.label)} ${(x.score*100).toFixed(0)}%`).join(' · ')}</div></div>`;
  }catch(err){console.error(err);$('#photoResult').innerHTML='<div class="notice warning">Photo AI could not load on this device/network. Text Ask AI and all maintenance tracking still work.</div>';}
  finally{$('#scanPhoto').disabled=false;}
}
function fileToDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
function photoLabelToLib(label){
  const l=label.toLowerCase();
  const map=[['air filter','hvac-filter'],['air conditioner','hvac-service'],['smoke','smoke-test'],['carbon monoxide','smoke-test'],['water heater','water-heater'],['dryer','dryer-vent'],['roof','roof'],['gutter','gutters'],['gfci','gfci'],['refrigerator','fridge-coils'],['pool pump','pool-baskets'],['pool filter','pool-filter'],['diverter','pool-valves'],['skimmer','pool-baskets'],['pool light','pool-light'],['tire','vehicle-tires'],['battery','vehicle-battery'],['oil','vehicle-oil']];
  const found=map.find(([k])=>l.includes(k));return found?getLib(found[1]):null;
}

function renderHistory(){
  view.innerHTML=`<div class="section-title"><h2>Maintenance history</h2><button id="exportHistory">Export</button></div>${state.history.length?state.history.map(h=>`<div class="history-item"><div class="task-row"><div><strong>${escapeHtml(h.title)}</strong><div class="task-meta">${formatDate(h.doneAt)} · ${escapeHtml(h.tester||'')}</div></div><span class="badge due-good">Done</span></div>${h.notes?`<div class="muted" style="margin-top:9px">${escapeHtml(h.notes)}</div>`:''}</div>`).join(''):`<div class="empty">Your completed maintenance will show up here.</div>`}`;
  $('#exportHistory').onclick=exportData;
}

function renderTest(){
  const recent=state.feedback.slice(0,3);
  view.innerHTML=`<div class="section-title"><h2>Family & friends test</h2></div>
    <div class="notice">This screen is intentionally part of the prototype. Give the phone to somebody, let them use HeadsUp, then capture what was useful, confusing or wrong.</div>
    <div class="feedback-card">
      <div class="field"><label>Tester name</label><input id="testerName" value="${escapeHtml(state.profile.tester||'')}" placeholder="Lola, Dad, friend…"></div>
      ${ratingRow('useful','Was it useful?')}
      ${ratingRow('easy','Was it easy?')}
      ${ratingRow('trust','Did the answer feel trustworthy?')}
      <div class="field"><label>What worked, what was wrong, or what was missing?</label><textarea id="feedbackNotes" placeholder="Be blunt. Bad feedback helps us improve it."></textarea></div>
      <button class="primary-btn" id="saveFeedback" style="width:100%">Save test feedback</button>
    </div>
    <div class="section-title"><h2>Prototype stats</h2></div>
    <div class="guide"><table class="mini-table"><tr><td>AI questions asked</td><td>${state.aiUseCount||0}</td></tr><tr><td>Photo scans</td><td>${state.photoUseCount||0}</td></tr><tr><td>Maintenance jobs logged</td><td>${state.history.length}</td></tr><tr><td>Feedback sessions</td><td>${state.feedback.length}</td></tr></table></div>
    ${recent.length?`<div class="section-title"><h2>Latest feedback</h2></div>${recent.map(f=>`<div class="history-item"><strong>${escapeHtml(f.tester)}</strong><div class="task-meta">Useful ${f.useful}/5 · Easy ${f.easy}/5 · Trust ${f.trust}/5</div><div class="muted" style="margin-top:8px">${escapeHtml(f.notes||'No notes')}</div></div>`).join('')}`:''}
    <div class="button-row"><button class="ghost-btn" id="exportAll">Export test data</button></div>`;
  wireRatings();
  $('#saveFeedback').onclick=saveFeedback;
  $('#exportAll').onclick=exportData;
}
function ratingRow(name,label){return `<div class="field"><label>${label}</label><div class="stars" data-rating="${name}">${[1,2,3,4,5].map(n=>`<button class="star-btn" data-value="${n}" type="button">★</button>`).join('')}</div></div>`;}
function wireRatings(){document.querySelectorAll('[data-rating]').forEach(group=>{group.dataset.selected='0';group.querySelectorAll('.star-btn').forEach(btn=>btn.onclick=()=>{group.dataset.selected=btn.dataset.value;group.querySelectorAll('.star-btn').forEach(b=>b.classList.toggle('on',Number(b.dataset.value)<=Number(btn.dataset.value)));});});}
function saveFeedback(){
  const get=n=>Number(document.querySelector(`[data-rating="${n}"]`).dataset.selected||0);
  const tester=$('#testerName').value.trim()||'Anonymous tester'; const useful=get('useful'),easy=get('easy'),trust=get('trust');
  if(!useful||!easy||!trust){showToast('Tap a rating for all 3 questions');return;}
  state.profile.tester=tester; state.feedback.unshift({id:crypto.randomUUID?.()||String(Date.now()),tester,useful,easy,trust,notes:$('#feedbackNotes').value.trim(),createdAt:new Date().toISOString()});saveState();renderTest();showToast('Feedback saved');
}

function openSettings(){
  settingsContent.innerHTML=`<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">Prototype settings</div><h2>Your HeadsUp</h2></div><button class="close-btn" data-close>×</button></div>
    <div class="field"><label>Your name</label><input id="setOwner" value="${escapeHtml(state.profile.owner)}"></div>
    <div class="field"><label>Home name</label><input id="setHome" value="${escapeHtml(state.profile.homeName)}"></div>
    <div class="field"><label>City</label><input id="setCity" value="${escapeHtml(state.profile.city)}"></div>
    <div class="field"><label>Home year</label><input id="setYear" type="number" min="1700" max="2100" value="${state.profile.homeYear||''}"></div>
    <div class="button-row"><button class="primary-btn" id="saveSettings">Save</button><button class="ghost-btn" id="backupSettings">Export backup</button></div>
    <div class="field"><label>Import a HeadsUp backup</label><input id="importFile" type="file" accept="application/json"></div>
    <button class="danger-btn" id="resetData" style="width:100%;margin-top:12px">Reset prototype data</button>
    <div class="notice" style="margin-top:14px">Your maintenance records stay in this browser unless you export them. There is no account or cloud database in v0.1.</div></div>`;
  settingsDialog.showModal(); settingsContent.querySelector('[data-close]').onclick=()=>settingsDialog.close();
  $('#saveSettings').onclick=()=>{state.profile.owner=$('#setOwner').value.trim()||'Josh';state.profile.homeName=$('#setHome').value.trim()||'My Home';state.profile.city=$('#setCity').value.trim();state.profile.homeYear=Number($('#setYear').value)||null;saveState();settingsDialog.close();render();showToast('Settings saved');};
  $('#backupSettings').onclick=exportData;
  $('#importFile').onchange=importData;
  $('#resetData').onclick=()=>{if(confirm('Reset all HeadsUp prototype data on this device?')){localStorage.removeItem(STORAGE_KEY);state={...DEFAULT_STATE,tasks:seedTasks(),history:[],feedback:[]};saveState();settingsDialog.close();render();showToast('Prototype reset');}};
}

function exportData(){
  const payload={app:'HeadsUp AI',version:'0.1',exportedAt:new Date().toISOString(),data:state};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`headsup-ai-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Backup exported');
}
async function importData(e){
  try{const file=e.target.files?.[0];if(!file)return;const parsed=JSON.parse(await file.text());const incoming=parsed.data||parsed;if(!incoming.profile||!Array.isArray(incoming.tasks))throw new Error('Invalid backup');state={...DEFAULT_STATE,...incoming,profile:{...DEFAULT_STATE.profile,...incoming.profile}};saveState();settingsDialog.close();render();showToast('Backup imported');}catch(err){showToast('That file is not a valid HeadsUp backup');}
}

window.addEventListener('click',e=>{if(e.target===taskDialog)taskDialog.close();if(e.target===settingsDialog)settingsDialog.close();});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('SW registration failed',err)));

render();
