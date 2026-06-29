-- =============================================
-- Study Logbook — Supabase Setup SQL
-- Run this in your Supabase SQL Editor
-- =============================================

-- 1. Profiles table (one row per user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  daily_target_hrs float default 4,
  goal_total_hrs float,
  goal_deadline date,
  created_at timestamptz default now()
);

-- 2. Sessions table (study sessions)
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  date date not null,
  start timestamptz not null,
  "end" timestamptz not null,
  note text default '',
  duration_minutes integer not null default 0,
  created_at timestamptz default now()
);

-- 3. Row Level Security
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

-- Profiles: everyone can read, only owner can write
create policy "Profiles are readable by all authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Sessions: everyone can read (for leaderboard), only owner can insert/delete
create policy "Sessions are readable by all authenticated users"
  on public.sessions for select
  to authenticated
  using (true);

create policy "Users can insert their own sessions"
  on public.sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can delete their own sessions"
  on public.sessions for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Enable Realtime for sessions table
-- (Do this in Supabase Dashboard > Database > Replication > supabase_realtime publication)
-- Or run:
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.profiles;

-- 5. Index for performance
create index if not exists sessions_user_id_date_idx on public.sessions(user_id, date);
create index if not exists sessions_date_idx on public.sessions(date);

