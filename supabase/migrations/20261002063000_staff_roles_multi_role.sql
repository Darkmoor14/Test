-- ============================================================
-- STAFF ROLES — allow more than one role per person (e.g. inginer +
-- contabilitate together), without that being the same as 'god'.
-- staff_roles goes from one row per email to one row per
-- (email, role) pair; effective permission per module is now the
-- highest ('write' > 'view' > 'none') across all of a person's roles.
-- ============================================================

alter table public.staff_roles drop constraint staff_roles_pkey;
alter table public.staff_roles add primary key (email, role);

create or replace function public.staff_permission(p_module text)
returns text
language sql
stable
security definer
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
  ) t;
$$;

create or replace function public.is_god()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists(select 1 from public.staff_roles where email = auth.jwt()->>'email' and role = 'god');
$$;

-- dan.hidos@yahoo.com: inginer -> contabilitate, per explicit request.
update public.staff_roles set role = 'contabilitate' where email = 'dan.hidos@yahoo.com' and role = 'inginer';
