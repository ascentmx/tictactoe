"use client";

import { useEffect, useRef, useState } from "react";
import {
  Cell, Mode, Opponent, Player,
  winner, botMove3, ultimateBotMove, miniPlayable, UltimateState,
} from "@/lib/game";

// ---------------------------------------------------------------------------
const MODES: { id: Mode; name: string; desc: string }[] = [
  { id: "classic",   name: "Classic",   desc: "The game you know. Three in a row wins." },
  { id: "vanishing", name: "Vanishing", desc: "Only three marks each. A fourth fades your oldest." },
  { id: "ultimate",  name: "Ultimate",  desc: "Nine boards in one. Your move sends your rival on." },
];
const oppLabel = (o: Opponent) => (o === "oracle" ? "The Oracle" : "Two Players");

type Over = { who: Player | null; line?: number[] } | null;

type State = {
  screen: "landing" | "play";
  mode: Mode;
  opponent: Opponent;
  turn: Player;
  board: Cell[];
  queue: { X: number[]; O: number[] };
  ub: Cell[][];
  boardsWon: Cell[];
  active: number | null;
  metaLine: number[] | null;
  over: Over;
  ply: number;
};

const fresh3 = () => ({ board: Array(9).fill(null) as Cell[], queue: { X: [] as number[], O: [] as number[] } });
const freshU = () => ({
  ub: Array.from({ length: 9 }, () => Array(9).fill(null) as Cell[]),
  boardsWon: Array(9).fill(null) as Cell[], active: null as number | null, metaLine: null as number[] | null,
});
const base: State = {
  screen: "landing", mode: "classic", opponent: "oracle", turn: "X",
  ...fresh3(), ...freshU(), over: null, ply: 0,
};

