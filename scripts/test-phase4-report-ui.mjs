// Actual portal components and read-only PostgreSQL RPCs. Synthetic Auth shim;
// no Supabase HTTP, hosted credentials, notifications, or deployment.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { renderedText } from './rendered-text.mjs';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

registerHooks({
  resolve(specifier,context,next) {
    try { return next(specifier,context); }
    catch (error) {
      if (specifier.startsWith('.') && context.parentURL) {
        const base=fileURLToPath(new URL(specifier,context.parentURL));
        for (const ext of ['.ts','.tsx']) if (existsSync(base+ext)) return {url:pathToFileURL(base+ext).href,shortCircuit:true};
      }
      throw error;
    }
  },
  load(url,context,next) {
    if (!/\.tsx?$/.test(url)) return next(url,context);
    if (url.endsWith('/src/pages/appointments/auth/staffAuth.tsx')) return {format:'module',shortCircuit:true,
      source:'export function getStaffClient(){return globalThis.__phase4ReportClient;} export function useStaffAuth(){return globalThis.__phase4ReportAuth;}'};
    return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}
    }).outputText};
  }
});

export async function verifyReportPages(db,uid) {
  const {default:Dashboard}=await import('../src/pages/appointments/Dashboard.tsx');
  const {default:Reports}=await import('../src/pages/appointments/Reports.tsx');
  const {default:StaffLayout}=await import('../src/pages/appointments/StaffLayout.tsx');
  const {clinicDateKey,clinicInstant}=await import('../src/lib/clinicTime.ts');
  const today=clinicDateKey(), empty='2120-01-01';
  const quote=value=>value==null?'null':"'"+String(value).replaceAll("'","''")+"'";
  let actor='admin',failRpc=null;
  const calls=[];
  function query(statement) {
    const result=db.sql(`begin read only; set local role authenticated;
      set local request.jwt.claim.sub=${quote(uid[actor])}; ${statement} commit;`,'phase3_test',true);
    if (result.status!==0) return {data:null,error:{message:result.stderr.match(/ERROR:\s*([^\r\n]*)/)?.[1]??'Local query failed'}};
    return {data:JSON.parse(result.stdout.trim()),error:null};
  }
  globalThis.__phase4ReportClient={
    rpc(name,args) {
      calls.push({name,args});
      return {abortSignal(signal) {
        assert.equal(signal.aborted,false);
        if (failRpc===name) { failRpc=null; return Promise.resolve(query('select 1/0;')); }
        if (name==='staff_appointment_report') return Promise.resolve(query(`select public.staff_appointment_report(${quote(args.p_from)},${quote(args.p_to)},${quote(args.p_doctor_id)});`));
        assert.equal(name,'staff_report_audit');
        return Promise.resolve(query(`select public.staff_report_audit(${quote(args.p_from)},${quote(args.p_to)},${quote(args.p_action)},${Number(args.p_offset)},${Number(args.p_limit)});`));
      }};
    },
    from(table) {
      assert.equal(table,'appointments');
      const range={offset:0,limit:500};
      const builder={
        select(){return this;},gte(_,value){range.start=value;return this;},lt(_,value){range.end=value;return this;},
        order(){return this;},range(from,to){range.offset=from;range.limit=to-from+1;return this;},
        abortSignal(signal) {
          assert.equal(signal.aborted,false);
          const result=query(`with rows as (
            select a.id,a.scheduled_time,a.status,a.room,a.source,
              jsonb_build_object('full_name',p.full_name) patient,jsonb_build_object('full_name',d.full_name) doctor
            from public.appointments a join public.patients p on p.id=a.patient_id join public.doctors d on d.id=a.doctor_id
            where a.scheduled_time>=${quote(range.start)} and a.scheduled_time<${quote(range.end)})
            select jsonb_build_object('count',(select count(*) from rows),'data',coalesce((select jsonb_agg(x) from
              (select * from rows order by scheduled_time,id offset ${range.offset} limit ${range.limit})x),'[]'));`);
          return Promise.resolve(result.error?result:{...result.data,error:null});
        }
      };
      return builder;
    }
  };
  // Use existing synthetic IDs; a completed visit creates no external send.
  db.sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status)
    values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',${quote(clinicInstant(today,'09:00'))},'completed');`);
  let mounted;
  const text=()=>JSON.stringify(mounted.toJSON());
  async function until(predicate,label) {
    const deadline=Date.now()+10000;
    while (!predicate()) {
      assert.ok(Date.now()<deadline,'Timed out: '+label+'; rendered '+text().slice(0,400));
      await act(async()=>{await new Promise(done=>setTimeout(done,10));});
    }
  }
  async function mount(component,path) {
    await act(async()=>{mounted=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(component)));});
  }
  const unmount=async()=>{await act(async()=>mounted.unmount());};
  const clickRetry=async()=>{const button=mounted.root.findAllByType('button').find(b=>renderedText(b)==='Retry');assert.ok(button);await act(async()=>button.props.onClick());};
  const hasAlert=()=>mounted.root.findAll(n=>n.props.role==='alert').length>0;
  const dashboardLoaded=()=>mounted.root.findAllByType('h1').some(n=>n.children.includes('Daily overview'));
  const reportsLoaded=()=>mounted.root.findAllByType('h1').some(n=>n.children.includes('Reports and admin'));
  try {
    await mount(Dashboard,'/appointments/dashboard');
    await until(dashboardLoaded,'dashboard SQL data');
    assert.equal(hasAlert(),false);assert.match(text(),/Same Name/);
    assert.ok(mounted.root.findAllByType('button').some(b=>b.props.title==='1 appointments'));
    assert.doesNotMatch(text(),/SELECT FOR SHARE/);
    await act(async()=>mounted.root.findByProps({type:'month'}).props.onChange({target:{value:empty.slice(0,7)}}));
    await until(()=>dashboardLoaded()&&text().includes('No appointments match this filter.'),'dashboard empty state');
    assert.equal(hasAlert(),false);
    await unmount();
    console.log('PASS Dashboard component loads actual SQL day/calendar data and normal empty state without the lock error');

    failRpc='staff_appointment_report';
    await mount(Dashboard,'/appointments/dashboard');
    await until(()=>text().includes('division by zero'),'dashboard real SQL error');
    await clickRetry();await until(dashboardLoaded,'dashboard Retry recovery');assert.equal(hasAlert(),false);
    await unmount();
    console.log('PASS Dashboard exposes an actual SQL failure and Retry reloads data');

    await mount(Reports,'/appointments/reports');
    await until(()=>reportsLoaded()&&text().includes('"create"'),'reports and audit SQL data');
    const total=mounted.root.findAllByType('p').find(n=>n.children.includes('Total appointments'));
    assert.equal(total.parent.findAllByType('p')[1].children.join(''),'1');
    assert.equal(hasAlert(),false);assert.doesNotMatch(text(),/SELECT FOR SHARE/);
    await act(async()=>{for(const input of mounted.root.findAllByProps({type:'date'}))input.props.onChange({target:{value:empty}});});
    await until(()=>reportsLoaded()&&text().includes('No data in range.')&&text().includes('No audit activity in this date range/filter.'),'reports empty state');
    assert.equal(hasAlert(),false);await unmount();
    console.log('PASS Reports component loads actual SQL totals/audit and normal empty states');

    for (const rpc of ['staff_appointment_report','staff_report_audit']) {
      failRpc=rpc;await mount(Reports,'/appointments/reports');
      await until(()=>text().includes('division by zero'),'report real SQL error '+rpc);
      await clickRetry();await until(()=>reportsLoaded()&&!hasAlert()&&text().includes('"create"'),'reports Retry '+rpc);
      await unmount();
    }
    console.log('PASS Reports totals and audit each expose actual SQL failures and recover through Retry');

    actor='patient';
    await mount(Reports,'/appointments/reports');
    await until(()=>text().includes('Administrator authorization required.'),'patient backend denial');
    assert.equal(reportsLoaded(),false);assert.doesNotMatch(text(),/Same Name/);await unmount();
    console.log('PASS patient calling the Reports component still receives database authorization denial');

    // Route guard uses real StaffLayout; supply only synthetic identity state.
    const savedDocument=globalThis.document;
    globalThis.document={body:{style:{}}};
    globalThis.__phase4ReportAuth={user:{id:uid.patient},profile:{role:'patient'},role:'patient',loading:false,error:null};
    try {
      for (const [path,component] of [['/appointments/dashboard',Dashboard],['/appointments/reports',Reports]]) {
        const before=calls.length;
        await act(async()=>{mounted=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},
          React.createElement(Routes,null,
            React.createElement(Route,{element:React.createElement(StaffLayout)},React.createElement(Route,{path,element:React.createElement(component)})),
            React.createElement(Route,{path:'/appointments/login',element:React.createElement('p',null,'Staff login')}))));});
        await until(()=>text().includes('Staff login'),'patient protected route redirect');
        assert.equal(calls.length,before);await unmount();
      }
    } finally {globalThis.document=savedDocument;}
    console.log('PASS patient is redirected away from both staff routes before report RPCs execute');
  } finally {
    if (mounted) await unmount();
    delete globalThis.__phase4ReportClient;delete globalThis.__phase4ReportAuth;
  }
}
