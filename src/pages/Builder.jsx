import { useEffect, useMemo, useRef, useState } from "react";
import { upsertProject } from "../lib/projects";
import { applyTemplateToSpec, classifyPromptToTemplate, getTemplateById } from "../lib/templates";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card, { CardBody } from "../components/ui/Card";
import IconButton from "../components/ui/IconButton";
import Input from "../components/ui/Input";
import Toast from "../components/ui/Toast";

import BuildPanel from "../components/builder/BuildPanel";
import TimelineDrawer from "../components/builder/TimelineDrawer";
import ClarifyCard from "../components/builder/ClarifyCard";
import WorkspaceDrawer from "../components/builder/WorkspaceDrawer";
import PreviewStage from "../components/builder/PreviewStage";

import "./builder.css";

const API_BASE = (import.meta.env.VITE_API_BASE || "").trim();
const AGENT_STREAM_URL = `${API_BASE}/api/agent/stream`;
const GENERATE_URL = `${API_BASE}/api/generate`;
const HEALTH_URL = `${API_BASE}/api/health`;

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

function createRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  projectId,
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
  const [draftPrompt, setDraftPrompt] = useState("");
  const [provider, setProvider] = useState("openai");
  const [forceMode, setForceMode] = useState("auto");
  const [chatMessages, setChatMessages] = useState([]);
  const [runs, setRuns] = useState([]);
  const [specHistory, setSpecHistory] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [currentSpec, setCurrentSpec] = useState(null);

  const [serverOnline, setServerOnline] = useState(false);
  const [runState, setRunState] = useState("stopped");
  const [lastStatus, setLastStatus] = useState("");
  const [lastError, setLastError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("");
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [openAiKeyInput, setOpenAiKeyInput] = useState(localStorage.getItem(OPENAI_KEY) || "");
  const [geminiKeyInput, setGeminiKeyInput] = useState(localStorage.getItem(GEMINI_KEY) || "");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [logs, setLogs] = useState([]);
  const [agentEvents, setAgentEvents] = useState([]);
  const [lastBuildError, setLastBuildError] = useState("");

  const [gameState, setGameState] = useState("idle");
  const [countdown, setCountdown] = useState(null);
  const [playSession, setPlaySession] = useState(0);
  const [playHighlight, setPlayHighlight] = useState(false);
  const [lastBuildPayload, setLastBuildPayload] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedRequiredModules, setSelectedRequiredModules] = useState([]);
  const [templateMeta, setTemplateMeta] = useState(null);
  const [agentPlan, setAgentPlan] = useState(null);
  const [phaseTimeline, setPhaseTimeline] = useState([]);
  const [limitations, setLimitations] = useState([]);
  const [pendingClarifyQuestion, setPendingClarifyQuestion] = useState(null);
  const [clarifyAnswers, setClarifyAnswers] = useState({});
  const [composerInput, setComposerInput] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [buildPulse, setBuildPulse] = useState(false);
  const [showAdvancedHistory, setShowAdvancedHistory] = useState(false);

  const abortControllerRef = useRef(null);
  const currentRunIdRef = useRef("");
  const seenEventKeysRef = useRef(new Set());
  const buildInFlightRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const persistReadyRef = useRef(false);
  const runOriginalPromptRef = useRef("");
  const previousRunStateRef = useRef("stopped");
  const pendingBuildHandledRef = useRef(new Set());
  const startedRunIdsRef = useRef(new Set());

  const project = useMemo(
    () => projects.find((entry) => entry.id === projectId) || null,
    [projects, projectId],
  );
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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    buildInFlightRef.current = false;
  };

  const markEventSeen = (key) => {
    if (!key) return false;
    const seen = seenEventKeysRef.current;
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > 300) {
      const trimmed = Array.from(seen).slice(-250);
      seenEventKeysRef.current = new Set(trimmed);
    }
    return false;
  };

  const parseSseChunk = (rawChunk) => {
    const lines = String(rawChunk || "").split(/\r?\n/);
    let event = "message";
    const dataLines = [];

    lines.forEach((line) => {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    });

    return {
      event,
      data: parseEventData(dataLines.join("\n")),
    };
  };

  const processStreamEvent = ({ event, payload, mode, runId, eventId }) => {
    if (runId && Number.isFinite(eventId)) {
      const dedupeKey = `${runId}|${eventId}`;
      if (markEventSeen(dedupeKey)) return;
    }

    const eventType = event || "message";
    setAgentEvents((prev) => [
      {
        id:
          runId && Number.isFinite(eventId)
            ? `${runId}|${eventId}`
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        runId: runId || currentRunIdRef.current || "",
        eventId: Number.isFinite(eventId) ? eventId : null,
        type: eventType,
        message:
          payload?.message
          || payload?.reason
          || payload?.text
          || payload?.step
          || payload?.status
          || "",
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 200));
    console.log("Stream event", {
      runId: runId || currentRunIdRef.current || "",
      event: eventType,
      eventId: Number.isFinite(eventId) ? eventId : undefined,
    });

    if (event === "clarify_question") {
      if (!payload?.questionId || !payload?.text) return;
      setPendingClarifyQuestion(payload);
      setRunState("awaiting_clarify");
      setLastStatus("clarify_waiting");
      setPhaseTimeline((prev) => [...prev, {
        phase: "clarify_question",
        status: "waiting",
        message: payload.text,
        at: Date.now(),
      }].slice(-40));
      setChatMessages((prev) => [
        ...prev,
        createMessage("assistant", payload.text, { type: "clarify_question", choices: payload.choices || [] }),
      ]);
      appendLog("info", "Clarification required", payload);
      return;
    }

    if (event === "plan") {
      setAgentPlan(payload || null);
      setLimitations(Array.isArray(payload?.willNotImplement) ? payload.willNotImplement : []);
      setPhaseTimeline((prev) => [...prev, {
        phase: "plan",
        status: "done",
        message: `Mode ${payload?.mode || "unknown"}`,
        at: Date.now(),
      }].slice(-40));
      setChatMessages((prev) => [
        ...prev,
        createMessage(
          "assistant",
          `Plan: mode=${payload?.mode || "unknown"}; mechanics=${Array.isArray(payload?.mechanics) ? payload.mechanics.join(", ") : "n/a"}`,
          { type: "plan", payload },
        ),
      ]);
      appendLog("info", "Plan emitted", payload);
      return;
    }

    if (event === "verify_pass") {
      setLastStatus("verify_pass");
      setPhaseTimeline((prev) => [...prev, {
        phase: "verify_pass",
        status: "done",
        message: payload?.message || "Verification passed",
        at: Date.now(),
      }].slice(-40));
      appendLog("info", payload?.message || "verify_pass", payload);
      return;
    }

    if (event === "verify_fail") {
      setLastStatus("verify_fail");
      setPhaseTimeline((prev) => [...prev, {
        phase: "verify_fail",
        status: "failed",
        message: Array.isArray(payload?.reasons) ? payload.reasons.join(" | ") : "Verification failed",
        at: Date.now(),
      }].slice(-40));
      appendLog("warn", "verify_fail", payload);
      return;
    }

    if (event === "repair_attempt") {
      setLastStatus(`repair_attempt_${payload?.attempt || "?"}`);
      setPhaseTimeline((prev) => [...prev, {
        phase: "repair_attempt",
        status: "running",
        message: `Attempt ${payload?.attempt || "?"}`,
        at: Date.now(),
      }].slice(-40));
      appendLog("info", `repair_attempt #${payload?.attempt || "?"}`, payload);
      return;
    }

    if (event === "cannot_build") {
      setRunState("ready");
      setLastStatus("ready");
      const message = payload?.reason || "Cannot build requested game honestly with current runtime.";
      setLastError(message);
      setLastBuildError(message);
      setToastMessage(message);
      setPendingClarifyQuestion(null);
      setChatMessages((prev) => [
        ...prev,
        createMessage("assistant", `${message}${payload?.suggestion ? ` ${payload.suggestion}` : ""}`, { type: "cannot_build", payload }),
      ]);
      appendLog("warn", "cannot_build", payload);
      closeStream();
      return;
    }

    if (event === "done") {
      const doneMessage = payload?.status === "ok" ? "" : (payload?.message || payload?.reason || "Build finished without a successful result.");
      if (doneMessage) {
        setLastError(doneMessage);
        setLastBuildError(doneMessage);
        setToastMessage(doneMessage);
      }
      setRunState("ready");
      setLastStatus("ready");
      setPendingClarifyQuestion(null);
      appendLog("info", "done", payload);
      closeStream();
      return;
    }

    if (event === "status") {
      if (payload?.step === "ping") return;
      setLastStatus(payload?.step || "status");
      appendLog("info", payload?.message || "Status update", payload);
      return;
    }

    if (event === "phase_update") {
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
      return;
    }

    if (event === "chat_message") {
      if (!payload?.message) return;
      setChatMessages((prev) => [...prev, createMessage(payload.role || "assistant", payload.message, payload.meta || null)]);

      if (payload?.meta?.type === "plan" && payload?.meta?.plan) {
        setAgentPlan(payload.meta.plan);
        setLimitations(Array.isArray(payload.meta.plan.limitations) ? payload.meta.plan.limitations : []);
      }

      if (payload?.meta?.limitations && Array.isArray(payload.meta.limitations)) {
        setLimitations(payload.meta.limitations);
      }
      return;
    }

    if (event === "template_selected") {
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
      const selectedName = getTemplateById(payload.templateId)?.name || payload.templateId;
      setToastMessage(`Template selected: ${selectedName}`);
      setBuildPulse(true);
      setTimeout(() => setBuildPulse(false), 900);
      appendLog("info", `Template selected: ${payload.templateId}`, payload);
      return;
    }

    if (event === "spec_update") {
      if (!payload || typeof payload !== "object") return;
      setCurrentSpec(payload);
      appendLog("info", "Spec intermediate update", { templateId: payload?.templateId });
      return;
    }

    if (event === "run_in_progress") {
      setLastStatus("run_in_progress");
      appendLog("info", payload?.message || "Run is already in progress", payload);
      closeStream();
      return;
    }

    if (event === "run_already_completed") {
      setLastStatus("run_already_completed");
      if (payload?.finalSpec) {
        saveSpecVersion(payload.finalSpec);
        setRunState("ready");
      }
      appendLog("info", payload?.message || "Run already completed", payload);
      closeStream();
      return;
    }

    if (event === "spec") {
      saveSpecVersion(payload);
      setRunState("ready");
      setLastStatus("ready");
      setPendingClarifyQuestion(null);
      appendLog("info", mode === "patch" ? "Patch applied" : "Game generated");
      closeStream();
      return;
    }

    if (event === "build_error" || event === "error") {
      const message = payload?.message || "Stream error";
      setLastError(message);
      setLastBuildError(message);
      setToastMessage(message);
      setRunState("ready");
      setLastStatus("ready");
      appendLog("error", message, payload);
      closeStream();
    }
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

    const loadedMessages = Array.isArray(project.chat)
      ? project.chat
      : Array.isArray(project.messages)
        ? project.messages
        : [];
    let loadedHistory = Array.isArray(project.specHistory) ? project.specHistory : [];

    const loadedCursor = Number.isInteger(project.specCursor) ? project.specCursor : loadedHistory.length - 1;

    setChatMessages(loadedMessages);
    setRuns(Array.isArray(project.runs) ? project.runs : []);
    setSpecHistory(loadedHistory);
    setHistoryCursor(loadedCursor);
    setCurrentSpec(loadedCursor >= 0 ? loadedHistory[loadedCursor] || null : null);
    setPrompt(project.lastPrompt || "");
    setDraftPrompt(project.draftPrompt || "");
    setLastStatus("");
    setLastError("");
    setLastBuildError("");
    setRetryCount(0);
    setRunState("stopped");
    setTemplateMeta(null);
    setAgentPlan(null);
    setPhaseTimeline([]);
    setLimitations([]);
    setPendingClarifyQuestion(null);
    setClarifyAnswers({});
    setAgentEvents([]);
    runOriginalPromptRef.current = "";

    if (loadedHistory.length === 0 && project.templateId) {
      const template = getTemplateById(project.templateId);
      if (template) {
        const seeded = applyTemplateToSpec(template.defaultSpec, {
          template,
          intent: template.mode,
          genre: template.genre || "generic",
          requestedTemplateId: template.id,
          templateId: template.id,
          modulesEnabled: Array.isArray(project.requiredModules) && project.requiredModules.length > 0
            ? project.requiredModules
            : template.requiredModules || [],
          isFallback: false,
          unsupportedFeatures: [],
          limitationSummary: "",
          upgradePath: [],
        });
        loadedHistory = [seeded];
      }
    }

    persistReadyRef.current = true;
  }, [project?.id]);

  useEffect(() => {
    if (!project || !project.pendingBuild) return;
    if (buildInFlightRef.current) return;

    const pending = project.pendingBuild;
    const pendingKey = `${project.id}:${pending.runId || pending.createdAt || pending.prompt}`;
    if (pendingBuildHandledRef.current.has(pendingKey)) {
      return;
    }

    pendingBuildHandledRef.current.add(pendingKey);
    setPrompt(pending.prompt || "");
    setProvider(pending.provider || project.provider || "openai");
    setForceMode(pending.mode || project.forceMode || "auto");
    setSelectedTemplateId(pending.templateId || project.templateId || "");
    setSelectedRequiredModules(
      Array.isArray(pending.modules)
        ? pending.modules
        : Array.isArray(project.requiredModules)
          ? project.requiredModules
          : [],
    );
    setIsTimelineOpen(true);

    void startBuild({
      messageValue: pending.prompt || "",
      providerValue: pending.provider || project.provider || "openai",
      forceModeValue: pending.mode || project.forceMode || "auto",
      templateIdValue: pending.templateId || project.templateId || "",
      requiredModulesValue: Array.isArray(pending.modules)
        ? pending.modules
        : Array.isArray(project.requiredModules)
          ? project.requiredModules
          : [],
      buildType: "generate",
      retries: 0,
      runIdValue: pending.runId || "",
      originalPromptValue: pending.prompt || "",
    });

    upsertProject({
      ...project,
      pendingBuild: null,
    });
    onProjectsChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.pendingBuild?.runId, project?.pendingBuild?.createdAt, project?.pendingBuild?.prompt]);

  useEffect(() => {
    if (!project || !persistReadyRef.current) return;
    upsertProject({
      ...project,
      title: projectName || "Untitled",
      provider,
      mode: forceMode,
      templateId: selectedTemplateId,
      modules: selectedRequiredModules,
      chat: chatMessages,
      runs,
      specHistory,
      specCursor: historyCursor,
      draftPrompt,
      lastPrompt: prompt,
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
    runs,
    specHistory,
    historyCursor,
    draftPrompt,
    prompt,
    project?.id,
  ]);

  useEffect(() => {
    return () => closeStream();
  }, []);

  useEffect(() => {
    if (runState === "running" || runState === "awaiting_clarify" || lastStatus === "reconnecting") {
      setIsTimelineOpen(true);
    }

    if (runState === "ready" && previousRunStateRef.current !== "ready") {
      setPlayHighlight(true);
      const timer = setTimeout(() => setPlayHighlight(false), 1800);
      previousRunStateRef.current = runState;
      return () => clearTimeout(timer);
    }

    previousRunStateRef.current = runState;
    return undefined;
  }, [runState, lastStatus]);

  useEffect(() => {
    if (runState === "ready") {
      const timer = setTimeout(() => setIsTimelineOpen(false), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [runState]);

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
    runIdValue = "",
    answersValue = {},
    originalPromptValue = "",
  }) => {
    const cleanMessage = String(messageValue || "").trim();
    if (!project) {
      if (projectId) return;
      const message = "Open or create a project before building.";
      setLastBuildError(message);
      setLastError(message);
      setToastMessage(message);
      return;
    }

    if (!cleanMessage) {
      const message = "Enter a prompt to build.";
      setLastBuildError(message);
      setLastError(message);
      setToastMessage(message);
      return;
    }

    if (buildInFlightRef.current && retries === 0) {
      const message = "A build is already running.";
      setLastBuildError(message);
      setLastError(message);
      setToastMessage(message);
      return;
    }

    const healthOk = await checkServerHealth();
    if (!healthOk) {
      const message = "Server unreachable.";
      setLastError(message);
      setLastBuildError(message);
      setToastMessage(message);
      appendLog("error", message);
      return;
    }

    const key = getApiKey(providerValue);
    if (!key) {
      const message = "Add API key in Settings to build.";
      setLastError(message);
      setLastBuildError(message);
      setToastMessage(message);
      setActiveWorkspaceTab("settings");
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
    const runId = runIdValue || currentRunIdRef.current || createRunId();
    if (runIdValue && retries === 0 && Object.keys(answersValue || {}).length === 0) {
      if (startedRunIdsRef.current.has(runIdValue)) {
        appendLog("info", "Skipped duplicate run trigger", { runId: runIdValue });
        return;
      }
      startedRunIdsRef.current.add(runIdValue);
    }
    currentRunIdRef.current = runId;
    if (!runOriginalPromptRef.current || (!runIdValue && retries === 0)) {
      runOriginalPromptRef.current = originalPromptValue || cleanMessage;
    }
    if (retries === 0 && !runIdValue) {
      seenEventKeysRef.current = new Set();
      setRuns((prev) => {
        if (prev.some((entry) => entry.id === runId)) return prev;
        return [
          ...prev,
          {
            id: runId,
            createdAt: new Date().toISOString(),
            buildType,
            prompt: cleanMessage,
            templateId: localSelection.templateId,
          },
        ].slice(-80);
      });
    }
    buildInFlightRef.current = true;
    setRunState("running");
    setLastError("");
    setLastBuildError("");
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

    if (retries === 0 && Object.keys(answersValue || {}).length === 0) {
      setChatMessages((prev) => [...prev, createMessage("user", cleanMessage, { buildType })]);
    }
    appendLog("info", retries > 0 ? "Reconnecting build stream" : "Starting build", { buildType, retries });

    const mode = buildType === "refine" && currentSpec ? "patch" : "generate";
    if (Object.keys(answersValue || {}).length === 0) {
      setPhaseTimeline([]);
    }

    try {
      let streamProducedSpec = false;
      let streamCannotBuild = false;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch(AGENT_STREAM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "X-Model-Provider": providerValue,
          "X-Retry-Attempt": String(retries),
        },
        body: JSON.stringify({
          projectId: project.id,
          runId,
          prompt: originalPromptValue || runOriginalPromptRef.current || cleanMessage,
          answers: answersValue,
          templateId: localSelection.templateId,
          mode,
          modules:
            Array.isArray(requiredModulesValue) && requiredModulesValue.length > 0
              ? requiredModulesValue
              : localSelection.modulesEnabled,
          specCursor: historyCursor,
          clientInfo: {
            source: "builder",
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Stream request failed (${response.status}).`);
      }

      setLastStatus("stream_open");
      appendLog("info", "Connected to build stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        chunks.forEach((chunk) => {
          if (!chunk.trim()) return;
          const parsed = parseSseChunk(chunk);
          const envelope = parsed.data && typeof parsed.data === "object" ? parsed.data : {};
          const eventType = envelope.type || parsed.event;
          if (eventType === "spec" || eventType === "run_already_completed") {
            streamProducedSpec = true;
          }
          if (eventType === "cannot_build") {
            streamCannotBuild = true;
          }
          processStreamEvent({
            event: eventType,
            payload: envelope.payload ?? parsed.data,
            mode,
            runId: envelope.runId,
            eventId: Number(envelope.eventId),
          });
        });
      }

      if (buffer.trim()) {
        const parsed = parseSseChunk(buffer);
        const envelope = parsed.data && typeof parsed.data === "object" ? parsed.data : {};
        const eventType = envelope.type || parsed.event;
        if (eventType === "spec" || eventType === "run_already_completed") {
          streamProducedSpec = true;
        }
        if (eventType === "cannot_build") {
          streamCannotBuild = true;
        }
        processStreamEvent({
          event: eventType,
          payload: envelope.payload ?? parsed.data,
          mode,
          runId: envelope.runId,
          eventId: Number(envelope.eventId),
        });
      }

      closeStream();
      if (!streamProducedSpec && !streamCannotBuild) {
        const message = "Build ended without a usable result.";
        setLastError(message);
        setLastBuildError(message);
        setToastMessage(message);
        setRunState("ready");
        setLastStatus("ready");
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }

      closeStream();

      if (/^Stream request failed \(\d+\)\.$/.test(String(error?.message || ""))) {
        const message = String(error.message || "Build failed.");
        setLastError(message);
        setLastBuildError(message);
        setToastMessage(message);
        setRunState("ready");
        setLastStatus("ready");
        appendLog("error", message);
        return;
      }

      if (retries < 3) {
        const backoffMs = Math.min(9000, 1200 * 2 ** retries);
        setLastStatus("reconnecting");
        setLastError(`Reconnecting… attempt ${retries + 1}`);
        reconnectTimerRef.current = setTimeout(() => {
          void startBuild({
            messageValue: cleanMessage,
            providerValue,
            forceModeValue,
            templateIdValue,
            requiredModulesValue,
            buildType,
            retries: retries + 1,
            runIdValue: runId,
          });
        }, backoffMs);
        return;
      }

      const message = /failed|NetworkError|fetch/i.test(String(error?.message || ""))
        ? "Server unreachable."
        : "Connection dropped while streaming.";
      setLastError(message);
      setLastBuildError(message);
      setToastMessage(message);
      setRunState("ready");
      setLastStatus("ready");
      appendLog("error", message);
    }
  };

  const handleRetry = () => {
    if (!lastBuildPayload) return;
    void startBuild({ ...lastBuildPayload, retries: 1, runIdValue: currentRunIdRef.current });
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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "X-Model-Provider": provider,
          },
          body: JSON.stringify({
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

  const sceneTitle = currentSpec?.title || "Untitled game";
  const isBoardMode = currentSpec?.mode === "board2d";
  const hudTimer = typeof countdown === "number" ? Math.max(0, Math.ceil(countdown)) : null;
  const resolvedTemplate = getTemplateById(currentSpec?.templateId || selectedTemplateId);
  const resolvedModules =
    Array.isArray(currentSpec?.modules) && currentSpec.modules.length > 0
      ? currentSpec.modules
      : Array.isArray(selectedRequiredModules)
        ? selectedRequiredModules
        : templateMeta?.modulesEnabled || [];
  const sceneObjects = Array.isArray(currentSpec?.scene?.objects) ? currentSpec.scene.objects : [];
  const isBuilding = runState === "running" || lastStatus === "reconnecting";
  const canPlay = Boolean(currentSpec) && runState === "ready";
  const showEmptyPreview = !isBoardMode && sceneObjects.length === 0;
  const hasFriendlyError = runState === "error" && Boolean(lastError);
  const pendingChoices = Array.isArray(pendingClarifyQuestion?.choices) ? pendingClarifyQuestion.choices : [];
  const statusLabel =
    runState === "running"
      ? "Building"
      : runState === "awaiting_clarify"
        ? "Needs input"
        : runState === "error"
          ? "Error"
          : "Ready";
  const statusVariant = runState === "error" ? "danger" : isBuilding ? "brand" : "success";

  const hasPhase = (value) => phaseTimeline.some((entry) => String(entry.phase || "").includes(value));
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

  const completedTimelineCards = timelineCards.filter((card) => card.state === "done").length;
  const progressPercent = Math.round((completedTimelineCards / timelineCards.length) * 100);

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

  const handleComposerSubmit = () => {
    const nextMessage = composerInput.trim();
    if (!nextMessage) {
      const message = "Type a message before sending.";
      setLastBuildError(message);
      setLastError(message);
      setToastMessage(message);
      return;
    }

    if (pendingClarifyQuestion?.questionId) {
      const qid = pendingClarifyQuestion.questionId;
      const nextAnswers = {
        ...clarifyAnswers,
        [qid]: nextMessage,
      };
      setClarifyAnswers(nextAnswers);
      setChatMessages((prev) => [...prev, createMessage("user", nextMessage, { type: "clarify_answer", questionId: qid })]);
      setComposerInput("");
      setPendingClarifyQuestion(null);
      setIsTimelineOpen(true);
      void startBuild({
        messageValue: runOriginalPromptRef.current || prompt,
        buildType: "generate",
        runIdValue: currentRunIdRef.current,
        answersValue: nextAnswers,
        originalPromptValue: runOriginalPromptRef.current || prompt,
      });
      return;
    }

    setComposerInput("");
    setPrompt(nextMessage);
    setIsTimelineOpen(true);
    void startBuild({ messageValue: nextMessage, buildType: currentSpec ? "refine" : "generate" });
  };

  return (
    <div className="builder2-shell">
      <div className="builder2-layout">
        <aside className="builder2-sidebar" aria-label="Workspace navigation">
          <IconButton onClick={onBack} title="Back to landing" aria-label="Back to landing">
            ←
          </IconButton>
          <IconButton
            active={activeWorkspaceTab === "projects"}
            onClick={() => setActiveWorkspaceTab((prev) => (prev === "projects" ? "" : "projects"))}
            title="Projects"
            aria-label="Projects"
          >
            📁
          </IconButton>
          <IconButton
            active={activeWorkspaceTab === "history"}
            onClick={() => setActiveWorkspaceTab((prev) => (prev === "history" ? "" : "history"))}
            title="History"
            aria-label="History"
          >
            🕘
          </IconButton>
          <IconButton
            active={activeWorkspaceTab === "settings"}
            onClick={() => setActiveWorkspaceTab((prev) => (prev === "settings" ? "" : "settings"))}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </IconButton>
        </aside>

        <main className="builder2-main">
          <Card className="builder-main-topbar">
            <CardBody className="builder-main-topbar-inner">
              <div className="title-wrap">
                <label htmlFor="builder-project-title">Game Title</label>
                <Input
                  id="builder-project-title"
                  className="project-input"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  aria-label="Game title"
                />
              </div>

              <div className="builder-main-actions">
                <BuildPanel
                  runState={runState}
                  prompt={prompt}
                  setPrompt={setPrompt}
                  draftPrompt={draftPrompt}
                  composerInput={composerInput}
                  onBuild={(seed) => {
                    setPrompt(seed);
                    if (seed === composerInput.trim()) {
                      setComposerInput("");
                    }
                    setIsTimelineOpen(true);
                    void startBuild({ messageValue: seed, buildType: currentSpec ? "refine" : "generate" });
                  }}
                  onStop={() => {
                    closeStream();
                    setRunState("stopped");
                  }}
                  lastBuildError={lastBuildError}
                />

                <div title={!canPlay ? "Build first to unlock Play" : "Play your latest scene"}>
                  <Button
                    variant="secondary"
                    className={playHighlight ? "success-pulse" : ""}
                    disabled={!canPlay}
                    onClick={() => {
                      if (!canPlay) return;
                      setGameState("idle");
                      setPlaySession((prev) => prev + 1);
                    }}
                  >
                    Play
                  </Button>
                </div>

                <div className="builder-indicators">
                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                  <Badge variant={serverOnline ? "success" : "danger"}>
                    {serverOnline ? "Server online" : "Server offline"}
                  </Badge>
                </div>
              </div>
            </CardBody>
          </Card>

          <WorkspaceDrawer
            activeTab={activeWorkspaceTab}
            projects={projects}
            specHistory={specHistory}
            historyCursor={historyCursor}
            provider={provider}
            forceMode={forceMode}
            openAiKeyInput={openAiKeyInput}
            geminiKeyInput={geminiKeyInput}
            settingsMessage={settingsMessage}
            showAdvancedHistory={showAdvancedHistory}
            onCreateProject={() =>
              onCreateProject?.({
                name: "Untitled",
                provider,
                forceMode,
                templateId: selectedTemplateId,
                requiredModules: resolvedModules,
                autoRun: false,
              })
            }
            onSetActiveProject={onSetActiveProject}
            onDeleteProject={onDeleteProject}
            onUndo={undoSpec}
            onRedo={redoSpec}
            onToggleAdvancedHistory={() => setShowAdvancedHistory((v) => !v)}
            setProvider={setProvider}
            setForceMode={setForceMode}
            setOpenAiKeyInput={setOpenAiKeyInput}
            setGeminiKeyInput={setGeminiKeyInput}
            onSaveSettings={handleSaveSettings}
            onTestKey={handleTestKey}
            resolvedTemplate={resolvedTemplate}
            resolvedModules={resolvedModules}
          />

          <PreviewStage
            currentSpec={currentSpec}
            runState={runState}
            lastError={lastError}
            lastBuildError={lastBuildError}
            playSession={playSession}
            gameState={gameState}
            hudTimer={hudTimer}
            sceneTitle={sceneTitle}
            isBoardMode={isBoardMode}
            showEmptyPreview={showEmptyPreview}
            hasFriendlyError={hasFriendlyError}
            isBuilding={isBuilding}
            setGameState={setGameState}
            setCountdown={setCountdown}
            setPlaySession={setPlaySession}
            onBuildTrigger={() => {
              const seedPrompt = composerInput.trim() || prompt.trim() || draftPrompt.trim();
              if (!seedPrompt) {
                const message = "Enter a prompt to build.";
                setLastBuildError(message);
                setLastError(message);
                setToastMessage(message);
                return;
              }
              setPrompt(seedPrompt);
              setIsTimelineOpen(true);
              void startBuild({ messageValue: seedPrompt, buildType: currentSpec ? "refine" : "generate" });
            }}
          />

          <Card className="builder-composer">
            <CardBody>
              <ClarifyCard
                pendingClarifyQuestion={pendingClarifyQuestion}
                clarifyAnswers={clarifyAnswers}
                setClarifyAnswers={setClarifyAnswers}
                setComposerInput={setComposerInput}
              />

              <div className="composer-row">
                <Input
                  value={composerInput}
                  onChange={(event) => setComposerInput(event.target.value)}
                  placeholder="Describe changes to your game…"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleComposerSubmit();
                    }
                  }}
                />
                <Button type="button" onClick={handleComposerSubmit}>Send</Button>
              </div>
              <p className="composer-hint">Tip: ask for mechanics, rules, or visual changes in one line.</p>
            </CardBody>
          </Card>
        </main>

        <button
          type="button"
          className={`timeline-peek ${isTimelineOpen ? "open" : ""}`}
          onClick={() => setIsTimelineOpen((prev) => !prev)}
          aria-label={isTimelineOpen ? "Collapse timeline" : "Expand timeline"}
        >
          {isTimelineOpen ? "→" : "←"}
        </button>

        <TimelineDrawer
          isOpen={isTimelineOpen}
          onToggle={() => setIsTimelineOpen((prev) => !prev)}
          phaseTimeline={phaseTimeline}
          agentEvents={agentEvents}
          runState={runState}
          agentPlan={agentPlan}
          pendingClarifyQuestion={pendingClarifyQuestion}
        />
      </div>
      <Toast open={Boolean(toastMessage)} message={toastMessage} onDone={() => setToastMessage("")} />
    </div>
  );
}