// ===========================================================================
export default function Home() {
  const [s, setS] = useState<State>(base);
  const [idx, setIdx] = useState(0); // carousel index
  const [swapping, setSwapping] = useState(false);
  const oracleActedPly = useRef(-1);

  const isOracleTurn = s.screen === "play" && s.opponent === "oracle" && s.turn === "O" && !s.over;

  // ---- carousel ----
  const cycle = (dir: 1 | -1) => {
    setSwapping(true);
    setTimeout(() => {
      setIdx((i) => (i + dir + MODES.length) % MODES.length);
      setSwapping(false);
    }, 170);
  };
  const begin = () => { oracleActedPly.current = -1; setS({ ...base, mode: MODES[idx].id, opponent: "oracle", screen: "play" }); };

  // ---- navigation ----
  const home = () => setS((st) => ({ ...st, screen: "landing" }));
  const reset = () => { oracleActedPly.current = -1; setS((st) => ({ ...base, mode: st.mode, opponent: st.opponent, screen: "play" })); };
  const switchOpponent = () => { oracleActedPly.current = -1; setS((st) => ({ ...base, mode: st.mode, opponent: st.opponent === "oracle" ? "human" : "oracle", screen: "play" })); };

  // ---- commits (pure) ----
  function commit3(st: State, i: number): State {
    if (st.board[i] || st.over) return st;
    const board = st.board.slice();
    const queue = { X: st.queue.X.slice(), O: st.queue.O.slice() };
    board[i] = st.turn;
    if (st.mode === "vanishing") {
      queue[st.turn].push(i);
      if (queue[st.turn].length > 3) board[queue[st.turn].shift()!] = null;
    }
    const w = winner(board);
    let over: Over = null;
    if (w) over = { who: w.who, line: w.line };
    else if (st.mode === "classic" && board.every(Boolean)) over = { who: null };
    return { ...st, board, queue, turn: over ? st.turn : st.turn === "X" ? "O" : "X", over, ply: st.ply + 1 };
  }
  function commitU(st: State, b: number, i: number): State {
    if (st.over || st.boardsWon[b] || st.ub[b][i]) return st;
    if (st.active !== null && st.active !== b) return st;
    const ub = st.ub.map((m, k) => (k === b ? m.slice() : m));
    ub[b][i] = st.turn;
    const boardsWon = st.boardsWon.slice();
    const w = winner(ub[b]); if (w) boardsWon[b] = w.who;
    const destClosed = !!boardsWon[i] || ub[i].every(Boolean);
    const active = destClosed ? null : i;
    const meta = winner(boardsWon);
    const allDecided = boardsWon.every((v, k) => v || ub[k].every(Boolean));
    let over: Over = null;
    if (meta) over = { who: meta.who, line: meta.line };
    else if (allDecided) over = { who: null };
    return { ...st, ub, boardsWon, active, metaLine: meta ? meta.line : null,
      turn: over ? st.turn : st.turn === "X" ? "O" : "X", over, ply: st.ply + 1 };
  }

  // ---- human moves ----
  const play3 = (i: number) => { if (!isOracleTurn && !s.over) setS((st) => commit3(st, i)); };
  const playU = (b: number, i: number) => { if (!isOracleTurn && !s.over) setS((st) => commitU(st, b, i)); };

  // ---- Oracle replies after a short, deliberate pause ----
  useEffect(() => {
    if (!isOracleTurn || oracleActedPly.current === s.ply) return;
    oracleActedPly.current = s.ply;
    const t = setTimeout(() => {
      setS((st) => {
        if (st.over || st.turn !== "O" || st.opponent !== "oracle") return st;
        if (st.mode === "ultimate") {
          const us: UltimateState = { boards: st.ub, boardsWon: st.boardsWon, active: st.active };
          const mv = ultimateBotMove(us, "O", "X");
          return mv ? commitU(st, mv.b, mv.i) : st;
        }
        const i = botMove3(st.board, "O", "X");
        return i >= 0 ? commit3(st, i) : st;
      });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOracleTurn, s.ply]);

  // -------------------------------------------------------------------------
  const goldTurn = s.turn === "X";
  const vanishingIdx = s.mode === "vanishing" && !s.over && s.queue[s.turn].length === 3 ? s.queue[s.turn][0] : -1;
  const other: Opponent = s.opponent === "oracle" ? "human" : "oracle";

  return (
    <>
      <Defs />
      {/* full-bleed dragon: three cross-fading colour variants */}
      <div className={`dragons mode-${s.screen === "play" ? "hidden" : MODES[idx].id}`}>
        <div className="drag classic" /><div className="drag vanishing" /><div className="drag ultimate" />
        <div className="mist-fallback" />
      </div>
      <Fog />

      {s.screen === "landing" ? (
        // ================= TITLE =================
        <main className="title-screen">
          <h1 className="brand">Tic&nbsp;Tac&nbsp;Toe</h1>

          <div className="carousel">
            <button className="chev" aria-label="Previous board" onClick={() => cycle(-1)}>‹</button>

            <button className={`disc mode-${MODES[idx].id}`} onClick={begin} aria-label={`Begin ${MODES[idx].name}`}>
              <span className={`disc-name${swapping ? " swap" : ""}`}>{MODES[idx].name}</span>
              <span className="disc-hint">tap to begin</span>
              <span className={`disc-desc${swapping ? " swap" : ""}`}>{MODES[idx].desc}</span>
            </button>

            <button className="chev" aria-label="Next board" onClick={() => cycle(1)}>›</button>
          </div>

          <p className="tagline">Choose your board. Then choose your rival.</p>
        </main>
      ) : (
        // ================= PLAY =================
        <main className={`play mode-${s.mode}`}>
          <div className="clouds" />
          <div className="vignette" />

          <div className="topbar">
            <button className="home" onClick={home}>‹ Home</button>
            <div className="mode-title">{s.mode}</div>
            <div className="tr">
              <button className="oppToggle" onClick={switchOpponent}>{oppLabel(other)}</button>
              <div className="turn"><span className={`dot ${goldTurn ? "x" : "o"}`} /><span>{goldTurn ? "Gold" : s.opponent === "oracle" ? "Oracle" : "Cinnabar"}</span></div>
            </div>
          </div>

          <div className="opp-current"><span className="ul">{oppLabel(s.opponent)}</span></div>

          <div className="board-wrap">
            {s.mode === "ultimate"
              ? <Ultimate s={s} onCell={playU} />
              : <Grid s={s} vanishingIdx={vanishingIdx} onCell={play3} disabled={isOracleTurn} />}
          </div>

          <div className="status">
            {s.over && (s.over.who === null
              ? <>A still board. <span className="dim">Neither prevails.</span></>
              : s.over.who === "X"
                ? <><span className="gold">Gold</span> takes the board.</>
                : <><span className="red">{s.opponent === "oracle" ? "The Oracle" : "Cinnabar"}</span> prevails.</>)}
          </div>

          <button className="newgame" onClick={reset}>New game</button>
        </main>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function Grid({ s, vanishingIdx, onCell, disabled }:
  { s: State; vanishingIdx: number; onCell: (i: number) => void; disabled: boolean }) {
  return (
    <div className="grid">
      <div className="gline v v1" /><div className="gline v v2" />
      <div className="gline h h1" /><div className="gline h h2" />
      {s.board.map((v, i) => (
        <button key={i} className="cell" aria-label={`cell ${i + 1}`} disabled={disabled} onClick={() => onCell(i)}>
          {v && <Mark key={`${i}-${v}`} type={v} fading={i === vanishingIdx} />}
        </button>
      ))}
      {s.over?.line && <WinStroke line={s.over.line} seal />}
    </div>
  );
}

function Ultimate({ s, onCell }: { s: State; onCell: (b: number, i: number) => void }) {
  return (
    <div className="ultimate">
      {s.ub.map((mini, b) => {
        const active = !s.over && (s.active === null || s.active === b)
          && miniPlayable({ boards: s.ub, boardsWon: s.boardsWon, active: s.active }, b);
        const won = s.boardsWon[b];
        return (
          <div key={b} className={`mini${active ? " active" : ""}`}>
            <div className="guide" aria-hidden="true" />
            {mini.map((v, i) => (
              <button key={i} className="ucell" aria-label={`board ${b + 1} cell ${i + 1}`}
                disabled={!active || !!v} onClick={() => onCell(b, i)}>
                {v && <Mark key={`${i}-${v}`} type={v} />}
              </button>
            ))}
            {won && <div className="overlay"><Mark type={won} /></div>}
          </div>
        );
      })}
      {s.metaLine && <WinStroke line={s.metaLine} seal />}
    </div>
  );
}

// gold brush stroke through the winning three + a small cinnabar seal
function WinStroke({ line, seal }: { line: number[]; seal?: boolean }) {
  const c = (i: number) => ({ x: ((i % 3) + 0.5) / 3 * 100, y: (Math.floor(i / 3) + 0.5) / 3 * 100 });
  const a = c(line[0]), b = c(line[2]);
  const ex = (b.x - a.x) * 0.14, ey = (b.y - a.y) * 0.14; // extend past the end cells
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.03, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.03; // slight brush bow
  return (
    <svg className="winstroke" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className="ws draw" d={`M ${a.x - ex} ${a.y - ey} Q ${mx} ${my} ${b.x + ex} ${b.y + ey}`} />
      {seal && <circle className="seal" cx={b.x + ex} cy={b.y + ey} r="5" />}
    </svg>
  );
}

function Mark({ type, fading }: { type: Player; fading?: boolean }) {
  const cls = fading ? "fading" : "";
  return type === "X" ? (
    <svg viewBox="0 0 100 100" className={cls}>
      <path className="stroke x draw" d="M22 20 Q52 46 80 82" />
      <path className="stroke x draw d2" d="M80 20 Q48 48 20 82" />
    </svg>
  ) : (
    <svg viewBox="0 0 100 100" className={cls}>
      <path className="stroke o draw" d="M78 34 A32 32 0 1 0 74 68" />
    </svg>
  );
}

function Fog() {
  return <div className="fog" aria-hidden="true"><span /><span /><span /></div>;
}
function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E7CE86" /><stop offset="1" stopColor="#8A6B26" />
        </linearGradient>
        <linearGradient id="redGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C64A3E" /><stop offset="1" stopColor="#8E271F" />
        </linearGradient>
      </defs>
    </svg>
  );
}
