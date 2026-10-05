-- Optional, reviewed staging configuration; execute separately from migrations.
begin;
do $$ begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'Supabase Realtime publication is missing.'; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;
-- Keep DEFAULT replica identity: do not replicate full old patient/reason payloads.
commit;
