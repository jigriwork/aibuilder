import React from "react";

export default function HUD({ title, timer }) {
  return (
    <div className="preview-hud">
      <p>{title}</p>
      <p>{timer !== null ? `Time ${timer}s` : "Ready to play"}</p>
    </div>
  );
}
