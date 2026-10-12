-- Regression from the earlier full/limited -> god/inginer/contabilitate
-- role migration: this trigger was missed and still checked for the
-- literal old role string 'full', which no longer exists in
-- staff_roles -- so EVERY account, including god, got blocked from
-- saving the "Ce s-a facut" field via the repair-sheet import,
-- because v_staff_role (now 'god'/'inginer'/'contabilitate') was
-- always "distinct from 'full'". Replaced with the same
-- staff_permission('tickets') = 'write' check every other
-- tickets-write policy already uses (also fixes it to recognize
-- multiple roles per person, which the old single-row lookup ignored).
create or replace function public.enforce_resolution_note_permission()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(current_setting('app.propagating_duplicate_resolution', true), 'false') = 'true' then
    return NEW;
  end if;

  if staff_permission('tickets') is distinct from 'write' then
    if NEW.resolution_note is distinct from OLD.resolution_note
       and NEW.resolution_note is not null
       and NEW.resolution_note <> '' then
      raise exception 'Nu aveți permisiunea de a completa acest câmp.';
    end if;
    NEW.resolution_note := OLD.resolution_note;
  end if;

  return NEW;
end;
$$;
