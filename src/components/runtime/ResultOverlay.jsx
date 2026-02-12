import React from "react";

export default function ResultOverlay({ result }) {
  if (result === "won") return <div className="preview-result won">You win</div>;
  if (result === "lost") return <div className="preview-result lost">Try again</div>;
  return null;
}
