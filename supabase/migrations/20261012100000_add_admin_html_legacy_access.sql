-- Standalone role system for admin.html only, fully decoupled from
-- staff_roles (which admin-3.html's own, evolving role model owns).
-- Mirrors admin.html's original documented design exactly: 'full'
-- (default, unrestricted) or 'limited' (can do everything except
-- write tickets.resolution_note). Changing staff_roles for admin-3
-- purposes can never affect this table or anyone in it.
create table public.admin_html_access (
  email text primary key,
  role text not null check (role in ('full', 'limited')),
  created_at timestamptz not null default now()
);

alter table public.admin_html_access enable row level security;

-- Read-only to the account itself (matches what admin.html's own
-- fetchCurrentUserRole() needs); no insert/update/delete policies for
-- anon/authenticated at all -- managed directly via migrations, same
-- as how this worked before admin-3's Roluri tab existed.
create policy "Staff can read their own admin_html_access row"
  on public.admin_html_access for select
  using (email = auth.jwt()->>'email');

insert into public.admin_html_access (email, role) values
  ('vlasbogdan@insta-grup.ro', 'full'),
  ('sesizari@insta-grup.ro', 'limited');

-- staff_permission() gains an additive floor: a 'full' row here
-- grants write on every module, independent of whatever staff_roles
-- says for that email (which may change, be added to, or be
-- restructured for admin-3 at any time, without ever touching this).
-- 'limited' rows contribute nothing here -- that one narrow
-- restriction (can't write resolution_note) is enforced directly by
-- enforce_resolution_note_permission(), not through this
-- general-purpose permission function.
create or replace function public.staff_permission(p_module text)
returns text
language sql
stable security definer
set search_path to 'public'
as $$
  select case coalesce(max(lvl), 0)
    when 2 then 'write'
    when 1 then 'view'
    else 'none'
  end
  from (
    select case role
      when 'god' then 2
      when 'inginer' then case p_module when 'erp' then 1 else 2 end
      when 'contabilitate' then case p_module when 'erp' then 2 else 1 end
      else 0
    end as lvl
    from public.staff_roles
    where email = auth.jwt()->>'email'
    union all
    select case role when 'full' then 2 else 0 end as lvl
    from public.admin_html_access
    where email = auth.jwt()->>'email'
  ) t;
$$;

-- No logic change to the trigger itself -- staff_permission('tickets')
-- above already incorporates admin_html_access. Comment-only update
-- so a future reader sees the connection without digging for it.
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

  -- staff_permission('tickets') covers both systems: staff_roles
  -- (admin-3.html's own role model) and admin_html_access (admin.html's
  -- independent full/limited floor, which always grants 'write' here
  -- for a 'full' row regardless of what staff_roles says).
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
