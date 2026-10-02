-- Salary removed from the HR module per request — no longer tracked
-- anywhere on the platform (UI form, table, and now the column itself).
alter table public.hr_employees drop column if exists salary;
