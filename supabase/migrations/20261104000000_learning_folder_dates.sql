-- 5.54 A date for each Learning folder, set by the director.
--
-- A folder shows its date as a little calendar page with a countdown. Folders
-- still need no table of their own (songs with the same learn_for share one), so
-- this keeps only the date, keyed by the folder's name the way the page groups
-- songs: lower case, spaces collapsed. The page writes the key; the database only
-- checks that it is a sensible length.
--
-- Additive only: no existing row changes, and pages from before 5.54 never read
-- this table, so it can be created before the new pages are published.
create table if not exists public.learn_folders (
  key        text primary key check (char_length(key) between 1 and 200 and key = btrim(key)),
  due        date,
  updated_at timestamptz not null default now()
);

comment on table public.learn_folders is
  'A date per Learning folder, set by the director (5.54). key: the folder name (songs.learn_for) in lower case, spaces collapsed';

alter table public.learn_folders enable row level security;

-- everyone reads, as with every other table the pages show
drop policy if exists "learn_folders read" on public.learn_folders;
create policy "learn_folders read" on public.learn_folders for select using (true);

-- only the director writes (choir_private.is_director(), from 20261102000000)
drop policy if exists "director insert" on public.learn_folders;
drop policy if exists "director update" on public.learn_folders;
drop policy if exists "director delete" on public.learn_folders;
create policy "director insert" on public.learn_folders for insert to authenticated
  with check ((select choir_private.is_director()));
create policy "director update" on public.learn_folders for update to authenticated
  using ((select choir_private.is_director())) with check ((select choir_private.is_director()));
create policy "director delete" on public.learn_folders for delete to authenticated
  using ((select choir_private.is_director()));

-- the public key reads and nothing more; signed-in writes still pass the rules above
revoke all on public.learn_folders from anon, authenticated;
grant select on public.learn_folders to anon, authenticated;
grant insert, update, delete on public.learn_folders to authenticated;
