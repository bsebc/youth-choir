-- 5.51 Learning folders and repertoire songs on the Learning page.
--
-- A song that is already in the repertoire (learning = false) can also sit on the
-- Learning page while the choir learns it; learning = true keeps meaning "not in
-- the repertoire yet". Folders need no table: songs with the same learn_for share
-- one, as the Goal box already allowed.
--
-- Additive only: no existing row changes, and pages from before 5.51 ignore the
-- column, so this can run before the new pages are published.
alter table public.songs add column if not exists learn_listed boolean not null default false;

comment on column public.songs.learn_listed is
  'In the repertoire and also on the Learning page until the director marks it learned (5.51)';
