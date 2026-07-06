"use client";

import { useEffect, useRef, useState } from "react";
import {
  Cell, Mode, Opponent, Player,
  winner, botMove3, ultimateBotMove, miniPlayable, UltimateState,
} from "@/lib/game";

// ---------------------------------------------------------------------------
type Over = { who: Player | null; line?: number[] } | null;

type State = {
  screen: "landing" | "play";
  mode: Mode;
  opponent: Opponent;
  turn: Player;
  // 3x3 modes
  board: Cell[];
  queue: { X: number[]; O: number[] };
  // ultimate
  ub: Cell[][];
  boardsWon: Cell[];
  active: number | null;
  metaLine: number[] | null;
  over: Over;
  ply: number;
};

const fresh3 = (): Pick<State, "board" | "queue"> => ({
  board: Array(9).fill(null),
  queue: { X: [], O: [] },
});
const freshU = (): Pick<State, "ub" | "boardsWon" | "active" | "metaLine"> => ({
  ub: Array.from({ length: 9 }, () => Array(9).fill(null) as Cell[]),
  boardsWon: Array(9).fill(null),
  active: null,
  metaLine: null,
});

const initial: State = {
  screen: "landing", mode: "classic", opponent: "human", turn: "X",
  ...fresh3(), ...freshU(), over: null, ply: 0,
};

const CLIENT_FALLBACK: Record<string, string[]> = {
  move: ["You reach where I have already been.", "Predictable.", "A small stone against a mountain."],
  win: ["The board clears. As does your ambition.", "You lost to yourself, not to me."],
  loss: ["Fortune, not skill. Sit again."],
  draw: ["Stillness. Neither of us moved the mountain."],
};
const cannedLine = (e: string) => {
  const a = CLIENT_FALLBACK[e] ?? CLIENT_FALLBACK.move;
  return a[Math.floor(Math.random() * a.length)];
};

