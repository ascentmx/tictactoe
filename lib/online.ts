import { supabase, supabaseReady, ensureAnon } from "./supabase";
import { Cell, Mode, Player } from "./game";

export { supabaseReady };

// The full serialisable game state that lives in the row and syncs between players.
export type GameBlob = {
  mode: Mode;
  turn: Player;
  board: Cell[];
  queue: { X: number[]; O: number[] };
  ub: Cell[][];
  boardsWon: Cell[];
  active: number | null;
  metaLine: number[] | null;
  over: { who: Player | null; line?: number[] } | null;
  ply: number;
  rid: number;
};

export type GameRow = {
  id: string;
  code: string;
  mode: Mode;
  state: GameBlob;
  player_x: string | null;
  player_o: string | null;
  name_x: string | null;
  name_o: string | null;
  status: "waiting" | "live" | "ended";
};

// short, unambiguous join codes (no O/0/I/1)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () =>
  Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

export async function createGame(state: GameBlob, name?: string): Promise<{ code: string }> {
  if (!supabase) throw new Error("Online play isn't configured yet.");
  await ensureAnon();
  const code = genCode();
  const { error } = await supabase.rpc("create_game", {
    p_code: code, p_mode: state.mode, p_state: state, p_name: name ?? null,
  });
  if (error) throw new Error(error.message);
  return { code };
}

export async function joinGame(code: string, name?: string): Promise<GameRow> {
  if (!supabase) throw new Error("Online play isn't configured yet.");
  await ensureAnon();
  const { data, error } = await supabase.rpc("join_game", { p_code: code, p_name: name ?? null });
  if (error) throw new Error(error.message);
  return data as GameRow;
}

export async function makeMove(code: string, state: GameBlob, fromPly: number): Promise<void> {
  if (!supabase) throw new Error("Online play isn't configured yet.");
  const { error } = await supabase.rpc("make_move", {
    p_code: code, p_state: state, p_from_ply: fromPly,
  });
  if (error) throw new Error(error.message);
}

// Reset the shared room to a fresh board. Either player may call it.
export async function rematchGame(code: string, state: GameBlob): Promise<void> {
  if (!supabase) throw new Error("Online play isn't configured yet.");
  const { error } = await supabase.rpc("rematch_game", { p_code: code, p_state: state });
  if (error) throw new Error(error.message);
}

export async function fetchGame(code: string): Promise<GameRow | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("games").select("*").eq("code", code).single();
  return (data as GameRow) ?? null;
}

// Subscribe to a room. Fires the callback with the current row now and on every change.
export function subscribeGame(code: string, onRow: (row: GameRow) => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  client.from("games").select("*").eq("code", code).single()
    .then(({ data }) => { if (data) onRow(data as GameRow); });
  const channel = client
    .channel(`game:${code}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "games", filter: `code=eq.${code}` },
      (payload) => { if (payload.new) onRow(payload.new as GameRow); })
    .subscribe();
  return () => { client.removeChannel(channel); };
}
