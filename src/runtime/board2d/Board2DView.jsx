import { useEffect, useMemo, useState } from "react";
import "./board2d.css";

const BASE_TRACK = [
  [6, 1],[6, 2],[6, 3],[6, 4],[6, 5],[5, 6],[4, 6],[3, 6],[2, 6],[1, 6],[0, 6],[0, 7],[0, 8],
  [1, 8],[2, 8],[3, 8],[4, 8],[5, 8],[6, 9],[6, 10],[6, 11],[6, 12],[6, 13],[6, 14],[7, 14],[8, 14],
  [8, 13],[8, 12],[8, 11],[8, 10],[8, 9],[9, 8],[10, 8],[11, 8],[12, 8],[13, 8],[14, 8],[14, 7],[14, 6],
  [13, 6],[12, 6],[11, 6],[10, 6],[9, 6],[8, 5],[8, 4],[8, 3],[8, 2],[8, 1],[8, 0],[7, 0],[7, 1],
  [7, 2],[7, 3],[7, 4],[7, 5],[7, 6],[7, 7],
];

function rotatePath(path, shift) {
  const count = path.length;
  return path.map((_, index) => path[(index + shift + count) % count]);
}

function fallbackBoardSpec() {
  const quarter = Math.floor(BASE_TRACK.length / 4);
  return {
    game: "ludo",
    size: 15,
    players: [
      {
        id: "red",
        color: "#ef4444",
        home: [1, 1],
        path: rotatePath(BASE_TRACK, 0),
        tokens: [{ id: "r1", pos: [1, 1], steps: 0 }],
      },
      {
        id: "green",
        color: "#22c55e",
        home: [13, 1],
        path: rotatePath(BASE_TRACK, quarter),
        tokens: [{ id: "g1", pos: [13, 1], steps: 0 }],
      },
      {
        id: "yellow",
        color: "#eab308",
        home: [13, 13],
        path: rotatePath(BASE_TRACK, quarter * 2),
        tokens: [{ id: "y1", pos: [13, 13], steps: 0 }],
      },
      {
        id: "blue",
        color: "#3b82f6",
        home: [1, 13],
        path: rotatePath(BASE_TRACK, quarter * 3),
        tokens: [{ id: "b1", pos: [1, 13], steps: 0 }],
      },
    ],
    rules: {
      dice: { min: 1, max: 6 },
      moves: { enterOn: 6, exactFinish: true },
    },
  };
}

function normalizeBoardSpec(spec) {
  const fallback = fallbackBoardSpec();
  const players = Array.isArray(spec?.players) && spec.players.length > 0 ? spec.players : fallback.players;

  return {
    size: spec?.size === 15 ? 15 : 15,
    players: players.slice(0, 4).map((player, index) => {
      const safeFallback = fallback.players[index] || fallback.players[0];
      const tokens = Array.isArray(player?.tokens) && player.tokens.length > 0 ? player.tokens : safeFallback.tokens;
      const token = tokens[0];
      return {
        id: player?.id || safeFallback.id,
        color: player?.color || safeFallback.color,
        home: Array.isArray(player?.home) ? player.home : safeFallback.home,
        path: Array.isArray(player?.path) && player.path.length > 1 ? player.path : safeFallback.path,
        token: {
          id: token?.id || `${safeFallback.id}1`,
          pos: Array.isArray(token?.pos) ? token.pos : safeFallback.home,
          steps: Number(token?.steps) > 0 ? Number(token.steps) : 0,
        },
      };
    }),
    rules: {
      dice: {
        min: Number(spec?.rules?.dice?.min) || 1,
        max: Number(spec?.rules?.dice?.max) || 6,
      },
      moves: {
        enterOn: Number(spec?.rules?.moves?.enterOn) || 6,
        exactFinish: spec?.rules?.moves?.exactFinish !== false,
      },
    },
  };
}

