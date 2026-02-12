import express from "express";
import cors from "cors";
import {
  applyTemplateToSpec,
  classifyPromptToTemplate,
  getTemplateById,
  MODULE_AVAILABILITY,
  getPublicTemplates,
} from "../src/lib/templates.js";

const app = express();
const PORT = 8787;

const SUPPORTED_PROVIDERS = ["openai", "gemini"];
const SUPPORTED_FORCE_MODES = ["auto", "board2d", "physics3d"];
const SUPPORTED_GENERATE_MODES = ["generate", "patch"];
const SESSION_CACHE = new Map();
const MAX_SESSION_MESSAGES = 200;
const MAX_SPEC_VERSIONS = 40;
const MAX_AGENT_REPAIR_ATTEMPTS = 2;
const MAX_AGENT_CLARIFY_QUESTIONS = 3;
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const runtimeCapabilities = {
  physics3d: {
    objects: ["ground", "box", "sphere", "ramp"],
    player: true,
    win: ["reachArea"],
    lose: ["fallBelow"],
    score: ["time"],
    timer: true,
    cameraFollow: true,
    collisions: false,
    audio: false,
    multiplayer: false,
    combat: false,
    npcs: false,
  },
  board2d: {
    dice: true,
    turnBased: true,
    tokenMove: true,
    captureMaybe: false,
    audio: false,
    multiplayer: false,
    combat: false,
    npcs: false,
  },
};

const PATCH_SYSTEM_INSTRUCTION =
  "You are updating an existing game specification. Modify only what user requests. Preserve all other systems, rules, and structure. Return full corrected GameSpec JSON.";

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      callback(null, isLocalhost);
    },
  }),
);

app.use(express.json({ limit: "1mb" }));

function safeError(res, { provider = "openai", status = 500, error = "Unexpected server error", code, details }) {
  return res.status(status).json({ error, status, provider, code, details });
}

