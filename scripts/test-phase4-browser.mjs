// Actual production bundle in isolated headless browsers. ALL remote HTTP/WS
// requests are intercepted/blocked. Auth/REST are synthetic, NOT hosted E2E.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { clinicDateKey, addClinicDays, clinicInstant } from '../src/lib/clinicTime.ts';
const checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(30);}throw new Error('Timed out: '+label);}
const root=resolve('dist'), server=createServer((req,res)=>{
 const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep)&&path!==root){res.writeHead(403);return res.end();}
 const file=existsSync(path)&&!path.endsWith(sep)&&path!==root?path:join(root,'index.html');
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const uid={patient:'00000000-0000-0000-0000-000000000002',admin:'00000000-0000-0000-0000-000000000001'};
const patient={id:'10000000-0000-0000-0000-000000000001',user_id:uid.patient,full_name:'Synthetic Patient',contact_number:'09123456789',date_of_birth:'2000-01-01',address:'Synthetic address'};
const doctor={id:'20000000-0000-0000-0000-000000000001',full_name:'Synthetic Doctor',specialty:'General Medicine',is_active:true};
const profiles=Object.entries(uid).map(([role,id])=>({id,role:role==='admin'?'admin':'patient',full_name:role==='admin'?'Synthetic Admin':patient.full_name}));
const schedules=Array.from({length:7},(_,day)=>({id:String(day),doctor_id:doctor.id,day_of_week:day,start_time:'09:00:00',end_time:'12:00:00',slot_duration_minutes:30}));
let appointments=[],remoteRequests=0,errors=[],serial=1;const frontendCredentialRoles=new Set();
const future=addClinicDays(clinicDateKey(),10),failure={table:null,identity:false};
const user=role=>({id:uid[role],aud:'authenticated',role:'authenticated',email:`${role}@example.invalid`,app_metadata:{provider:'email',providers:['email']},user_metadata:{full_name:role==='admin'?'Synthetic Admin':patient.full_name},created_at:'2026-01-01T00:00:00Z'});
const token=role=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid[role],role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'synthetic-test-only'].join('.');
const session=role=>({access_token:token(role),refresh_token:'synthetic-refresh-'+role,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:user(role)});
function responseData(url,request){
 if(request.method==='OPTIONS')return{status:204,data:null,head:true,headers:[{name:'Access-Control-Allow-Headers',value:Object.entries(request.headers).find(([k])=>k.toLowerCase()==='access-control-request-headers')?.[1]??'*'}]};
 const u=new URL(url),body=request.postData?JSON.parse(request.postData):{},headers=request.headers;
 const authorization=Object.entries(headers).find(([k])=>k.toLowerCase()==='authorization')?.[1]??'';
 let role='patient';try{if(JSON.parse(Buffer.from(authorization.replace(/^Bearer /i,'').split('.')[1],'base64url')).sub===uid.admin)role='admin';}catch{}
 if(u.pathname.endsWith('/auth/v1/token')){
  if(body.password==='wrong-password')return{status:400,data:{msg:'Invalid login credentials',code:'invalid_credentials'}};
  role=(body.email??body.refresh_token??'').includes('admin')?'admin':'patient';return{data:session(role)};
 }
 if(u.pathname.endsWith('/auth/v1/signup'))return{data:session('patient')};
 if(u.pathname.endsWith('/auth/v1/user'))return{data:user(role)};
 if(u.pathname.endsWith('/auth/v1/logout'))return{data:{}};
 if(u.pathname.includes('/functions/v1/'))return{data:{executed:true,ok:false,accepted:false,stubbed:true,provider:'none',error:'not_configured',delivery:'not_verified'}};
 const rpc=u.pathname.split('/rpc/')[1];
 if(rpc){
  if(rpc==='ensure_patient_identity')return role==='admin'||failure.identity?{status:403,data:{code:'42501',message:role==='admin'?'This account is not a patient account.':'Synthetic identity unavailable'}}:{data:{profile:profiles.find(p=>p.role==='patient'),patient}};
  if(rpc==='get_available_appointment_dates')return{data:[{clinic_date:future,available:true},{clinic_date:addClinicDays(future,1),available:true}]};
  if(rpc==='get_available_appointment_slots')return{data:Array.from({length:6},(_,i)=>clinicInstant(body.p_date,`${String(9+Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`)).filter(t=>!appointments.some(a=>a.scheduled_time===t&&!['cancelled','no_show'].includes(a.status))).map(scheduled_time=>({scheduled_time,slot_duration_minutes:30}))};
  if(['book_appointment','staff_book_appointment'].includes(rpc)){
   const a={id:`30000000-0000-0000-0000-${String(serial++).padStart(12,'0')}`,patient_id:patient.id,doctor_id:doctor.id,scheduled_time:body.p_scheduled_time,status:'scheduled',reason:body.p_reason??null,source:'pre_booked',created_at:new Date().toISOString()};appointments.push(a);return{data:{success:true,id:a.id}};
  }
  if(rpc.includes('reschedule_appointment')){appointments.find(a=>a.id===body.p_appointment_id).scheduled_time=body.p_scheduled_time;return{data:{success:true,id:body.p_appointment_id}};}
  if(rpc.includes('cancel_appointment')){appointments.find(a=>a.id===body.p_appointment_id).status='cancelled';return{data:{success:true,id:body.p_appointment_id}};}
  if(rpc==='patient_save_profile'){patient.full_name=body.p_full_name;profiles.find(p=>p.role==='patient').full_name=body.p_full_name;return{data:patient};}
  if(rpc==='staff_appointment_report')return{data:{total:0,noShows:0,cancelled:0,walkIns:0,doctors:[],perDay:{},perDoctor:[],noShowPatients:[]}};
  if(rpc==='staff_report_audit')return{data:{rows:[],total:0,actions:[]}};
  if(rpc==='admin_patient_duplicate_count')return{data:0};
  return{data:{success:true}};
 }
 const table=u.pathname.split('/rest/v1/')[1];
 if(table===failure.table)return{status:503,data:{code:'synthetic_network',message:'Synthetic query failure'}};
 let rows=table==='profiles'?profiles:table==='patients'?[patient]:table==='doctors'?[doctor]:table==='doctor_schedules'?schedules:table==='appointments'?appointments.map(a=>({...a,doctor,patient,doctors:doctor,patients:patient})):[];
 for(const [key,value]of u.searchParams){if(['select','order','limit','offset'].includes(key))continue;
  const [op,...rest]=value.split('.'),v=rest.join('.');
  if(op==='eq')rows=rows.filter(x=>String(x[key])===v);
  if(op==='gte')rows=rows.filter(x=>String(x[key])>=v);if(op==='lt')rows=rows.filter(x=>String(x[key])<v);if(op==='lte')rows=rows.filter(x=>String(x[key])<=v);
  if(op==='in'){const values=v.replace(/[()]/g,'').split(',');rows=rows.filter(x=>values.includes(String(x[key])));}
 }
 const count=rows.length;rows=rows.slice(Number(u.searchParams.get('offset')??0),Number(u.searchParams.get('offset')??0)+Number(u.searchParams.get('limit')??1000));
 const object=Object.entries(headers).some(([k,v])=>k.toLowerCase()==='accept'&&v.includes('vnd.pgrst.object'));
 return{data:object?rows[0]??null:rows,headers:[{name:'Content-Range',value:`0-${Math.max(0,count-1)}/${count}`}],head:request.method==='HEAD'};
}
async function browser(name,binary){
 const temporary=mkdtempSync(join(tmpdir(),'medicappointment-phase4-browser-'));
 const child=spawn(binary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${temporary}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;
 try{
  await wait(()=>existsSync(join(temporary,'DevToolsActivePort')),'isolated browser startup');const port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let counter=0,loads=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++counter;pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({id:requestId,method,params}));});
  socket.onmessage=async ev=>{const message=JSON.parse(ev.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p?.reject(new Error(message.error.message));else p?.resolve(message.result);return;}
   if(message.method==='Fetch.requestPaused'){
    const {requestId,request}=message.params;
    const publicKey=Object.entries(request.headers).find(([key])=>key.toLowerCase()==='apikey')?.[1];
    if(publicKey){try{const role=JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url')).role;frontendCredentialRoles.add(role==='service_role'?'service_role':role==='anon'?'anon':'other');if(role==='service_role')errors.push('Frontend credential has service_role claim');}catch{frontendCredentialRoles.add('non-JWT-or-unclassified');}}
    if(request.url.startsWith(origin+'/')){try{await call('Fetch.continueRequest',{requestId});}catch(error){if(!error.message.includes('Invalid InterceptionId'))errors.push('Local resource interception failed');}return;}
    remoteRequests++;try{const r=responseData(request.url,request);await call('Fetch.fulfillRequest',{requestId,responseCode:r.status??200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Headers',value:'authorization,apikey,x-client-info,content-type,prefer,range,range-unit,x-supabase-api-version'},{name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS'},{name:'Access-Control-Expose-Headers',value:'Content-Range'},...(r.headers??[])],body:Buffer.from(r.head?'':JSON.stringify(r.data)).toString('base64')});}
    catch(error){if(!error.message.includes('Invalid InterceptionId'))errors.push('Synthetic interception failed');try{await call('Fetch.failRequest',{requestId,errorReason:'Failed'});}catch{/* Navigation may cancel an obsolete interception. */}}
   }
   if(message.method==='Page.javascriptDialogOpening')await call('Page.handleJavaScriptDialog',{accept:true});
   if(message.method==='Page.loadEventFired')loads++;
   if(message.method==='Runtime.exceptionThrown')errors.push('Browser runtime exception');
   if(message.method==='Network.loadingFailed'&&message.params.corsErrorStatus)console.log('Synthetic transport CORS diagnostic: '+JSON.stringify(message.params.corsErrorStatus));
  };
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`const NativeWS=window.WebSocket;window.WebSocket=class extends NativeWS{constructor(url,protocols){super(String(url).startsWith('ws://127.0.0.1:')?url:'ws://127.0.0.1:1/offline',protocols)}};`});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('Synthetic browser action failed');return r.result.value;};
  const navigate=async path=>{const previous=loads;await call('Page.navigate',{url:origin+path});await wait(()=>loads>previous,'document load');await wait(()=>evaluate("document.readyState==='complete'&&Boolean(document.querySelector('#root'))"),'page render');};
  const text=()=>evaluate('document.body.innerText');
  const has=async fragment=>{try{await wait(async()=>(await text()).includes(fragment),'visible '+fragment);}catch(error){console.log('Synthetic UI diagnostics: '+(await text()).slice(-700));throw error;}};
  const click=async label=>{await has(label);assert.equal(await evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>(e.textContent.trim()===${JSON.stringify(label)}||e.title===${JSON.stringify(label)})&&!e.disabled);if(!e)return false;e.click();return true})()`),true,'Enabled control '+label);};
  const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const login=async(role,password='synthetic-only-password')=>{await navigate(role==='admin'?'/appointments/login':'/patient/login');await has('LOGIN');assert.ok(await fill('input[type=email]',role+'@example.invalid'));assert.ok(await fill('input[type=password]',password));await click('LOGIN');};
  const test=async(label,fn)=>{try{await fn();}catch(error){console.log('Synthetic test UI: '+(await text()).slice(-900));throw error;}checks.push({browser:name,name:label,result:'PASS'});console.log('PASS '+name+': '+label);};
  await test('root/anonymous protected routes redirect to correct portal login',async()=>{await navigate('/');await has('My Health Portal');await navigate('/patient/book');await has('LOGIN');await navigate('/appointments/booking');await has('Clinic Admin Portal');});
  await test('wrong password visible; patient signup, provisioning and dashboard render',async()=>{await login('patient','wrong-password');await has('Invalid login credentials');await navigate('/patient/login');await click('Create account');assert.ok(await fill('input[type=text]','Synthetic Patient'));await fill('input[type=email]','patient@example.invalid');await fill('input[type=password]','synthetic-only-password');await click('CREATE ACCOUNT');await wait(()=>evaluate("location.pathname==='/patient/dashboard'"),'signup dashboard');});
  await test('patient direct refresh routes render with restored real SDK session',async()=>{for(const [path,label]of [['dashboard','Dashboard'],['profile','Profile'],['settings','Settings'],['appointments','My Appointments'],['history','Appointment History']]){await navigate('/patient/'+path);await has(label);}});
  const selectSlot=async(reschedule=false)=>{await has('Select Doctor');await click('Select Doctor');await has('Choose a Date');await wait(()=>evaluate("Boolean(document.querySelector('[aria-labelledby=\"choose-date\"] button[title]')?.title)"),'date options');assert.equal(await evaluate("(()=>{const e=[...document.querySelectorAll('[aria-labelledby=\"choose-date\"] button[title]')].find(e=>!e.disabled&&e.title.includes('2030')===false&&e.querySelector('span'));if(!e)return false;e.click();return true})()"),true);await has('Choose an Available Time');await wait(()=>evaluate("document.querySelector('[aria-label=\"Available times\"] button')!==null"),'slots');await evaluate("document.querySelector('[aria-label=\"Available times\"] button').click()");await click(reschedule?'Confirm Reschedule':'Confirm Appointment');await has(reschedule?'Appointment Rescheduled!':'Appointment Booked Successfully!');};
  await test('patient doctor/date/slot/book → list → reschedule → cancel → history',async()=>{await navigate('/patient/book');await selectSlot();await navigate('/patient/appointments');await has('Synthetic Doctor');await click('Reschedule');await selectSlot(true);await navigate('/patient/appointments');await click('Cancel Appointment');await has('cancelled');await navigate('/patient/history');await has('Cancelled');});
  await test('patient query error/retry and failed identity are explicit rather than indefinite/empty',async()=>{failure.table='appointments';await navigate('/patient/appointments');await has('Synthetic query failure');failure.table=null;await click('Retry');await has('No Appointments Yet');failure.identity=true;await navigate('/patient/dashboard');await has('Synthetic identity unavailable');failure.identity=false;await click('Retry account loading');await wait(()=>evaluate("document.body.innerText.includes('Dashboard')"),'identity recovery');});
  await test('patient session alone cannot access staff; independent admin login restores staff routes',async()=>{await navigate('/appointments/dashboard');await has('Clinic Admin Portal');await login('admin');await wait(()=>evaluate("location.pathname==='/appointments/dashboard'"),'admin dashboard');for(const [path,label]of [['dashboard','Dashboard'],['booking','Booking'],['check-in','Check-in'],['patients','Patients'],['doctors','Doctors'],['reports','Reports'],['settings','Settings']]){await navigate('/appointments/'+path);await has(label);}});
  await test('separate SDK storage keys coexist; admin logout preserves patient session',async()=>{assert.deepEqual(await evaluate("['medical-patient','medical-appointments-staff'].map(k=>Boolean(localStorage.getItem(k)))"),[true,true]);await click('Sign out');await has('Clinic Admin Portal');assert.deepEqual(await evaluate("['medical-patient','medical-appointments-staff'].map(k=>Boolean(localStorage.getItem(k)))"),[true,false]);await navigate('/patient/dashboard');await has('Dashboard');});
  await test('wrong-role restored sessions fail closed in both portals; patient logout and login again work',async()=>{
   await evaluate(`localStorage.setItem('medical-appointments-staff',JSON.stringify(${JSON.stringify(session('patient'))}))`);await navigate('/appointments/dashboard');await has('not an admin account');
   await evaluate(`localStorage.setItem('medical-patient',JSON.stringify(${JSON.stringify(session('admin'))}))`);await navigate('/patient/dashboard');await has('not a patient account');
   await evaluate(`localStorage.setItem('medical-patient',JSON.stringify(${JSON.stringify(session('patient'))}))`);await navigate('/patient/dashboard');await has('Dashboard');await click('Sign out');await has('My Health Portal');assert.equal(await evaluate("localStorage.getItem('medical-patient')"),null);await login('patient');await wait(()=>evaluate("location.pathname==='/patient/dashboard'"),'patient login again');
  });
  await test('clinic appointment display identical under Manila/UTC/New York browser timezones',async()=>{
   appointments=[{id:'30000000-0000-0000-0000-000000000099',patient_id:patient.id,doctor_id:doctor.id,scheduled_time:clinicInstant(future,'09:00'),status:'scheduled',source:'pre_booked'}];const displays=[];
   for(const timezoneId of ['Asia/Manila','UTC','America/New_York']){await call('Emulation.setTimezoneOverride',{timezoneId});await navigate('/patient/appointments');await has('Synthetic Doctor');displays.push(await evaluate("document.querySelector('article p.tabular-nums').textContent"));}assert.equal(displays[0],displays[1]);assert.equal(displays[0],displays[2]);
  });
  await test('mobile viewport login/patient/booking and invalid nested route behavior',async()=>{await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await navigate('/patient/book');await has('Select Doctor');assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`scripts/phase4-${name.toLowerCase()}-mobile.png`,Buffer.from(shot.data,'base64'));await navigate('/patient/not-a-route');assert.equal(await evaluate("document.querySelector('#root').textContent.trim()"),'');await navigate('/not-a-route');await has('My Health Portal');});
 }catch(error){if(socket?.readyState===1){socket.send(JSON.stringify({id:99999,method:'Runtime.evaluate',params:{expression:"console.log('Synthetic browser verification stopped')"}}));}throw error;}finally{socket?.close();child.kill();await sleep(500);assert.ok(resolve(temporary).startsWith(resolve(tmpdir())+sep));try{rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{/* OS may finish browser child cleanup later; private synthetic profile only. */}}
}
try{for(const [name,path]of [['Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['Edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]){
 if(existsSync(path)){appointments=[];await browser(name,path);}else checks.push({browser:name,result:'NOT VERIFIED',reason:'Browser not installed'});
}assert.equal(errors.length,0);writeFileSync('scripts/phase4-browser-results.json',JSON.stringify({timestamp:new Date().toISOString(),boundary:'Actual built React/SDK; Auth/REST mocked, all non-loopback HTTP intercepted and remote WebSockets replaced; hosted E2E NOT VERIFIED',remoteRequestsIntercepted:remoteRequests,frontendCredentialRoleCategories:[...frontendCredentialRoles],checks},null,2)+'\n');console.log(checks.length+' browser checks passed; no hosted request allowed.');}
finally{server.close();}
