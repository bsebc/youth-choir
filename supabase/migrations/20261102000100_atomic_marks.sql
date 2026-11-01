-- Save one event's attendance marks or song order in a single transaction.
--
-- The app used to write the event, then delete the changed rows, then insert
-- the new ones, as separate requests. A dropped connection in between could
-- leave a new event with nobody marked absent (so everyone counted as
-- present), or lose marks that were deleted but never re-inserted.
-- This function applies exactly the same change, all or nothing. It runs with
-- the caller's rights (security invoker), so the row-level security policies
-- still decide who may write. The app falls back to the old step-by-step save
-- if this function is missing, so it can be applied before or after the page.
--
-- p_event: {"id": ...} for an existing event, plus any of date, kind, label,
--          name, cancelled to change; without "id", the new event's fields.
-- p_mode:  'att' (absences) or 'songs' (song order).
-- p_del:   singer or song ids whose stored row must go or change.
-- p_ins:   rows to write: {"singer_id","status"} or
--          {"song_id","position","conductor_id","pianist_id"}.
create or replace function public.save_marks(
  p_event jsonb,
  p_mode  text,
  p_del   uuid[] default '{}',
  p_ins   jsonb  default '[]'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_event ->> 'id', '')::uuid;
  v_want int;   -- stored rows that should go
  v_done int;   -- rows that actually went
begin
  if p_mode is null or p_mode not in ('att', 'songs') then
    raise exception 'p_mode must be att or songs' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.events (date, kind, label, name, cancelled, attendance_taken)
    values ((p_event ->> 'date')::date, p_event ->> 'kind', p_event ->> 'label',
            nullif(p_event ->> 'name', ''), coalesce((p_event ->> 'cancelled')::boolean, false),
            -- a date cancelled before anyone was marked stays unmarked
            p_mode = 'att' and not coalesce((p_event ->> 'cancelled')::boolean, false))
    returning id into v_id;
  else
    update public.events e set
      date      = coalesce((p_event ->> 'date')::date, e.date),
      kind      = coalesce(p_event ->> 'kind', e.kind),
      label     = coalesce(p_event ->> 'label', e.label),
      name      = case when p_event ? 'name' then nullif(p_event ->> 'name', '') else e.name end,
      cancelled = coalesce((p_event ->> 'cancelled')::boolean, e.cancelled),
      attendance_taken = e.attendance_taken
        or (p_mode = 'att' and not coalesce((p_event ->> 'cancelled')::boolean, e.cancelled))
    where e.id = v_id;
    if not found then
      raise exception 'event % not found, or not yours to change', v_id using errcode = '42501';
    end if;
  end if;

  if p_mode = 'att' then
    -- A delete that row-level security filters out removes nothing and raises
    -- nothing, so count what should go and stop if it did not all go.
    select count(*) into v_want from public.absences a
     where a.event_id = v_id and a.singer_id = any (coalesce(p_del, '{}'));
    delete from public.absences a
     where a.event_id = v_id and a.singer_id = any (coalesce(p_del, '{}'));
    get diagnostics v_done = row_count;
    if v_done < v_want then
      raise exception 'not allowed to change these marks' using errcode = '42501';
    end if;
    insert into public.absences (event_id, singer_id, status)
    select v_id, (r ->> 'singer_id')::uuid, coalesce(r ->> 'status', 'absent')
      from jsonb_array_elements(coalesce(p_ins, '[]'::jsonb)) r
    on conflict (event_id, singer_id) do update set status = excluded.status;
  else
    select count(*) into v_want from public.event_songs s
     where s.event_id = v_id and s.song_id = any (coalesce(p_del, '{}'));
    delete from public.event_songs s
     where s.event_id = v_id and s.song_id = any (coalesce(p_del, '{}'));
    get diagnostics v_done = row_count;
    if v_done < v_want then
      raise exception 'not allowed to change this song order' using errcode = '42501';
    end if;
    insert into public.event_songs (event_id, song_id, position, conductor_id, pianist_id)
    select v_id, (r ->> 'song_id')::uuid, (r ->> 'position')::int,
           nullif(r ->> 'conductor_id', '')::uuid, nullif(r ->> 'pianist_id', '')::uuid
      from jsonb_array_elements(coalesce(p_ins, '[]'::jsonb)) r
    on conflict (event_id, song_id) do update
      set position = excluded.position, conductor_id = excluded.conductor_id, pianist_id = excluded.pianist_id;
  end if;

  return v_id;
end
$$;

revoke all on function public.save_marks(jsonb, text, uuid[], jsonb) from public, anon;
grant execute on function public.save_marks(jsonb, text, uuid[], jsonb) to authenticated;
