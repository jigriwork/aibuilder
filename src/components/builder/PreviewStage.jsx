import React from "react";
import Button from "../ui/Button";
import Card from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import GameViewport from "../../runtime/GameViewport";
import Board2DView from "../../runtime/board2d/Board2DView";
import LoadingOverlay from "../runtime/LoadingOverlay";
import ErrorOverlay from "../runtime/ErrorOverlay";
import HUD from "../runtime/HUD";
import ResultOverlay from "../runtime/ResultOverlay";

export default function PreviewStage({
  currentSpec,
  runState,
  lastError,
  lastBuildError,
  playSession,
  gameState,
  hudTimer,
  sceneTitle,
  isBoardMode,
  showEmptyPreview,
  hasFriendlyError,
  isBuilding,
  setGameState,
  setCountdown,
  setPlaySession,
  onBuildTrigger,
}) {
  return (
    <section className="builder2-preview-stage">
      <Card className="preview-wrap premium">
        {lastBuildError ? <div className="build-error-banner">{lastBuildError}</div> : null}
        
        {!showEmptyPreview ? (
          isBoardMode ? (
            <Board2DView key={`board-${playSession}`} spec={currentSpec?.board2d} />
          ) : (
            <GameViewport
              key={`physics-${playSession}`}
              gameSpec={currentSpec}
              onGameStateChange={setGameState}
              onCountdownChange={setCountdown}
            />
          )
        ) : null}

        {showEmptyPreview ? (
          <div className="preview-overlay empty-grid">
            <EmptyState
              title="Your game world will appear here"
              subtitle="Click Build to generate a playable scene."
              ctaLabel="Build"
              onCta={onBuildTrigger}
            />
          </div>
        ) : null}

        {isBuilding ? <LoadingOverlay /> : null}

        {hasFriendlyError ? (
          <ErrorOverlay error={lastError} onRetry={onBuildTrigger} />
        ) : null}

        <HUD title={sceneTitle} timer={hudTimer} />

        <ResultOverlay result={gameState} />
      </Card>
    </section>
  );
}
