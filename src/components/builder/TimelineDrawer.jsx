import React, { useEffect, useState } from "react";
import Button from "../ui/Button";
import Badge from "../ui/Badge";

export default function TimelineDrawer({
  isOpen,
  onToggle,
  phaseTimeline,
  agentEvents,
  runState,
  agentPlan,
  pendingClarifyQuestion,
}) {
  const [progressPercent, setProgressPercent] = useState(0);

  const hasPhase = (value) => phaseTimeline.some((entry) => String(entry.phase || "").includes(value));
  const isBuilding = runState === "running" || runState === "awaiting_clarify";

  const timelineCards = [
    {
      id: "clarify",
      label: "Clarify",
      description: pendingClarifyQuestion?.text || "Captures missing details before generation.",
      state: pendingClarifyQuestion ? "active" : hasPhase("clarify") ? "done" : "idle",
    },
    {
      id: "plan",
      label: "Plan",
      description: agentPlan?.mvpDefinition || "Build strategy is prepared here.",
      state: hasPhase("plan") ? "done" : isBuilding ? "active" : "idle",
    },
    {
      id: "verify",
      label: "Verify",
      description: hasPhase("verify_fail") ? "Checks found issues that need fixing." : "Agent validates interactions and rules.",
      state: hasPhase("verify_fail") ? "error" : hasPhase("verify_pass") ? "done" : hasPhase("verify") ? "active" : "idle",
    },
    {
      id: "repair",
      label: "Repair",
      description: hasPhase("repair") ? "Auto-fixing edge cases and runtime safety." : "No repairs needed yet.",
      state: hasPhase("repair") ? (runState === "ready" ? "done" : "active") : "idle",
    },
    {
      id: "done",
      label: "Done",
      description: runState === "ready" ? "Build completed. Play is now unlocked." : "Final output appears here.",
      state: runState === "ready" ? "done" : runState === "error" ? "error" : "idle",
    },
  ];

  useEffect(() => {
    const completed = timelineCards.filter((card) => card.state === "done").length;
    setProgressPercent(Math.round((completed / timelineCards.length) * 100));
  }, [timelineCards]);

  const renderStatusText = (state) => {
    if (state === "done") return "Done";
    if (state === "active") return "Working";
    if (state === "error") return "Failed";
    return "Pending";
  };

  const renderStatusVariant = (state) => {
    if (state === "done") return "success";
    if (state === "active") return "brand";
    if (state === "error") return "danger";
    return "muted";
  };

  const renderTimelineIcon = (state) => {
    if (state === "done") return "✓";
    if (state === "active") return "●";
    if (state === "error") return "!";
    return "○";
  };

  if (!isOpen) return null;

  return (
    <aside className={`builder2-timeline ${isOpen ? "open" : "closed"}`}>
      <div className="timeline-head">
        <h3>Build Timeline</h3>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          Hide
        </Button>
      </div>

      <div className="timeline-progress">
        <div style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="timeline-card-list">
        {timelineCards.map((card) => (
          <article key={card.id} className={`timeline-card ${card.state}`}>
            <header>
              <span className="timeline-step-icon" aria-hidden="true">{renderTimelineIcon(card.state)}</span>
              <h4>{card.label}</h4>
              <Badge variant={renderStatusVariant(card.state)}>{renderStatusText(card.state)}</Badge>
            </header>
            <details>
              <summary>Details</summary>
              <p>{card.description}</p>
            </details>
          </article>
        ))}
      </div>

      <div className="timeline-events">
        <h4>Live events</h4>
        {agentEvents.length > 0 ? (
          <ul>
            {agentEvents.slice(0, 8).map((entry) => (
              <li key={entry.id}>
                <strong>{entry.type}</strong>
                <span>{entry.message || "Event received"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No events yet.</p>
        )}
      </div>
    </aside>
  );
}
