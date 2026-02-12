import { useMemo, useState } from "react";
import { classifyPromptToTemplate, getPublicTemplates, getTemplateById } from "../lib/templates";
import "./landing.css";

const TEMPLATE_ID_KEY = "aigb_selected_template_id";
const TEMPLATE_MODE_KEY = "aigb_selected_template_mode";
const TEMPLATE_MODULES_KEY = "aigb_selected_template_modules";

const SUGGESTIONS = [
  "A cozy 3D puzzle room with movable boxes",
  "A Ludo-style board game with turn-based moves",
  "A physics platform with ramps and bouncing balls",
];

export default function Landing({
  user,
  projects,
  activeProjectId,
  onContinueAsGuest,
  onSignIn,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
}) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("openai");
  const [modePreference, setModePreference] = useState("auto");
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => localStorage.getItem(TEMPLATE_ID_KEY) || "");
  const [selectedMode, setSelectedMode] = useState(() => localStorage.getItem(TEMPLATE_MODE_KEY) || "auto");
  const [selectedModules, setSelectedModules] = useState(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_MODULES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [lastTemplateHint, setLastTemplateHint] = useState("");

  const recentProjects = useMemo(() => projects.slice(0, 10), [projects]);
  const templates = useMemo(() => getPublicTemplates(), []);

  const suggestedSelection = useMemo(
    () =>
      classifyPromptToTemplate({
        prompt,
        forceMode: modePreference,
        preferredTemplateId: selectedTemplateId,
      }),
    [prompt, modePreference, selectedTemplateId],
  );

  const activeTemplate = getTemplateById(selectedTemplateId || suggestedSelection.templateId);

  const selectTemplate = (template) => {
    const nextHint = template?.promptHints?.[0] || "";
    const currentPrompt = String(prompt || "").trim();
    const shouldAutofill = !currentPrompt || currentPrompt === lastTemplateHint;

    setSelectedTemplateId(template.id);
    setModePreference(template.mode);
    setSelectedMode(template.mode);
    setSelectedModules(Array.isArray(template.requiredModules) ? template.requiredModules : []);

    if (shouldAutofill && nextHint) {
      setPrompt(nextHint);
      setLastTemplateHint(nextHint);
    }

    localStorage.setItem(TEMPLATE_ID_KEY, template.id);
    localStorage.setItem(TEMPLATE_MODE_KEY, template.mode);
    localStorage.setItem(TEMPLATE_MODULES_KEY, JSON.stringify(template.requiredModules || []));
  };

  const handleNext = (autoRun = true) => {
    if (!prompt.trim()) return;

    const selection = classifyPromptToTemplate({
      prompt,
      forceMode: activeTemplate?.mode || modePreference,
      preferredTemplateId: selectedTemplateId,
    });

    const chosenTemplate = getTemplateById(selection.templateId) || activeTemplate;
    const effectiveForceMode = chosenTemplate?.mode || selection.intent || modePreference;
    const requiredModules = chosenTemplate?.requiredModules || selection.modulesEnabled || [];

    onCreateProject?.({
      name: prompt.trim().slice(0, 42) || "Untitled",
      prompt: prompt.trim(),
      provider,
      forceMode: effectiveForceMode,
      templateId: selection.templateId,
      requiredModules,
      autoRun,
    });
  };

  const handleOpenActive = () => {
    if (!activeProjectId) {
      setAuthMessage("No project yet. Create a new project first.");
      return;
    }
    onOpenProject?.(activeProjectId);
  };

  const handleSignInSubmit = () => {
    if (!emailInput.trim()) {
      setAuthMessage("Enter an email to sign in.");
      return;
    }
    onSignIn?.({
      name: nameInput.trim() || emailInput.trim().split("@")[0],
      email: emailInput.trim(),
    });
    setShowSignIn(false);
    setAuthMessage("Signed in locally.");
  };

  return (
    <div className="landing-shell">
      <div className="landing-core">
        <div className="auth-bar">
          {user?.isGuest ? (
            <>
              <p>Mode: <strong>Guest</strong></p>
              <button type="button" onClick={() => onContinueAsGuest?.()}>
                Continue as Guest
              </button>
              <button type="button" onClick={() => setShowSignIn((v) => !v)}>
                Sign in
              </button>
            </>
          ) : (
            <>
              <p>
                Signed in as <strong>{user?.name || user?.email}</strong>
              </p>
              <button type="button" onClick={() => onContinueAsGuest?.()}>
                Switch to Guest
              </button>
            </>
          )}
        </div>

        {showSignIn ? (
          <div className="auth-bar">
            <input
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Name"
              aria-label="Name"
            />
            <input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Email"
              aria-label="Email"
            />
            <button type="button" onClick={handleSignInSubmit}>
              Save Sign-in
            </button>
          </div>
        ) : null}

        {authMessage ? <p className="auth-message">{authMessage}</p> : null}

        <p className="landing-kicker">Jigrify · AI Game Builder from India</p>
        <h1>What do you want to build?</h1>

        <div className="landing-input-wrap">
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe your game idea..."
            aria-label="Build prompt"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleNext();
              }
            }}
          />
          <button type="button" onClick={() => handleNext(true)}>
            Next
          </button>
        </div>

        <div className="landing-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setPrompt(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>

        <section className="templates-gallery">
          <div className="templates-gallery-head">
            <h2>Templates Gallery</h2>
            <p>
              Suggested: <strong>{activeTemplate?.name || "Auto"}</strong>
            </p>
            <p>
              Selected: <strong>{activeTemplate?.name || "None"}</strong>
              {activeTemplate?.mode || selectedMode ? ` (${activeTemplate?.mode || selectedMode})` : ""}
            </p>
          </div>
          <div className="templates-grid">
            {templates.map((template) => {
              const isActive = (selectedTemplateId || suggestedSelection.templateId) === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  role="button"
                  tabIndex={0}
                  className={`template-card templateCard ${isActive ? "active templateCardSelected" : ""}`}
                  onClick={() => selectTemplate(template)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectTemplate(template);
                    }
                  }}
                >
                  {isActive ? <span className="template-selected-badge">Selected</span> : null}
                  <h3>{template.name}</h3>
                  <p>{template.mode}</p>
                  <p>Modules: {template.requiredModules.join(", ")}</p>
                </button>
              );
            })}
          </div>
          {suggestedSelection.limitationSummary ? (
            <p className="template-note">Capability note: {suggestedSelection.limitationSummary}</p>
          ) : null}
        </section>

        <div className="landing-selectors">
          <div className="selector-item">
            <label htmlFor="framework-select">🧩 Framework</label>
            <select
              id="framework-select"
              value={activeTemplate?.mode || modePreference}
              onChange={(event) => {
                setModePreference(event.target.value);
                setSelectedMode(event.target.value);
              }}
            >
              <option value="auto">Auto</option>
              <option value="physics3d">3D Physics</option>
              <option value="board2d">Board Game</option>
            </select>
          </div>

          <div className="selector-item">
            <label htmlFor="provider-select">🤖 Provider</label>
            <select
              id="provider-select"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>

          {modePreference !== "board2d" ? (
            <div className="selector-item toggle-item">
              <label htmlFor="physics-toggle">⚙️ Physics</label>
              <label className="switch" htmlFor="physics-toggle">
                <input
                  id="physics-toggle"
                  type="checkbox"
                  checked={physicsEnabled}
                  onChange={(event) => setPhysicsEnabled(event.target.checked)}
                />
                <span>{physicsEnabled ? "On" : "Off"}</span>
              </label>
            </div>
          ) : null}
        </div>

        <div className="landing-bottom-actions">
          <button
            type="button"
            className="open-builder-btn"
            onClick={() =>
              onCreateProject?.({
                name: "Untitled",
                provider,
                forceMode: activeTemplate?.mode || modePreference,
                templateId: selectedTemplateId || suggestedSelection.templateId,
                requiredModules:
                  selectedModules.length > 0
                    ? selectedModules
                    : activeTemplate?.requiredModules || suggestedSelection.modulesEnabled || [],
                autoRun: false,
              })
            }
          >
            New Project
          </button>
          <button type="button" className="open-builder-btn" onClick={handleOpenActive}>
            Open Existing Builder
          </button>
        </div>

        <div className="panel-card history-box" style={{ marginTop: 16 }}>
          <h3>Projects</h3>
          {recentProjects.length === 0 ? (
            <p>No projects yet.</p>
          ) : (
            <ul>
              {recentProjects.map((project) => (
                <li key={project.id}>
                  <strong>{project.name || "Untitled"}</strong>
                  <span>{new Date(project.updatedAt).toLocaleString()}</span>
                  <button type="button" onClick={() => onOpenProject?.(project.id)}>
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete project \"${project.name || "Untitled"}\"?`)) {
                        onDeleteProject?.(project.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
