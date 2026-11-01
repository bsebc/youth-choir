-- Mirror of the LIVE choir databases' public schema as of 2026-11-01, BEFORE
-- that day's security fixes: same tables, constraints, indexes, views,
-- policies, grants, storage buckets and storage policies. Run with psql
-- -v senior=true for the senior choir (one extra column, and views that ran
-- with the owner's rights) or -v senior=false for the youth choir.

drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.singers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  part          text,
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  is_pianist    boolean not null default false,
  is_conductor  boolean not null default false,
  seat_block    text,
  seat_row      smallint,
  seat_col      smallint,
  joined_on     date default current_date,
  photo_path    text,
  service_start date,
  constraint singers_part_check check (part is null or part = any (array['soprano','alto','tenor','bass'])),
  constraint singers_seat_block_check check (seat_block is null or seat_block = any (array['soprano','alto','tenor','bass'])),
  constraint singers_seat_bounds_check check ((seat_row is null or (seat_row >= 1 and seat_row <= 2)) and (seat_col is null or (seat_col >= 1 and seat_col <= 16)))
);
create unique index singers_seat_unique on public.singers (seat_block, seat_row, seat_col) where seat_block is not null;

create table public.song_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.songs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  subtitle     text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  pdf_path     text,
  piano_path   text,
  pdf_locked   boolean not null default false,
  piano_locked boolean not null default false,
  category_id  uuid references public.song_categories(id) on delete set null,
  audio_url    text,
  pv_number    integer,
  lyrics       jsonb,
  learning     boolean not null default false,
  learn_for    text,
  learn_note   text,
  learn_order  integer,
  part_audio   jsonb not null default '{}'::jsonb
);
create index songs_pv_number_idx on public.songs (pv_number);

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  kind             text not null,
  label            text not null,
  name             text,
  cancelled        boolean not null default false,
  attendance_taken boolean not null default false,
  constraint events_kind_check check (kind = any (array['rehearsal','morning','evening','other']))
);
\if :senior
alter table public.events add column demo boolean not null default false;
\endif
create unique index events_unique_idx on public.events (date, kind, coalesce(name, ''));
create index events_date_idx on public.events (date desc);

create table public.absences (
  event_id  uuid not null references public.events(id) on delete cascade,
  singer_id uuid not null references public.singers(id) on delete cascade,
  status    text not null default 'absent',
  primary key (event_id, singer_id),
  constraint absences_status_check check (status = any (array['absent','not_listed']))
);

create table public.event_songs (
  event_id     uuid not null references public.events(id) on delete cascade,
  song_id      uuid not null references public.songs(id) on delete cascade,
  position     integer,
  conductor_id uuid references public.singers(id) on delete set null,
  pianist_id   uuid references public.singers(id) on delete set null,
  primary key (event_id, song_id)
);
create index event_songs_conductor_idx on public.event_songs (conductor_id);
create index event_songs_pianist_idx on public.event_songs (pianist_id);

create table public.documents (
  key        text primary key,
  body_ru    text not null default '',
  body_en    text not null default '',
  updated_at timestamptz not null default now()
);

create table public.usage_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  kind   text not null,
  ref    text,
  lang   text,
  vid    text,
  device text,
  app    boolean,
  constraint usage_log_kind_check check (kind = any (array['order','sheet','audio','page']))
);
create index usage_log_at_idx on public.usage_log (at desc);

-- leftovers from an early schema; the app never reads them
create view public.singer_attendance as
  select id, name, part,
         (select count(*) from public.events e) as events_total,
         (select count(*) from public.absences a where a.singer_id = s.id) as missed
  from public.singers s where active;
create view public.song_stats as
  select so.id, so.title, so.subtitle, count(es.event_id) as times_sung, max(e.date) as last_sung
  from public.songs so
  left join public.event_songs es on es.song_id = so.id
  left join public.events e on e.id = es.event_id
  group by so.id, so.title, so.subtitle;
create view public.attendance_marks as
  select e.date, e.kind, e.label, s.part, s.name, a.status
  from public.absences a join public.events e on e.id = a.event_id join public.singers s on s.id = a.singer_id;
\if :senior
\else
alter view public.singer_attendance set (security_invoker = on);
alter view public.song_stats set (security_invoker = on);
alter view public.attendance_marks set (security_invoker = on);
\endif

alter table public.singers         enable row level security;
alter table public.songs           enable row level security;
alter table public.events          enable row level security;
alter table public.absences        enable row level security;
alter table public.event_songs     enable row level security;
alter table public.song_categories enable row level security;
alter table public.documents       enable row level security;
alter table public.usage_log       enable row level security;

create policy "public read" on public.singers     for select using (true);
create policy "admin write" on public.singers     for all to authenticated using (true) with check (true);
create policy "public read" on public.songs       for select using (true);
create policy "admin write" on public.songs       for all to authenticated using (true) with check (true);
create policy "public read" on public.events      for select using (true);
create policy "admin write" on public.events      for all to authenticated using (true) with check (true);
create policy "public read" on public.absences    for select using (true);
create policy "admin write" on public.absences    for all to authenticated using (true) with check (true);
create policy "public read" on public.event_songs for select using (true);
create policy "admin write" on public.event_songs for all to authenticated using (true) with check (true);
create policy "song_categories read"  on public.song_categories for select using (true);
create policy "song_categories write" on public.song_categories for all to authenticated using (true) with check (true);
create policy "documents are public"        on public.documents for select using (true);
create policy "documents editable by admin" on public.documents for all to authenticated using (true) with check (true);
create policy "anyone may log" on public.usage_log for insert with check (true);
create policy "admin read"     on public.usage_log for select to authenticated using (true);

-- Supabase's default grants: every API role holds every table privilege.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- storage
delete from storage.objects;
delete from storage.buckets;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sheets', 'sheets', false, null, null),
  ('piano',  'piano',  false, null, null),
  ('photos', 'photos', true,  null, null),
  ('parts',  'parts',  true,  52428800, array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/wav','audio/x-wav','audio/wave']);

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
create policy "sheets read open" on storage.objects for select
  using (bucket_id = any (array['sheets','piano']) and (auth.role() = 'authenticated' or name !~~ 'locked/%'));
create policy "sheets insert" on storage.objects for insert to authenticated with check (bucket_id = 'sheets');
create policy "sheets write"  on storage.objects for insert to authenticated with check (bucket_id = any (array['sheets','piano']));
create policy "sheets update" on storage.objects for update to authenticated using (bucket_id = any (array['sheets','piano']));
create policy "sheets delete" on storage.objects for delete to authenticated using (bucket_id = any (array['sheets','piano']));
create policy "photos read"   on storage.objects for select using (bucket_id = 'photos');
create policy "photos insert" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "photos update" on storage.objects for update to authenticated using (bucket_id = 'photos') with check (bucket_id = 'photos');
create policy "photos delete" on storage.objects for delete to authenticated using (bucket_id = 'photos');
create policy "parts read"    on storage.objects for select using (bucket_id = 'parts');
create policy "parts insert"  on storage.objects for insert to authenticated with check (bucket_id = 'parts');
create policy "parts update"  on storage.objects for update to authenticated using (bucket_id = 'parts') with check (bucket_id = 'parts');
create policy "parts delete"  on storage.objects for delete to authenticated using (bucket_id = 'parts');
