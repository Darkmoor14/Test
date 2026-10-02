-- ============================================================
-- "Produse" — fourth ERP/Resurse-si-inventar subcategory. Reuses
-- equipment_inventory with item_type='material' (same quantity/unit/
-- reorder/stock-ledger behavior as Materiale), distinguished purely
-- by erp_category='produs' for which sidebar tab a row lives under —
-- same pattern the echipament/masina split already uses.
-- ============================================================
alter table public.equipment_inventory drop constraint equipment_inventory_erp_category_check;
alter table public.equipment_inventory add constraint equipment_inventory_erp_category_check
  check (erp_category = any (array['echipament','masina','material','produs']));

alter table public.entity_log drop constraint entity_log_entity_type_check;
alter table public.entity_log add constraint entity_log_entity_type_check
  check (entity_type = any (array['project','backlog','lookahead','echipament','masina','material','produs']));

-- ============================================================
-- HR module — employees, worktime/extra-hours log, vacation-days-used
-- log. God-only end to end (personal data + salary), same posture as
-- Stare sistem: RLS enforces it at the DB layer, applyRolePermissionsToUI
-- hides the nav client-side.
-- ============================================================
create table public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  date_of_birth date,
  address text,
  salary numeric,
  vacation_days_allowed numeric not null default 21,
  created_at timestamptz not null default now()
);

create table public.hr_worktime_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  work_date date not null,
  hours_worked numeric not null default 0,
  extra_hours numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table public.hr_vacation_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days_used numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

create index hr_worktime_entries_employee_id_idx on public.hr_worktime_entries(employee_id);
create index hr_vacation_entries_employee_id_idx on public.hr_vacation_entries(employee_id);

alter table public.hr_employees enable row level security;
alter table public.hr_worktime_entries enable row level security;
alter table public.hr_vacation_entries enable row level security;

create policy "God can read hr_employees" on public.hr_employees for select using (is_god());
create policy "God can insert hr_employees" on public.hr_employees for insert with check (is_god());
create policy "God can update hr_employees" on public.hr_employees for update using (is_god()) with check (is_god());
create policy "God can delete hr_employees" on public.hr_employees for delete using (is_god());

create policy "God can read hr_worktime_entries" on public.hr_worktime_entries for select using (is_god());
create policy "God can insert hr_worktime_entries" on public.hr_worktime_entries for insert with check (is_god());
create policy "God can update hr_worktime_entries" on public.hr_worktime_entries for update using (is_god()) with check (is_god());
create policy "God can delete hr_worktime_entries" on public.hr_worktime_entries for delete using (is_god());

create policy "God can read hr_vacation_entries" on public.hr_vacation_entries for select using (is_god());
create policy "God can insert hr_vacation_entries" on public.hr_vacation_entries for insert with check (is_god());
create policy "God can update hr_vacation_entries" on public.hr_vacation_entries for update using (is_god()) with check (is_god());
create policy "God can delete hr_vacation_entries" on public.hr_vacation_entries for delete using (is_god());
