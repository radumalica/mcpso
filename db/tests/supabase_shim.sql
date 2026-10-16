-- Minimal stand-in for the parts of Supabase that the migrations rely on, so they can run on a plain Postgres
-- (PGlite in db/tests/run.mjs, or a disposable server). NOT part of the production schema: Supabase provides the
-- real roles, auth.users and auth.uid().
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
