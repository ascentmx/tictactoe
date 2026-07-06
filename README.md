# Tic-Tac-Toe

Three modes — Classic, Vanishing, Ultimate — on an ink-wash board. Each mode can be
played two-player or against **the Oracle**, an AI opponent that moves locally and
taunts you via the Anthropic API. Built with Next.js (App Router) + TypeScript.

## Your checklist

1. **Add two images** to `public/`:
   - `public/dragon.jpg` — the title-screen art
   - `public/clouds.jpg` — the cloudy background behind the board

   Missing files fail silently (a painted ink mist shows underneath), so it runs
   without them — but these are what make it look finished.

2. **Add your API key.** Copy `.env.local.example` to `.env.local` and paste your
   Anthropic key:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   The key is read **only** on the server (`app/api/oracle/route.ts`) — it is never
   sent to the browser. Without a key the Oracle still plays; it just uses built-in
   taunt lines instead of live ones.

3. **Run it locally:**
   ```
   npm install
   npm run dev
   ```
   Open http://localhost:3000

4. **Push & deploy:**
   - Push the repo to GitHub.
   - Import it in Vercel.
   - In Vercel → Project → Settings → **Environment Variables**, add the same
     `ANTHROPIC_API_KEY` (and optionally `ORACLE_MODEL`). Redeploy.

## Notes

- **Which model writes the taunts?** Set `ORACLE_MODEL` in your env. It defaults to a
  small, fast, cheap model. Confirm the current model string at https://docs.claude.com
- **The Classic bot is deliberately beatable** — it always takes a win and usually
  blocks, but slips sometimes on purpose. A perfect bot forces a draw every game and
  feels dead. Tune the probabilities in `lib/game.ts → botMove3`.
- **Taunts vs. moves are separate layers.** The Oracle's move-picking lives in
  `lib/game.ts` and never needs the network; the flavour text lives in the API route.
  Any mode can have a silent bot, a talking bot, or human-vs-human.

## Where things live

```
app/
  page.tsx            all game UI + state (client component)
  api/oracle/route.ts server route — holds the key, calls Claude, falls back to canned lines
  globals.css         ink-wash theme: palette, board, brush marks
  layout.tsx          fonts + shell
lib/
  game.ts             pure logic: win-checking + AI move pickers (no React)
public/
  dragon.jpg          ← you add
  clouds.jpg          ← you add
```

## V2, later

Online multiplayer (deferred). Turn-based state this small is a light lift — the
usual path on this stack is Supabase Realtime with a room-code flow, since Vercel's
serverless functions don't hold WebSocket connections themselves.
