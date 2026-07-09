# Online multiplayer setup

The code is done. These are the parts only you can do — creating the Supabase project
and flipping a few switches. Until you finish them, the online option stays hidden and
the game plays exactly as before (Oracle + Pass & Play).

## 1. Create a Supabase project
Go to supabase.com, create a free project. Wait for it to finish provisioning.

## 2. Run the schema
Open the project's **SQL Editor**, paste the entire contents of `supabase/schema.sql`,
and run it. That creates the `games` table, the row-level-security policy, the three
functions (`create_game`, `join_game`, `make_move`), and adds the table to realtime.

## 3. Enable anonymous sign-ins
**Authentication → Providers → Anonymous** → turn it on. Each player gets a throwaway
identity so the security rules know which side of a room they are. No passwords, no
sign-up screen.

## 4. Add your keys
**Settings → API** gives you the Project URL and the `anon` public key. Put them in
`.env.local` (copy from `.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Then add the **same two variables** in Vercel → Project → Settings → Environment
Variables, and redeploy. (These are the public anon key + URL — safe to expose. The
security lives in the RLS policy and the RPCs, not in hiding the key.)

## 5. Play
Restart `npm run dev`. "Multiplayer" now appears in the opponent cycle (top-right on
the board). One player picks a mode, taps **Multiplayer**, enters a name, and taps
**Create a game**. They then get a 4-letter code and a **Share link** button (uses the
phone's native share sheet, falls back to copy). The other player either opens the link
— which drops them straight onto the lobby with the code filled in — or taps
**Multiplayer → Join** and types the code. Each enters their own name; those names show
on the turn indicator and the result card. Works across all three modes; the Oracle just
doesn't exist online.

## How it works (so you can extend it)
- The whole board state lives in one `games` row as JSON. A move writes the new state
  through `make_move`, which checks it's your turn and that you're not writing a stale
  state, then updates the row.
- Both clients subscribe to the row via Supabase Realtime and re-render on every change.
  Your own move appears after the round-trip — that's why it's not instant.
- Move *legality* is computed client-side from `lib/game.ts` (the same logic the local
  game uses). The server enforces turn-order and participation, not the rules of each
  mode — fine for a casual game. If you ever want it fully cheat-proof, port the commit
  logic into a Postgres function and have `make_move` compute the next state itself.

## Known V1 limits (all fixable later)
- No reconnect-by-code if you close the tab mid-game (the row still exists; you'd add a
  "resume" screen that re-subscribes).
- No "opponent left" detection yet — Supabase Realtime presence is the hook for that.
- "New game" while online drops the room rather than offering a rematch in place.
