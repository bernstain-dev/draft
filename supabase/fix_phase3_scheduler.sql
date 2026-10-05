-- OPTIONAL staging installation AFTER Phase 3 SQL and Edge Functions.
-- Enable pg_cron, pg_net and Supabase Vault beforehand. Never paste secrets here.
-- Vault names: medicappointment_url, medicappointment_anon_key,
-- medicappointment_cron_secret (same server-only CRON_SECRET as the function).
begin;
do $$ begin
  if to_regprocedure('public.queue_due_appointment_reminders(timestamp with time zone)') is null then raise exception 'Install Phase 3 notifications first.'; end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regclass('cron.job') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then raise exception 'Enable Supabase Vault, pg_cron and pg_net first.'; end if;
  if (select count(distinct name) from vault.decrypted_secrets where name in ('medicappointment_url','medicappointment_anon_key','medicappointment_cron_secret'))<>3 then
    raise exception 'Configure three named Vault secrets before scheduling. No values displayed.'; end if;
end $$;
create or replace function public._invoke_notification_worker()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_secret text; begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='medicappointment_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name='medicappointment_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='medicappointment_cron_secret';
  if v_url is null or v_key is null or v_secret is null then raise exception 'Notification Vault configuration missing.'; end if;
  return net.http_post(url:=rtrim(v_url,'/')||'/functions/v1/send-reminders',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key,'x-cron-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function public._invoke_notification_worker() from public,anon,authenticated,service_role;
select cron.schedule('medicappointment-notification-worker','*/5 * * * *','select public._invoke_notification_worker();');
commit;
