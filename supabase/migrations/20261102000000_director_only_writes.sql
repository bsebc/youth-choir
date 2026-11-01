-- Only the director may change anything.
--
-- Until now every policy said "any signed-in account may write", and storage
-- said the same. Sign-ups were open on the youth project, so anyone could have
-- created an account and rewritten or deleted the choir's history. This:
--   1. keeps a private list of director accounts (the one account that exists
--      when it first runs) and a function the policies use to ask about it;
--   2. limits every table write and every file write to directors, and lets
--      only directors open sheets kept under locked/;
--   3. lets guests add usage-log rows only in the shape the app sends, at a
--      bounded rate, so the log can't be flooded or poisoned;
--   4. takes away table privileges the public key never needs;
--   5. adds the three indexes the performance advisor asks for.
-- Same file for both choirs. Safe to run more than once. Pages that are already
-- open keep working: the director's current session is a director's session.
--
-- To add another director later (after they have an account):
--   insert into choir_private.directors (user_id)
--   select id from auth.users where email = '...';

-- 1. directors ---------------------------------------------------------------
create schema if not exists choir_private;
revoke all on schema choir_private from public;
grant usage on schema choir_private to anon, authenticated;

create table if not exists choir_private.directors (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table choir_private.directors enable row level security;
revoke all on choir_private.directors from public, anon, authenticated;

do $$
declare n int;
begin
  if not exists (select 1 from choir_private.directors) then
    select count(*) into n from auth.users;
    if n <> 1 then
      raise exception 'expected exactly one account (the director) but found %; list the directors by hand', n;
    end if;
    insert into choir_private.directors (user_id) select id from auth.users;
  end if;
end $$;

create or replace function choir_private.is_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from choir_private.directors where user_id = (select auth.uid()))
$$;
revoke all on function choir_private.is_director() from public;
grant execute on function choir_private.is_director() to anon, authenticated;

-- 2. table writes: directors only. Reads stay public, as before. ----------------
do $$
declare t text;
begin
  foreach t in array array['singers', 'songs', 'events', 'absences', 'event_songs', 'song_categories', 'documents'] loop
    execute format('drop policy if exists "director insert" on public.%I', t);
    execute format('drop policy if exists "director update" on public.%I', t);
    execute format('drop policy if exists "director delete" on public.%I', t);
    execute format('create policy "director insert" on public.%I for insert to authenticated
                      with check ((select choir_private.is_director()))', t);
    execute format('create policy "director update" on public.%I for update to authenticated
                      using ((select choir_private.is_director())) with check ((select choir_private.is_director()))', t);
    execute format('create policy "director delete" on public.%I for delete to authenticated
                      using ((select choir_private.is_director()))', t);
  end loop;
end $$;
drop policy if exists "admin write" on public.singers;
drop policy if exists "admin write" on public.songs;
drop policy if exists "admin write" on public.events;
drop policy if exists "admin write" on public.absences;
drop policy if exists "admin write" on public.event_songs;
drop policy if exists "song_categories write" on public.song_categories;
drop policy if exists "documents editable by admin" on public.documents;

-- 3. usage log: the shape the app sends, at a bounded rate ----------------------
alter table public.usage_log drop constraint if exists usage_log_shape_check;
alter table public.usage_log add constraint usage_log_shape_check check (
      char_length(coalesce(ref, '')) <= 200
  and char_length(coalesce(vid, '')) <= 64
  and char_length(coalesce(device, '')) <= 16
  and (lang is null or lang in ('en', 'ru')));

-- Guests choose only these columns; id and time always come from the database.
revoke insert, update, delete, select on public.usage_log from anon;
revoke insert, update, delete on public.usage_log from authenticated;
grant insert (kind, ref, lang, vid, device, app) on public.usage_log to anon, authenticated;
drop policy if exists "anyone may log" on public.usage_log;
create policy "anyone may log" on public.usage_log for insert to anon, authenticated with check (true);
drop policy if exists "admin read" on public.usage_log;
drop policy if exists "director reads" on public.usage_log;
create policy "director reads" on public.usage_log for select to authenticated
  using ((select choir_private.is_director()));

-- Counting is best-effort: past 2,000 rows in an hour (real use is a few dozen),
-- further rows are dropped quietly, so a script can't fill the database.
create or replace function choir_private.usage_log_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.usage_log where at > now() - interval '1 hour') >= 2000 then
    return null;
  end if;
  return new;
end
$$;
revoke all on function choir_private.usage_log_guard() from public;
drop trigger if exists usage_log_guard on public.usage_log;
create trigger usage_log_guard before insert on public.usage_log
  for each row execute function choir_private.usage_log_guard();

-- 4. privileges the public key never needs --------------------------------------
revoke truncate, references, trigger
  on public.singers, public.songs, public.events, public.absences, public.event_songs,
     public.song_categories, public.documents, public.usage_log
  from anon, authenticated;
revoke insert, update, delete
  on public.singers, public.songs, public.events, public.absences, public.event_songs,
     public.song_categories, public.documents
  from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.singer_attendance, public.song_stats, public.attendance_marks
  from anon, authenticated;

-- 5. files: guests read what the pages show; only directors write -------------
drop policy if exists "sheets read open" on storage.objects;
drop policy if exists "sheets insert" on storage.objects;
drop policy if exists "sheets write" on storage.objects;
drop policy if exists "sheets update" on storage.objects;
drop policy if exists "sheets delete" on storage.objects;
drop policy if exists "photos insert" on storage.objects;
drop policy if exists "photos update" on storage.objects;
drop policy if exists "photos delete" on storage.objects;
drop policy if exists "parts insert" on storage.objects;
drop policy if exists "parts update" on storage.objects;
drop policy if exists "parts delete" on storage.objects;
drop policy if exists "choir files insert" on storage.objects;
drop policy if exists "choir files update" on storage.objects;
drop policy if exists "choir files delete" on storage.objects;

create policy "sheets read open" on storage.objects for select
  using (bucket_id in ('sheets', 'piano')
         and (name !~~ 'locked/%' or (select choir_private.is_director())));
create policy "choir files insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('sheets', 'piano', 'photos', 'parts') and (select choir_private.is_director()));
create policy "choir files update" on storage.objects for update to authenticated
  using (bucket_id in ('sheets', 'piano', 'photos', 'parts') and (select choir_private.is_director()))
  with check (bucket_id in ('sheets', 'piano', 'photos', 'parts') and (select choir_private.is_director()));
create policy "choir files delete" on storage.objects for delete to authenticated
  using (bucket_id in ('sheets', 'piano', 'photos', 'parts') and (select choir_private.is_director()));
-- "photos read" and "parts read" (public buckets) stay as they are.

-- 6. indexes the performance advisor asks for -----------------------------------
create index if not exists absences_singer_id_idx on public.absences (singer_id);
create index if not exists event_songs_song_id_idx on public.event_songs (song_id);
create index if not exists songs_category_id_idx on public.songs (category_id);
