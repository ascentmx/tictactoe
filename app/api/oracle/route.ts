import { NextRequest, NextResponse } from "next/server";

// The API key lives ONLY here, on the server. The browser never sees it.
// Set ANTHROPIC_API_KEY in .env.local (local) and in Vercel project settings.

type Event = "move" | "win" | "loss" | "draw";

const FALLBACK: Record<Event, string[]> = {
  move: [
    "You reach where I have already been.",
    "Predictable. I saw this before you did.",
    "A small stone against a mountain.",
    "You play. I merely allow it.",
    "Another thread, and still you weave your own noose.",
  ],
  win: [
    "The board clears. As does your ambition.",
    "I have watched empires make finer mistakes.",
    "You were never playing me. Only losing to yourself.",
  ],
  loss: [
    "…the student surpasses the master. Once.",
    "Fortune, not skill. Sit again.",
    "Enjoy it. Such moments do not repeat.",
  ],
  draw: [
    "Stillness. Neither of us moved the mountain.",
    "A truce the board did not earn.",
  ],
};

const pick = (e: Event) => FALLBACK[e][Math.floor(Math.random() * FALLBACK[e].length)];

export async function POST(req: NextRequest) {
  let body: { mode?: string; grid?: string[]; event?: Event };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ line: pick("move") });
  }

  const event: Event = body.event ?? "move";
  const key = process.env.ANTHROPIC_API_KEY;

  // No key configured → play with the canned lines, never error.
  if (!key) return NextResponse.json({ line: pick(event) });

  const grid = body.grid ?? [];
  const rows = `[${grid.slice(0, 3).join(", ")}] [${grid.slice(3, 6).join(", ")}] [${grid.slice(6, 9).join(", ")}]`;
  const prompt =
    `You are the Oracle: an ancient, smug, imperious spirit toying with a mortal ` +
    `in a game of tic-tac-toe (mode: ${body.mode ?? "classic"}). The mortal plays Gold, ` +
    `you play Cinnabar. Board rows: ${rows}. Event: ${
      event === "move" ? "you just moved" :
      event === "win" ? "you just won" :
      event === "loss" ? "you just lost" : "the game ended in a draw"
    }. Reply with ONE short taunt, at most 14 words, cryptic and haughty. ` +
    `No quotation marks, no emoji, no preamble.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ORACLE_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return NextResponse.json({ line: pick(event) });
    const data = await r.json();
    const line: string = (data.content ?? [])
      .filter((x: { type: string }) => x.type === "text")
      .map((x: { text: string }) => x.text)
      .join(" ")
      .trim()
      .replace(/^["']|["']$/g, "");
    return NextResponse.json({ line: line || pick(event) });
  } catch {
    return NextResponse.json({ line: pick(event) });
  }
}
