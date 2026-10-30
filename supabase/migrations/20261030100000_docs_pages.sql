-- Internal knowledgebase (distinct from the existing panel-docs user
-- guide, which stays a static, hardcoded manual for the platform
-- itself). docs_pages holds staff-written pages -- SOPs, troubleshooting
-- notes, process docs -- editable from the new "Bază de cunoștințe" tab.
-- Reuses the 'docs' staff_roles module (see 20261026090330_add_docs_staff_role,
-- which added the role for parity even though nothing read it yet) as
-- the write gate, same read-everyone/write-gated split every other
-- module already uses.
create table public.docs_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  content text not null default '',
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only history -- cheap "who changed this and when" without
-- building a full diff/restore UI for v1.
create table public.docs_page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.docs_pages(id) on delete cascade,
  content text not null,
  edited_by text,
  edited_at timestamptz not null default now()
);

create or replace function public.set_docs_pages_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger docs_pages_set_updated_at
before update on public.docs_pages
for each row execute function public.set_docs_pages_updated_at();

alter table public.docs_pages enable row level security;
alter table public.docs_page_revisions enable row level security;

-- Any signed-in staff account can read (same as every other module),
-- only 'docs'-role (or god) holders can write.
create policy "Staff can read docs_pages" on public.docs_pages
  for select using (is_staff());
create policy "Staff can insert docs_pages" on public.docs_pages
  for insert with check (is_staff() and staff_permission('docs') = 'write');
create policy "Staff can update docs_pages" on public.docs_pages
  for update using (is_staff() and staff_permission('docs') = 'write')
  with check (is_staff() and staff_permission('docs') = 'write');
create policy "Staff can delete docs_pages" on public.docs_pages
  for delete using (is_staff() and staff_permission('docs') = 'write');

create policy "Staff can read docs_page_revisions" on public.docs_page_revisions
  for select using (is_staff());
create policy "Staff can insert docs_page_revisions" on public.docs_page_revisions
  for insert with check (is_staff() and staff_permission('docs') = 'write');

alter publication supabase_realtime add table public.docs_pages;
