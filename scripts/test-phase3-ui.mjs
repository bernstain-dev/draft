// Real handlers/hooks/components, synthetic clients, mocked network only.
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
registerHooks({
  resolve(specifier,context,next) {try{return next(specifier,context);}catch(error){
    if(specifier.startsWith('.')&&context.parentURL){const base=fileURLToPath(new URL(specifier,context.parentURL));for(const ext of ['.ts','.tsx'])if(existsSync(base+ext))return{url:pathToFileURL(base+ext).href,shortCircuit:true};}throw error;
  }},
  load(url,context,next){if(!/\.tsx?$/.test(url))return next(url,context);
    if(url.endsWith('/src/lib/supabaseClient.ts'))return{format:'module',shortCircuit:true,source:'export function createAppClient(key){return globalThis.__phase3Clients[key];}'};
    if(url.endsWith('/src/pages/patient/auth/patientAuth.tsx'))return{format:'module',shortCircuit:true,source:'export function usePatientAuth(){return globalThis.__phase3LoginAuth;}'};
    if(url.endsWith('/src/pages/appointments/auth/staffAuth.tsx'))return{format:'module',shortCircuit:true,source:'export function useStaffAuth(){return globalThis.__phase3LoginAuth;}'};
    const source=readFileSync(fileURLToPath(url),'utf8').replaceAll('import.meta.env','({VITE_NOTIFY_ENABLED:"true"})');
    return{format:'module',shortCircuit:true,source:ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  },
});
const {confirmationHandler,reminderHandler,noticeText}=await import('../supabase/functions/_shared/handlers.ts');
const {sendNotification}=await import('../supabase/functions/_shared/notify.ts');
const {csvCell,csvText}=await import('../src/lib/csv.ts');
const {doctorFormError,patientFormError}=await import('../src/lib/formValidation.ts');
const {useMutation}=await import('../src/lib/useMutation.ts');
const {useClinicQuery}=await import('../src/lib/useClinicQuery.ts');
const {default:QueryState}=await import('../src/components/QueryState.tsx');
const {default:PatientLink}=await import('../src/components/PatientLink.tsx');
const {useAppointmentRealtime}=await import('../src/lib/useAppointmentRealtime.ts');
const {subscribeAppointmentChanges}=await import('../src/lib/appointmentChanges.ts');
const {notifyAppointment}=await import('../src/lib/notifications.ts');
const {deliveryHandler}=await import('../supabase/functions/_shared/delivery.ts');
const {IdentityCoordinator}=await import('../src/lib/asyncState.ts');
const {fetchAllRows}=await import('../src/lib/fetchAllRows.ts');
const {default:PatientLogin}=await import('../src/pages/patient/PatientLogin.tsx');
const {default:StaffLogin}=await import('../src/pages/appointments/StaffLogin.tsx');
const {usePortalAuth}=await import('../src/lib/usePortalAuth.ts');
const origin='http://localhost:5173', appointment='30000000-0000-0000-0000-000000000001',other='30000000-0000-0000-0000-000000000002';
const settings={NOTIFY_ALLOWED_ORIGINS:origin,CRON_SECRET:'synthetic-cron-secret',TWILIO_ACCOUNT_SID:'synthetic-sid',TWILIO_AUTH_TOKEN:'synthetic-token',TWILIO_FROM_NUMBER:'+639123456789'};
const env=key=>settings[key];
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const sleep=(ms=8)=>new Promise(done=>setTimeout(done,ms));
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
function fixture(){let status='pending',networkCalls=0;const service={
  auth:{getUser:async()=>({data:{user:null},error:null})},
  async rpc(name,args){if(name==='queue_due_appointment_reminders')return{data:0,error:null};
    if(name==='claim_appointment_notifications'){if(status!=='pending')return{data:[],error:null};status='processing';return{data:[{event_id:appointment,lease_token:other,notification_type:'confirmation',scheduled_time:'2030-10-10T01:00:00Z',contact_number:'09123456789'}],error:null};}
    if(name==='finish_appointment_notification'){status=args.p_status;return{data:true,error:null};}
    if(name==='notification_result')return{data:{status,provider:'twilio',accepted:status==='accepted',stubbed:status==='stubbed',error:null,delivery:'not_verified'},error:null};throw new Error(name);
  }};
  const deps={env,serviceClient:()=>service,userClient:auth=>({auth:{getUser:async()=>({data:{user:auth==='Bearer invalid'?null:{id:auth}},error:null})},
    async rpc(name,args){assert.equal(name,'request_appointment_notification');if(auth==='Bearer patient'&&args.p_appointment_id===other)return{data:null,error:{code:'42501'}};return{data:appointment,error:null};}}),
    network:async()=>{networkCalls++;return new Response(JSON.stringify({sid:'SM'+'a'.repeat(32),status:'queued'}),{status:201});}};
  return{deps,get calls(){return networkCalls;}};
}
const request=(body,auth='patient',extra={})=>new Request('https://synthetic.invalid/functions/v1/send-confirmation',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth,'Content-Type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
await test('A: OPTIONS and all allowed-origin success/error responses carry consistent restrictive CORS',async()=>{
  const {deps}=fixture(),handler=confirmationHandler(deps);
  const options=await handler(new Request('https://synthetic.invalid',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'}}));assert.equal(options.status,204);
  for(const response of [options,await handler(request({appointment_id:appointment})),await handler(request('null'))]){
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.match(response.headers.get('Access-Control-Allow-Headers'),/authorization/);assert.equal(response.headers.get('Access-Control-Allow-Methods'),'POST, OPTIONS');
  }
  const forbidden=await handler(request({appointment_id:appointment},'patient',{Origin:'https://untrusted.invalid'}));assert.equal(forbidden.status,403);assert.equal(forbidden.headers.get('Access-Control-Allow-Origin'),null);
});
await test('B: malformed JSON, null, missing ID, invalid UUID and invalid type are rejected',async()=>{
  const {deps}=fixture(),handler=confirmationHandler(deps);
  for(const body of ['{','null','[]',{}, {appointment_id:'not-a-uuid'}, {appointment_id:appointment,type:'bad'}]) assert.equal((await handler(request(body))).status,400);
});
await test('C: unauthenticated/invalid token/other patient rejected; own patient and admin accepted',async()=>{
  for(const [auth,id,status]of [['',appointment,401],['invalid',appointment,401],['patient',other,403],['patient',appointment,200],['admin',other,200]]){
    const {deps}=fixture();let req=request({appointment_id:id},auth);if(!auth)req.headers.delete('Authorization');assert.equal((await confirmationHandler(deps)(req)).status,status);
  }
});
await test('D: provider rejection/5xx/transport failure cannot produce acceptance or leak provider body/secrets',async()=>{
  for(const code of [400,429,500]){
    const {deps}=fixture();deps.network=async()=>new Response('synthetic-provider-secret',{status:code});
    const response=await confirmationHandler(deps)(request({appointment_id:appointment}));const data=await response.json();assert.equal(data.ok,false);assert.equal(data.accepted,false);assert.equal(data.delivery,'not_verified');assert.doesNotMatch(JSON.stringify(data),/synthetic-provider-secret|synthetic-token/);
  }
  const result=await sendNotification('09123456789','Synthetic appointment',env,async()=>{throw new Error('sensitive transport payload');});assert.equal(result.status,'unknown');assert.equal(result.retry,false);assert.doesNotMatch(JSON.stringify(result),/sensitive/);
});
await test('E/F: repeated confirmation/reminder handler execution sends the accepted event once',async()=>{
  const f=fixture(),handler=confirmationHandler(f.deps);
  const first=await(await handler(request({appointment_id:appointment}))).json();assert.equal(first.accepted,true);
  const second=await(await handler(request({appointment_id:appointment}))).json();assert.equal(second.duplicate,true);assert.equal(f.calls,1);
  const reminders=reminderHandler(f.deps);
  assert.equal((await reminders(new Request('https://synthetic.invalid',{method:'POST'}))).status,401);
  for(let i=0;i<2;i++)await reminders(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-cron-secret':settings.CRON_SECRET}}));assert.equal(f.calls,1);
});
await test('G: reminder display is Manila-specific under three runtime timezones and contains no patient/medical fields',()=>{
  const outputs=['Asia/Manila','UTC','America/New_York'].map(zone=>{
    const r=spawnSync(process.execPath,['--input-type=module','-e',"import {noticeText} from './supabase/functions/_shared/handlers.ts'; console.log(noticeText('reminder','2030-10-10T01:00:00Z'));"],{encoding:'utf8',env:{...process.env,TZ:zone},windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();
  });assert.equal(outputs[0],outputs[1]);assert.equal(outputs[1],outputs[2]);assert.match(outputs[0],/9:00|09:00/);assert.match(outputs[0],/Philippine time/);
  assert.doesNotMatch(noticeText('cancellation','2030-10-10T01:00:00Z'),/patient name|diagnosis|reason/i);
});
await test('L: CSV neutralizes formulas in patient/doctor/contact/text values while preserving Unicode and quotes',()=>{
  for(const text of ['=HYPERLINK("evil")','+639123456789','-1+2','@SUM(1)',' \t=evil','\tformula','\r=evil','\n@evil'])assert.ok(csvCell(text).startsWith('"\''),text);
  assert.equal(csvCell('José García'), '"José García"');assert.equal(csvCell('ordinary "text"'),'"ordinary ""text"""');assert.equal(csvCell(-1),'"-1"');assert.ok(csvText(['patient','doctor','contact','reason'],[['=evil','@evil','+1234567','-evil']]).startsWith('\uFEFF'));
});
await test('M: doctor and patient forms reject nonblank/length/contact/impossible or future DOB errors',()=>{
  for(const [name,specialty]of [[' ','General'],['X'.repeat(201),'General'],['Doctor',' '],['Doctor','X'.repeat(121)]])assert.ok(doctorFormError(name,specialty));
  assert.equal(doctorFormError('José Doctor','Family Medicine'),null);
  const valid={full_name:'Synthetic Patient',date_of_birth:'2000-01-01',contact_number:'09123456789',address:'Synthetic address'};
  assert.equal(patientFormError(valid),null);for(const value of ['2030-02-31','2099-01-01'])assert.ok(patientFormError({...valid,date_of_birth:value}));assert.ok(patientFormError({...valid,contact_number:'=evil'}));
});
await test('N/P: actual intentional-link UI requires verification/exact UUID, rejects conflicts and sends one request',async()=>{
  let calls=0,linked=0;const pending=deferred();globalThis.confirm=()=>true;
  const client={rpc:()=>{calls++;return pending.promise;}};const patient={id:'10000000-0000-0000-0000-000000000001',full_name:'Synthetic Clinic Patient',date_of_birth:'2000-01-01'};let tree;
  await act(async()=>{tree=Renderer.create(React.createElement(PatientLink,{client,patient,onLinked:()=>linked++}));});
  await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}});});assert.equal(calls,0);
  await act(async()=>tree.root.findByProps({'aria-label':'Verified Auth UUID'}).props.onChange({target:{value:'00000000-0000-0000-0000-000000000004'}}));
  await act(async()=>tree.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  let first;
  await act(async()=>{first=tree.root.findByType('form').props.onSubmit({preventDefault(){}});tree.root.findByType('form').props.onSubmit({preventDefault(){}});await sleep();});assert.equal(calls,1);
  await act(async()=>{pending.resolve({data:null,error:{message:'This account already has a patient record. No histories merged.'}});await first;});assert.equal(linked,0);assert.match(JSON.stringify(tree.toJSON()),/already has a patient record/);
  await act(async()=>tree.unmount());
});
await test('O: real query UI distinguishes loading, failure, retrying, and loaded empty',async()=>{
  const calls=[];let query,tree;
  function Probe(){query=useClinicQuery('synthetic',()=>{const d=deferred();calls.push(d);return d.promise;},[]);return query.loading||query.error?React.createElement(QueryState,{query}):React.createElement('p',null,query.data.length?'Rows':'Loaded empty');}
  await act(async()=>{tree=Renderer.create(React.createElement(Probe));await sleep();});assert.match(JSON.stringify(tree.toJSON()),/Loading/);
  await act(async()=>calls[0].resolve(Promise.reject(new Error('Synthetic database failure'))));assert.match(JSON.stringify(tree.toJSON()),/failure/);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/Loaded empty/);
  await act(async()=>{tree.root.findByType('button').props.onClick();await sleep();});assert.match(JSON.stringify(tree.toJSON()),/Retrying/);
  await act(async()=>calls[1].resolve([]));assert.match(JSON.stringify(tree.toJSON()),/Loaded empty/);await act(async()=>tree.unmount());
});
await test('P: mutation gate blocks same-tick duplicate submits and recovers after thrown failure',async()=>{
  let gate,calls=0,tree,error;const pending=deferred();function Probe(){gate=useMutation(message=>error=message);return null;}
  await act(async()=>{tree=Renderer.create(React.createElement(Probe));});let first;
  await act(async()=>{first=gate.run(async()=>{calls++;await pending.promise;});await gate.run(async()=>calls++);});assert.equal(calls,1);assert.equal(gate.pending,true);
  await act(async()=>{pending.resolve();await first;});assert.equal(gate.pending,false);
  await act(async()=>gate.run(async()=>{throw new Error('Synthetic failure');}));assert.equal(error,'Synthetic failure');assert.equal(gate.pending,false);await act(async()=>tree.unmount());
});
await test('Q: staff-only Realtime has one subscription, debounced invalidation and cleanup on identity/role/unmount',async()=>{
  const channels=[],removed=[];let refreshes=0;const unsubscribe=subscribeAppointmentChanges(()=>refreshes++);
  const client={channel(name){const channel={name,on(event,filter,callback){assert.equal(event,'postgres_changes');assert.deepEqual(filter,{event:'*',schema:'public',table:'appointments'});channel.callback=callback;return channel;},subscribe(){return channel;}};channels.push(channel);return channel;},async removeChannel(channel){removed.push(channel);}};
  function Probe({id,role}){useAppointmentRealtime(client,id,role);return null;}let tree;
  await act(async()=>{tree=Renderer.create(React.createElement(Probe,{id:'patient',role:'patient'}));});assert.equal(channels.length,0);
  await act(async()=>tree.update(React.createElement(Probe,{id:'admin',role:'admin'})));assert.equal(channels.length,1);
  for(let i=0;i<20;i++)channels[0].callback();await sleep(350);assert.equal(refreshes,1);
  channels[0].callback();await act(async()=>tree.update(React.createElement(Probe,{id:'patient',role:'patient'})));await sleep(350);assert.equal(removed.length,1);assert.equal(refreshes,1);
  await act(async()=>tree.update(React.createElement(Probe,{id:'admin2',role:'admin'})));await act(async()=>tree.unmount());assert.equal(removed.length,2);unsubscribe();
});
await test('Frontend notification wording reflects accepted/stubbed/failed structured results',async()=>{
  for(const [data,match]of [[{accepted:true},/accepted by provider.*not yet verified/],[{stubbed:true},/not sent/],[{accepted:false,error:'provider_rejected'},/not accepted/]]){
    const message=await notifyAppointment({functions:{invoke:async()=>({data,error:null})}},appointment,'confirmation');assert.match(message,match);assert.doesNotMatch(message,/Confirmation sent/);
  }
});
await test('Signed delivery callback rejects forged/tampered requests and accepts independently computed HMAC',async()=>{
  const callbackUrl='https://synthetic.invalid/functions/v1/notification-status';let calls=0;
  const callbackEnv=key=>key==='NOTIFY_STATUS_CALLBACK_URL'?callbackUrl:env(key);
  const handler=deliveryHandler(callbackEnv,()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'record_notification_delivery');assert.equal(args.p_status,'delivered');return{data:true,error:null};}}));
  const form=new URLSearchParams({MessageSid:'SM'+'a'.repeat(32),MessageStatus:'delivered'});
  const signature=createHmac('sha1',settings.TWILIO_AUTH_TOKEN).update(callbackUrl+[...form.keys()].sort().map(k=>k+form.get(k)).join('')).digest('base64');
  const req=sig=>new Request(callbackUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','x-twilio-signature':sig},body:form});
  assert.equal((await handler(req('forged'))).status,403);assert.equal(calls,0);
  assert.equal((await handler(req(signature))).status,200);assert.equal(calls,1);
  form.set('MessageStatus','failed');assert.equal((await handler(req(signature))).status,403);assert.equal(calls,1);
});
await test('Query/identity deadlines end hanging loads and cannot commit a later stale result',async()=>{
  const request=deferred();let query,tree;
  function Probe(){query=useClinicQuery('slow',()=>request.promise,[],20);return null;}
  await act(async()=>{tree=Renderer.create(React.createElement(Probe));await sleep(40);});assert.equal(query.loading,false);assert.match(query.error,/timed out/);
  await act(async()=>request.resolve(['late']));assert.deepEqual(query.data,[]);await act(async()=>tree.unmount());
  const identityRequest=deferred();let state,signal;
  const identity=new IdentityCoordinator((_user,s)=>{signal=s;return identityRequest.promise;},value=>state=value,20);
  assert.match(await identity.accept({id:'synthetic'}),/timed out/);assert.equal(state.loading,false);assert.equal(state.patient,null);assert.equal(signal.aborted,true);identity.dispose();
});
await test('Exact-count pagination handles lower server row caps and fails on truncated/error results',async()=>{
  const result=await fetchAllRows(offset=>Promise.resolve({data:[offset,offset+1].slice(0,Math.min(2,5-offset)),count:5,error:null}));assert.deepEqual(result,[0,1,2,3,4]);
  await assert.rejects(fetchAllRows(()=>Promise.resolve({data:[],count:10,error:null})),/incomplete/);
  await assert.rejects(fetchAllRows(()=>Promise.resolve({data:[],count:0,error:{message:'Synthetic query failure'}})),/failure/);
});
await test('Demonstration seeder refuses a hosted URL before creating a client or touching data',()=>{
  const result=spawnSync(process.execPath,['supabase/seed.cjs'],{encoding:'utf8',windowsHide:true,env:{...process.env,SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-backend-key'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Hosted seeding is refused/);assert.doesNotMatch(result.stdout+result.stderr,/synthetic-backend-key/);
});
await test('Patient registration/login and staff login block repeated submissions in mounted forms',async()=>{
  for(const [Component,signup]of [[PatientLogin,false],[PatientLogin,true],[StaffLogin,false]]){
    const pending=deferred();let calls=0,tree;
    globalThis.__phase3LoginAuth={error:null,signIn:()=>{calls++;return pending.promise;},signUp:()=>{calls++;return pending.promise;}};
    await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(Component)));});
    if(signup)await act(async()=>tree.root.findAllByType('button').find(b=>b.props.children==='Create account').props.onClick());
    let first;
    await act(async()=>{first=tree.root.findByType('form').props.onSubmit({preventDefault(){}});tree.root.findByType('form').props.onSubmit({preventDefault(){}});await sleep();});assert.equal(calls,1);
    await act(async()=>{pending.resolve('Synthetic authentication failure');await first;});assert.match(JSON.stringify(tree.toJSON()),/Synthetic authentication failure/);
    await act(async()=>tree.unmount());
  }
  delete globalThis.__phase3LoginAuth;
});
await test('Initial Auth session read has a deadline and ignores a late initial result',async()=>{
  const session=deferred();let auth,tree,unsubscribed=0;
  const client={auth:{getSession:()=>session.promise,onAuthStateChange:()=>({data:{subscription:{unsubscribe(){unsubscribed++;}}}})}};
  function Probe(){auth=usePortalAuth(client,'patient',20);return null;}
  await act(async()=>{tree=Renderer.create(React.createElement(Probe));await sleep(45);});
  assert.equal(auth.loading,false);assert.match(auth.error,/initialization timed out/);assert.equal(auth.patient,null);
  await act(async()=>session.resolve({data:{session:{user:{id:'stale-initial'}}},error:null}));
  assert.equal(auth.user,null);assert.match(auth.error,/timed out/);
  await act(async()=>tree.unmount());assert.equal(unsubscribed,1);
});
console.log(`\n${passed} Phase 3 handler/UI/timezone checks passed. All provider calls mocked.`);
