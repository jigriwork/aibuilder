import { useEffect, useMemo, useState } from "react";

const BUILD_TABS = [
  { id: "gamespec", label: "GameSpec" },
  { id: "errors", label: "Errors" },
  { id: "assets", label: "Assets" },
];

function getRulesSummary(spec) {
  if (!spec?.rules || typeof spec.rules !== "object") {
    return "No rules generated yet.";
  }

  const fragments = [];

  if (Array.isArray(spec.rules.win) && spec.rules.win.length > 0) {
    fragments.push(`win: ${spec.rules.win.map((rule) => rule?.type || "unknown").join(", ")}`);
  }

  if (Array.isArray(spec.rules.lose) && spec.rules.lose.length > 0) {
    fragments.push(`lose: ${spec.rules.lose.map((rule) => rule?.type || "unknown").join(", ")}`);
  }

  if (Array.isArray(spec.rules.score) && spec.rules.score.length > 0) {
    fragments.push(`score: ${spec.rules.score.map((rule) => rule?.type || "unknown").join(", ")}`);
  }

  return fragments.length > 0 ? fragments.join(" · ") : "Rules object is present but empty.";
}

export default function BuildPanel({
  gameSpec,
  lastErrorMessage,
  lastResponseStatus,
  onApplySpec,
  assets,
}) {
  const [activeTab, setActiveTab] = useState("gamespec");
  const [isEditable, setIsEditable] = useState(false);
  const [specText, setSpecText] = useState("");
  const [specValidationMessage, setSpecValidationMessage] = useState("");

  const canonicalSpecText = useMemo(
    () => (gameSpec ? JSON.stringify(gameSpec, null, 2) : "{}"),
    [gameSpec],
  );

  const generatedSummary = useMemo(
    () => ({
      title: gameSpec?.title || "Untitled Prototype",
      mode: gameSpec?.mode || "Unknown",
      rulesSummary: getRulesSummary(gameSpec),
    }),
    [gameSpec],
  );

  const isDirty = specText.trim() !== canonicalSpecText.trim();

  useEffect(() => {
    setSpecText(canonicalSpecText);
    setSpecValidationMessage("");
  }, [canonicalSpecText]);

  const handleApply = () => {
    try {
      const parsed = JSON.parse(specText);
      onApplySpec?.(parsed);
      setSpecValidationMessage("Spec applied successfully.");
    } catch (error) {
      setSpecValidationMessage(
        error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON payload.",
      );
    }
  };

  return (
    <section className="panel build-panel">
      <div className="panel-head">
        <h2>Build</h2>
        <div className="panel-tabs" role="tablist" aria-label="Build panel tabs">
          {BUILD_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="generated-summary">
        <p>
          <span>Generated:</span> {generatedSummary.title}
        </p>
        <p>
          <span>Mode:</span> {generatedSummary.mode}
        </p>
        <p>
          <span>Rules:</span> {generatedSummary.rulesSummary}
        </p>
      </div>

      {activeTab === "gamespec" ? (
        <div className="panel-content build-spec-content">
          <div className="row-inline">
            <label className="toggle-inline" htmlFor="spec-edit-toggle">
              <input
                id="spec-edit-toggle"
                type="checkbox"
                checked={isEditable}
                onChange={(event) => setIsEditable(event.target.checked)}
              />
              Edit JSON
            </label>

            {isDirty ? (
              <button type="button" className="btn btn-secondary" onClick={handleApply}>
                Apply Spec
              </button>
            ) : null}
          </div>

          <textarea
            className="spec-editor"
            value={specText}
            onChange={(event) => setSpecText(event.target.value)}
            readOnly={!isEditable}
            aria-label="Game spec JSON editor"
            spellCheck={false}
          />

          {specValidationMessage ? <p className="form-inline-msg">{specValidationMessage}</p> : null}
        </div>
      ) : null}

      {activeTab === "errors" ? (
        <div className="panel-content build-errors-content">
          <div className="info-block">
            <h3>Last response status</h3>
            <p>{lastResponseStatus || "No response yet."}</p>
          </div>
          <div className="info-block">
            <h3>Last error</h3>
            <p>{lastErrorMessage || "No errors recorded."}</p>
          </div>
        </div>
      ) : null}

      {activeTab === "assets" ? (
        <div className="panel-content build-assets-content">
          <h3>Assets</h3>
          {assets?.length ? (
            <ul className="asset-list">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.name}</strong>
                  <span>{asset.type}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No assets yet. Generated assets will appear here.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
