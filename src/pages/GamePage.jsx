import { useEffect, useMemo, useState } from "react";
import GameViewport from "../runtime/GameViewport";
import Board2DView from "../runtime/board2d/Board2DView";
import BuildPanel from "./BuildPanel";
import ConsoleDrawer from "./ConsoleDrawer";
import "./gamePage.css";

const API_BASE = (import.meta.env.VITE_API_BASE || "").trim();
const GENERATE_URL = `${API_BASE}/api/generate`;
const HEALTH_URL = `${API_BASE}/api/health`;
const PROVIDER_KEY = "jigrify_provider";
const OPENAI_KEY = "jigrify_openai_key";
const GEMINI_KEY = "jigrify_gemini_key";
const HISTORY_KEY = "jigrify_history";

const QUICK_PROMPTS = [
  "A bouncy ball on a floor",
  "A stack of boxes that falls",
  "A sphere rolling down a ramp",
];

export default function GamePage() {
  const [prompt, setPrompt] = useState("");
  const [gameSpec, setGameSpec] = useState(null);
  const [history, setHistory] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [inlineMessage, setInlineMessage] = useState("");
  const [provider, setProvider] = useState("openai");
  const [openAiKeyInput, setOpenAiKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [keyTestStatus, setKeyTestStatus] = useState("");
  const [serverOnline, setServerOnline] = useState(false);
  const [gameState, setGameState] = useState("idle");
  const [countdown, setCountdown] = useState(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState("prompt");
  const [runState, setRunState] = useState("stopped");
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled");
  const [lastProvider, setLastProvider] = useState("");
  const [lastLatencyMs, setLastLatencyMs] = useState(null);
  const [lastResponseStatus, setLastResponseStatus] = useState("");
  const [lastErrorStack, setLastErrorStack] = useState("");
  const [lastJsonParseError, setLastJsonParseError] = useState("");
  const [consoleEvents, setConsoleEvents] = useState([]);

  const addConsoleEvent = (level, message, meta) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      level,
      message,
      meta: meta ? JSON.stringify(meta) : "",
      createdAt: new Date().toISOString(),
    };

    setConsoleEvents((prev) => [entry, ...prev].slice(0, 150));
  };

  const toSafeStack = (error) => {
    if (!(error instanceof Error)) return "Unknown error";
    return (error.stack || error.message || "Unknown error")
      .split("\n")
      .slice(0, 8)
      .join("\n");
  };

  useEffect(() => {
    const savedProvider = localStorage.getItem(PROVIDER_KEY);
    setProvider(savedProvider === "gemini" ? "gemini" : "openai");

    setOpenAiKeyInput(localStorage.getItem(OPENAI_KEY) || "");
    setGeminiKeyInput(localStorage.getItem(GEMINI_KEY) || "");

    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (!savedHistory) return;

    try {
      const parsed = JSON.parse(savedHistory);
      if (Array.isArray(parsed)) {
        setHistory(parsed.slice(0, 10));
      }
    } catch {
      // Ignore invalid history payload.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
  }, [history]);

  useEffect(() => {
    if (!inlineMessage) return;
    const timeout = setTimeout(() => setInlineMessage(""), 3500);
    return () => clearTimeout(timeout);
  }, [inlineMessage]);

  const checkServerHealth = async () => {
    try {
      const response = await fetch(HEALTH_URL);
      if (!response.ok) {
        setServerOnline(false);
        return false;
      }

      const data = await response.json();
      const ok = Boolean(data?.ok);
      setServerOnline(ok);
      return ok;
    } catch {
      setServerOnline(false);
      return false;
    }
  };

  useEffect(() => {
    void checkServerHealth();
    const interval = setInterval(() => {
      void checkServerHealth();
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  const callGenerateApi = async ({ providerName, apiKey, generationPrompt, previousSpec }) => {
    const requestStarted = performance.now();
    const response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Model-Provider": providerName,
      },
      body: JSON.stringify({
        prompt: generationPrompt,
        previousSpec: previousSpec || undefined,
      }),
    });

    const latencyMs = Math.round(performance.now() - requestStarted);
    setLastLatencyMs(latencyMs);
    setLastProvider(providerName);
    setLastResponseStatus(`${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);

    let data;
    try {
      data = await response.json();
      setLastJsonParseError("");
    } catch (error) {
      const parseMessage =
        error instanceof Error ? error.message : "Unable to parse server response as JSON.";
      setLastJsonParseError(parseMessage);
      throw new Error(`JSON parse failed (${response.status}): ${parseMessage}`);
    }

    if (!response.ok) {
      throw new Error(data?.error || `Request failed (${response.status}).`);
    }

    return { gameSpec: data?.gameSpec, latencyMs };
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) {
      return false;
    }

    const savedProvider = localStorage.getItem(PROVIDER_KEY) || "openai";
    const savedKey =
      savedProvider === "gemini"
        ? localStorage.getItem(GEMINI_KEY) || ""
        : localStorage.getItem(OPENAI_KEY) || "";

    if (!savedKey) {
      setErrorMessage("Key missing in Settings");
      setActiveSidebarTab("settings");
      addConsoleEvent("warn", "Run blocked: missing API key", { provider: savedProvider });
      return false;
    }

    setIsGenerating(true);
    setErrorMessage("");
    setInlineMessage("");
    setGameState("idle");
    addConsoleEvent("info", "Run requested", {
      provider: savedProvider,
      prompt: prompt.trim().slice(0, 120),
    });

    try {
      const { gameSpec: generatedSpec, latencyMs } = await callGenerateApi({
        providerName: savedProvider,
        apiKey: savedKey,
        generationPrompt: prompt.trim(),
        previousSpec: gameSpec,
      });

      setServerOnline(true);
      setLastErrorStack("");
      setGameSpec(generatedSpec);
      setCountdown(null);
      setRunState("running");

      const newEntry = {
        prompt: prompt.trim(),
        title: generatedSpec?.title || "Untitled Prototype",
        createdAt: new Date().toISOString(),
      };

      setHistory((prev) => [newEntry, ...prev].slice(0, 10));
      addConsoleEvent("info", "Run completed", {
        provider: savedProvider,
        latencyMs,
        title: generatedSpec?.title || "Untitled Prototype",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setServerOnline(false);
      setErrorMessage(message);
      setLastErrorStack(toSafeStack(error));
      addConsoleEvent("error", "Run failed", { message });
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRunStop = () => {
    if (runState === "running") {
      handleReset();
      addConsoleEvent("info", "Run stopped by user");
      return;
    }

    void handleGenerate();
  };

  const handleReset = () => {
    setGameSpec(null);
    setCountdown(null);
    setGameState("idle");
    setErrorMessage("");
    setInlineMessage("");
    setRunState("stopped");
  };

  const handleSaveKey = () => {
    const keyValue = provider === "gemini" ? geminiKeyInput.trim() : openAiKeyInput.trim();

    if (!keyValue) {
      setInlineMessage("Enter a valid API key first.");
      return;
    }

    localStorage.setItem(PROVIDER_KEY, provider);
    localStorage.setItem(provider === "gemini" ? GEMINI_KEY : OPENAI_KEY, keyValue);
    setInlineMessage(`${provider === "gemini" ? "Gemini" : "OpenAI"} key saved locally.`);
  };

  const handleClearKey = () => {
    if (provider === "gemini") {
      localStorage.removeItem(GEMINI_KEY);
      setGeminiKeyInput("");
    } else {
      localStorage.removeItem(OPENAI_KEY);
      setOpenAiKeyInput("");
    }

    setInlineMessage(`${provider === "gemini" ? "Gemini" : "OpenAI"} key cleared.`);
    setKeyTestStatus("");
  };

  const handleTestKey = () => {
    void (async () => {
      const key =
        provider === "gemini"
          ? geminiKeyInput.trim() || localStorage.getItem(GEMINI_KEY) || ""
          : openAiKeyInput.trim() || localStorage.getItem(OPENAI_KEY) || "";

      if (!key) {
        setKeyTestStatus("Add an API key first.");
        addConsoleEvent("warn", "Test Key blocked: missing API key", { provider });
        return;
      }

      addConsoleEvent("info", "Test Key requested", { provider });
      const healthOk = await checkServerHealth();
      if (!healthOk) {
        setKeyTestStatus("Server: Not running");
        addConsoleEvent("error", "Test Key failed: server offline", { provider });
        return;
      }

      setKeyTestStatus("Server: Connected. Testing key…");
      try {
        await callGenerateApi({
          providerName: provider,
          apiKey: key,
          generationPrompt: "test: make a ball on ground",
        });
        setKeyTestStatus("Key test successful.");
        setLastErrorStack("");
        addConsoleEvent("info", "Test Key successful", { provider });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Key test failed.";
        setKeyTestStatus(message);
        setLastErrorStack(toSafeStack(error));
        addConsoleEvent("error", "Test Key failed", { provider, message });
      }
    })();
  };

  const handleApplySpec = (nextSpec) => {
    if (!nextSpec || typeof nextSpec !== "object" || Array.isArray(nextSpec)) {
      const message = "Applied spec must be a JSON object.";
      setErrorMessage(message);
      addConsoleEvent("error", "Apply Spec failed", { message });
      return;
    }

    setGameSpec(nextSpec);
    setErrorMessage("");
    setRunState("running");
    addConsoleEvent("info", "Spec applied from Build panel", {
      title: nextSpec?.title || "Untitled Prototype",
      mode: nextSpec?.mode || "unknown",
    });
  };

  const handleResetCamera = () => {
    // Placeholder callback for future camera control reset.
  };

  const sceneTitle = gameSpec?.title || "None";
  const isBoardMode = gameSpec?.mode === "board2d";

  const assets = useMemo(() => {
    const sceneObjects = Array.isArray(gameSpec?.scene?.objects) ? gameSpec.scene.objects : [];
    return sceneObjects.slice(0, 12).map((obj, index) => ({
      id: `${obj?.name || obj?.type || "asset"}-${index}`,
      name: obj?.name || `Object ${index + 1}`,
      type: obj?.type || "scene-object",
    }));
  }, [gameSpec]);

  const historyItems = useMemo(
    () =>
      history.map((entry) => ({
        ...entry,
        prettyTime: new Date(entry.createdAt).toLocaleString(),
      })),
    [history],
  );

  const hudTimer = typeof countdown === "number" ? Math.max(0, Math.ceil(countdown)) : null;

  return (
    <div className="builder-shell">
      <header className="builder-header">
        <div className="brand-block">
          <span className="brand-logo" aria-hidden="true" />
          <div className="brand-copy">
            <h1>Jigrify</h1>
            <p>Text → Playable Game</p>
          </div>
        </div>

        <div className="project-name-wrap">
          <span>Project</span>
          <input
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            aria-label="Project name"
          />
        </div>

        <div className="header-actions">
          <label className="provider-select-wrap" htmlFor="provider-select-topbar">
            <span>Provider</span>
            <select
              id="provider-select-topbar"
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value;
                setProvider(nextProvider);
                localStorage.setItem(PROVIDER_KEY, nextProvider);
                setKeyTestStatus("");
                addConsoleEvent("info", "Provider changed", { provider: nextProvider });
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>

          <span className={`status-pill ${serverOnline ? "online" : "offline"}`}>
            Server: {serverOnline ? "Online" : "Offline"}
          </span>

          <button className="btn btn-ghost" type="button" onClick={() => setIsConsoleOpen((prev) => !prev)}>
            Console
          </button>

          <button className="btn btn-primary" type="button" onClick={handleRunStop} disabled={isGenerating}>
            {isGenerating ? "Generating…" : runState === "running" ? "Stop" : "Run"}
          </button>

          <button className="btn btn-secondary" type="button">
            Share
          </button>

          <button className="btn btn-ghost" type="button" disabled title="Coming soon">
            Export
          </button>
        </div>
      </header>

      <div className="builder-body">
        <div className="workspace-main">
          <aside className="panel pane pane-left">
            <div className="tabs-row" role="tablist" aria-label="Builder tabs">
              <button
                type="button"
                className={`tab-btn ${activeSidebarTab === "prompt" ? "active" : ""}`}
                onClick={() => setActiveSidebarTab("prompt")}
              >
                Prompt
              </button>
              <button
                type="button"
                className={`tab-btn ${activeSidebarTab === "history" ? "active" : ""}`}
                onClick={() => setActiveSidebarTab("history")}
              >
                History
              </button>
              <button
                type="button"
                className={`tab-btn ${activeSidebarTab === "settings" ? "active" : ""}`}
                onClick={() => setActiveSidebarTab("settings")}
              >
                Settings
              </button>
            </div>

            {activeSidebarTab === "prompt" ? (
              <div className="panel-content prompt-card">
                <label htmlFor="builder-prompt">Describe what to build</label>
                <textarea
                  id="builder-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Create a playful physics scene..."
                  rows={8}
                />

                <div className="chips-wrap">
                  {QUICK_PROMPTS.map((chipText) => (
                    <button
                      key={chipText}
                      type="button"
                      className="prompt-chip"
                      onClick={() => setPrompt(chipText)}
                    >
                      {chipText}
                    </button>
                  ))}
                </div>

                <div className="examples-note">
                  <span>Examples</span>
                  <p>Start simple, test quickly, then iterate your prompt.</p>
                </div>

                <div className="prompt-actions">
                  <button type="button" className="btn btn-primary" onClick={handleRunStop}>
                    {isGenerating ? "Generating…" : runState === "running" ? "Stop" : "Run"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleReset}>
                    Reset
                  </button>
                </div>

                {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
                {inlineMessage ? <p className="form-inline-msg">{inlineMessage}</p> : null}
              </div>
            ) : null}

            {activeSidebarTab === "history" ? (
              <div className="panel-content history-panel">
                <h2>Recent generations</h2>

                {historyItems.length === 0 ? (
                  <p>No generations yet. Run a prompt to create your first game spec.</p>
                ) : (
                  <ul className="history-list">
                    {historyItems.map((entry, index) => (
                      <li key={`${entry.createdAt}-${index}`}>
                        <h3>{entry.title}</h3>
                        <p className="history-prompt">{entry.prompt}</p>
                        <span>{entry.prettyTime}</span>
                        <button type="button" className="btn btn-ghost" onClick={() => setPrompt(entry.prompt)}>
                          Load prompt
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {activeSidebarTab === "settings" ? (
              <div className="panel-content settings-panel">
                <h2>Settings</h2>
                <p>Bring your own key. Stored only in your browser localStorage.</p>

                <label className="settings-label" htmlFor="api-key-input">
                  {provider === "gemini" ? "Gemini API Key" : "OpenAI API Key"}
                </label>
                <input
                  id="api-key-input"
                  type="password"
                  value={provider === "gemini" ? geminiKeyInput : openAiKeyInput}
                  onChange={(event) =>
                    provider === "gemini"
                      ? setGeminiKeyInput(event.target.value)
                      : setOpenAiKeyInput(event.target.value)
                  }
                  placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
                />

                <div className="settings-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleSaveKey}>
                    Save
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={handleClearKey}>
                    Clear
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleTestKey}>
                    Test Key
                  </button>
                </div>

                {keyTestStatus ? <p className="settings-status">{keyTestStatus}</p> : null}
              </div>
            ) : null}
          </aside>

          <div className="pane pane-middle">
            <BuildPanel
              gameSpec={gameSpec}
              lastErrorMessage={errorMessage}
              lastResponseStatus={lastResponseStatus}
              onApplySpec={handleApplySpec}
              assets={assets}
            />
          </div>

          <main className="panel pane pane-right builder-viewport">
            <div className="workspace-grid" aria-hidden="true" />

            {isBoardMode ? (
              <Board2DView spec={gameSpec?.board2d} />
            ) : (
              <GameViewport
                gameSpec={gameSpec}
                onGameStateChange={setGameState}
                onCountdownChange={setCountdown}
              />
            )}

            <div className="viewport-hud">
              <p>Scene: {sceneTitle}</p>
              <p>Mode: {isBoardMode ? "Board" : "Physics"}</p>
              {!isBoardMode ? <p>Physics: On</p> : null}
              {hudTimer !== null ? <p>Time: {hudTimer}s</p> : null}
              {!isBoardMode ? (
                <button type="button" className="btn btn-ghost" onClick={handleResetCamera}>
                  Reset Camera
                </button>
              ) : null}
            </div>

            {gameState === "won" ? <div className="result-overlay won">You win</div> : null}
            {gameState === "lost" ? <div className="result-overlay lost">You lost</div> : null}

            {!gameSpec ? (
              <div className="empty-overlay">
                <div className="empty-state-card">
                  <span className="empty-icon" aria-hidden="true">
                    ✦
                  </span>
                  <h2>Describe a scene</h2>
                  <p>Write a prompt and click Run to generate a playable preview.</p>
                </div>
              </div>
            ) : null}
          </main>
        </div>

        <ConsoleDrawer
          isOpen={isConsoleOpen}
          serverOnline={serverOnline}
          lastProvider={lastProvider}
          lastLatencyMs={lastLatencyMs}
          lastResponseStatus={lastResponseStatus}
          lastErrorStack={lastErrorStack}
          lastJsonParseError={lastJsonParseError}
          events={consoleEvents}
        />
      </div>
    </div>
  );
}
