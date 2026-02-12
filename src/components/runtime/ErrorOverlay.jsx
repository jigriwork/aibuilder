import React from "react";
import Button from "../ui/Button";

export default function ErrorOverlay({ error, onRetry }) {
  return (
    <div className="preview-overlay friendly-error">
      <h4>We hit a small build issue</h4>
      <p>{error}</p>
      <Button variant="ghost" onClick={onRetry}>Try again</Button>
    </div>
  );
}
