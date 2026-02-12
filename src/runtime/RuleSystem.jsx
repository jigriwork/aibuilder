import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

function getFirstCountdown(rules) {
  const scoreRules = Array.isArray(rules?.score) ? rules.score : [];
  const countdownRule = scoreRules.find((rule) => rule?.type === "time" && rule?.mode === "countdown");
  const seconds = Number(countdownRule?.seconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function getFallBelowY(rules) {
  const loseRules = Array.isArray(rules?.lose) ? rules.lose : [];
  const loseRule = loseRules.find((rule) => rule?.type === "fallBelow");
  return Number.isFinite(Number(loseRule?.y)) ? Number(loseRule.y) : null;
}

function getReachArea(rules) {
  const winRules = Array.isArray(rules?.win) ? rules.win : [];
  const reachRule = winRules.find((rule) => rule?.type === "reachArea");
  if (!reachRule || !Array.isArray(reachRule.position) || reachRule.position.length !== 3) {
    return null;
  }
  return {
    position: reachRule.position.map(Number),
    radius: Number(reachRule.radius) > 0 ? Number(reachRule.radius) : 1,
  };
}

export default function RuleSystem({ gameSpec, playerBodyRef, onGameStateChange, onCountdownChange }) {
  const [remainingTime, setRemainingTime] = useState(null);
  const gameOverRef = useRef(false);

  const countdownStart = useMemo(() => getFirstCountdown(gameSpec?.rules), [gameSpec?.rules]);
  const fallBelowY = useMemo(() => getFallBelowY(gameSpec?.rules), [gameSpec?.rules]);
  const reachArea = useMemo(() => getReachArea(gameSpec?.rules), [gameSpec?.rules]);

  useEffect(() => {
    gameOverRef.current = false;
    onGameStateChange?.("idle");
    setRemainingTime(countdownStart);
  }, [countdownStart, onGameStateChange, gameSpec]);

  useEffect(() => {
    onCountdownChange?.(remainingTime);
  }, [remainingTime, onCountdownChange]);

  useEffect(() => {
    if (remainingTime === null || gameOverRef.current) {
      return;
    }

    const timer = setInterval(() => {
      setRemainingTime((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (!gameOverRef.current) {
            gameOverRef.current = true;
            onGameStateChange?.("lost");
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [remainingTime, onGameStateChange]);

  useFrame(() => {
    if (gameOverRef.current) {
      return;
    }

    const body = playerBodyRef?.current;
    if (!body) {
      return;
    }

    const position = body.translation();

    if (fallBelowY !== null && position.y < fallBelowY) {
      gameOverRef.current = true;
      onGameStateChange?.("lost");
      return;
    }

    if (reachArea) {
      const [tx, ty, tz] = reachArea.position;
      const dx = position.x - tx;
      const dy = position.y - ty;
      const dz = position.z - tz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= reachArea.radius) {
        gameOverRef.current = true;
        onGameStateChange?.("won");
      }
    }
  });

  return null;
}
