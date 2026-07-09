-- =====================================================================
-- Tic-Tac-Toe — online multiplayer schema
-- Run this in the Supabase SQL editor (one time).
-- =====================================================================

create table if not exists public.games (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  mode       text not null,
  state      jsonb not null,
  player_x   uuid,
  player_o   uuid,
  name_x     text,
  name_o     text,
  status     text not null default 'waiting',   -- waiting | live | ended
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.games enable row level security;

-- Reads are open; writes go only through the security-definer functions below.
-- Open reads keep Supabase Realtime delivering reliably to BOTH players (an
-- identity-based read policy silently drops the host's "someone joined" event).
-- A game row holds only a board and two display names, behind an unguessable code.
drop policy if exists "read own game" on public.games;
drop policy if exists "read games" on public.games;
create policy "read games" on public.games for select using (true);

-- All writes go through the functions below (security definer), so there are
-- no direct insert/update policies — clients can't hand-edit a board.

-- ---- create a game; caller becomes Gold (X) --------------------------
create or replace function public.create_game(p_code text, p_mode text, p_state jsonb, p_name text default null)
returns public.games language plpgsql security definer as $$
declare g public.games;
begin
  insert into public.games (code, mode, state, player_x, name_x, status)
  values (p_code, p_mode, p_state, auth.uid(), nullif(p_name, ''), 'waiting')
  returning * into g;
  return g;
end; $$;

-- ---- join a waiting game; caller becomes Cinnabar (O) ----------------
create or replace function public.join_game(p_code text, p_name text default null)
returns public.games language plpgsql security definer as $$
declare g public.games;
begin
  select * into g from public.games where code = p_code for update;
  if g.id is null then raise exception 'Game % not found', p_code; end if;

  -- already one of the two players? just hand the row back (rejoin / retry)
  if auth.uid() = g.player_x or auth.uid() = g.player_o then
    return g;
  end if;

  if g.player_o is not null then
    raise exception 'Game % is full', p_code;
  end if;

  update public.games
     set player_o = auth.uid(),
         name_o   = coalesce(nullif(p_name, ''), name_o),
         status   = 'live'
   where id = g.id
  returning * into g;
  return g;
end; $$;

-- ---- make a move -----------------------------------------------------
-- Enforces: caller is a participant, it is their turn, and the state is
-- advancing from the ply they last saw (blocks out-of-turn / stale writes).
-- The move's legality itself is computed client-side from the shared logic.
create or replace function public.make_move(p_code text, p_state jsonb, p_from_ply int)
returns void language plpgsql security definer as $$
declare g public.games;
begin
  select * into g from public.games where code = p_code for update;
  if g.id is null then raise exception 'No such game'; end if;

  if auth.uid() is distinct from g.player_x
     and auth.uid() is distinct from g.player_o then
    raise exception 'Not a participant';
  end if;

  if (g.state->>'turn') = 'X' and auth.uid() is distinct from g.player_x then
    raise exception 'Not your turn';
  end if;
  if (g.state->>'turn') = 'O' and auth.uid() is distinct from g.player_o then
    raise exception 'Not your turn';
  end if;

  if (g.state->>'ply')::int is distinct from p_from_ply then
    raise exception 'Stale move';
  end if;

  update public.games set
    state = p_state,
    status = case when (p_state->'over') is not null and (p_state->'over') <> 'null'::jsonb
                  then 'ended' else 'live' end,
    updated_at = now()
  where code = p_code;
end; $$;

grant execute on function public.create_game(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.join_game(text, text)               to anon, authenticated;
grant execute on function public.make_move(text, jsonb, int)         to anon, authenticated;

-- ---- realtime --------------------------------------------------------
-- FULL replica identity lets Row Level Security evaluate realtime UPDATE
-- events, so the host reliably receives "someone joined" and every move.
alter table public.games replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;