function scrubSensitiveText(value) {
  return String(value || "")
    .replace(/(key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]");
}

function getUserKey(req) {
  const rawAuth = typeof req?.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  const match = rawAuth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function getModelProvider(req, bodyOrQuery = {}) {
  const providerHeader =
    typeof req?.headers?.["x-model-provider"] === "string"
      ? req.headers["x-model-provider"].trim().toLowerCase()
      : "";
  const providerBody =
    typeof bodyOrQuery?.provider === "string" ? bodyOrQuery.provider.trim().toLowerCase() : "";
  return providerHeader || providerBody || "openai";
}

function createStructuredError(message, details = {}, code = "GENERATION_FAILED") {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function resolveMode(text, forceMode) {
  return classifyPromptToTemplate({ prompt: text, forceMode }).intent;
}

function resolveSessionId(rawSessionId) {
  const value = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
  return value || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCurrentSpec(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSessionState(sessionId) {
  if (!SESSION_CACHE.has(sessionId)) {
    SESSION_CACHE.set(sessionId, {
      messages: [],
      specVersions: [],
      runs: new Map(),
      activeStreams: 0,
      lastAccessAt: Date.now(),
    });
  }

  return SESSION_CACHE.get(sessionId);
}

function touchSession(sessionState) {
  if (!sessionState) return;
  sessionState.lastAccessAt = Date.now();
}

function sweepExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, sessionState] of SESSION_CACHE.entries()) {
    if (sessionState?.activeStreams > 0) continue;
    const lastAccessAt = Number(sessionState?.lastAccessAt) || 0;
    if (now - lastAccessAt > SESSION_TTL_MS) {
      SESSION_CACHE.delete(sessionId);
    }
  }
}

function pushSessionMessage(sessionState, entry) {
  touchSession(sessionState);
  sessionState.messages = [...sessionState.messages, entry].slice(-MAX_SESSION_MESSAGES);
}

function pushSessionSpecVersion(sessionState, gameSpec) {
  touchSession(sessionState);
  sessionState.specVersions = [...sessionState.specVersions, gameSpec].slice(-MAX_SPEC_VERSIONS);
}

function validateGameSpec(spec, forcedMode, selectedTemplate = null, allowedModules = null) {
  if (!spec || typeof spec !== "object") {
    return "Generated output is not a JSON object.";
  }

  if (!spec.templateId || typeof spec.templateId !== "string") {
    return "GameSpec must include templateId.";
  }

  if (!Array.isArray(spec.modules)) {
    return "GameSpec must include modules array.";
  }

  if (selectedTemplate && spec.templateId !== selectedTemplate.id) {
    return `Expected templateId \"${selectedTemplate.id}\" but received \"${spec.templateId}\".`;
  }

  const effectiveAllowedModules = Array.isArray(allowedModules) && allowedModules.length > 0
    ? allowedModules
    : selectedTemplate?.requiredModules || [];

  if (effectiveAllowedModules.length > 0) {
    const disallowedModule = spec.modules.find((moduleId) => !effectiveAllowedModules.includes(moduleId));
    if (disallowedModule) {
      return `Module \"${disallowedModule}\" is not allowed for template \"${selectedTemplate?.id || "unknown"}\".`;
    }
  }

  if (!spec.mode || spec.mode !== forcedMode) {
    return `Expected mode \"${forcedMode}\" but received \"${spec.mode || "unknown"}\".`;
  }

  if (forcedMode === "board2d") {
    const board = spec.board2d;
    if (!board || !board.game || !Array.isArray(board.players) || board.players.length === 0) {
      return "board2d specs must include board2d.game and at least one player.";
    }

    const dice = board.rules?.dice;
    if (!Number.isFinite(Number(dice?.min)) || !Number.isFinite(Number(dice?.max))) {
      return "board2d specs must include rules.dice.min and rules.dice.max.";
    }

    return null;
  }

  if (!spec.scene || !Array.isArray(spec.scene.objects)) {
    return "physics3d specs must include scene.objects array.";
  }

  return null;
}

function isValidGameSpec(spec, forcedMode) {
  return !validateGameSpec(spec, forcedMode);
}

const GAME_SPEC_PROMPT = `You are a GameSpec compiler.
Return ONLY valid JSON. No markdown. No commentary.

Target schema (GameSpec v1):
{
  "mode": "physics3d|board2d",
  "templateId": "string",
  "modules": ["string"],
  "title": "string",
  "description": "string",
  "scene": {
    "objects": [
      {"type":"ground","size":[x,y,z],"position":[x,y,z],"color":"#hex"},
      {"type":"box","size":[x,y,z],"position":[x,y,z],"mass":number,"color":"#hex"},
      {"type":"sphere","radius":number,"position":[x,y,z],"mass":number,"color":"#hex"},
      {"type":"ramp","size":[x,y,z],"position":[x,y,z],"rotation":[x,y,z],"color":"#hex"}
    ]
  },
  "player": {
    "kind": "box|sphere",
    "spawn": [x,y,z],
    "move": {"type":"keyboard","speed": number},
    "jump": {"enabled": true, "strength": number}
  },
  "camera": {
    "mode": "follow|orbit",
    "position": [x,y,z],
    "target": [x,y,z],
    "followOffset": [x,y,z]
  },
  "rules": {
    "objective": "string",
    "win": [{"type":"reachArea","position":[x,y,z],"radius":number}],
    "lose": [{"type":"fallBelow","y": number}],
    "score": [{"type":"time","mode":"countdown","seconds": number}]
  },
  "ui": {
    "hud": [{"type":"text","value":"string"}]
  },
  "board2d": {
    "game": "string",
    "size": 15,
    "players": [],
    "rules": {"dice": {"min": 1, "max": 6}}
  }
}

Rules:
- Use simple physics-friendly values.
- Choose the correct mode based on the requested game type.
- Ensure player spawn is above ground.
- Prefer ramps/obstacles for variety.
- Always include at least one ground object for physics3d.
- For board2d include board2d with players and dice rules.
- You MUST output a GameSpec that uses only supported modules for the chosen template.
- You MUST include templateId and modules exactly as provided in the request context.`;

const AGENT_PLAN_PROMPT = `You are the planning brain for Jigrify.
Return ONLY valid JSON with this exact shape:
{
  "templateId": "string",
  "mode": "physics3d|board2d",
  "modulesNeeded": ["string"],
  "mvpDefinition": "string",
  "buildSteps": ["string"],
  "limitations": ["string"],
  "questions": ["string"]
}

Rules:
- Select a templateId that exists in the provided context.
- If request is beyond current capabilities, define a truthful MVP and list limitations.
- modulesNeeded should describe mechanics/components needed for MVP.
- No markdown. JSON only.`;

function parseJsonObject(rawText) {
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object.");
  }
  return parsed;
}

function validateAgentPlan(plan, availableTemplateIds = []) {
  if (!plan || typeof plan !== "object") {
    return "Plan must be a JSON object.";
  }

  if (!plan.templateId || typeof plan.templateId !== "string") {
    return "Plan.templateId must be a string.";
  }

  if (availableTemplateIds.length > 0 && !availableTemplateIds.includes(plan.templateId)) {
    return `Plan.templateId \"${plan.templateId}\" is not in available templates.`;
  }

  if (!SUPPORTED_FORCE_MODES.includes(plan.mode) || plan.mode === "auto") {
    return "Plan.mode must be physics3d or board2d.";
  }

  const listFields = ["modulesNeeded", "buildSteps", "limitations", "questions"];
  for (const field of listFields) {
    if (!Array.isArray(plan[field])) {
      return `Plan.${field} must be an array.`;
    }
  }

  if (!plan.mvpDefinition || typeof plan.mvpDefinition !== "string") {
    return "Plan.mvpDefinition must be a string.";
  }

  return null;
}

async function generateAgentPlan({ provider, apiKey, userPrompt, preferredTemplateId = "", currentSpec = null }) {
  const templates = getPublicTemplates();
  const availableTemplateIds = templates.map((template) => template.id);
  const initialSelection = classifyPromptToTemplate({
    prompt: userPrompt,
    preferredTemplateId,
  });

  const planContext = {
    userPrompt,
    preferredTemplateId,
    currentSpec,
    templates: templates.map((template) => ({
      id: template.id,
      mode: template.mode,
      requiredModules: template.requiredModules,
      promptHints: template.promptHints,
    })),
    initialSelection: {
      templateId: initialSelection.templateId,
      mode: initialSelection.intent,
      modulesEnabled: initialSelection.modulesEnabled,
      limitations: initialSelection.limitationSummary,
      fallback: initialSelection.isFallback,
    },
    moduleAvailability: MODULE_AVAILABILITY,
  };

  const firstAttemptText = await providerGenerateText({
    provider,
    apiKey,
    systemInstruction: AGENT_PLAN_PROMPT,
    userPrompt: JSON.stringify(planContext),
    temperature: 0.2,
  });

  try {
    const firstPlan = parseJsonObject(firstAttemptText);
    const planError = validateAgentPlan(firstPlan, availableTemplateIds);
    if (!planError) {
      return firstPlan;
    }

    const repairedPlanText = await providerGenerateText({
      provider,
      apiKey,
      systemInstruction: AGENT_PLAN_PROMPT,
      userPrompt: [
        JSON.stringify(planContext),
        `Previous plan failed validation: ${planError}`,
        "Return one corrected JSON plan only.",
      ].join("\n\n"),
      temperature: 0,
    });

    const repairedPlan = parseJsonObject(repairedPlanText);
    const repairedError = validateAgentPlan(repairedPlan, availableTemplateIds);
    if (repairedError) {
      throw new Error(repairedError);
    }
    return repairedPlan;
  } catch {
    return {
      templateId: initialSelection.templateId,
      mode: initialSelection.intent,
      modulesNeeded: initialSelection.modulesEnabled,
      mvpDefinition:
        "Build a playable MVP with core movement, objective, and UI feedback using currently supported modules.",
      buildSteps: [
        "Select closest supported template",
        "Generate playable core loop",
        "Validate mechanics and module limits",
      ],
      limitations: initialSelection.limitationSummary ? [initialSelection.limitationSummary] : [],
      questions: [],
    };
  }
}

function hasMechanic(spec, mechanicKey) {
  const key = String(mechanicKey || "").toLowerCase();
  if (!key) return true;

  if (key.includes("camera.follow")) return spec?.camera?.mode === "follow";
  if (key.includes("spawner")) {
    return Array.isArray(spec?.scene?.objects) && spec.scene.objects.length >= 2;
  }
  if (key.includes("input.swing")) {
    const objective = String(spec?.rules?.objective || "").toLowerCase();
    return objective.includes("swing") || objective.includes("bat") || objective.includes("hit");
  }
  if (key.includes("score.zones")) {
    return Array.isArray(spec?.rules?.win) && spec.rules.win.length > 0;
  }
  if (key.includes("board.turn") || key.includes("turn")) {
    return Array.isArray(spec?.board2d?.players) && spec.board2d.players.length >= 2;
  }
  if (key.includes("rules.win")) {
    return Array.isArray(spec?.rules?.win) && spec.rules.win.length > 0;
  }
  if (key.includes("physics.player") || key.includes("player")) {
    return Boolean(spec?.player);
  }

  return true;
}

function verifyAgentSpec({ spec, plan, selection, forcedMode }) {
  const validationError = validateGameSpec(spec, forcedMode, selection.template, selection.modulesEnabled);
  if (validationError) {
    return { ok: false, missing: [validationError], type: "schema" };
  }

  const unavailableModules = (spec.modules || []).filter((moduleId) => MODULE_AVAILABILITY[moduleId] !== true);
  if (unavailableModules.length > 0) {
    return {
      ok: false,
      missing: unavailableModules.map((moduleId) => `Module unavailable at runtime: ${moduleId}`),
      type: "module_availability",
    };
  }

  const missingMechanics = (plan?.modulesNeeded || []).filter((mechanicKey) => !hasMechanic(spec, mechanicKey));
  if (missingMechanics.length > 0) {
    return {
      ok: false,
      missing: missingMechanics.map((item) => `Missing planned mechanic: ${item}`),
      type: "mechanics",
    };
  }

  return { ok: true, missing: [], type: "ok" };
}

function enrichAgentSpec(spec, { selection, plan, limitations = [] }) {
  const next = {
    ...(spec || {}),
    meta: {
      ...(spec?.meta || {}),
      templateId: selection.templateId,
      modulesEnabled: selection.modulesEnabled,
      mvpDefinition: plan?.mvpDefinition || "",
    },
  };

  if (limitations.length > 0) {
    next.capability = {
      ...(next.capability || {}),
      limitationSummary: limitations.join(" "),
      nextFeatures: selection.upgradePath || [],
    };
  }

  return next;
}

function getAgentRequestPayload(req, bodyOrQuery = {}) {
  const base = getRequestPayload(req, bodyOrQuery);
  const projectIdRaw = typeof bodyOrQuery?.projectId === "string" ? bodyOrQuery.projectId.trim() : "";
  const userPromptRaw =
    typeof bodyOrQuery?.prompt === "string"
      ? bodyOrQuery.prompt
      : typeof bodyOrQuery?.userPrompt === "string"
        ? bodyOrQuery.userPrompt
        : "";
  const runIdRaw = typeof bodyOrQuery?.runId === "string" ? bodyOrQuery.runId.trim() : "";
  const requestModeRaw = typeof bodyOrQuery?.mode === "string" ? bodyOrQuery.mode.trim().toLowerCase() : "generate";
  const modulesRaw = bodyOrQuery?.modules ?? bodyOrQuery?.requiredModules;
  const answersRaw = bodyOrQuery?.answers;
  const answers =
    answersRaw && typeof answersRaw === "object" && !Array.isArray(answersRaw)
      ? Object.fromEntries(
          Object.entries(answersRaw)
            .map(([key, value]) => [String(key), String(value ?? "").trim()])
            .filter(([key, value]) => key && value),
        )
      : {};

  return {
    provider: base.provider,
    runId: runIdRaw,
    projectId: projectIdRaw || base.sessionId,
    sessionId: projectIdRaw || base.sessionId,
    userPrompt: String(userPromptRaw || base.message || "").trim(),
    currentSpec: base.currentSpec,
    templateId: base.templateId,
    requiredModules: parseRequiredModules(modulesRaw),
    mode: SUPPORTED_GENERATE_MODES.includes(requestModeRaw) ? requestModeRaw : "generate",
    answers,
    specCursor: Number.isFinite(Number(bodyOrQuery?.specCursor)) ? Number(bodyOrQuery.specCursor) : -1,
    messagesDelta: Array.isArray(bodyOrQuery?.messagesDelta) ? bodyOrQuery.messagesDelta : [],
    clientInfo: bodyOrQuery?.clientInfo && typeof bodyOrQuery.clientInfo === "object" ? bodyOrQuery.clientInfo : null,
  };
}

function buildMvpFallbackSpec({ selection, plan }) {
  const fallback = applyTemplateToSpec(selection.template.defaultSpec, selection);
  return enrichAgentSpec(fallback, {
    selection,
    plan,
    limitations: [
      "Returned MVP fallback after repair attempts could not fully satisfy requested mechanics.",
      ...(Array.isArray(plan?.limitations) ? plan.limitations : []),
    ],
  });
}

function normalizePromptText(value) {
  return String(value || "").toLowerCase();
}

function uniqueStrings(values = []) {
  return Array.from(new Set((values || []).filter(Boolean).map((item) => String(item))));
}

function detectUnsupportedRequests(prompt) {
  const text = normalizePromptText(prompt);
  const unsupported = [];

  if (text.includes("multiplayer") || text.includes("online") || text.includes("co-op") || text.includes("coop")) {
    unsupported.push("multiplayer");
  }
  if (text.includes("gun") || text.includes("combat") || text.includes("weapon") || text.includes("shoot")) {
    unsupported.push("combat");
  }
  if (text.includes("npc") || text.includes("enemy ai") || text.includes("ai enemy")) {
    unsupported.push("npcs");
  }
  if (text.includes("audio") || text.includes("music") || text.includes("sound")) {
    unsupported.push("audio");
  }
  if (text.includes("collision callback") || text.includes("on collision") || text.includes("collision event")) {
    unsupported.push("collisions");
  }

  return uniqueStrings(unsupported);
}

function buildClarifyQuestion({ prompt, answers, selection, unsupported }) {
  const questions = [];
  const hasAnswers = answers && typeof answers === "object" ? answers : {};
  const modeIntent = selection?.intent || resolveMode(prompt, "auto");
  const text = normalizePromptText(prompt);

  if (
    unsupported.length > 0
    && !hasAnswers.scope_choice
  ) {
    questions.push({
      questionId: "scope_choice",
      text: `Your request includes unsupported features (${unsupported.join(", ")}). Choose a supported MVP direction to continue honestly.`,
      choices: [
        "single-player physics3d runner",
        "single-player board2d dice/turn game",
        "cancel",
      ],
      required: true,
    });
  }

  const ambiguousPrompt = text.split(/\s+/).filter(Boolean).length <= 2;
  if (ambiguousPrompt && !hasAnswers.mode_choice) {
    questions.push({
      questionId: "mode_choice",
      text: "Should I build this as a 3D physics game or a 2D board game?",
      choices: ["physics3d", "board2d"],
      required: true,
    });
  }

  if (modeIntent === "board2d" && !hasAnswers.board_style && !text.includes("ludo") && !text.includes("snake")) {
    questions.push({
      questionId: "board_style",
      text: "For board2d MVP, do you want Ludo-style turn+dice movement?",
      choices: ["yes, ludo-style", "no, keep it generic turn+dice"],
      required: true,
    });
  }

  return questions.slice(0, MAX_AGENT_CLARIFY_QUESTIONS);
}

function inferModeFromAnswers(selection, answers = {}) {
  const modeChoice = String(answers.mode_choice || "").toLowerCase();
  if (modeChoice.includes("board")) return "board2d";
  if (modeChoice.includes("physics") || modeChoice.includes("3d")) return "physics3d";

  const scopeChoice = String(answers.scope_choice || "").toLowerCase();
  if (scopeChoice.includes("board")) return "board2d";
  if (scopeChoice.includes("physics") || scopeChoice.includes("runner")) return "physics3d";

  return selection?.intent || "physics3d";
}

function sanitizeUnsupportedTopLevelFields(spec) {
  const next = JSON.parse(JSON.stringify(spec || {}));
  const unsupportedTopKeys = [
    "audio",
    "multiplayer",
    "network",
    "combat",
    "npcs",
    "enemies",
    "weapons",
    "collisionCallbacks",
    "callbacks",
  ];

  for (const key of unsupportedTopKeys) {
    if (key in next) {
      delete next[key];
    }
  }

  return next;
}

function capabilityCheck(spec, capabilities) {
  const reasons = [];
  const suggestedFixes = [];
  if (!spec || typeof spec !== "object") {
    return {
      ok: false,
      reasons: ["Spec must be an object."],
      suggestedFixes: ["Generate a valid GameSpec object."],
    };
  }

  const mode = spec.mode;
  if (!mode || !capabilities?.[mode]) {
    return {
      ok: false,
      reasons: ["spec.mode must be either board2d or physics3d."],
      suggestedFixes: ["Set mode to board2d or physics3d and keep only that runtime's mechanics."],
    };
  }

  const serialized = JSON.stringify(spec).toLowerCase();
  if (serialized.includes("multiplayer") || serialized.includes("network")) {
    reasons.push("Multiplayer/network fields are unsupported.");
    suggestedFixes.push("Remove multiplayer/network fields and keep single-player mechanics.");
  }
  if (serialized.includes("audio") || serialized.includes("sound") || serialized.includes("music")) {
    reasons.push("Audio fields are unsupported.");
    suggestedFixes.push("Remove audio/sound/music fields.");
  }
  if (serialized.includes("combat") || serialized.includes("weapon") || serialized.includes("gun")) {
    reasons.push("Combat/weapon systems are unsupported.");
    suggestedFixes.push("Replace combat with movement + objective mechanics.");
  }
  if (serialized.includes("npc") || serialized.includes("enemy")) {
    reasons.push("NPC/enemy systems are unsupported.");
    suggestedFixes.push("Remove NPC/enemy systems and use static obstacles.");
  }

  if (mode === "physics3d") {
    const caps = capabilities.physics3d;
    const objects = Array.isArray(spec?.scene?.objects) ? spec.scene.objects : [];
    const invalidObjects = objects
      .map((obj) => obj?.type)
      .filter((type) => type && !caps.objects.includes(type));
    if (invalidObjects.length > 0) {
      reasons.push(`Unsupported physics3d object types: ${uniqueStrings(invalidObjects).join(", ")}.`);
      suggestedFixes.push(`Use only scene object types: ${caps.objects.join(", ")}.`);
    }

    const winRules = Array.isArray(spec?.rules?.win) ? spec.rules.win : [];
    const loseRules = Array.isArray(spec?.rules?.lose) ? spec.rules.lose : [];
    const scoreRules = Array.isArray(spec?.rules?.score) ? spec.rules.score : [];

    const invalidWin = winRules.map((rule) => rule?.type).filter((type) => type && !caps.win.includes(type));
    const invalidLose = loseRules.map((rule) => rule?.type).filter((type) => type && !caps.lose.includes(type));
    const invalidScore = scoreRules.map((rule) => rule?.type).filter((type) => type && !caps.score.includes(type));

    if (invalidWin.length > 0) {
      reasons.push(`Unsupported physics3d win rules: ${uniqueStrings(invalidWin).join(", ")}.`);
      suggestedFixes.push(`Use win rules: ${caps.win.join(", ")}.`);
    }
    if (invalidLose.length > 0) {
      reasons.push(`Unsupported physics3d lose rules: ${uniqueStrings(invalidLose).join(", ")}.`);
      suggestedFixes.push(`Use lose rules: ${caps.lose.join(", ")}.`);
    }
    if (invalidScore.length > 0) {
      reasons.push(`Unsupported physics3d score rules: ${uniqueStrings(invalidScore).join(", ")}.`);
      suggestedFixes.push(`Use score rules: ${caps.score.join(", ")}.`);
    }
  }

  if (mode === "board2d") {
    const hasDice = Boolean(spec?.board2d?.rules?.dice);
    const hasPlayers = Array.isArray(spec?.board2d?.players) && spec.board2d.players.length > 0;
    if (!hasDice) {
      reasons.push("board2d requires dice rules.");
      suggestedFixes.push("Add board2d.rules.dice with min/max values.");
    }
    if (!hasPlayers) {
      reasons.push("board2d requires at least one player token.");
      suggestedFixes.push("Add board2d.players entries for token movement.");
    }

    if (spec?.scene || spec?.player || spec?.camera) {
      reasons.push("board2d does not support physics3d scene/player/camera fields.");
      suggestedFixes.push("Remove scene/player/camera from board2d specs.");
    }

    if (Array.isArray(spec?.rules?.win) || Array.isArray(spec?.rules?.lose) || Array.isArray(spec?.rules?.score)) {
      reasons.push("board2d runtime only supports dice + per-turn token movement rules.");
      suggestedFixes.push("Remove physics-style win/lose/score rule arrays from board2d specs.");
    }
  }

  return reasons.length > 0
    ? { ok: false, reasons: uniqueStrings(reasons), suggestedFixes: uniqueStrings(suggestedFixes) }
    : { ok: true };
}

function repairSpecAgainstCapabilities(spec, capabilities) {
  const next = sanitizeUnsupportedTopLevelFields(spec);
  if (next.mode === "physics3d") {
    const caps = capabilities.physics3d;
    if (!next.scene || !Array.isArray(next.scene.objects)) {
      next.scene = { objects: [] };
    }
    next.scene.objects = next.scene.objects.filter((obj) => caps.objects.includes(obj?.type));
    if (!next.scene.objects.some((obj) => obj?.type === "ground")) {
      next.scene.objects.unshift({
        type: "ground",
        size: [40, 1, 40],
        position: [0, -0.5, 0],
        color: "#334155",
      });
    }

    if (!next.rules || typeof next.rules !== "object") {
      next.rules = {};
    }
    next.rules.win = (Array.isArray(next.rules.win) ? next.rules.win : []).filter((rule) => caps.win.includes(rule?.type));
    next.rules.lose = (Array.isArray(next.rules.lose) ? next.rules.lose : []).filter((rule) => caps.lose.includes(rule?.type));
    next.rules.score = (Array.isArray(next.rules.score) ? next.rules.score : []).filter((rule) => caps.score.includes(rule?.type));

    if (!Array.isArray(next.rules.win) || next.rules.win.length === 0) {
      next.rules.win = [{ type: "reachArea", position: [0, 1, -20], radius: 3 }];
    }
    if (!Array.isArray(next.rules.lose) || next.rules.lose.length === 0) {
      next.rules.lose = [{ type: "fallBelow", y: -6 }];
    }
  }

  if (next.mode === "board2d") {
    delete next.scene;
    delete next.player;
    delete next.camera;

    if (!next.board2d || typeof next.board2d !== "object") {
      next.board2d = { game: "ludo", size: 15, players: [] };
    }
    if (!Array.isArray(next.board2d.players) || next.board2d.players.length === 0) {
      next.board2d.players = [
        { id: "p1", name: "Player 1", color: "#ef4444" },
        { id: "p2", name: "Player 2", color: "#3b82f6" },
      ];
    }
    if (!next.board2d.rules || typeof next.board2d.rules !== "object") {
      next.board2d.rules = {};
    }
    if (!next.board2d.rules.dice || typeof next.board2d.rules.dice !== "object") {
      next.board2d.rules.dice = { min: 1, max: 6 };
    }

    if (!next.rules || typeof next.rules !== "object") {
      next.rules = {};
    }
    delete next.rules.win;
    delete next.rules.lose;
    delete next.rules.score;
  }

  return next;
}

function getSupportedMechanicsForMode(mode) {
  if (mode === "board2d") {
    return ["dice", "turn-based flow", "per-turn token movement"];
  }
  return [
    "scene objects: ground/box/sphere/ramp",
    "player move + jump",
    "camera follow",
    "timer/score by time",
    "win by reachArea",
    "lose by fallBelow",
  ];
}

function getUnsupportedMechanicsSummary(unsupported = []) {
  const base = [
    "no collision callbacks",
    "no audio/music",
    "no multiplayer/networking",
    "no combat/weapon systems",
    "no NPC/enemy AI systems",
  ];
  const mapped = (unsupported || []).map((item) => `requested but unsupported: ${item}`);
  return uniqueStrings([...mapped, ...base]);
}

function buildAlternativeSpecSuggestion({ prompt, mode, preferredTemplateId = "" }) {
  const selection = classifyPromptToTemplate({
    prompt,
    forceMode: mode,
    preferredTemplateId,
  });
  const fallback = applyTemplateToSpec(selection.template.defaultSpec, selection);
  return repairSpecAgainstCapabilities(fallback, runtimeCapabilities);
}

function buildUserPrompt({ mode, message, forcedMode, currentSpec, sessionMessages, selection }) {
  const conversation = (sessionMessages || [])
    .slice(-12)
    .map((item) => `${item.role}: ${item.message}`)
    .join("\n");

  const selectedTemplate = selection?.template;
  const requestContext = selectedTemplate
    ? {
        intent: selection.intent,
        genre: selection.genre,
        requestedTemplateId: selection.requestedTemplateId,
        selectedTemplateId: selectedTemplate.id,
        modulesEnabled: selection.modulesEnabled,
        fallbackApplied: selection.isFallback,
        limitationSummary: selection.limitationSummary,
        upgradePath: selection.upgradePath,
      }
    : null;

  return [
    `Request mode: ${mode}`,
    `You MUST output mode=\"${forcedMode}\"`,
    requestContext ? `TemplateContext: ${JSON.stringify(requestContext)}` : "",
    selectedTemplate ? `TemplateDefaultSpec: ${JSON.stringify(selectedTemplate.defaultSpec)}` : "",
    `User request: ${message}`,
    currentSpec ? `CurrentSpec: ${JSON.stringify(currentSpec)}` : "",
    conversation ? `Conversation history:\n${conversation}` : "",
    "Return strict GameSpec v1 JSON only.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const text = (data?.output || [])
    .flatMap((item) => item?.content || [])
    .map((content) => (typeof content?.text === "string" ? content.text : ""))
    .find((value) => value.trim());

  return (text || "").trim();
}

function extractGeminiText(data) {
  const text = (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .find((value) => value.trim());

  return (text || "").trim();
}

async function callOpenAI({ apiKey, systemInstruction, userPrompt, temperature = 0.2 }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemInstruction }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}).`);
  }

  const data = await response.json();
  return extractOpenAIText(data);
}

async function callGemini({ apiKey, systemInstruction, userPrompt, temperature = 0.2 }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: { temperature },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}).`);
  }

  const data = await response.json();
  return extractGeminiText(data);
}

