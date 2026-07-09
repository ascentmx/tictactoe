"use client";

import { useEffect, useRef, useState } from "react";
import {
  Cell, Mode, Opponent, Player,
  winner, botMove3, ultimateBotMove, miniPlayable, UltimateState,
} from "@/lib/game";
import {
  supabaseReady, createGame, joinGame, makeMove, subscribeGame, fetchGame, GameBlob, GameRow,
} from "@/lib/online";

// ---------------------------------------------------------------------------
const MODES: { id: Mode; name: string; desc: string }[] = [
  { id: "classic",   name: "Classic",   desc: "The game you know. Three in a row wins." },
  { id: "vanishing", name: "Vanishing", desc: "Only three marks each. A fourth fades your oldest." },
  { id: "ultimate",  name: "Ultimate",  desc: "Nine boards in one. Your move sends your rival on." },
];
const oppLabel = (o: Opponent) =>
  o === "oracle" ? "The Oracle" : o === "online" ? "Online" : "Pass & Play";

const CONGRATS = [
  "Three in a row. The board is yours.",
  "A clean line, beautifully played.",
  "Victory, drawn in gold.",
  "The dragon nods in respect.",
  "Masterful. The board bent to you.",
  "You saw the path and took it.",
  "A win worthy of the mist.",
  "Precision. The board had no answer.",
  "The gold holds. Well played.",
  "Triumph, quiet and complete.",
  "You wrote the ending yourself.",
  "A finish with no wasted move.",
];
const INSULTS = [
  "The Oracle expected no less.",
  "Outmaneuvered. The mist keeps its secrets.",
  "So close. The dragon barely stirred.",
  "A valiant loss is still a loss.",
  "The Oracle has seen this ending before.",
  "Try again. The board is patient.",
  "Defeat sharpens the blade. Sharpen away.",
  "The dragon yawns. Again?",
  "Your strategy amused the Oracle.",
  "Not today. Perhaps not tomorrow either.",
  "The mist claims another challenger.",
  "Close enough to see the win, not to hold it.",
];
const DRAWS = [
  "Stillness. Neither prevails.",
  "A balanced board. No victor.",
  "Two minds, one deadlock.",
  "The mist settles on no one.",
];
const LOSSES = [
  "Bested this time. Run it back?",
  "A loss with honour. Again?",
  "The board favoured your rival today.",
  "So close. Demand a rematch.",
  "Outplayed — but the mist forgets quickly.",
  "Not your board this time.",
];
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

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
type Room = { code: string; side: Player; status: "waiting" | "live" | "ended"; nameX: string | null; nameO: string | null };

const fresh3 = () => ({ board: Array(9).fill(null) as Cell[], queue: { X: [] as number[], O: [] as number[] } });
const freshU = () => ({
  ub: Array.from({ length: 9 }, () => Array(9).fill(null) as Cell[]),
  boardsWon: Array(9).fill(null) as Cell[], active: null as number | null, metaLine: null as number[] | null,
});
const base: State = {
  screen: "landing", mode: "classic", opponent: "oracle", turn: "X",
  ...fresh3(), ...freshU(), over: null, ply: 0,
};
const toBlob = (st: State): GameBlob => ({
  mode: st.mode, turn: st.turn, board: st.board, queue: st.queue,
  ub: st.ub, boardsWon: st.boardsWon, active: st.active, metaLine: st.metaLine, over: st.over, ply: st.ply,
});

