import { createClient, SupabaseClient } from "@supabase/supabase-js";

// These are safe to expose (anon key + project URL). Set them in .env.local
// and in Vercel's environment variables. If absent, online play is simply hidden
// and the rest of the app runs exactly as before.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && key);
export const supabase: SupabaseClient | null = supabaseReady ? createClient(url!, key!) : null;

// Each browser gets a lightweight anonymous identity (no passwords) so the row-level
// security policies know which side of a room you are. Requires "Anonymous sign-ins"
// enabled in the Supabase dashboard (Authentication → Providers).
export async function ensureAnon(): Promise<string> {
  if (!supabase) throw new Error("Online play isn't configured yet.");
  const { data: got } = await supabase.auth.getUser();
  if (got.user) return got.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error(error?.message ?? "Couldn't start a session.");
  return data.user.id;
}