export default function Board2DView({ spec }) {
  const normalized = useMemo(() => normalizeBoardSpec(spec), [spec]);
  const [playersState, setPlayersState] = useState(normalized.players);
  const [turnIndex, setTurnIndex] = useState(0);
  const [dice, setDice] = useState(null);
  const [winner, setWinner] = useState(null);

  useEffect(() => {
    setPlayersState(normalized.players);
    setTurnIndex(0);
    setDice(null);
    setWinner(null);
  }, [normalized]);

  const currentPlayer = playersState[turnIndex] || playersState[0];

  const rollDice = () => {
    if (winner) return;
    const min = normalized.rules.dice.min;
    const max = normalized.rules.dice.max;
    const value = Math.floor(Math.random() * (max - min + 1)) + min;
    setDice(value);
  };

  const tryMoveToken = (playerIndex) => {
    if (winner || dice === null || playerIndex !== turnIndex) {
      return;
    }

    const player = playersState[playerIndex];
    if (!player) return;

    const token = player.token;
    const pathLength = player.path.length;
    const enterOn = normalized.rules.moves.enterOn;
    const exactFinish = normalized.rules.moves.exactFinish;

    let nextSteps;
    if (token.steps === 0) {
      if (dice !== enterOn) {
        setDice(null);
        setTurnIndex((prev) => (prev + 1) % playersState.length);
        return;
      }
      nextSteps = 1;
    } else {
      nextSteps = token.steps + dice;
    }

    if (exactFinish && nextSteps > pathLength) {
      setDice(null);
      setTurnIndex((prev) => (prev + 1) % playersState.length);
      return;
    }

    const reachedFinish = nextSteps >= pathLength;
    const cell = reachedFinish ? player.path[pathLength - 1] : player.path[nextSteps - 1];

    setPlayersState((prev) =>
      prev.map((entry, idx) =>
        idx === playerIndex
          ? {
              ...entry,
              token: {
                ...entry.token,
                steps: reachedFinish ? pathLength : nextSteps,
                pos: cell,
              },
            }
          : entry,
      ),
    );

    if (reachedFinish) {
      setWinner(player.id);
    }

    setDice(null);
    setTurnIndex((prev) => (prev + 1) % playersState.length);
  };

  const cells = Array.from({ length: 15 * 15 }, (_, index) => {
    const x = index % 15;
    const y = Math.floor(index / 15);
    return { x, y };
  });

  return (
    <div className="board2d-shell">
      <div className="board2d-topbar">
        <p>Turn: <strong>{currentPlayer?.id || "-"}</strong></p>
        <p>Dice: <strong>{dice ?? "-"}</strong></p>
        <button type="button" onClick={rollDice} disabled={Boolean(winner)}>
          Roll Dice
        </button>
      </div>

      <div className="ludo-grid" role="img" aria-label="Ludo board">
        {cells.map((cell) => {
          const inRedHome = cell.x <= 5 && cell.y <= 5;
          const inGreenHome = cell.x >= 9 && cell.y <= 5;
          const inBlueHome = cell.x <= 5 && cell.y >= 9;
          const inYellowHome = cell.x >= 9 && cell.y >= 9;
          const inCenter = cell.x >= 6 && cell.x <= 8 && cell.y >= 6 && cell.y <= 8;

          const classes = ["ludo-cell"];
          if (inRedHome) classes.push("red-home");
          if (inGreenHome) classes.push("green-home");
          if (inBlueHome) classes.push("blue-home");
          if (inYellowHome) classes.push("yellow-home");
          if (inCenter) classes.push("center-cell");

          return <div key={`${cell.x}-${cell.y}`} className={classes.join(" ")} />;
        })}

        {playersState.map((player, index) => {
          const [x, y] = player.token.pos;
          return (
            <button
              key={player.token.id}
              type="button"
              className="ludo-token"
              style={{
                gridColumn: `${x + 1}`,
                gridRow: `${y + 1}`,
                backgroundColor: player.color,
              }}
              onClick={() => tryMoveToken(index)}
              title={`${player.id} token`}
            />
          );
        })}
      </div>

      {winner ? <div className="board-win">You win: {winner}</div> : null}
    </div>
  );
}
