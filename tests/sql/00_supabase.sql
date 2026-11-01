-- The parts of a Supabase project the choir app relies on, for the local test
-- harness only: the API roles, auth.uid()/auth.role()/auth.jwt() reading the
-- request's JWT claims (exactly as PostgREST passes them), auth.users, and the
-- storage tables whose row-level security decides who may read or write files.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

drop schema if exists auth cascade;
create schema auth;
create table auth.users (
  id                  uuid primary key,
  email               text unique,
  encrypted_password  text,
  created_at          timestamptz not null default now(),
  last_sign_in_at     timestamptz,
  email_confirmed_at  timestamptz default now(),
  raw_app_meta_data   jsonb not null default '{"provider":"email"}',
  raw_user_meta_data  jsonb not null default '{}',
  is_anonymous        boolean not null default false
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '') $$;
create or replace function auth.email() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'email', '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

drop schema if exists storage cascade;
create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);
create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text not null references storage.buckets(id),
  name        text not null,
  owner       uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  metadata    jsonb,
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
