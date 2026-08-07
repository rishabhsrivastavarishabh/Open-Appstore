-- Optional relational storage for the Developer API v1.
--
-- The application does NOT require this file to work. PostgREST cannot execute
-- DDL, so the running code stores API keys in the GoTrue
-- `app_metadata.oas_api_keys` field (service-role-writable only) and stores
-- developer replies inline on the review row behind a marker. Both are
-- functional and secure.
--
-- Run this in the Supabase SQL editor if you would rather have proper tables:
-- it gives you indexed key lookups, real review replies, and per-day download
-- rollups. After running it, the app keeps working unchanged; migrate the data
-- with the two commented statements at the bottom.

/* ── developer_api_keys ─────────────────────────────────────────────────── */

create table if not exists public.developer_api_keys (
  id           uuid primary key default gen_random_uuid(),
  key_id       varchar(16) not null unique,   -- hex of the 8-byte id in the key
  user_id      uuid not null references auth.users (id) on delete cascade,
  developer_id uuid references public.developers (id) on delete cascade,
  name         varchar(60) not null default 'API key',
  prefix       varchar(16) not null,          -- shown in the UI, e.g. dev_AbC12345
  key_hash     varchar(64) not null,          -- sha256 of the full key string
  revoked      boolean not null default false,
  last_used_at timestamp,
  created_at   timestamp not null default now()
);

create index if not exists idx_dev_api_keys_user    on public.developer_api_keys (user_id);
create index if not exists idx_dev_api_keys_key_id  on public.developer_api_keys (key_id);
create index if not exists idx_dev_api_keys_hash    on public.developer_api_keys (key_hash);

alter table public.developer_api_keys enable row level security;

-- A developer may read the metadata of their own keys, never the hash of
-- someone else's. Minting and revoking go through the service role.
drop policy if exists dev_api_keys_select_own on public.developer_api_keys;
create policy dev_api_keys_select_own on public.developer_api_keys
  for select using (user_id = auth.uid());

/* ── review_responses ───────────────────────────────────────────────────── */

create table if not exists public.review_responses (
  id           uuid primary key default gen_random_uuid(),
  review_id    uuid not null references public.app_reviews (id) on delete cascade,
  developer_id uuid not null references public.developers (id) on delete cascade,
  body         text not null,
  created_at   timestamp not null default now(),
  updated_at   timestamp not null default now(),
  -- One reply per review keeps the read path a simple join.
  unique (review_id)
);

create index if not exists idx_review_responses_review on public.review_responses (review_id);

alter table public.review_responses enable row level security;

-- Replies are public (they appear under the review in the store), but only the
-- app's own developer may write one.
drop policy if exists review_responses_public_read on public.review_responses;
create policy review_responses_public_read on public.review_responses
  for select using (true);

drop policy if exists review_responses_dev_write on public.review_responses;
create policy review_responses_dev_write on public.review_responses
  for all using (
    developer_id in (select id from public.developers where user_id = auth.uid())
  )
  with check (
    developer_id in (select id from public.developers where user_id = auth.uid())
  );

/* ── api_request_log (exact global rate limiting) ───────────────────────── */
--
-- The Worker rate limiter is per-isolate, which stops runaway clients but is
-- not globally exact. If you need exact limits, insert one row per request and
-- count the window here instead. Left unused by default: one extra write per
-- API call is a real cost, and the default limiter is sufficient for most
-- stores.

create table if not exists public.api_request_log (
  id         bigserial primary key,
  key_id     varchar(16) not null,
  path       varchar(200),
  status     smallint,
  created_at timestamp not null default now()
);

create index if not exists idx_api_request_log_key_time
  on public.api_request_log (key_id, created_at desc);

/* ── data migration from the metadata-based store ───────────────────────── */
-- Run these once, after creating the tables above, to lift existing records
-- out of app_metadata / the inline review marker.
--
-- insert into public.developer_api_keys (key_id, user_id, name, prefix, key_hash, created_at, last_used_at, revoked)
-- select k->>'id', u.id, coalesce(k->>'name','API key'), k->>'prefix', k->>'hash',
--        coalesce((k->>'created_at')::timestamp, now()), (k->>'last_used_at')::timestamp,
--        coalesce((k->>'revoked')::boolean, false)
-- from auth.users u
-- cross join lateral jsonb_array_elements(u.raw_app_meta_data->'oas_api_keys') k
-- on conflict (key_id) do nothing;
--
-- insert into public.review_responses (review_id, developer_id, body, created_at)
-- select r.id, a.developer_id,
--        btrim(split_part(substring(r.review_text from '\[developer_response\]:(.*)$'), E'\n', 2)),
--        now()
-- from public.app_reviews r
-- join public.apps a on a.id = r.app_id
-- where r.review_text like '%[developer_response]:%'
-- on conflict (review_id) do nothing;