// ===========================================================================
export default function Home() {
  const [s, setS] = useState<State>(base);
  const [idx, setIdx] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [endMsg, setEndMsg] = useState("");
  const [showEnd, setShowEnd] = useState(false);
  const oracleActedPly = useRef(-1);

  // online session
  const [room, setRoom] = useState<Room | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [invited, setInvited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mpChoosing, setMpChoosing] = useState(false);
  const [forcePlay, setForcePlay] = useState(false);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineErr, setOnlineErr] = useState("");
  const unsub = useRef<null | (() => void)>(null);

  const isOracleTurn = s.screen === "play" && s.opponent === "oracle" && s.turn === "O" && !s.over;
  const myTurn = s.opponent !== "online" || (!!room && (room.status !== "waiting" || forcePlay) && room.side === s.turn);

  // ---- carousel ----
  const cycle = (dir: 1 | -1) => {
    setSwapping(true);
    setTimeout(() => { setIdx((i) => (i + dir + MODES.length) % MODES.length); setSwapping(false); }, 170);
  };

  // ---- navigation ----
  const clearOnline = () => { unsub.current?.(); unsub.current = null; setRoom(null); setJoinInput(""); setOnlineErr(""); setForcePlay(false); };
  const begin = () => { oracleActedPly.current = -1; clearOnline(); setMpChoosing(false); setS({ ...base, mode: MODES[idx].id, opponent: "oracle", screen: "play" }); };
  const home = () => { clearOnline(); setMpChoosing(false); setS((st) => ({ ...st, screen: "landing" })); };
  const reset = () => { oracleActedPly.current = -1; setMpChoosing(false); if (s.opponent === "online") clearOnline();
    setS((st) => ({ ...base, mode: st.mode, opponent: st.opponent, screen: "play" })); };
  const setOpponentTo = (target: Opponent) => {
    oracleActedPly.current = -1; clearOnline();
    setS((st) => ({ ...base, mode: st.mode, opponent: target, screen: "play" }));
  };
  // grouped selection: The Oracle  vs  Multiplayer → { Online, Pass & Play }
  const chooseOracle = () => { setMpChoosing(false); setOpponentTo("oracle"); };
  const openMultiplayer = () => { clearOnline(); setMpChoosing(true); };
  const chooseOnline = () => { setMpChoosing(false); setOpponentTo("online"); };
  const chooseLocal = () => { setMpChoosing(false); setOpponentTo("human"); };
  useEffect(() => () => { unsub.current?.(); }, []);

  // ---- open a shared link → land on the online lobby with the code filled ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("join");
    if (code) {
      if (supabaseReady) {
        setJoinInput(code.toUpperCase().slice(0, 4));
        setInvited(true);
        setS((prev) => ({ ...prev, screen: "play", opponent: "online" }));
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const shareLink = async () => {
    if (!room) return;
    const url = `${window.location.origin}/?join=${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Tic Tac Toe", text: "Join my match", url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    } catch { /* user dismissed the share sheet — nothing to do */ }
  };

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

  // ---- human moves (local + online) ----
  const canPlayOnline = () => !!room && (room.status !== "waiting" || forcePlay) && room.side === s.turn;
  const play3 = (i: number) => {
    if (s.over) return;
    if (s.opponent === "online") {
      if (!canPlayOnline()) return;
      const next = commit3(s, i);
      if (next !== s) { setS(next); makeMove(room!.code, toBlob(next), s.ply).catch((e) => setOnlineErr(String(e.message ?? e))); }
      return;
    }
    if (!isOracleTurn) setS((st) => commit3(st, i));
  };
  const playU = (b: number, i: number) => {
    if (s.over) return;
    if (s.opponent === "online") {
      if (!canPlayOnline()) return;
      const next = commitU(s, b, i);
      if (next !== s) { setS(next); makeMove(room!.code, toBlob(next), s.ply).catch((e) => setOnlineErr(String(e.message ?? e))); }
      return;
    }
    if (!isOracleTurn) setS((st) => commitU(st, b, i));
  };

  // ---- Oracle replies after a short pause (local only) ----
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

  // ---- end-of-game line, revealed after the winning stroke draws ----
  useEffect(() => {
    if (!s.over) { setEndMsg(""); setShowEnd(false); return; }
    const who = s.over.who;
    const poolArr =
      who === null ? DRAWS
      : s.opponent === "online" ? (room?.side === who ? CONGRATS : LOSSES)
      : s.opponent === "oracle" ? (who === "O" ? INSULTS : CONGRATS)
      : CONGRATS;
    setEndMsg(pick(poolArr));
    const t = setTimeout(() => setShowEnd(true), 850);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.over]);

  // ---- polling: the reliable sync path (works regardless of realtime config) ----
  useEffect(() => {
    if (s.opponent !== "online" || !room || s.over) return;
    let active = true;
    const tick = async () => {
      try {
        const row = await fetchGame(room.code);
        if (!active || !row) return;
        // only adopt server state if it's not older than what we already show
        setS((prev) => (row.state.ply >= prev.ply ? { ...prev, ...row.state } : prev));
        setRoom((r) => (r ? { ...r, status: row.status, nameX: row.name_x, nameO: row.name_o } : r));
      } catch { /* transient — next tick retries */ }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { active = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.opponent, room?.code, s.over]);

  // ---- online: apply incoming rows ----
  const startSub = (code: string) => {
    unsub.current?.();
    unsub.current = subscribeGame(code, (row: GameRow) => {
      const b = row.state;
      setS((prev) => ({ ...prev, ...b }));
      setRoom((r) => (r ? { ...r, status: row.status, nameX: row.name_x, nameO: row.name_o } : r));
    });
  };
  const hostGame = async () => {
    setOnlineBusy(true); setOnlineErr("");
    try {
      const blob = toBlob({ ...base, mode: s.mode });
      const nm = playerName.trim();
      const { code } = await createGame(blob, nm);
      setS((prev) => ({ ...prev, ...blob }));
      setRoom({ code, side: "X", status: "waiting", nameX: nm || null, nameO: null });
      startSub(code);
    } catch (e) { setOnlineErr(String((e as Error).message ?? e)); }
    setOnlineBusy(false);
  };
  const joinRoom = async () => {
    const code = joinInput.trim().toUpperCase();
    if (code.length < 4) { setOnlineErr("Enter the 4-character code."); return; }
    setOnlineBusy(true); setOnlineErr("");
    try {
      const nm = playerName.trim();
      const row = await joinGame(code, nm);
      setS((prev) => ({ ...prev, ...row.state, mode: row.mode }));
      setRoom({ code, side: "O", status: row.status, nameX: row.name_x, nameO: nm || row.name_o });
      setInvited(false);
      startSub(code);
    } catch (e) { setOnlineErr(String((e as Error).message ?? e)); }
    setOnlineBusy(false);
  };

  // -------------------------------------------------------------------------
  const goldTurn = s.turn === "X";
  const nameFor = (p: Player) => (p === "X" ? room?.nameX || "Gold" : room?.nameO || "Cinnabar");
  const turnLabel = s.opponent === "online" ? nameFor(s.turn)
    : goldTurn ? "Gold" : s.opponent === "oracle" ? "Oracle" : "Cinnabar";
  const vanishingIdx = s.mode === "vanishing" && !s.over && s.queue[s.turn].length === 3 ? s.queue[s.turn][0] : -1;
  const showLobby = s.opponent === "online" && (!room || (room.status === "waiting" && !forcePlay));
  const group: "oracle" | "mp" = s.opponent === "oracle" && !mpChoosing ? "oracle" : "mp";
  const currentLabel = mpChoosing ? "Multiplayer" : oppLabel(s.opponent);

  return (
    <>
      <Defs />
      <div className={`dragons mode-${s.screen === "play" ? "hidden" : MODES[idx].id}`}>
        <div className="drag d-classic" /><div className="drag d-vanishing" /><div className="drag d-ultimate" />
        <div className="mist-fallback" />
      </div>
      <Fog />

      {s.screen === "landing" ? (
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
        <main className={`play mode-${s.mode}`}>
          <div className="clouds" />
          <div className="vignette" />

          <div className="topbar">
            <button className="home" onClick={home}>‹ Home</button>
            <div className="mode-title">{s.mode}</div>
            <div className="tr">
              <div className="opp-others">
                {group === "oracle"
                  ? <button className="oppToggle" onClick={openMultiplayer}>Multiplayer</button>
                  : <button className="oppToggle" onClick={chooseOracle}>The Oracle</button>}
              </div>
              <div className="turn"><span className={`dot ${goldTurn ? "x" : "o"}`} /><span>{turnLabel}</span></div>
            </div>
          </div>

          <div className="opp-current">
            {group === "mp" && !mpChoosing
              ? <button className="ul ul-btn" onClick={() => setMpChoosing(true)}>{currentLabel}</button>
              : <span className="ul">{currentLabel}</span>}
          </div>
          {s.opponent === "online" && room && room.status !== "waiting" && !s.over && !mpChoosing && (
            <div className="turn-hint">{myTurn ? "Your move" : "Their move"}</div>
          )}

          <div className="board-wrap">
            {mpChoosing ? (
              <div className="chooser">
                {supabaseReady && <button className="lobby-btn" onClick={chooseOnline}>Online</button>}
                {supabaseReady && <div className="lobby-or">or</div>}
                <button className="lobby-btn" onClick={chooseLocal}>Pass &amp; Play</button>
                {!supabaseReady && <div className="lobby-sub">Online play isn&apos;t set up yet — Pass &amp; Play works on one device.</div>}
              </div>
            ) : showLobby ? (
              <Lobby room={room} joinInput={joinInput} setJoinInput={setJoinInput}
                playerName={playerName} setPlayerName={setPlayerName} invited={invited}
                onHost={hostGame} onJoin={joinRoom} onShare={shareLink} copied={copied}
                onForcePlay={() => setForcePlay(true)} busy={onlineBusy} err={onlineErr} />
            ) : s.mode === "ultimate" ? (
              <Ultimate s={s} onCell={playU} locked={!myTurn} />
            ) : (
              <Grid s={s} vanishingIdx={vanishingIdx} onCell={play3} disabled={isOracleTurn || !myTurn} />
            )}
          </div>

          {!s.over && !showLobby && !mpChoosing && <button className="newgame" onClick={reset}>New game</button>}

          {s.over && showEnd && (() => {
            const who = s.over.who;
            const win = s.opponent === "online" ? who === room?.side
              : who === "X" || (who === "O" && s.opponent !== "oracle");
            const headline = who === null ? "A still board"
              : s.opponent === "online" ? `${nameFor(who)} wins`
              : s.opponent === "oracle" ? (who === "X" ? "You win" : "The Oracle wins")
              : (who === "X" ? "Gold prevails" : "Cinnabar prevails");
            const tone = who === null ? "draw" : win ? "win" : "loss";
            return (
              <div className="endwrap">
                <div className="endcard">
                  <div className={`endresult ${tone}`}>{headline}</div>
                  <p className="endmsg">{endMsg}</p>
                  <div className="endactions">
                    <button className="endnew" onClick={reset}>New game</button>
                    <button className="endhome" onClick={home}>‹ Home</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </main>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function Lobby({ room, joinInput, setJoinInput, playerName, setPlayerName, invited,
  onHost, onJoin, onShare, copied, onForcePlay, busy, err }: {
  room: Room | null; joinInput: string; setJoinInput: (v: string) => void;
  playerName: string; setPlayerName: (v: string) => void; invited: boolean;
  onHost: () => void; onJoin: () => void; onShare: () => void; copied: boolean;
  onForcePlay: () => void; busy: boolean; err: string;
}) {
  if (room && room.status === "waiting") {
    return (
      <div className="lobby">
        <div className="lobby-title">Waiting for your rival</div>
        <div className="code">{room.code}</div>
        <button className="lobby-btn" onClick={onShare}>{copied ? "Link copied" : "Share link"}</button>
        <div className="lobby-sub">Or read them the code. They tap Multiplayer, then Join.</div>
        <button className="lobby-ghost" onClick={onForcePlay}>Play now &rsaquo;</button>
      </div>
    );
  }
  return (
    <div className="lobby">
      {invited && <div className="lobby-invite">You've been invited to a match</div>}
      <input className="lobby-name" value={playerName} maxLength={16} placeholder="Your name"
        onChange={(e) => setPlayerName(e.target.value)} aria-label="Your name" />
      {!invited && <button className="lobby-btn" onClick={onHost} disabled={busy}>Create a game</button>}
      {!invited && <div className="lobby-or">or</div>}
      <div className="join-row">
        <input className="join-input" value={joinInput} maxLength={4} placeholder="CODE"
          onChange={(e) => setJoinInput(e.target.value.toUpperCase())} aria-label="Join code" />
        <button className="lobby-btn small" onClick={onJoin} disabled={busy}>Join</button>
      </div>
      {err && <div className="lobby-err">{err}</div>}
    </div>
  );
}

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
      {s.over?.line && s.over.who && <WinStroke line={s.over.line} who={s.over.who} />}
    </div>
  );
}

function Ultimate({ s, onCell, locked }: { s: State; onCell: (b: number, i: number) => void; locked: boolean }) {
  return (
    <div className="ultimate">
      {s.ub.map((mini, b) => {
        const active = !locked && !s.over && (s.active === null || s.active === b)
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
      {s.metaLine && s.over?.who && <WinStroke line={s.metaLine} who={s.over.who} />}
    </div>
  );
}

function WinStroke({ line, who }: { line: number[]; who: Player }) {
  const c = (i: number) => ({ x: ((i % 3) + 0.5) / 3 * 100, y: (Math.floor(i / 3) + 0.5) / 3 * 100 });
  const a = c(line[0]), b = c(line[2]);
  const ex = (b.x - a.x) * 0.14, ey = (b.y - a.y) * 0.14;
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.03, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.03;
  const k = who === "X" ? "x" : "o";
  return (
    <svg className="winstroke" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className={`ws ${k} draw`} d={`M ${a.x - ex} ${a.y - ey} Q ${mx} ${my} ${b.x + ex} ${b.y + ey}`} />
      <circle className={`seal ${k}`} cx={b.x + ex} cy={b.y + ey} r="5" />
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

function Fog() { return <div className="fog" aria-hidden="true"><span /><span /><span /></div>; }
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