// ---------------------------------------------------------------------------
export default function Home() {
  const [s, setS] = useState<State>(initial);
  const [oracleLine, setOracleLine] = useState<string | null>(null);
  const oracleActedPly = useRef<number>(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOracleTurn =
    s.screen === "play" && s.opponent === "oracle" && s.turn === "O" && !s.over;

  // --- Oracle taunt (server route → falls back to canned) ------------------
  const summon = async (event: "move" | "win" | "loss" | "draw") => {
    const grid = s.board.map((v) => (v === "X" ? "Gold" : v === "O" ? "Oracle" : "·"));
    setOracleLine("…");
    try {
      const res = await fetch("/api/oracle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: s.mode, grid, event }),
      });
      const data = await res.json();
      setOracleLine(data.line || cannedLine(event));
    } catch {
      setOracleLine(cannedLine(event));
    }
  };

  // --- Oracle move (reliable local logic) ----------------------------------
  useEffect(() => {
    if (!isOracleTurn) return;
    if (oracleActedPly.current === s.ply) return;
    oracleActedPly.current = s.ply;
    timer.current = setTimeout(() => {
      setS((st) => {
        if (st.over || st.turn !== "O") return st;
        if (st.mode === "ultimate") {
          const us: UltimateState = { boards: st.ub, boardsWon: st.boardsWon, active: st.active };
          const mv = ultimateBotMove(us, "O", "X");
          if (!mv) return st;
          return commitUltimate(st, mv.b, mv.i);
        } else {
          const i = botMove3(st.board, "O", "X");
          if (i < 0) return st;
          return commit3(st, i);
        }
      });
    }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [isOracleTurn, s.ply]);

  // announce results / oracle moves via a taunt
  useEffect(() => {
    if (s.opponent !== "oracle") return;
    if (s.over) {
      const who = s.over.who;
      summon(who === "O" ? "win" : who === "X" ? "loss" : "draw");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.over]);

  // -------------------------------------------------------------------------
  const start = (mode: Mode) =>
    setS((st) => ({ ...initial, mode, opponent: st.opponent, screen: "play" }));
  const backToMenu = () => { oracleActedPly.current = -1; setOracleLine(null); setS((st) => ({ ...st, screen: "landing" })); };
  const setOpponent = (opponent: Opponent) => { oracleActedPly.current = -1; setOracleLine(null); setS((st) => ({ ...initial, mode: st.mode, opponent, screen: "play" })); };
  const reset = () => {
    oracleActedPly.current = -1; setOracleLine(null);
    setS((st) => ({ ...initial, mode: st.mode, opponent: st.opponent, screen: "play" }));
  };

  // --- 3x3 commit (classic + vanishing) ------------------------------------
  function commit3(st: State, i: number): State {
    if (st.board[i] || st.over) return st;
    const board = st.board.slice();
    const queue = { X: st.queue.X.slice(), O: st.queue.O.slice() };
    board[i] = st.turn;
    if (st.mode === "vanishing") {
      queue[st.turn].push(i);
      if (queue[st.turn].length > 3) {
        const old = queue[st.turn].shift()!;
        board[old] = null;
      }
    }
    const w = winner(board);
    let over: Over = null;
    if (w) over = { who: w.who, line: w.line };
    else if (st.mode === "classic" && board.every(Boolean)) over = { who: null };
    return {
      ...st, board, queue,
      turn: over ? st.turn : (st.turn === "X" ? "O" : "X"),
      over, ply: st.ply + 1,
    };
  }

  // --- ultimate commit -----------------------------------------------------
  function commitUltimate(st: State, b: number, i: number): State {
    if (st.over || st.boardsWon[b] || st.ub[b][i]) return st;
    if (st.active !== null && st.active !== b) return st;
    const ub = st.ub.map((mini, idx) => (idx === b ? mini.slice() : mini));
    ub[b][i] = st.turn;
    const boardsWon = st.boardsWon.slice();
    const w = winner(ub[b]);
    if (w) boardsWon[b] = w.who;
    // next forced board = cell index just played, unless that board is closed
    const destClosed = !!boardsWon[i] || ub[i].every(Boolean);
    const active = destClosed ? null : i;
    const meta = winner(boardsWon);
    const allDecided = boardsWon.every((v, idx) => v || ub[idx].every(Boolean));
    let over: Over = null;
    if (meta) over = { who: meta.who, line: meta.line };
    else if (allDecided) over = { who: null };
    return {
      ...st, ub, boardsWon, active, metaLine: meta ? meta.line : null,
      turn: over ? st.turn : (st.turn === "X" ? "O" : "X"),
      over, ply: st.ply + 1,
    };
  }

  const human3 = (i: number) => {
    if (isOracleTurn || s.over) return;
    setS((st) => {
      const next = commit3(st, i);
      if (next !== st && st.opponent === "oracle" && !next.over) summon("move");
      return next;
    });
  };
  const humanU = (b: number, i: number) => {
    if (isOracleTurn || s.over) return;
    setS((st) => {
      const next = commitUltimate(st, b, i);
      if (next !== st && st.opponent === "oracle" && !next.over) summon("move");
      return next;
    });
  };

  // -------------------------------------------------------------------------
  const goldFirst = s.turn === "X";
  const turnLabel = goldFirst ? "Gold" : s.opponent === "oracle" ? "Oracle" : "Cinnabar";
  const vanishingIdx =
    s.mode === "vanishing" && !s.over && s.queue[s.turn].length === 3 ? s.queue[s.turn][0] : -1;

  return (
    <>
      <Defs />
      <div className="fog" />
      <div className="grain" />
      <div className={`play-bg${s.screen === "play" ? " show" : ""}`} />

      <div className="stage">
        {s.screen === "landing" ? (
          <section className="landing">
            <div className="hero"><div className="hero-fallback"><div className="ink-orb" /></div></div>
            <div className="title-block">
              <h1 className="title">Tic&nbsp;Tac&nbsp;Toe</h1>
              <p className="subtitle">Choose your board. Then choose your rival.</p>
              <div className="rule" />
            </div>

            <div className="modes">
              <ModeCard mode="classic" name="Classic"
                desc="The game you know. Three in a row wins." onPick={start} />
              <ModeCard mode="vanishing" name="Vanishing"
                desc="Only three marks each. Place a fourth and your oldest fades away." onPick={start} />
              <ModeCard mode="ultimate" name="Ultimate"
                desc="Nine boards in one. Your move sends your rival to the next." onPick={start} />
            </div>

            <div className="signature" title="" />
          </section>
        ) : (
          <section className="play">
            <div className="topbar">
              <button className="back" onClick={backToMenu}>‹ Menu</button>
              <div className="mode-title">{s.mode}</div>
              <div className="turn">
                <span className={`dot ${goldFirst ? "x" : "o"}`} />
                <span>{turnLabel}</span>
              </div>
            </div>

            <div className="board-wrap">
              <div className="picker" role="group" aria-label="Opponent">
                <button className="pick" aria-pressed={s.opponent === "human"}
                  onClick={() => setOpponent("human")}>Two Players</button>
                <button className="pick" aria-pressed={s.opponent === "oracle"}
                  onClick={() => setOpponent("oracle")}>The Oracle</button>
              </div>

              {s.mode === "ultimate" ? (
                <UltimateBoard s={s} onCell={humanU} />
              ) : (
                <Grid s={s} vanishingIdx={vanishingIdx} onCell={human3} disabled={isOracleTurn} />
              )}

              {s.opponent === "oracle" && (
                <div className="oracle">
                  <span className="who">THE ORACLE</span>
                  {oracleLine ?? "Approach, then."}
                </div>
              )}

              <div className="status">
                {s.over ? (
                  s.over.who === null ? (
                    <>A still board. <span className="dim">Neither prevails.</span></>
                  ) : s.over.who === "X" ? (
                    <><span className="gold">Gold</span> takes the board.</>
                  ) : (
                    <><span className="red">{s.opponent === "oracle" ? "The Oracle" : "Cinnabar"}</span> wins.</>
                  )
                ) : null}
              </div>

              <button className="again" onClick={reset}>New Game</button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function Grid({ s, vanishingIdx, onCell, disabled }:
  { s: State; vanishingIdx: number; onCell: (i: number) => void; disabled: boolean }) {
  return (
    <div className="grid">
      <div className="line v v1" /><div className="line v v2" />
      <div className="line h h1" /><div className="line h h2" />
      {s.board.map((v, i) => (
        <button key={i} className={`cell${s.over?.line?.includes(i) ? " win" : ""}`}
          aria-label={`cell ${i + 1}`} disabled={disabled} onClick={() => onCell(i)}>
          {v && <Mark key={`${i}-${v}`} type={v} fading={i === vanishingIdx} />}
        </button>
      ))}
    </div>
  );
}

function UltimateBoard({ s, onCell }: { s: State; onCell: (b: number, i: number) => void }) {
  return (
    <div className="ultimate">
      {s.ub.map((mini, b) => {
        const active = !s.over && (s.active === null || s.active === b) && miniPlayable(
          { boards: s.ub, boardsWon: s.boardsWon, active: s.active }, b,
        );
        const won = s.boardsWon[b];
        return (
          <div key={b} className={`mini${active ? " active" : ""}`}>
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
    </div>
  );
}

function Mark({ type, fading }: { type: Player; fading?: boolean }) {
  if (type === "X") {
    return (
      <svg viewBox="0 0 100 100" className={fading ? "fading" : ""}>
        <path className="stroke x draw" d="M22 20 Q52 46 80 82" />
        <path className="stroke x draw d2" d="M80 20 Q48 48 20 82" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className={fading ? "fading" : ""}>
      <path className="stroke o draw" d="M78 34 A32 32 0 1 0 74 68" />
    </svg>
  );
}

function ModeCard({ mode, name, desc, onPick }:
  { mode: Mode; name: string; desc: string; onPick: (m: Mode) => void }) {
  return (
    <button className="mode" onClick={() => onPick(mode)}>
      <ModeIcon mode={mode} />
      <span>
        <span className="mode-name">{name}</span>
        <span className="mode-desc">{desc}</span>
      </span>
    </button>
  );
}

function ModeIcon({ mode }: { mode: Mode }) {
  // small gold grid glyphs — a plain grid, a grid with one fading cell, nested grids
  if (mode === "vanishing") {
    return (
      <svg className="mode-icon" viewBox="0 0 40 40">
        <g className="g">
          <path d="M14 4 V36 M26 4 V36 M4 14 H36 M4 26 H36" />
          <rect x="5" y="27" width="8" height="8" strokeDasharray="2 2" />
        </g>
      </svg>
    );
  }
  if (mode === "ultimate") {
    return (
      <svg className="mode-icon" viewBox="0 0 40 40">
        <g className="g">
          <path d="M14 3 V37 M26 3 V37 M3 14 H37 M3 26 H37" />
          <path d="M9 6 V11 M6 9 H11 M31 29 V34 M28 31 H34" strokeWidth="1.4" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="mode-icon" viewBox="0 0 40 40">
      <g className="g"><path d="M14 4 V36 M26 4 V36 M4 14 H36 M4 26 H36" /></g>
    </svg>
  );
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
