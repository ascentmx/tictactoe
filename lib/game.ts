// ---------------------------------------------------------------------------
// Pure game logic — no React. Shared by every mode and by the AI opponent.
// X = Gold (player one).  O = Cinnabar / the Oracle (player two).
// ---------------------------------------------------------------------------

export type Player = "X" | "O";
export type Cell = Player | null;
export type Mode = "classic" | "vanishing" | "ultimate";
export type Opponent = "human" | "oracle";

export const WINS: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function winner(b: Cell[]): { who: Player; line: number[] } | null {
  for (const [a, c, d] of WINS) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { who: b[a] as Player, line: [a, c, d] };
  }
  return null;
}

export function empties(b: Cell[]): number[] {
  const r: number[] = [];
  b.forEach((v, i) => { if (!v) r.push(i); });
  return r;
}

// Returns the empty cell that completes a line for player p, else -1.
export function findLine(b: Cell[], p: Player): number {
  for (const line of WINS) {
    const vals = line.map((x) => b[x]);
    const mine = vals.filter((v) => v === p).length;
    const open = vals.filter((v) => !v).length;
    if (mine === 2 && open === 1) return line[vals.indexOf(null)];
  }
  return -1;
}

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ---- AI for the 3x3 modes (classic + vanishing) --------------------------
// Deliberately beatable: it always takes a win, usually blocks, and otherwise
// plays sensibly. A perfect bot would force a draw every time and feel dead.
export function botMove3(board: Cell[], me: Player, opp: Player): number {
  const open = empties(board);
  if (open.length === 0) return -1;

  const win = findLine(board, me);
  if (win >= 0) return win;

  // Block ~85% of the time — the slips are what let a human win.
  const block = findLine(board, opp);
  if (block >= 0 && Math.random() < 0.85) return block;

  if (board[4] === null && Math.random() < 0.7) return 4;

  const corners = [0, 2, 6, 8].filter((i) => board[i] === null);
  if (corners.length && Math.random() < 0.6) return rand(corners);

  return rand(open);
}

// ---- Ultimate (9 boards in one) ------------------------------------------
export type UltimateState = {
  boards: Cell[][];   // 9 mini-boards, each 9 cells
  boardsWon: Cell[];  // winner of each mini-board (or null)
  active: number | null; // forced mini-board index, or null = play anywhere open
};

export function miniPlayable(s: UltimateState, b: number): boolean {
  return !s.boardsWon[b] && s.boards[b].some((c) => c === null);
}

// Light heuristic: win a mini-board if possible, else block, else prefer centre,
// and gently avoid handing the opponent an immediate mini-board win.
export function ultimateBotMove(
  s: UltimateState, me: Player, opp: Player,
): { b: number; i: number } | null {
  const targets = s.active !== null && miniPlayable(s, s.active)
    ? [s.active]
    : s.boardsWon.map((_, b) => b).filter((b) => miniPlayable(s, b));
  if (targets.length === 0) return null;

  type Move = { b: number; i: number; score: number };
  const moves: Move[] = [];

  for (const b of targets) {
    const mini = s.boards[b];
    for (let i = 0; i < 9; i++) {
      if (mini[i]) continue;
      let score = 0;

      // winning this mini-board is great
      if (findLine(mini, me) === i) score += 100;
      // blocking the opponent's mini-board win is good
      if (findLine(mini, opp) === i) score += 60;
      // centre / corners of a mini-board
      if (i === 4) score += 6;
      else if ([0, 2, 6, 8].includes(i)) score += 3;

      // this move sends the opponent to mini-board `i`; penalise if they could
      // immediately win it
      const dest = i;
      if (miniPlayable(s, dest) && findLine(s.boards[dest], opp) >= 0) score -= 40;
      // sending them to a free-choice (won/full) board is slightly bad
      if (!miniPlayable(s, dest)) score -= 10;

      score += Math.random() * 4; // break ties, keep it human
      moves.push({ b, i, score });
    }
  }
  moves.sort((a, b) => b.score - a.score);
  return moves[0] ? { b: moves[0].b, i: moves[0].i } : null;
}
