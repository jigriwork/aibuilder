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
const MAX_AGENT_REPAIR_LOOPS = 3;

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
    });
  }

  return SESSION_CACHE.get(sessionId);
}

function pushSessionMessage(sessionState, entry) {
  sessionState.messages = [...sessionState.messages, entry].slice(-MAX_SESSION_MESSAGES);
}

function pushSessionSpecVersion(sessionState, gameSpec) {
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

function getAgentRequestPayload(bodyOrQuery = {}) {
  const base = getRequestPayload(bodyOrQuery);
  const projectIdRaw = typeof bodyOrQuery?.projectId === "string" ? bodyOrQuery.projectId.trim() : "";
  const userPromptRaw = typeof bodyOrQuery?.userPrompt === "string" ? bodyOrQuery.userPrompt : "";

  return {
    provider: base.provider,
    apiKey: base.apiKey,
    projectId: projectIdRaw || base.sessionId,
    sessionId: projectIdRaw || base.sessionId,
    userPrompt: String(userPromptRaw || base.message || "").trim(),
    currentSpec: base.currentSpec,
    templateId: base.templateId,
    requiredModules: base.requiredModules,
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

function getRequestPayload(bodyOrQuery = {}) {
  const provider =
    typeof bodyOrQuery?.provider === "string" ? bodyOrQuery.provider.trim().toLowerCase() : "openai";

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
    message: messageRaw.trim(),
    apiKey: typeof bodyOrQuery?.apiKey === "string" ? bodyOrQuery.apiKey.trim() : "",
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
    safeError(res, { provider, status: 400, error: "Add your API key in Jigrify Settings" });
    return false;
  }

  if (provider === "openai" && !apiKey.startsWith("sk-")) {
    safeError(res, { provider, status: 400, error: "Add your OpenAI API key in Jigrify Settings" });
    return false;
  }

  return true;
}

app.post("/api/generate", async (req, res) => {
  const payload = getRequestPayload(req.body);
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

app.get("/api/generate/stream", async (req, res) => {
  const payload = getRequestPayload(req.query);
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
    endWithError(400, { message: "Add your API key in Jigrify Settings" });
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
      message: error instanceof Error ? error.message : "Generation failed. Check your key/network and retry.",
    });
  }
});

app.get("/api/agent/stream", async (req, res) => {
  const payload = getAgentRequestPayload(req.query);
  const { provider, apiKey, userPrompt, currentSpec, templateId, requiredModules, sessionId, projectId } = payload;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const sendEvent = (eventName, eventPayload) => {
    if (closed) return;
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
  };

  const endWithError = (status, errPayload) => {
    sendEvent("error", { status, ...errPayload });
    sendEvent("build_error", { status, ...errPayload });
    if (!closed) res.end();
  };

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    endWithError(400, { message: "Provider must be openai or gemini." });
    return;
  }

  if (!userPrompt) {
    endWithError(400, { message: "userPrompt is required." });
    return;
  }

  if (!apiKey || apiKey.length < 20) {
    endWithError(400, { message: "Add your API key in Jigrify Settings" });
    return;
  }

  if (provider === "openai" && !apiKey.startsWith("sk-")) {
    endWithError(400, { message: "Add your OpenAI API key in Jigrify Settings" });
    return;
  }

  const sessionState = getSessionState(sessionId || projectId || resolveSessionId(""));

  try {
    pushSessionMessage(sessionState, {
      role: "user",
      message: userPrompt,
      createdAt: new Date().toISOString(),
    });

    sendEvent("chat_message", {
      role: "assistant",
      message: "Brain loop started: Plan → Build → Verify → Repair (if needed).",
    });

    sendEvent("phase_update", {
      phase: "plan",
      status: "running",
      message: "Understanding request and selecting MVP strategy.",
    });

    const plan = await generateAgentPlan({
      provider,
      apiKey,
      userPrompt,
      preferredTemplateId: templateId,
      currentSpec,
    });

    sendEvent("chat_message", {
      role: "assistant",
      message: `Plan ready: ${plan.mvpDefinition}`,
      meta: { type: "plan", plan },
    });

    sendEvent("phase_update", {
      phase: "plan",
      status: "done",
      plan,
    });

    const forcedTemplate = getTemplateById(plan.templateId || templateId || "");
    let selection = classifyPromptToTemplate({
      prompt: userPrompt,
      forceMode: forcedTemplate?.mode || plan.mode,
      preferredTemplateId: forcedTemplate?.id || templateId,
    });

    selection = {
      ...selection,
      modulesEnabled:
        Array.isArray(requiredModules) && requiredModules.length > 0
          ? requiredModules.filter((moduleId) => selection.template.requiredModules.includes(moduleId))
          : selection.modulesEnabled,
    };

    let workingSpec = currentSpec || null;
    let verified = false;
    let finalSpec = null;
    let lastVerify = null;

    for (let attempt = 0; attempt <= MAX_AGENT_REPAIR_LOOPS; attempt += 1) {
      if (attempt === 0) {
        sendEvent("phase_update", {
          phase: "build",
          status: "running",
          message: "Building initial GameSpec from plan.",
        });

        const built = await generateGameSpec({
          provider,
          apiKey,
          message: userPrompt,
          mode: workingSpec ? "patch" : "generate",
          currentSpec: workingSpec,
          forceMode: plan.mode,
          sessionMessages: sessionState.messages,
          preferredTemplateId: selection.templateId,
          requiredModules: selection.modulesEnabled,
        });

        workingSpec = enrichAgentSpec(built.gameSpec, {
          selection: built.selection,
          plan,
          limitations: plan.limitations,
        });
        selection = built.selection;

        sendEvent("spec_update", workingSpec);
        sendEvent("phase_update", { phase: "build", status: "done" });
      } else {
        sendEvent("phase_update", {
          phase: `repair_${attempt}`,
          status: "running",
          message: `Repair #${attempt}: fixing verification issues.`,
          verify: lastVerify,
        });

        const repairInstruction = [
          userPrompt,
          "Repair the current spec to satisfy missing mechanics using only supported modules.",
          `Missing items: ${(lastVerify?.missing || []).join("; ")}`,
        ].join("\n\n");

        const repaired = await generateGameSpec({
          provider,
          apiKey,
          message: repairInstruction,
          mode: "patch",
          currentSpec: workingSpec,
          forceMode: plan.mode,
          sessionMessages: sessionState.messages,
          preferredTemplateId: selection.templateId,
          requiredModules: selection.modulesEnabled,
        });

        workingSpec = enrichAgentSpec(repaired.gameSpec, {
          selection: repaired.selection,
          plan,
          limitations: plan.limitations,
        });
        selection = repaired.selection;

        sendEvent("spec_update", workingSpec);
        sendEvent("phase_update", { phase: `repair_${attempt}`, status: "done" });
      }

      sendEvent("phase_update", {
        phase: "verify",
        status: "running",
        message: "Verifying schema, module support, and planned mechanics.",
      });

      const verify = verifyAgentSpec({
        spec: workingSpec,
        plan,
        selection,
        forcedMode: plan.mode,
      });

      lastVerify = verify;
      if (verify.ok) {
        verified = true;
        finalSpec = workingSpec;
        sendEvent("phase_update", { phase: "verify", status: "done" });
        break;
      }

      sendEvent("phase_update", {
        phase: "verify",
        status: "failed",
        missing: verify.missing,
      });

      sendEvent("chat_message", {
        role: "assistant",
        message: `Verification found issues: ${(verify.missing || []).join(" | ")}`,
        meta: { type: "verify_error", verify },
      });
    }

    if (!verified) {
      finalSpec = buildMvpFallbackSpec({ selection, plan });
      sendEvent("chat_message", {
        role: "assistant",
        message:
          "Could not satisfy all requested mechanics in repair budget. Returning truthful MVP fallback and listing limitations.",
      });
      sendEvent("phase_update", {
        phase: "fallback",
        status: "done",
        limitations: plan.limitations,
      });
      sendEvent("spec_update", finalSpec);
    }

    pushSessionSpecVersion(sessionState, finalSpec);
    pushSessionMessage(sessionState, {
      role: "assistant",
      message: "Agent build ready.",
      createdAt: new Date().toISOString(),
    });

    sendEvent("phase_update", {
      phase: "ready",
      status: "done",
      retriesUsed: verified ? Math.max(0, (lastVerify?.ok ? 0 : MAX_AGENT_REPAIR_LOOPS)) : MAX_AGENT_REPAIR_LOOPS,
    });

    sendEvent("spec", finalSpec);
    sendEvent("chat_message", {
      role: "assistant",
      message: "Ready: playable MVP generated.",
      meta: {
        type: "ready",
        plan,
        limitations: plan.limitations,
      },
    });

    if (!closed) res.end();
  } catch (error) {
    endWithError(500, {
      message: error instanceof Error ? error.message : "Agent build failed.",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
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