async function providerGenerateText({ provider, apiKey, systemInstruction, userPrompt, temperature = 0.2 }) {
  if (provider === "gemini") {
    return callGemini({ apiKey, systemInstruction, userPrompt, temperature });
  }

  return callOpenAI({ apiKey, systemInstruction, userPrompt, temperature });
}

function parseAndValidateSpec(rawText, forcedMode, selectedTemplate = null, allowedModules = null) {
  try {
    const parsed = JSON.parse(rawText);
    const validationError = validateGameSpec(parsed, forcedMode, selectedTemplate, allowedModules);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    return { ok: true, spec: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    return { ok: false, error: `JSON parse failed: ${message}` };
  }
}

async function generateGameSpec({
  provider,
  apiKey,
  message,
  mode,
  currentSpec,
  forceMode,
  sessionMessages,
  preferredTemplateId,
  requiredModules,
}) {
  let selection = classifyPromptToTemplate({
    prompt: message,
    forceMode,
    preferredTemplateId: mode === "patch" && currentSpec?.templateId ? currentSpec.templateId : preferredTemplateId,
  });

  const explicitTemplate = getTemplateById(preferredTemplateId || "");
  if (explicitTemplate) {
    selection = classifyPromptToTemplate({
      prompt: message,
      forceMode: explicitTemplate.mode,
      preferredTemplateId: explicitTemplate.id,
    });
  }

  const allowedModules = Array.isArray(requiredModules) && requiredModules.length > 0
    ? requiredModules.filter((moduleId) => selection.template.requiredModules.includes(moduleId))
    : selection.modulesEnabled;

  const effectiveSelection = {
    ...selection,
    modulesEnabled: allowedModules,
  };

  const forcedMode =
    mode === "patch" && currentSpec?.mode
      ? currentSpec.mode
      : explicitTemplate?.mode || selection.intent;

  const systemInstruction =
    mode === "patch" ? `${GAME_SPEC_PROMPT}\n\n${PATCH_SYSTEM_INSTRUCTION}` : GAME_SPEC_PROMPT;

  const userPrompt = buildUserPrompt({
    mode,
    message,
    forcedMode,
    currentSpec,
    sessionMessages,
    selection: effectiveSelection,
  });

  const firstText = await providerGenerateText({
    provider,
    apiKey,
    systemInstruction,
    userPrompt,
    temperature: 0.2,
  });

  const firstAttempt = parseAndValidateSpec(firstText, forcedMode, effectiveSelection.template, allowedModules);
  if (firstAttempt.ok) {
    return {
      gameSpec: applyTemplateToSpec(firstAttempt.spec, effectiveSelection),
      forcedMode,
      selection: effectiveSelection,
    };
  }

  const correctionPrompt = [
    userPrompt,
    "Your previous response failed schema validation.",
    `ValidationError: ${firstAttempt.error}`,
    "Return one full corrected GameSpec JSON. No markdown. No explanation.",
    "Previous invalid output:",
    firstText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const repairedText = await providerGenerateText({
    provider,
    apiKey,
    systemInstruction,
    userPrompt: correctionPrompt,
    temperature: 0,
  });

  const secondAttempt = parseAndValidateSpec(repairedText, forcedMode, effectiveSelection.template, allowedModules);
  if (secondAttempt.ok) {
    return {
      gameSpec: applyTemplateToSpec(secondAttempt.spec, effectiveSelection),
      forcedMode,
      selection: effectiveSelection,
    };
  }

  throw createStructuredError(
    "Model returned invalid GameSpec after one correction retry.",
    {
      mode,
      forcedMode,
      firstError: firstAttempt.error,
      secondError: secondAttempt.error,
      templateId: effectiveSelection.templateId,
    },
    "INVALID_GAMESPEC",
  );
}

function parseRequiredModules(raw) {
  if (Array.isArray(raw)) return raw.map((value) => String(value)).filter(Boolean);
  if (typeof raw !== "string") return [];

  const value = raw.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean);
    }
  } catch {
    // fallback to comma-separated
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRequestPayload(req, bodyOrQuery = {}) {
  const provider = getModelProvider(req, bodyOrQuery);
  const apiKey = getUserKey(req);

  const messageRaw =
    typeof bodyOrQuery?.message === "string"
      ? bodyOrQuery.message
      : typeof bodyOrQuery?.prompt === "string"
        ? bodyOrQuery.prompt
        : "";

  const requestedModeRaw =
    typeof bodyOrQuery?.mode === "string" ? bodyOrQuery.mode.trim().toLowerCase() : "generate";

  const requestedForceModeRaw =
    typeof bodyOrQuery?.forceMode === "string" ? bodyOrQuery.forceMode.trim().toLowerCase() : "auto";

  return {
    provider,
    apiKey,
    message: messageRaw.trim(),
    mode: SUPPORTED_GENERATE_MODES.includes(requestedModeRaw) ? requestedModeRaw : "generate",
    forceMode: SUPPORTED_FORCE_MODES.includes(requestedForceModeRaw) ? requestedForceModeRaw : "auto",
    templateId: typeof bodyOrQuery?.templateId === "string" ? bodyOrQuery.templateId.trim() : "",
    requiredModules: parseRequiredModules(bodyOrQuery?.requiredModules),
    currentSpec: parseCurrentSpec(bodyOrQuery?.currentSpec ?? bodyOrQuery?.previousSpec ?? null),
    sessionId: resolveSessionId(bodyOrQuery?.sessionId),
  };
}

function validateRequestInput({ provider, message, apiKey, mode, currentSpec }, res) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    safeError(res, { provider, status: 400, error: "Provider must be openai or gemini." });
    return false;
  }

  if (!message) {
    safeError(res, { provider, status: 400, error: "Message is required." });
    return false;
  }

  if (mode === "patch" && !currentSpec) {
    safeError(res, { provider, status: 400, error: "currentSpec is required for patch mode." });
    return false;
  }

  if (!apiKey || apiKey.length < 20) {
    safeError(res, { provider, status: 400, error: "BYOK required: send Authorization: Bearer <key>." });
    return false;
  }

  if (provider === "openai" && !apiKey.startsWith("sk-")) {
    safeError(res, { provider, status: 400, error: "Add your OpenAI API key in Jigrify Settings" });
    return false;
  }

  return true;
}

