-- Reverts 20261030100000_docs_pages.sql -- the internal knowledgebase
-- (Bază de cunoștințe) was built, then dropped one request later as
-- not worth it right now. Removing cleanly rather than leaving unused
-- tables/policies behind; the realtime publication entry goes away
-- automatically when the table is dropped.
drop trigger if exists docs_pages_set_updated_at on public.docs_pages;
drop function if exists public.set_docs_pages_updated_at();
drop table if exists public.docs_page_revisions;
drop table if exists public.docs_pages;
