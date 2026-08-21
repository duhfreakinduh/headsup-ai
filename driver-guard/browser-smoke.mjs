import puppeteer from 'puppeteer-core';

const executable = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-setuid-sandbox','--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
await page.evaluateOnNewDocument(()=>{
  const fakeMedia={getUserMedia:async()=>{
    const c=document.createElement('canvas');c.width=640;c.height=480;
    const x=c.getContext('2d');x.fillStyle='#777';x.fillRect(0,0,c.width,c.height);
    setInterval(()=>{x.fillStyle='#777';x.fillRect(0,0,c.width,c.height);},100);
    return c.captureStream(12);
  }};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:fakeMedia});
});
await page.goto('http://127.0.0.1:4173/driver-guard/?v=5',{waitUntil:'networkidle2',timeout:120000});
await page.waitForSelector('#testBtn');
await page.click('#testBtn');
await page.waitForFunction(()=>document.querySelector('#statusText')?.textContent==='TEST WARNING',{timeout:5000});
await page.waitForTimeout(2600);
await page.evaluate(()=>{document.querySelector('#gpsToggle').checked=false;});
await page.click('#startBtn');
await page.waitForFunction(()=>{
  const f=document.querySelector('#faceText')?.textContent||'';
  return ['MODEL READY','CALIBRATE','NO FACE','READY','OK','DISTRACTED'].includes(f);
},{timeout:120000});
const state=await page.evaluate(()=>({
  face:document.querySelector('#faceText')?.textContent,
  detail:document.querySelector('#faceDetail')?.textContent,
  status:document.querySelector('#statusText')?.textContent,
  reason:document.querySelector('#reasonText')?.textContent,
  startDisabled:document.querySelector('#startBtn')?.disabled,
  stopDisabled:document.querySelector('#stopBtn')?.disabled,
}));
console.log('SMOKE STATE',JSON.stringify(state));
if(!state.startDisabled || state.stopDisabled) throw new Error('Start path did not enter running state: '+JSON.stringify(state));
if((state.face||'').includes('ERROR') || (state.detail||'').toLowerCase().includes('failed')) throw new Error('Face AI startup failed: '+JSON.stringify(state));
if(errors.length) throw new Error('Browser errors: '+errors.join(' | '));
await browser.close();
console.log('Browser smoke passed');