app.post("/api/generate", async (req, res) => {
  sweepExpiredSessions();
  const payload = getRequestPayload(req, req.body);
  const { provider, message, apiKey, mode, forceMode, templateId, requiredModules, currentSpec, sessionId } = payload;

  if (!validateRequestInput(payload, res)) return;

  const sessionState = getSessionState(sessionId);

  try {
    pushSessionMessage(sessionState, {
      role: "user",
      message,
      createdAt: new Date().toISOString(),
    });

    const { gameSpec, selection } = await generateGameSpec({
      provider,
      apiKey,
      message,
      mode,
      currentSpec,
      forceMode,
      preferredTemplateId: templateId,
      requiredModules,
      sessionMessages: sessionState.messages,
    });

    pushSessionSpecVersion(sessionState, gameSpec);
    pushSessionMessage(sessionState, {
      role: "assistant",
      message: mode === "patch" ? "Patch applied successfully." : "Game generated successfully.",
      createdAt: new Date().toISOString(),
    });

    return res.json({
      mode,
      sessionId,
      template: {
        templateId: selection.templateId,
        requestedTemplateId: selection.requestedTemplateId,
        intent: selection.intent,
        genre: selection.genre,
        modulesEnabled: selection.modulesEnabled,
        fallbackApplied: selection.isFallback,
        limitationSummary: selection.limitationSummary,
        upgradePath: selection.upgradePath,
        reasons: selection.reason,
      },
      gameSpec,
      session: {
        messages: sessionState.messages,
        specVersions: sessionState.specVersions,
      },
    });
  } catch (error) {
    if (error?.code === "INVALID_GAMESPEC") {
      return safeError(res, {
        provider,
        status: 422,
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }

    return safeError(res, {
      provider,
      status: 500,
      error: "Generation failed. Check your key/network and retry.",
    });
  }
});

app.post("/api/generate/stream", async (req, res) => {
  sweepExpiredSessions();
  const payload = getRequestPayload(req, req.body);
  const { provider, message, apiKey, mode, forceMode, templateId, requiredModules, currentSpec, sessionId } = payload;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  let pingInterval = null;
  req.on("close", () => {
    closed = true;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  });

  const sendEvent = (eventName, eventPayload) => {
    if (closed) return;
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
  };

  const endWithError = (status, errPayload) => {
    sendEvent("error", { status, ...errPayload });
    sendEvent("build_error", { status, ...errPayload });
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (!closed) res.end();
  };

  pingInterval = setInterval(() => {
    sendEvent("status", { step: "ping", message: "ping" });
  }, 10000);

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    endWithError(400, { message: "Provider must be openai or gemini." });
    return;
  }

  if (!message) {
    endWithError(400, { message: "Message is required." });
    return;
  }

  if (mode === "patch" && !currentSpec) {
    endWithError(400, { message: "currentSpec is required for patch mode." });
    return;
  }

  if (!apiKey || apiKey.length < 20) {
    endWithError(400, { message: "BYOK required: send Authorization: Bearer <key>." });
    return;
  }

  if (provider === "openai" && !apiKey.startsWith("sk-")) {
    endWithError(400, { message: "Add your OpenAI API key in Jigrify Settings" });
    return;
  }

  const sessionState = getSessionState(sessionId);

  try {
    pushSessionMessage(sessionState, {
      role: "user",
      message,
      createdAt: new Date().toISOString(),
    });

    sendEvent("chat_message", {
      role: "assistant",
      message:
        mode === "patch"
          ? "Applying your requested refinements to the existing game spec."
          : "Generating your new game spec.",
      mode,
    });

    sendEvent("status", { step: "plan", message: "Analyzing prompt and build intent." });

    const selectionPreview = classifyPromptToTemplate({
      prompt: message,
      forceMode: getTemplateById(templateId || "")?.mode || forceMode,
      preferredTemplateId: templateId,
    });
    const resolvedMode =
      mode === "patch" && currentSpec?.mode
        ? currentSpec.mode
        : getTemplateById(templateId || "")?.mode || selectionPreview.intent;

    sendEvent("status", {
      step: "mode_detected",
      message: `Using mode ${resolvedMode}.`,
      mode: resolvedMode,
    });

    sendEvent("template_selected", {
      templateId: selectionPreview.templateId,
      requestedTemplateId: selectionPreview.requestedTemplateId,
      intent: selectionPreview.intent,
      genre: selectionPreview.genre,
      modulesEnabled: selectionPreview.modulesEnabled,
      fallbackApplied: selectionPreview.isFallback,
      limitationSummary: selectionPreview.limitationSummary,
      upgradePath: selectionPreview.upgradePath,
      reasons: selectionPreview.reason,
    });

    if (selectionPreview.limitationSummary) {
      sendEvent("chat_message", {
        role: "assistant",
        message: `Capability note: ${selectionPreview.limitationSummary}`,
        meta: { type: "capability" },
      });
    }

    sendEvent("status", {
      step: "generating",
      message: mode === "patch" ? "Applying patch to current game spec." : "Generating candidate game spec.",
    });

    const { gameSpec, selection } = await generateGameSpec({
      provider,
      apiKey,
      message,
      mode,
      currentSpec,
      forceMode: resolvedMode,
      preferredTemplateId: templateId,
      requiredModules,
      sessionMessages: sessionState.messages,
    });

    sendEvent("status", { step: "validating", message: "Validating generated schema." });

    const validationError = validateGameSpec(
      gameSpec,
      resolvedMode,
      selection.template,
      Array.isArray(requiredModules) && requiredModules.length > 0 ? requiredModules : selection.modulesEnabled,
    );
    if (validationError) {
      throw createStructuredError(
        "Generated spec did not pass validation.",
        { mode, forcedMode: resolvedMode, validationError },
        "INVALID_GAMESPEC",
      );
    }

    pushSessionSpecVersion(sessionState, gameSpec);
    sendEvent("spec_version_saved", {
      message: "Spec version saved.",
      sessionId,
      versionIndex: sessionState.specVersions.length - 1,
      totalVersions: sessionState.specVersions.length,
    });

    if (mode === "patch") {
      sendEvent("patch_applied", {
        message: "Patch applied to current spec.",
      });
    }

    sendEvent("status", { step: "ready", message: "Spec ready for rendering." });
    sendEvent("template_selected", {
      templateId: selection.templateId,
      requestedTemplateId: selection.requestedTemplateId,
      intent: selection.intent,
      genre: selection.genre,
      modulesEnabled: selection.modulesEnabled,
      fallbackApplied: selection.isFallback,
      limitationSummary: selection.limitationSummary,
      upgradePath: selection.upgradePath,
      reasons: selection.reason,
    });
    sendEvent("spec", gameSpec);

    const assistantMessage = mode === "patch" ? "Patch applied successfully." : "Game generated successfully.";

    sendEvent("chat_message", {
      role: "assistant",
      message: assistantMessage,
      mode,
    });

    pushSessionMessage(sessionState, {
      role: "assistant",
      message: assistantMessage,
      createdAt: new Date().toISOString(),
    });

    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (!closed) res.end();
  } catch (error) {
    if (error?.code === "INVALID_GAMESPEC") {
      endWithError(422, {
        message: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    endWithError(500, {
      message: scrubSensitiveText(
        error instanceof Error ? error.message : "Generation failed. Check your key/network and retry.",
      ),
    });
  }
});

app.post("/api/agent/stream", async (req, res) => {
  sweepExpiredSessions();
  const payload = getAgentRequestPayload(req, req.body);
  const {
    provider,
    runId,
    userPrompt,
    currentSpec,
    templateId,
    requiredModules,
    sessionId,
    projectId,
    mode,
    specCursor,
    answers,
  } = payload;
  const apiKey = getUserKey(req);
  const effectiveSessionId = sessionId || projectId || resolveSessionId("");
  const effectiveRunId = runId || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sessionState = getSessionState(effectiveSessionId);
  touchSession(sessionState);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  let streamCounted = false;
  const finalizeStream = () => {
    if (streamCounted) {
      sessionState.activeStreams = Math.max(0, Number(sessionState.activeStreams || 0) - 1);
      streamCounted = false;
    }
    touchSession(sessionState);
  };

  req.on("close", () => {
    closed = true;
    finalizeStream();
  });

  const existingRunState = sessionState.runs.get(effectiveRunId);
  const sendEnvelope = (eventName, type, eventPayload) => {
    if (closed) return;
    const record = sessionState.runs.get(effectiveRunId);
    const eventId = Math.max(1, Number(record?.nextEventId || 1));
    if (record) {
      record.nextEventId = eventId + 1;
      sessionState.runs.set(effectiveRunId, record);
    }
    const envelope = {
      runId: effectiveRunId,
      eventId,
      type,
      payload: eventPayload,
    };
    touchSession(sessionState);
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
  };

  const endWithError = (status, errPayload) => {
    const safePayload = {
      status,
      ...errPayload,
      message: scrubSensitiveText(errPayload?.message || "Request failed."),
    };
    sendEnvelope("error", "error", safePayload);
    sendEnvelope("build_error", "build_error", safePayload);
    if (!closed) res.end();
    finalizeStream();
  };

  if (existingRunState?.status === "completed") {
    sendEnvelope("run_already_completed", "run_already_completed", {
      message: "run_already_completed",
      finalSpec: existingRunState.finalSpec || null,
    });
    if (!closed) res.end();
    return;
  }

  if (existingRunState?.status === "in_progress" && existingRunState?.agentState !== "clarify_waiting") {
    sendEnvelope("run_in_progress", "run_in_progress", {
      message: "run_in_progress",
    });
    if (!closed) res.end();
    return;
  }

  const runState = existingRunState || {
    status: "in_progress",
    agentState: "clarify",
    nextEventId: 1,
    finalSpec: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    originalPrompt: userPrompt,
    answers: {},
    clarifyQuestionsAsked: 0,
    verifyFailures: [],
  };

  runState.status = "in_progress";
  runState.originalPrompt = runState.originalPrompt || userPrompt;
  runState.answers = {
    ...(runState.answers || {}),
    ...(answers || {}),
  };
  sessionState.runs.set(effectiveRunId, runState);

  sessionState.activeStreams = Number(sessionState.activeStreams || 0) + 1;
  streamCounted = true;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    endWithError(400, { message: "Provider must be openai or gemini." });
    return;
  }

  const originalPrompt = runState.originalPrompt || userPrompt;
  if (!originalPrompt) {
    endWithError(400, { message: "prompt is required." });
    return;
  }

  if (!apiKey || apiKey.length < 20) {
    endWithError(400, { message: "BYOK required: send Authorization: Bearer <key>." });
    return;
  }

  if (provider === "openai" && !apiKey.startsWith("sk-")) {
    endWithError(400, { message: "Add your OpenAI API key in Jigrify Settings" });
    return;
  }

  const cursorSpec =
    Number.isInteger(specCursor) && specCursor >= 0
      ? sessionState.specVersions[specCursor] || null
      : null;
  const fallbackSpec = sessionState.specVersions[sessionState.specVersions.length - 1] || null;
  const effectiveCurrentSpec = currentSpec || (mode === "patch" ? cursorSpec || fallbackSpec : null);

  try {
    pushSessionMessage(sessionState, {
      role: "user",
      message: Object.keys(answers || {}).length > 0
        ? `Clarification provided: ${JSON.stringify(answers)}`
        : originalPrompt,
      createdAt: new Date().toISOString(),
    });

    const selectionPreview = classifyPromptToTemplate({
      prompt: originalPrompt,
      forceMode: getTemplateById(templateId || "")?.mode || "auto",
      preferredTemplateId: templateId,
    });

    const unsupported = detectUnsupportedRequests(originalPrompt);
    const clarifyQuestions = buildClarifyQuestion({
      prompt: originalPrompt,
      answers: runState.answers,
      selection: selectionPreview,
      unsupported,
    });

    if (clarifyQuestions.length > 0 && runState.clarifyQuestionsAsked < MAX_AGENT_CLARIFY_QUESTIONS) {
      const question = clarifyQuestions[0];
      runState.status = "in_progress";
      runState.agentState = "clarify_waiting";
      runState.pendingQuestion = question;
      runState.clarifyQuestionsAsked = Number(runState.clarifyQuestionsAsked || 0) + 1;
      sessionState.runs.set(effectiveRunId, runState);

      sendEnvelope("clarify_question", "clarify_question", question);
      if (!closed) res.end();
      finalizeStream();
      return;
    }

    const scopeChoice = String(runState.answers?.scope_choice || "").toLowerCase();
    if (scopeChoice.includes("cancel")) {
      const alternativeSpec = buildAlternativeSpecSuggestion({
        prompt: originalPrompt,
        mode: inferModeFromAnswers(selectionPreview, runState.answers),
        preferredTemplateId: templateId,
      });

      sendEnvelope("cannot_build", "cannot_build", {
        reason: "User selected cancel for unsupported feature scope.",
        unsupported,
        suggestion:
          "Try a supported MVP such as a single-player physics3d runner or board2d dice-turn game.",
        alternativeSpec,
      });
      sendEnvelope("done", "done", { status: "cannot_build" });

      sessionState.runs.set(effectiveRunId, {
        ...runState,
        status: "completed",
        agentState: "done",
        finalSpec: null,
        completedAt: new Date().toISOString(),
      });

      if (!closed) res.end();
      finalizeStream();
      return;
    }

    runState.agentState = "plan";
    runState.pendingQuestion = null;
    sessionState.runs.set(effectiveRunId, runState);

    const resolvedMode = inferModeFromAnswers(selectionPreview, runState.answers);
    const selectedTemplate = getTemplateById(templateId || "");
    let selection = classifyPromptToTemplate({
      prompt: originalPrompt,
      forceMode: selectedTemplate?.mode || resolvedMode,
      preferredTemplateId: selectedTemplate?.id || templateId,
    });

    selection = {
      ...selection,
      modulesEnabled:
        Array.isArray(requiredModules) && requiredModules.length > 0
          ? requiredModules.filter((moduleId) => selection.template.requiredModules.includes(moduleId))
          : selection.modulesEnabled,
    };

    const planPayload = {
      mode: resolvedMode,
      templateId: selection.templateId,
      mechanics: getSupportedMechanicsForMode(resolvedMode),
      willNotImplement: getUnsupportedMechanicsSummary(unsupported),
      canAddLater: Array.isArray(selection.upgradePath) ? selection.upgradePath : [],
      answersUsed: runState.answers,
    };

    sendEnvelope("plan", "plan", planPayload);

    runState.agentState = "build";
    sessionState.runs.set(effectiveRunId, runState);

    const answerContext = Object.keys(runState.answers || {}).length > 0
      ? `Clarification answers: ${JSON.stringify(runState.answers)}`
      : "";
    const buildPrompt = [originalPrompt, answerContext].filter(Boolean).join("\n\n");

    const built = await generateGameSpec({
      provider,
      apiKey,
      message: buildPrompt,
      mode: effectiveCurrentSpec ? "patch" : "generate",
      currentSpec: effectiveCurrentSpec,
      forceMode: resolvedMode,
      sessionMessages: sessionState.messages,
      preferredTemplateId: selection.templateId,
      requiredModules: selection.modulesEnabled,
    });

    let workingSpec = sanitizeUnsupportedTopLevelFields(
      enrichAgentSpec(built.gameSpec, {
        selection: built.selection,
        plan: {
          mvpDefinition: `Playable ${resolvedMode} MVP with supported mechanics only.`,
          limitations: planPayload.willNotImplement,
        },
        limitations: planPayload.willNotImplement,
      }),
    );
    selection = built.selection;

    const runVerify = (spec) => {
      const schemaError = validateGameSpec(
        spec,
        resolvedMode,
        selection.template,
        Array.isArray(selection.modulesEnabled) ? selection.modulesEnabled : [],
      );
      const capability = capabilityCheck(spec, runtimeCapabilities);
      const reasons = [
        ...(schemaError ? [schemaError] : []),
        ...(!capability.ok ? capability.reasons || [] : []),
      ];
      const suggestedFixes = !capability.ok ? capability.suggestedFixes || [] : [];

      return {
        ok: reasons.length === 0,
        reasons,
        suggestedFixes,
      };
    };

    runState.agentState = "verify";
    sessionState.runs.set(effectiveRunId, runState);

    let verifyResult = runVerify(workingSpec);
    if (verifyResult.ok) {
      sendEnvelope("verify_pass", "verify_pass", {
        message: "Spec passed schema + capability checks.",
      });
    } else {
      sendEnvelope("verify_fail", "verify_fail", {
        reasons: verifyResult.reasons,
        suggestedFixes: verifyResult.suggestedFixes,
      });
    }

    let repairAttempt = 0;
    while (!verifyResult.ok && repairAttempt < MAX_AGENT_REPAIR_ATTEMPTS) {
      repairAttempt += 1;
      runState.agentState = "repair";
      sessionState.runs.set(effectiveRunId, runState);

      sendEnvelope("repair_attempt", "repair_attempt", {
        attempt: repairAttempt,
        reasons: verifyResult.reasons,
        action: "Removing unsupported mechanics and simplifying to supported equivalents.",
      });

      workingSpec = repairSpecAgainstCapabilities(workingSpec, runtimeCapabilities);
      workingSpec = sanitizeUnsupportedTopLevelFields(workingSpec);

      runState.agentState = "verify";
      sessionState.runs.set(effectiveRunId, runState);
      verifyResult = runVerify(workingSpec);

      if (verifyResult.ok) {
        sendEnvelope("verify_pass", "verify_pass", {
          message: `Spec passed verify after repair attempt ${repairAttempt}.`,
        });
        break;
      }

      sendEnvelope("verify_fail", "verify_fail", {
        reasons: verifyResult.reasons,
        suggestedFixes: verifyResult.suggestedFixes,
      });
    }

    if (!verifyResult.ok) {
      const alternativeSpec = buildAlternativeSpecSuggestion({
        prompt: originalPrompt,
        mode: resolvedMode,
        preferredTemplateId: selection.templateId,
      });

      sendEnvelope("cannot_build", "cannot_build", {
        reason: "Could not produce a fully valid spec within repair budget.",
        verifyReasons: verifyResult.reasons,
        suggestedFixes: verifyResult.suggestedFixes,
        suggestion:
          resolvedMode === "board2d"
            ? "Try a Ludo-style board2d MVP: dice + turn order + token movement."
            : "Try a single-player 3D runner MVP: obstacles + reachArea + fallBelow.",
        alternativeSpec,
      });
      sendEnvelope("done", "done", { status: "cannot_build" });

      sessionState.runs.set(effectiveRunId, {
        ...runState,
        status: "completed",
        agentState: "done",
        finalSpec: null,
        completedAt: new Date().toISOString(),
      });

      if (!closed) res.end();
      finalizeStream();
      return;
    }

    pushSessionSpecVersion(sessionState, workingSpec);
    pushSessionMessage(sessionState, {
      role: "assistant",
      message: "Agent build ready.",
      createdAt: new Date().toISOString(),
    });

    sendEnvelope("spec", "spec", workingSpec);
    sendEnvelope("done", "done", {
      status: "ok",
      mode: resolvedMode,
      templateId: selection.templateId,
      repairsUsed: repairAttempt,
    });

    sessionState.runs.set(effectiveRunId, {
      ...runState,
      status: "completed",
      agentState: "done",
      finalSpec: workingSpec,
      completedAt: new Date().toISOString(),
    });

    if (!closed) res.end();
    finalizeStream();
  } catch (error) {
    const safeMessage = scrubSensitiveText(error instanceof Error ? error.message : "Agent build failed.");
    endWithError(500, { message: safeMessage });
  }
});

const getHealthPayload = () => ({
  ok: true,
  providerSupport: SUPPORTED_PROVIDERS,
  templateSupport: getPublicTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    mode: template.mode,
    requiredModules: template.requiredModules,
    promptHints: template.promptHints,
  })),
  sessionCount: SESSION_CACHE.size,
  time: new Date().toISOString(),
});

app.get("/health", (_req, res) => {
  res.json(getHealthPayload());
});

app.get("/api/health", (_req, res) => {
  res.json(getHealthPayload());
});

app.get("/api/templates", (_req, res) => {
  const templates = getPublicTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    mode: template.mode,
    defaultSpec: template.defaultSpec,
    requiredModules: template.requiredModules,
    promptHints: template.promptHints,
  }));

  res.json({ templates });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

const sessionSweepTimer = setInterval(() => {
  sweepExpiredSessions();
}, SESSION_SWEEP_INTERVAL_MS);

if (typeof sessionSweepTimer?.unref === "function") {
  sessionSweepTimer.unref();
}
