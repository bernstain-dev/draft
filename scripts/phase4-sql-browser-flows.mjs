// Extended verification only. This runs inside the SQL-backed browser harness.
import assert from 'node:assert/strict';
export async function extendedBrowserTests({test,navigate,has,fill,click,evaluate,wait,bridge,rpcFailures,future,patient,observations=[]}) {
  await test('patient demographic save persists through SQL and refresh',async()=>{
    await navigate('/patient/profile');await has('Save Changes');await wait(()=>evaluate("document.querySelector('input[placeholder=\"Juan Dela Cruz\"]')?.value==='Synthetic Patient'"),'patient form populated');assert.ok(await fill('textarea','Synthetic updated address'));assert.equal(await evaluate("document.querySelector('form').checkValidity()"),true,'patient form native validity');await click('Save Changes');
    await wait(()=>bridge.owner(`select address from public.patients where id='${patient.id}';`).stdout.trim()==='Synthetic updated address','patient saved in SQL');
    assert.equal(bridge.owner(`select address from public.patients where id='${patient.id}';`).stdout.trim(),'Synthetic updated address');
    await wait(()=>evaluate("document.querySelector('textarea')?.value==='Synthetic updated address'"),'saved profile after identity refresh');
    if(!(await evaluate('document.body.innerText')).includes('Your profile has been updated.'))observations.push({severity:'LOW',status:'STILL BROKEN',finding:'Patient profile success message disappears during identity refresh; SQL save and refreshed fields succeed',boundary:'Actual local browser/SQL; synthetic Auth',scope:'Documented; no unrelated UI change'});
    await navigate('/patient/profile');await wait(()=>evaluate("document.querySelector('textarea')?.value==='Synthetic updated address'"),'saved patient profile');
  });
  await test('staff creates, searches and edits a clinic patient with SQL persistence',async()=>{
    await navigate('/appointments/patients');await has('New patient');await click('New patient');await has('Create patient');
    await fill('input[placeholder="Full name *"]','Verification Clinic Patient');await fill('form input[type=date]','1990-01-01');await fill('form input[placeholder="Contact number"]','09123456780');await fill('input[placeholder="Address"]','Synthetic clinic address');await click('Save');await has('Patient created.');
    await fill('input[placeholder="Name"]','Verification Clinic Patient');await click('Search');await has('Verification Clinic Patient');await click('Edit');await has('Edit patient');await fill('input[placeholder="Address"]','Synthetic edited clinic address');await click('Save');await has('Patient updated.');
    assert.equal(bridge.owner("select address from public.patients where full_name='Verification Clinic Patient';").stdout.trim(),'Synthetic edited clinic address');
  });
  await test('staff doctor create/edit/activate and working-hour/block CRUD persists through SQL',async()=>{
    await navigate('/appointments/doctors');await has('Add doctor');await fill('input[placeholder="Full name *"]','Verification Doctor');await fill('input[placeholder="Specialty"]','Synthetic specialty');await click('Add doctor');await has('Verification Doctor');
    await evaluate("[...document.querySelectorAll('button.dk-panel')].find(e=>e.textContent.includes('Verification Doctor')).click()");await has('Save doctor details');await fill('input[aria-label="Edit doctor specialty"]','Edited specialty');await click('Save doctor details');await has('Doctor details updated.');
    await fill('form:has(button[type=submit]) input[type=time]:nth-of-type(2)','13:00');await fill('form:has(button[type=submit]) input[type=time]:nth-of-type(3)','14:00');await click('Add working hours');await has('Schedule added.');
    await fill('input[type=date]',future);await fill('input[placeholder="Reason (leave/holiday)"]','Synthetic leave');await click('Block date');await has('Unavailable date blocked.');await click('Unblock');await has('Date unblocked.');await click('Remove');await has('Working hours removed.');
    const toggle="[...document.querySelectorAll('button.dk-panel')].find(e=>e.textContent.includes('Verification Doctor')).querySelector('[role=button]').click()";
    await evaluate(toggle);await wait(()=>bridge.owner("select is_active from public.doctors where full_name='Verification Doctor';").stdout.trim()==='f','doctor deactivated');
    await wait(()=>evaluate("[...document.querySelectorAll('button.dk-panel')].some(e=>e.textContent.includes('Verification Doctor')&&e.textContent.includes('Activate')&&!e.disabled)"),'doctor toggle refreshed');
    await evaluate(toggle);await wait(()=>bridge.owner("select is_active from public.doctors where full_name='Verification Doctor';").stdout.trim()==='t','doctor activated');
  });
  const staffSlot=async()=>{await wait(()=>evaluate("[...document.querySelectorAll('button.tabular-nums')].some(e=>!e.disabled)"),'staff slots');await evaluate("[...document.querySelectorAll('button.tabular-nums')].find(e=>!e.disabled).click()");};
  const staffBook=async()=>{
    await navigate('/appointments/booking');await has('Book appointment');await fill('input[type=date]',future);await fill('input[placeholder="Search patient by name"]','Synthetic Patient');await click('Find patient');
    await wait(()=>evaluate("[...document.querySelectorAll('form select option')].some(e=>e.value==='"+patient.id+"')"),'patient search');await fill('form select',patient.id);await staffSlot();await click('Book appointment');await has('Booked.');
  };
  await test('staff books, moves and cancels through protected SQL RPCs',async()=>{
    await staffBook();const id=bridge.owner(`select id from public.appointments where patient_id='${patient.id}' and status='scheduled';`).stdout.trim();assert.match(id,/^[0-9a-f-]{36}$/);
    await wait(()=>evaluate(`[...document.querySelectorAll('select')].some(e=>e.options[0]?.textContent==='— appointment —'&&[...e.options].some(o=>o.value==='${id}'))`),'reschedule selector loaded');
    assert.equal(await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>e.options[0]?.textContent==='— appointment —');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'${id}');e.dispatchEvent(new Event('change',{bubbles:true}));return e.value==='${id}'})()`),true);await staffSlot();await click('Move');await has('Rescheduled (audit logged).');await click('Cancel');await has('Cancelled (audit logged).');assert.equal(bridge.owner(`select status from public.appointments where id='${id}';`).stdout.trim(),'cancelled');
  });
  await test('staff check-in, waiting, room, completion and visit note persist with audit',async()=>{
    bridge.owner(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status,source) values('${patient.id}','20000000-0000-0000-0000-000000000001',date_trunc('day',now() at time zone 'Asia/Manila') at time zone 'Asia/Manila','scheduled','pre_booked');`);
    await navigate('/appointments/check-in');await has('Check-in');await has('Synthetic Patient');await click('Check in');await has('Checked in.');await click('Move to waiting');await has('Status: waiting');assert.ok(await fill('input[placeholder="Room"]','Synthetic Room'));await click('Call to room');await has('Status: in_progress');assert.ok(await fill('input[placeholder="Visit note…"]','Synthetic clinical test note'));await click('Save');await has('Visit note saved.');await click('Complete visit');await has('Status: completed');
    assert.equal(bridge.owner(`select count(*) from public.appointments where patient_id='${patient.id}' and status='completed' and room='Synthetic Room';`).stdout.trim(),'1');assert.equal(bridge.owner("select count(*) from public.patient_visit_notes where note='Synthetic clinical test note';").stdout.trim(),'1');
  });
  await test('staff Dashboard/Reports real SQL totals, audit, CSV and Retry recover',async()=>{
    await navigate('/appointments/dashboard');await has('Dashboard');assert.ok(!(await evaluate('document.body.innerText')).includes('SELECT FOR SHARE'));
    await navigate('/appointments/reports');await has('Reports and admin');assert.ok(await fill('label:nth-of-type(2) input[type=date]',future));await wait(()=>evaluate(`document.querySelector('label:nth-of-type(2) input[type=date]')?.value==='${future}'`),'report end date loaded');assert.ok(await fill('label:first-of-type input[type=date]',future));await wait(()=>evaluate(`document.querySelector('label:first-of-type input[type=date]')?.value==='${future}'`),'report start date loaded');await has('Synthetic Doctor');await has('matching entries');
    await evaluate("window.__csv=[];const original=URL.createObjectURL;URL.createObjectURL=b=>{window.__csv.push(b.text());return original(b)}");await click('CSV');const csv=await evaluate("Promise.all(window.__csv)");assert.equal(csv.length,1);assert.ok(csv[0].includes('Synthetic Doctor'));assert.ok(csv[0].includes('"doctor","total","completed","cancelled","no_show","walk_in"'));
    rpcFailures.staff_appointment_report=true;await navigate('/appointments/reports');await has('Synthetic report failure');await click('Retry');await has('Reports and admin');assert.ok(!(await evaluate('document.body.innerText')).includes('SELECT FOR SHARE'));
  });
}
