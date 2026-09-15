-- SpeakUp! みんなで文法クイズ用（Supabase SQL Editorで1回実行）
create extension if not exists pgcrypto;

create table if not exists public.quiz_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_token text not null,
  title text not null default '英語文法クイズ',
  status text not null default 'lobby' check (status in ('lobby','question','reveal','finished')),
  questions jsonb not null,
  current_question integer not null default -1,
  question_started_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms(id) on delete cascade,
  name text not null,
  score integer not null default 0,
  streak integer not null default 0,
  joined_at timestamptz not null default now()
);
create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms(id) on delete cascade,
  player_id uuid not null references public.quiz_players(id) on delete cascade,
  question_index integer not null,
  option_index integer not null,
  correct boolean not null,
  points integer not null default 0,
  answered_at timestamptz not null default now(),
  unique(player_id, question_index)
);
create index if not exists quiz_players_room_idx on public.quiz_players(room_id);
create index if not exists quiz_answers_room_question_idx on public.quiz_answers(room_id, question_index);

alter table public.quiz_rooms enable row level security;
alter table public.quiz_players enable row level security;
alter table public.quiz_answers enable row level security;
-- アプリはVercelのサーバーAPIからService Role Keyでのみアクセスします。
