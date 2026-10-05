-- READ-ONLY diagnostic for the Phase 3 demographic preflight.
-- Returns counts only: no names, contact values, addresses, DOBs or patient IDs.
-- Does not depend on Phase 3 helper functions (the failed migration rolls them back).
begin read only;
with checks as (
  select
    (full_name is not null and length(btrim(full_name)) between 1 and 300
      and full_name !~ '[[:cntrl:]]') as name_ok,
    (contact_number is null or (contact_number ~ '^\+?[0-9][0-9 ()-]{5,24}$'
      and length(regexp_replace(contact_number,'[^0-9]','','g')) between 7 and 15)) as contact_ok,
    (address is null or (length(btrim(address)) between 0 and 500
      and address !~ '[[:cntrl:]]')) as address_ok,
    (date_of_birth is null or (isfinite(date_of_birth)
      and date_of_birth >= date '1900-01-01'
      and date_of_birth <= (now() at time zone 'Asia/Manila')::date)) as dob_ok,
    (contact_number is not null and contact_number ~ '^[[:space:]]*$') as blank_contact
  from public.patients
)
select
  count(*) filter (where not name_ok or not contact_ok or not address_ok or not dob_ok) as invalid_patient_rows,
  count(*) filter (where not name_ok) as invalid_name_rows,
  count(*) filter (where not contact_ok) as invalid_contact_rows,
  count(*) filter (where not contact_ok and blank_contact) as blank_contact_rows,
  count(*) filter (where not contact_ok and not blank_contact) as invalid_nonblank_contact_rows,
  count(*) filter (where not address_ok) as invalid_address_rows,
  count(*) filter (where not dob_ok) as invalid_dob_rows
from checks;
commit;
