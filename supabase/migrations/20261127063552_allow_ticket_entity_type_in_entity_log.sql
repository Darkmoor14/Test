-- Tickets' React mutations (saveTicketCard, archiveSelected, markDuplicates,
-- createTicket, etc.) have been calling logEntityActivity('ticket', ...) for
-- a while, but entity_log's own check constraint never allowed 'ticket' as
-- an entity_type -- every one of those inserts has been silently failing
-- (logEntityActivity swallows insert errors by design, so it never surfaced)
-- and ticket edits never showed up in Jurnal de activitate as a result.
alter table public.entity_log drop constraint entity_log_entity_type_check;
alter table public.entity_log add constraint entity_log_entity_type_check
  check (entity_type = any (array['ticket','project','backlog','lookahead','echipament','masina','material','produs']));
