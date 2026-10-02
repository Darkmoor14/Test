-- HR (Angajati/Pontaj/Concediu) opened up to every signed-in staff
-- account, view and write both — no per-role split here, unlike
-- tickets/proiecte/erp. Was god-only; per request, now matches is_staff().
alter policy "God can read hr_employees" on public.hr_employees using (is_staff());
alter policy "God can insert hr_employees" on public.hr_employees with check (is_staff());
alter policy "God can update hr_employees" on public.hr_employees using (is_staff()) with check (is_staff());
alter policy "God can delete hr_employees" on public.hr_employees using (is_staff());

alter policy "God can read hr_worktime_entries" on public.hr_worktime_entries using (is_staff());
alter policy "God can insert hr_worktime_entries" on public.hr_worktime_entries with check (is_staff());
alter policy "God can update hr_worktime_entries" on public.hr_worktime_entries using (is_staff()) with check (is_staff());
alter policy "God can delete hr_worktime_entries" on public.hr_worktime_entries using (is_staff());

alter policy "God can read hr_vacation_entries" on public.hr_vacation_entries using (is_staff());
alter policy "God can insert hr_vacation_entries" on public.hr_vacation_entries with check (is_staff());
alter policy "God can update hr_vacation_entries" on public.hr_vacation_entries using (is_staff()) with check (is_staff());
alter policy "God can delete hr_vacation_entries" on public.hr_vacation_entries using (is_staff());

alter policy "God can read hr_employees" on public.hr_employees rename to "Staff can read hr_employees";
alter policy "God can insert hr_employees" on public.hr_employees rename to "Staff can insert hr_employees";
alter policy "God can update hr_employees" on public.hr_employees rename to "Staff can update hr_employees";
alter policy "God can delete hr_employees" on public.hr_employees rename to "Staff can delete hr_employees";

alter policy "God can read hr_worktime_entries" on public.hr_worktime_entries rename to "Staff can read hr_worktime_entries";
alter policy "God can insert hr_worktime_entries" on public.hr_worktime_entries rename to "Staff can insert hr_worktime_entries";
alter policy "God can update hr_worktime_entries" on public.hr_worktime_entries rename to "Staff can update hr_worktime_entries";
alter policy "God can delete hr_worktime_entries" on public.hr_worktime_entries rename to "Staff can delete hr_worktime_entries";

alter policy "God can read hr_vacation_entries" on public.hr_vacation_entries rename to "Staff can read hr_vacation_entries";
alter policy "God can insert hr_vacation_entries" on public.hr_vacation_entries rename to "Staff can insert hr_vacation_entries";
alter policy "God can update hr_vacation_entries" on public.hr_vacation_entries rename to "Staff can update hr_vacation_entries";
alter policy "God can delete hr_vacation_entries" on public.hr_vacation_entries rename to "Staff can delete hr_vacation_entries";
