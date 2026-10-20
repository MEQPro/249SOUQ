-- 249Souq: WhatsApp sign-ups (lead capture). Run once in the Supabase SQL editor.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null unique,
  consent boolean not null default true,
  source text,
  page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status text not null default 'new'
);
alter table public.leads enable row level security;
-- No public policies on purpose: only the server (service role key) can read or write.
