-- Live updates: open pages refresh themselves when their data changes, without anyone pressing reload.
--
-- Every table that matters already writes a row to public.audit_log on each change (app.log_change), and that row
-- carries the branch. A trigger on audit_log sends a Supabase Realtime broadcast that says only "something changed"
-- (no data, no ids) to a topic for that branch. The browser listens on the topics its staff member may watch and,
-- when a signal arrives, asks the server to render the page again; the server reads the data through row level
-- security as usual, so nothing a staff member couldn't already see ever reaches them.
--
-- Topics:
--   erp:branch:<branch id>  changes to a branch's members, plans, loans, payments, top ups, receipts, ...
--   erp:org                 changes with no branch (HR, settings, products, roles, ...)
--   erp:staff:<staff id>    changes to a client this staff member brought in, or to their sign-up links, which may
--                           sit in a branch they don't otherwise see
--
-- Topics are private channels: realtime.messages policies below decide who may join each one, and nobody may send
-- on them from the browser. One signal per topic per transaction, so a bulk job (the daily interest run, say)
-- sends at most one per branch.

-- Who may listen on a topic.
create or replace function app.can_watch_live_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.staff s where s.id = auth.uid() and s.is_active) then
    return false;
  end if;
  if p_topic = 'erp:org' then
    return true;
  end if;
  if p_topic ~ '^erp:(branch|staff):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := split_part(p_topic, ':', 3)::uuid;
    if p_topic like 'erp:staff:%' then
      return v_id = auth.uid();
    end if;
    return exists (
      select 1
      from public.my_permissions() mp
      where (mp.branch_id is null and mp.region_id is null)
         or mp.branch_id = v_id
         or mp.region_id = (select b.region_id from public.branches b where b.id = v_id)
    );
  end if;
  return false;
end;
$$;
revoke all on function app.can_watch_live_topic(text) from public, anon;
grant execute on function app.can_watch_live_topic(text) to authenticated;

-- The topics the signed-in staff member should join: the organisation, themselves, and every branch they hold any
-- permission in (all of them for organisation-wide roles, the region's branches for regional ones).
create or replace function public.my_live_topics()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.staff s where s.id = auth.uid() and s.is_active) then '{}'::text[]
    else array['erp:org', 'erp:staff:' || auth.uid()::text] || coalesce((
      select array_agg('erp:branch:' || b.id::text order by b.code)
      from public.branches b
      where exists (
        select 1
        from public.my_permissions() mp
        where (mp.branch_id is null and mp.region_id is null) or mp.branch_id = b.id or mp.region_id = b.region_id
      )
    ), '{}'::text[])
  end;
$$;
revoke all on function public.my_live_topics() from public, anon;
grant execute on function public.my_live_topics() to authenticated;

-- Sends the "something changed" signal for one audit_log row.
create or replace function app.broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := coalesce(new.new_data, new.old_data);
  v_staff uuid;
  v_topics text[];
  v_topic text;
  v_sent text;
begin
  -- Databases without Supabase Realtime (local tests) simply skip the signal.
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    return null;
  end if;

  v_topics := array[case when new.branch_id is null then 'erp:org' else 'erp:branch:' || new.branch_id::text end];

  -- The staff member who brought a client in follows that client, whichever branch the client is in.
  if new.table_name = 'public.members' then
    v_staff := nullif(v_row ->> 'introduced_by', '')::uuid;
  elsif new.table_name = 'public.member_signup_links' then
    v_staff := nullif(v_row ->> 'created_by', '')::uuid;
  elsif v_row ? 'member_id' and nullif(v_row ->> 'member_id', '') is not null then
    select m.introduced_by into v_staff from public.members m where m.id = (v_row ->> 'member_id')::uuid;
  end if;
  if v_staff is not null then
    v_topics := v_topics || ('erp:staff:' || v_staff::text);
  end if;

  v_sent := coalesce(current_setting('app.live_topics_sent', true), '');
  foreach v_topic in array v_topics loop
    if position('|' || v_topic || '|' in v_sent) = 0 then
      perform realtime.send('{}'::jsonb, 'changed', v_topic, true);
      v_sent := v_sent || '|' || v_topic || '|';
    end if;
  end loop;
  perform set_config('app.live_topics_sent', v_sent, true);
  return null;
exception when others then
  -- A missed signal only means someone presses reload; it must never stop the change itself.
  return null;
end;
$$;
revoke all on function app.broadcast_change() from public, anon, authenticated;

drop trigger if exists audit_log_broadcast on public.audit_log;
create trigger audit_log_broadcast
  after insert on public.audit_log
  for each row execute function app.broadcast_change();

-- Who may join a topic. There is deliberately no insert policy: browsers can listen, never send.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "staff listen to their live topics" on realtime.messages';
    execute $p$
      create policy "staff listen to their live topics" on realtime.messages
        for select to authenticated
        using (realtime.messages.extension = 'broadcast' and app.can_watch_live_topic((select realtime.topic())))
    $p$;
  end if;
end;
$$;
