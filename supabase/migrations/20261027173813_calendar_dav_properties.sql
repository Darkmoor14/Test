-- Backs calendar-dav's PROPPATCH support: a client's own calendar
-- display properties (currently calendar-color and calendar-order,
-- e.g. iOS/macOS setting the color it was given for this calendar)
-- have nowhere else to live, so they ride along on the same per-person
-- row that already exists for the feed token.
ALTER TABLE public.calendar_feed_tokens ADD COLUMN IF NOT EXISTS dav_properties jsonb NOT NULL DEFAULT '{}'::jsonb;
