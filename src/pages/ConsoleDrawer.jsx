function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString();
}

export default function ConsoleDrawer({
  isOpen,
  serverOnline,
  lastProvider,
  lastLatencyMs,
  lastResponseStatus,
  lastErrorStack,
  lastJsonParseError,
  events,
}) {
  return (
    <section className={`console-drawer ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
      <div className="console-meta-grid">
        <div className="console-meta-card">
          <h3>Server Health</h3>
          <p>{serverOnline ? "Online" : "Offline"}</p>
        </div>
        <div className="console-meta-card">
          <h3>Last Provider</h3>
          <p>{lastProvider || "-"}</p>
        </div>
        <div className="console-meta-card">
          <h3>Last Latency</h3>
          <p>{typeof lastLatencyMs === "number" ? `${lastLatencyMs}ms` : "-"}</p>
        </div>
        <div className="console-meta-card">
          <h3>Last Response</h3>
          <p>{lastResponseStatus || "-"}</p>
        </div>
      </div>

      <div className="console-errors">
        <div className="info-block">
          <h3>Last error stack (safe)</h3>
          <pre>{lastErrorStack || "No error stack recorded."}</pre>
        </div>
        <div className="info-block">
          <h3>Last JSON parse error</h3>
          <pre>{lastJsonParseError || "No JSON parse errors."}</pre>
        </div>
      </div>

      <div className="console-event-feed">
        <h3>Events</h3>
        <ul>
          {events?.length ? (
            events.map((event) => (
              <li key={event.id}>
                <span className={`event-level ${event.level}`}>{event.level.toUpperCase()}</span>
                <span className="event-time">{formatTime(event.createdAt)}</span>
                <span className="event-message">{event.message}</span>
                {event.meta ? <code>{event.meta}</code> : null}
              </li>
            ))
          ) : (
            <li className="empty-events">No events yet.</li>
          )}
        </ul>
      </div>
    </section>
  );
}
