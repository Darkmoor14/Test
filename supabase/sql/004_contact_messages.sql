-- New table + RPC for the site's contact form (index.html), which
-- previously had no backing table at all -- it called the
-- bright-processor Edge Function directly with the anon key and
-- whatever the visitor typed, with nothing to validate or rate-limit
-- the caller. This gives it the same accept-once-then-validate shape
-- as the ticket form.

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  from_name text not null,
  from_email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

create policy "staff can read contact messages"
  on public.contact_messages for select
  to authenticated
  using (true);
-- No insert/update/delete policy for anyone -- all writes go through
-- submit_contact_message() below (SECURITY DEFINER).

create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_message text,
  p_captcha_token text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'anon' then
    perform public.check_and_log_rate_limit();

    if not public.verify_captcha(p_captcha_token) then
      raise exception 'CAPTCHA verification failed. Please try again.'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.contact_messages (from_name, from_email, message)
  values (p_name, p_email, p_message);
end;
$$;

grant execute on function public.submit_contact_message(text, text, text, text) to anon, authenticated;
