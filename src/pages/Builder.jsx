import { useEffect, useMemo, useRef, useState } from "react";
import GameViewport from "../runtime/GameViewport";
import Board2DView from "../runtime/board2d/Board2DView";
import { upsertProject } from "../lib/projects";
import { classifyPromptToTemplate, getTemplateById } from "../lib/templates";
import "./builder.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const GENERATE_STREAM_URL = `${API_BASE}/api/generate/stream`;
const AGENT_STREAM_URL = `${API_BASE}/api/agent/stream`;
const GENERATE_URL = `${API_BASE}/api/generate`;
const HEALTH_URL = `${API_BASE}/health`;

const OPENAI_KEY = "jigrify_openai_key";
const GEMINI_KEY = "jigrify_gemini_key";

function parseEventData(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function createMessage(role, message, meta = null) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    message,
    meta,
    createdAt: new Date().toISOString(),
  };
}

export default function Builder({
  user,
  activeProjectId,
  projects,
  initialRequest,
  onSetActiveProject,
  onCreateProject,
  onDeleteProject,
  onProjectsChanged,
  onBack,
}) {
  const [projectName, setProjectName] = useState("Untitled");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("openai");
  const [forceMode, setForceMode] = useState("auto");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [specHistory, setSpecHistory] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [currentSpec, setCurrentSpec] = useState(null);

  const [serverOnline, setServerOnline] = useState(false);
  const [runState, setRunState] = useState("stopped");
  const [lastStatus, setLastStatus] = useState("");
  const [lastError, setLastError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [activeLeftTab, setActiveLeftTab] = useState("history");
  const [openAiKeyInput, setOpenAiKeyInput] = useState(localStorage.getItem(OPENAI_KEY) || "");
  const [geminiKeyInput, setGeminiKeyInput] = useState(localStorage.getItem(GEMINI_KEY) || "");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [logs, setLogs] = useState([]);

  const [gameState, setGameState] = useState("idle");
  const [countdown, setCountdown] = useState(null);
  const [lastBuildPayload, setLastBuildPayload] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedRequiredModules, setSelectedRequiredModules] = useState([]);
  const [templateMeta, setTemplateMeta] = useState(null);
  const [agentPlan, setAgentPlan] = useState(null);
  const [phaseTimeline, setPhaseTimeline] = useState([]);
  const [limitations, setLimitations] = useState([]);

  const eventSourceRef = useRef(null);
  const buildInFlightRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const persistReadyRef = useRef(false);

  const project = useMemo(
    () => projects.find((entry) => entry.id === activeProjectId) || null,
    [projects, activeProjectId],
  );

  const projectMessagesStorageKey = project?.id ? `aigb_project_${project.id}_messages` : "";
  const projectSpecStorageKey = project?.id ? `aigb_project_${project.id}_spec` : "";

  const appendLog = (level, message, meta) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        level,
        message,
        meta: meta ? JSON.stringify(meta) : "",
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 150));
  };

  const closeStream = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    buildInFlightRef.current = false;
  };

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

  useEffect(() => {
    if (!project) return;

    persistReadyRef.current = false;
    closeStream();
    setProjectName(project.name || "Untitled");
    setProvider(project.provider || "openai");
    setForceMode(project.forceMode || "auto");
    setSelectedTemplateId(project.templateId || "");
    setSelectedRequiredModules(Array.isArray(project.requiredModules) ? project.requiredModules : []);

    let loadedMessages = Array.isArray(project.messages) ? project.messages : [];
    let loadedHistory = Array.isArray(project.specHistory) ? project.specHistory : [];

    try {
      if (projectMessagesStorageKey) {
        const rawMessages = localStorage.getItem(projectMessagesStorageKey);
        const parsedMessages = rawMessages ? JSON.parse(rawMessages) : null;
        if (Array.isArray(parsedMessages)) {
          loadedMessages = parsedMessages;
        }
      }

      if (projectSpecStorageKey) {
        const rawSpec = localStorage.getItem(projectSpecStorageKey);
        const parsedSpec = rawSpec ? JSON.parse(rawSpec) : null;
        if (parsedSpec && typeof parsedSpec === "object" && !Array.isArray(parsedSpec)) {
          loadedHistory = [parsedSpec];
        }
      }
    } catch {
      // Ignore project-scoped storage parse errors.
    }

    const loadedCursor = Number.isInteger(project.specCursor) ? project.specCursor : loadedHistory.length - 1;

    setChatMessages(loadedMessages);
    setSpecHistory(loadedHistory);
    setHistoryCursor(loadedCursor);
    setCurrentSpec(loadedCursor >= 0 ? loadedHistory[loadedCursor] || null : null);
    setPrompt("");
    setLastStatus("");
    setLastError("");
    setRetryCount(0);
    setRunState("stopped");
    setTemplateMeta(null);
    setAgentPlan(null);
    setPhaseTimeline([]);
    setLimitations([]);

    persistReadyRef.current = true;
  }, [project?.id]);

  useEffect(() => {
    if (!project || !persistReadyRef.current) return;
    upsertProject({
      ...project,
      name: projectName || "Untitled",
      provider,
      forceMode,
      templateId: selectedTemplateId,
      requiredModules: selectedRequiredModules,
      messages: chatMessages,
      specHistory,
      specCursor: historyCursor,
    });
    onProjectsChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectName,
    provider,
    forceMode,
    selectedTemplateId,
    selectedRequiredModules,
    chatMessages,
    specHistory,
    historyCursor,
    project?.id,
  ]);

  useEffect(() => {
    if (!projectMessagesStorageKey) return;
    localStorage.setItem(projectMessagesStorageKey, JSON.stringify(chatMessages));
  }, [projectMessagesStorageKey, chatMessages]);

  useEffect(() => {
    if (!projectSpecStorageKey) return;
    localStorage.setItem(projectSpecStorageKey, JSON.stringify(currentSpec || null));
  }, [projectSpecStorageKey, currentSpec]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    return () => closeStream();
  }, []);

  useEffect(() => {
    if (!initialRequest?.id || !project) return;
    if (initialRequest.projectId !== project.id) return;
    if (!initialRequest.prompt) return;

    setPrompt(initialRequest.prompt);
    setProvider(initialRequest.provider || project.provider || "openai");
    setForceMode(initialRequest.forceMode || project.forceMode || "auto");
    setSelectedTemplateId(initialRequest.templateId || project.templateId || "");
    setSelectedRequiredModules(
      Array.isArray(initialRequest.requiredModules)
        ? initialRequest.requiredModules
        : Array.isArray(project.requiredModules)
          ? project.requiredModules
          : [],
    );

    void startBuild({
      messageValue: initialRequest.prompt,
      providerValue: initialRequest.provider || provider,
      forceModeValue: initialRequest.forceMode || forceMode,
      templateIdValue: initialRequest.templateId || project.templateId || "",
      requiredModulesValue: Array.isArray(initialRequest.requiredModules)
        ? initialRequest.requiredModules
        : Array.isArray(project.requiredModules)
          ? project.requiredModules
          : [],
      buildType: "generate",
      retries: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest?.id, project?.id]);

  const getApiKey = (providerValue) => {
    if (providerValue === "gemini") {
      return geminiKeyInput.trim() || localStorage.getItem(GEMINI_KEY) || "";
    }
    return openAiKeyInput.trim() || localStorage.getItem(OPENAI_KEY) || "";
  };

  const saveSpecVersion = (spec) => {
    setSpecHistory((prev) => {
      const base = historyCursor >= 0 ? prev.slice(0, historyCursor + 1) : [];
      const next = [...base, spec].slice(-40);
      setHistoryCursor(next.length - 1);
      return next;
    });
    setCurrentSpec(spec);
  };

  const startBuild = async ({
    messageValue = prompt,
    providerValue = provider,
    forceModeValue = forceMode,
    templateIdValue = selectedTemplateId,
    requiredModulesValue = selectedRequiredModules,
    buildType = "generate",
    retries = 0,
  }) => {
    const cleanMessage = String(messageValue || "").trim();
    if (!cleanMessage || !project) return;
    if (buildInFlightRef.current && retries === 0) return;

    const healthOk = await checkServerHealth();
    if (!healthOk) {
      setLastError("Server is offline.");
      appendLog("error", "Server is offline.");
      return;
    }

    const key = getApiKey(providerValue);
    if (!key) {
      setLastError("Add your API key in Jigrify Settings.");
      setActiveLeftTab("settings");
      return;
    }

    const localSelection = classifyPromptToTemplate({
      prompt: cleanMessage,
      forceMode: forceModeValue,
      preferredTemplateId: templateIdValue || currentSpec?.templateId || "",
    });
    setTemplateMeta({
      templateId: localSelection.templateId,
      requestedTemplateId: localSelection.requestedTemplateId,
      modulesEnabled: localSelection.modulesEnabled,
      limitationSummary: localSelection.limitationSummary,
      upgradePath: localSelection.upgradePath,
      fallbackApplied: localSelection.isFallback,
    });
    setSelectedTemplateId(localSelection.templateId);
    setSelectedRequiredModules(
      Array.isArray(requiredModulesValue) && requiredModulesValue.length > 0
        ? requiredModulesValue
        : localSelection.modulesEnabled,
    );

    closeStream();
    buildInFlightRef.current = true;
    setRunState("running");
    setLastError("");
    setLastStatus(retries > 0 ? "reconnecting" : "connecting");
    setRetryCount(retries);
    setLastBuildPayload({
      messageValue: cleanMessage,
      providerValue,
      forceModeValue,
      templateIdValue: localSelection.templateId,
      requiredModulesValue:
        Array.isArray(requiredModulesValue) && requiredModulesValue.length > 0
          ? requiredModulesValue
          : localSelection.modulesEnabled,
      buildType,
    });

    setChatMessages((prev) => [...prev, createMessage("user", cleanMessage, { buildType })]);
    appendLog("info", retries > 0 ? "Reconnecting build stream" : "Starting build", { buildType, retries });

    const mode = buildType === "refine" && currentSpec ? "patch" : "generate";
    setPhaseTimeline([]);

    const params = new URLSearchParams({
      provider: providerValue,
      apiKey: key,
      projectId: project.id,
      sessionId: project.id,
      userPrompt: cleanMessage,
      templateId: localSelection.templateId,
      requiredModules: JSON.stringify(
        Array.isArray(requiredModulesValue) && requiredModulesValue.length > 0
          ? requiredModulesValue
          : localSelection.modulesEnabled,
      ),
      currentSpec: mode === "patch" && currentSpec ? JSON.stringify(currentSpec) : "",
    });

    const source = new EventSource(`${AGENT_STREAM_URL}?${params.toString()}`);
    eventSourceRef.current = source;

    source.onopen = () => {
      setLastStatus("stream_open");
      appendLog("info", "Connected to build stream");
    };

    source.addEventListener("status", (event) => {
      const payload = parseEventData(event.data);
      if (payload?.step === "ping") return;
      setLastStatus(payload?.step || "status");
      appendLog("info", payload?.message || "Status update", payload);
    });

    source.addEventListener("phase_update", (event) => {
      const payload = parseEventData(event.data);
      const phase = payload?.phase || "unknown";
      const status = payload?.status || "running";
      setLastStatus(`${phase}:${status}`);

      setPhaseTimeline((prev) => {
        const next = [...prev, { phase, status, message: payload?.message || "", at: Date.now() }];
        return next.slice(-40);
      });

      if (payload?.plan) {
        setAgentPlan(payload.plan);
        setLimitations(Array.isArray(payload.plan.limitations) ? payload.plan.limitations : []);
      }

      if (Array.isArray(payload?.limitations)) {
        setLimitations(payload.limitations);
      }

      appendLog("info", `Phase ${phase} ${status}`, payload);
    });

    source.addEventListener("chat_message", (event) => {
      const payload = parseEventData(event.data);
      if (!payload?.message) return;
      setChatMessages((prev) => [...prev, createMessage(payload.role || "assistant", payload.message, payload.meta || null)]);

      if (payload?.meta?.type === "plan" && payload?.meta?.plan) {
        setAgentPlan(payload.meta.plan);
        setLimitations(Array.isArray(payload.meta.plan.limitations) ? payload.meta.plan.limitations : []);
      }

      if (payload?.meta?.limitations && Array.isArray(payload.meta.limitations)) {
        setLimitations(payload.meta.limitations);
      }
    });

    source.addEventListener("template_selected", (event) => {
      const payload = parseEventData(event.data);
      if (!payload?.templateId) return;

      setSelectedTemplateId(payload.templateId);
      setTemplateMeta({
        templateId: payload.templateId,
        requestedTemplateId: payload.requestedTemplateId,
        modulesEnabled: Array.isArray(payload.modulesEnabled) ? payload.modulesEnabled : [],
        limitationSummary: payload.limitationSummary || "",
        upgradePath: Array.isArray(payload.upgradePath) ? payload.upgradePath : [],
        fallbackApplied: Boolean(payload.fallbackApplied),
      });
      setSelectedRequiredModules(Array.isArray(payload.modulesEnabled) ? payload.modulesEnabled : []);
      appendLog("info", `Template selected: ${payload.templateId}`, payload);
    });

    source.addEventListener("spec", (event) => {
      const payload = parseEventData(event.data);
      saveSpecVersion(payload);
      setRunState("ready");
      setLastStatus("ready");
      appendLog("info", mode === "patch" ? "Patch applied" : "Game generated");
      closeStream();
    });

    source.addEventListener("spec_update", (event) => {
      const payload = parseEventData(event.data);
      if (!payload || typeof payload !== "object") return;
      setCurrentSpec(payload);
      appendLog("info", "Spec intermediate update", { templateId: payload?.templateId });
    });

    source.addEventListener("build_error", (event) => {
      const payload = parseEventData(event.data);
      const message = payload?.message || "Stream error";
      setLastError(message);
      setRunState("error");
      setLastStatus("error");
      appendLog("error", message, payload);
      closeStream();
    });

    source.onerror = () => {
      if (!eventSourceRef.current) return;
      closeStream();

      if (retries < 2) {
        setLastStatus("reconnecting");
        setLastError("Reconnecting…");
        reconnectTimerRef.current = setTimeout(() => {
          void startBuild({
            messageValue: cleanMessage,
            providerValue,
            forceModeValue,
            buildType,
            retries: retries + 1,
          });
        }, 1200);
        return;
      }

      setLastError("Connection dropped while streaming.");
      setRunState("error");
      setLastStatus("error");
      appendLog("error", "Connection dropped while streaming.");
    };
  };

  const handleRetry = () => {
    if (!lastBuildPayload) return;
    void startBuild({ ...lastBuildPayload, retries: 0 });
  };

  const handleSaveSettings = () => {
    if (provider === "gemini") {
      localStorage.setItem(GEMINI_KEY, geminiKeyInput.trim());
    } else {
      localStorage.setItem(OPENAI_KEY, openAiKeyInput.trim());
    }
    setSettingsMessage("Settings saved locally.");
  };

  const handleTestKey = () => {
    void (async () => {
      const key = getApiKey(provider);
      if (!key) {
        setSettingsMessage("Add an API key first.");
        return;
      }
      try {
        const response = await fetch(GENERATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: key,
            message: "test: make a ball on ground",
            mode: "generate",
            forceMode,
            sessionId: project?.id || "test",
          }),
        });
        const data = await response.json();
        setSettingsMessage(response.ok ? "Key test successful." : data?.error || "Key test failed.");
      } catch {
        setSettingsMessage("Key test failed.");
      }
    })();
  };

  const undoSpec = () => {
    if (historyCursor <= 0) return;
    const nextCursor = historyCursor - 1;
    setHistoryCursor(nextCursor);
    setCurrentSpec(specHistory[nextCursor] || null);
  };

  const redoSpec = () => {
    if (historyCursor >= specHistory.length - 1) return;
    const nextCursor = historyCursor + 1;
    setHistoryCursor(nextCursor);
    setCurrentSpec(specHistory[nextCursor] || null);
  };

  const sceneTitle = currentSpec?.title || "None";
  const isBoardMode = currentSpec?.mode === "board2d";
  const hudTimer = typeof countdown === "number" ? Math.max(0, Math.ceil(countdown)) : null;
  const resolvedTemplate = getTemplateById(currentSpec?.templateId || selectedTemplateId);
  const resolvedTemplateMode = resolvedTemplate?.mode || currentSpec?.mode || forceMode;
  const resolvedModules =
    Array.isArray(currentSpec?.modules) && currentSpec.modules.length > 0
      ? currentSpec.modules
      : Array.isArray(selectedRequiredModules)
        ? selectedRequiredModules
        : templateMeta?.modulesEnabled || [];
  const upgradeItems = Array.isArray(currentSpec?.upgradePath?.nextFeatures)
    ? currentSpec.upgradePath.nextFeatures
    : templateMeta?.upgradePath || [];
  const timelineLabels = phaseTimeline.map((entry) => {
    const raw = String(entry.phase || "");
    if (raw.startsWith("repair_")) {
      return `Repair #${raw.split("_")[1] || "?"}`;
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  });

  return (
    <div className="builder2-shell">
      <header className="builder2-topbar">
        <div className="left-actions">
          <button type="button" className="ghost-btn" onClick={onBack}>
            ← Back
          </button>
          <span className="status-chip online">Jigrify Builder</span>
          <span className="status-chip online">Template: {resolvedTemplate?.name || selectedTemplateId || "Auto"}</span>
          <span className="status-chip online">Mode: {resolvedTemplateMode || "auto"}</span>
          <span className="status-chip online">Modules: {resolvedModules.join(", ") || "none"}</span>
          <input
            className="project-input"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            aria-label="Project name"
          />
        </div>

        <div className="right-actions">
          <span className={`status-chip ${serverOnline ? "online" : "offline"}`}>
            Server {serverOnline ? "Online" : "Offline"}
          </span>
          <button
            type="button"
            className="primary-btn"
            onClick={() =>
              onCreateProject?.({
                name: "Untitled",
                provider,
                forceMode,
                templateId: selectedTemplateId,
                requiredModules:
                  Array.isArray(currentSpec?.modules) && currentSpec.modules.length > 0
                    ? currentSpec.modules
                    : selectedRequiredModules,
                autoRun: false,
              })
            }
          >
            New Project
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              if (runState === "running") {
                closeStream();
                setRunState("stopped");
                return;
              }
              void startBuild({ buildType: "generate" });
            }}
          >
            {runState === "running" ? "Stop" : "Run"}
          </button>
        </div>
      </header>

      <div className="builder2-body">
        <aside className="left-panel">
          <div className="panel-card">
            <h3>Brain Timeline</h3>
            {timelineLabels.length === 0 ? (
              <p className="settings-msg">Plan → Build → Verify → Repair → Ready</p>
            ) : (
              <ul className="steps-list">
                {timelineLabels.map((label, index) => (
                  <li
                    key={`${label}-${index}`}
                    className={index === timelineLabels.length - 1 ? "active" : "done"}
                  >
                    <span>{index + 1}</span>
                    <p>{label}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel-card">
            <h3>User</h3>
            <p>{user?.name || "Guest"}</p>
          </div>

          <div className="panel-card">
            <div className="left-tabs">
              <button type="button" className={activeLeftTab === "history" ? "active" : ""} onClick={() => setActiveLeftTab("history")}>
                History
              </button>
              <button type="button" className={activeLeftTab === "projects" ? "active" : ""} onClick={() => setActiveLeftTab("projects")}>
                Projects
              </button>
              <button type="button" className={activeLeftTab === "settings" ? "active" : ""} onClick={() => setActiveLeftTab("settings")}>
                Settings
              </button>
            </div>

            {activeLeftTab === "history" ? (
              <div className="history-box">
                <p>Spec versions: {specHistory.length}</p>
                <p>Cursor: {historyCursor + 1}</p>
              </div>
            ) : null}

            {activeLeftTab === "projects" ? (
              <div className="history-box">
                <ul>
                  {projects.slice(0, 10).map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.name || "Untitled"}</strong>
                      <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                      <button type="button" onClick={() => onSetActiveProject?.(entry.id)}>
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete project \"${entry.name || "Untitled"}\"?`)) {
                            onDeleteProject?.(entry.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {activeLeftTab === "settings" ? (
              <div className="settings-box">
                <label htmlFor="builder-provider">Provider</label>
                <select id="builder-provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                </select>

                <label htmlFor="builder-mode">Mode preference</label>
                <select id="builder-mode" value={forceMode} onChange={(event) => setForceMode(event.target.value)}>
                  <option value="auto">Auto</option>
                  <option value="physics3d">3D Physics</option>
                  <option value="board2d">Board Game</option>
                </select>

                <label htmlFor="builder-key">{provider === "gemini" ? "Gemini API key" : "OpenAI API key"}</label>
                <input
                  id="builder-key"
                  type="password"
                  value={provider === "gemini" ? geminiKeyInput : openAiKeyInput}
                  onChange={(event) =>
                    provider === "gemini" ? setGeminiKeyInput(event.target.value) : setOpenAiKeyInput(event.target.value)
                  }
                />

                <div className="settings-actions">
                  <button type="button" onClick={handleSaveSettings}>Save</button>
                  <button type="button" onClick={handleTestKey}>Test Key</button>
                </div>
                {settingsMessage ? <p className="settings-msg">{settingsMessage}</p> : null}
              </div>
            ) : null}
          </div>
        </aside>

        <section className="middle-panel">
          <div className="prompt-run-row">
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe your game and click Run"
            />
            <button type="button" className="primary-btn" onClick={() => void startBuild({ buildType: "generate" })}>
              Run New
            </button>
          </div>

          <div className="spec-history-actions">
            <button type="button" onClick={undoSpec} disabled={historyCursor <= 0}>Undo</button>
            <button type="button" onClick={redoSpec} disabled={historyCursor >= specHistory.length - 1}>Redo</button>
            <span>Version {historyCursor + 1}/{specHistory.length}</span>
          </div>

          <div className="errors-view">
            <h4>Status</h4>
            <p>{lastStatus || "idle"}</p>
            <h4>Last error</h4>
            <p>{lastError || "No errors"}</p>
            {runState === "error" ? (
              <button type="button" className="primary-btn" onClick={handleRetry}>
                Retry Build
              </button>
            ) : null}
          </div>

          <div className="errors-view">
            <h4>Template</h4>
            <p>{resolvedTemplate?.name || currentSpec?.templateId || selectedTemplateId || "Auto"}</p>
            <h4>Modules enabled</h4>
            <p>{resolvedModules.join(", ") || "No modules yet"}</p>
            {templateMeta?.limitationSummary ? (
              <>
                <h4>Capability note</h4>
                <p>{templateMeta.limitationSummary}</p>
              </>
            ) : null}
          </div>

          <div className="upgrade-panel">
            <h4>Upgrade Path</h4>
            {upgradeItems.length > 0 ? (
              <ul>
                {upgradeItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>No upgrade suggestions yet. Generate a build to see next steps.</p>
            )}
          </div>

          <div className="errors-view">
            <h4>Agent Plan</h4>
            <p>{agentPlan?.mvpDefinition || "Run a build to see the MVP plan."}</p>
            {Array.isArray(agentPlan?.buildSteps) && agentPlan.buildSteps.length > 0 ? (
              <ul>
                {agentPlan.buildSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            ) : null}
            <h4>Limitations</h4>
            {limitations.length > 0 ? (
              <ul>
                {limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>No known limitations for current MVP.</p>
            )}
          </div>

          <div className="log-console">
            <ul>
              {logs.map((log) => (
                <li key={log.id}>
                  <span className={`lvl ${log.level}`}>{log.level.toUpperCase()}</span>
                  <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                  <p>{log.message}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="right-panel">
          <div className="right-split">
            <div className="preview-wrap">
              {isBoardMode ? (
                <Board2DView spec={currentSpec?.board2d} />
              ) : (
                <GameViewport gameSpec={currentSpec} onGameStateChange={setGameState} onCountdownChange={setCountdown} />
              )}

              <div className="preview-hud">
                <p>Scene: {sceneTitle}</p>
                <p>Mode: {isBoardMode ? "Board" : "Physics"}</p>
                {hudTimer !== null ? <p>Time: {hudTimer}s</p> : null}
              </div>

              {gameState === "won" ? <div className="preview-result won">You win</div> : null}
              {gameState === "lost" ? <div className="preview-result lost">You lost</div> : null}
            </div>

            <aside className="chat-panel">
              <div className="chat-panel-header">
                <h3>Ask follow-up / refine</h3>
                <span>{currentSpec ? "Agent refine mode" : "Agent generate mode"}</span>
              </div>

              <div className="chat-messages" ref={messagesEndRef}>
                {chatMessages.map((entry) => (
                  <div key={entry.id} className={`chat-message ${entry.role}`}>
                    <div className="chat-role">{entry.role === "user" ? "You" : "Builder"}</div>
                    <p>{entry.message}</p>
                  </div>
                ))}
              </div>

              <div className="chat-input-row">
                <textarea
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask changes or follow-up goals (agent will re-plan with current spec)"
                />
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    const nextMessage = chatInput.trim();
                    if (!nextMessage) return;
                    setChatInput("");
                    setPrompt(nextMessage);
                    void startBuild({ messageValue: nextMessage, buildType: "refine" });
                  }}
                >
                  Send
                </button>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
