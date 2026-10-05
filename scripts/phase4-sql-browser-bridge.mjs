// Verification transport only. Synthetic Auth is NOT GoTrue/JWT verification;
// REST translation is NOT PostgREST. Business RPCs/ACLs/RLS run in real local SQL.
import assert from 'node:assert/strict';
export const bridgeIds={admin:'00000000-0000-0000-0000-000000000001',patient:'00000000-0000-0000-0000-000000000002'};
export const bridgePatient='10000000-0000-0000-0000-000000000001';
export const bridgeDoctor='20000000-0000-0000-0000-000000000001';
const tables=new Set(['profiles','patients','doctors','doctor_schedules','doctor_unavailable_dates','appointments','patient_visit_notes','audit_log','notification_attempts']);
const literal=value=>value===null?'null':typeof value==='boolean'||typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const identifier=value=>{assert.match(value,/^[a-z_][a-z_0-9]*$/i);return '"'+value+'"';};
export function sqlBrowserBridge(db,database) {
  let statements=0;
  const owner=statement=>db.sql(statement,database);
  const catalog=JSON.parse(owner(`select jsonb_agg(jsonb_build_object('name',p.proname,'set',p.proretset,'volatility',p.provolatile))
    from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and l.lanname in ('sql','plpgsql');`).stdout);
  function execute(role,statement,readOnly=true) {
    statements++;
    const result=db.sql(`\\set VERBOSITY verbose
      begin ${readOnly?'read only':''}; set local role ${role?'authenticated':'anon'};
      set local request.jwt.claim.sub=${literal(bridgeIds[role]??'')}; ${statement} commit;`,database,true);
    if(result.status!==0) {
      const [,code,message]=result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):\s*([^\r\n]*)/)??[];
      return {status:code==='42501'?403:400,data:{code:code??'local_sql_error',message:message??'Local SQL request failed'}};
    }
    return {data:JSON.parse(result.stdout.trim()||'null')};
  }
  function filters(search,alias='t') {
    const conditions=[];
    for(const [key,value]of search) {
      if(['select','order','limit','offset','on_conflict'].includes(key))continue;
      if(key==='or') {
        const branches=value.replace(/^\(|\)$/g,'').split(',').map(part=>{
          const [column,op,...rest]=part.split('.');assert.equal(op,'ilike');
          return `${alias}.${identifier(column)} ilike ${literal(rest.join('.'))}`;
        });conditions.push('('+branches.join(' or ')+')');continue;
      }
      const [op,...rest]=value.split('.'),val=rest.join('.'),column=`${alias}.${identifier(key)}`;
      if(op==='in')conditions.push(`${column} in (${val.replace(/^\(|\)$/g,'').split(',').map(literal).join(',')})`);
      else if(op==='is') {assert.ok(['null','true','false'].includes(val));conditions.push(`${column} is ${val}`);}
      else {const operator={eq:'=',neq:'<>',gte:'>=',gt:'>',lte:'<=',lt:'<',ilike:'ilike'}[op];assert.ok(operator,'Unsupported filter '+op);conditions.push(`${column} ${operator} ${literal(val)}`);}
    }
    return conditions.length?' where '+conditions.join(' and '):'';
  }
  function response(url,request,role) {
    const u=new URL(url),body=request.postData?JSON.parse(request.postData):{};
    const header=name=>Object.entries(request.headers).find(([key])=>key.toLowerCase()===name)?.[1]??'';
    const rpc=u.pathname.split('/rpc/')[1];
    if(rpc) {
      identifier(rpc);const fn=catalog.find(fn=>fn.name===rpc);assert.ok(fn,'Unknown RPC '+rpc);
      const call=`public.${identifier(rpc)}(${Object.entries(body).map(([key,value])=>`${identifier(key)}=>${literal(value)}`).join(',')})`;
      return execute(role,fn.set?`select coalesce(jsonb_agg(x),'[]') from ${call} x;`:`select to_jsonb(${call});`,fn.volatility!=='v');
    }
    const table=u.pathname.split('/rest/v1/')[1];assert.ok(tables.has(table),'Unexpected table');
    const qualified='public.'+identifier(table),where=filters(u.searchParams);
    const method=request.method;
    if(method==='GET'||method==='HEAD') {
      let base=`select t.* from ${qualified} t${where}`;
      if(table==='appointments')base=`select t.*,to_jsonb(p) patient,to_jsonb(d) doctor,to_jsonb(p) patients,to_jsonb(d) doctors
        from ${qualified} t left join public.patients p on p.id=t.patient_id left join public.doctors d on d.id=t.doctor_id${where}`;
      const order=(u.searchParams.get('order')??'id.asc').split(',').map(part=>{const [key,direction='asc']=part.split('.');assert.ok(['asc','desc'].includes(direction));return `${identifier(key)} ${direction}`;}).join(',');
      const offset=Number(u.searchParams.get('offset')??0),limit=Number(u.searchParams.get('limit')??1000);
      assert.ok(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>0);
      const result=execute(role,`with rows as (${base})select jsonb_build_object('count',(select count(*) from rows),'rows',coalesce((select jsonb_agg(x) from (select * from rows order by ${order} offset ${offset} limit ${limit})x),'[]'));`);
      if(result.status)return result;
      const {count,rows}=result.data,object=header('accept').includes('vnd.pgrst.object');
      if(object&&rows.length!==1)return {status:406,data:{code:'PGRST116',message:'Expected exactly one row'}};
      return {data:object?rows[0]:rows,head:method==='HEAD',headers:[{name:'Content-Range',value:`${offset}-${Math.max(offset,offset+rows.length-1)}/${count}`} ]};
    }
    let operation;
    if(method==='POST') {
      assert.ok(!Array.isArray(body));const keys=Object.keys(body);
      operation=`insert into ${qualified}(${keys.map(identifier).join(',')}) values(${keys.map(key=>literal(body[key])).join(',')}) returning *`;
    } else if(method==='PATCH')operation=`update ${qualified} t set ${Object.entries(body).map(([key,value])=>`${identifier(key)}=${literal(value)}`).join(',')}${where} returning t.*`;
    else {assert.equal(method,'DELETE');operation=`delete from ${qualified} t${where} returning t.*`;}
    const result=execute(role,`with changed as (${operation})select coalesce(jsonb_agg(to_jsonb(changed)),'[]') from changed;`,false);
    if(result.status)return result;
    const object=header('accept').includes('vnd.pgrst.object');
    if(object&&result.data.length!==1)return {status:406,data:{code:'PGRST116',message:'Expected exactly one changed row'}};
    return {data:object?result.data[0]:result.data};
  }
  return {response,owner,get statements(){return statements;}};
}
