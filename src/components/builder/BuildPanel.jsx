import React from "react";
import Button from "../ui/Button";

export default function BuildPanel({
  runState,
  prompt,
  setPrompt,
  draftPrompt,
  composerInput,
  onBuild,
  onStop,
  lastBuildError,
}) {
  const isBuilding = runState === "running";
  const hasError = Boolean(lastBuildError);

  const handleBuild = () => {
    const seed = composerInput.trim() || prompt.trim() || draftPrompt.trim();
    if (!seed) return;
    onBuild(seed);
  };

  return (
    <div className="builder-main-actions">
      <Button
        className={isBuilding ? "btn-pulse-once" : ""}
        onClick={isBuilding ? onStop : handleBuild}
      >
        {isBuilding ? "Stop" : "Build"}
      </Button>

      {hasError ? <p className="build-inline-error">{lastBuildError}</p> : null}
    </div>
  );
}
