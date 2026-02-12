const MODULE_AVAILABILITY = {
  "runtime.physics3d.base": true,
  "runtime.physics3d.runner": true,
  "runtime.physics3d.driving": true,
  "runtime.physics3d.shooter.simple": true,
  "runtime.physics3d.platformer": true,
  "runtime.board2d.base": true,
  "runtime.board2d.ludo": true,
  "runtime.board2d.snake": true,
  "runtime.sports.base": true,
  "runtime.sports.cricket": false,
};

const TEMPLATE_REGISTRY = [
  {
    id: "physics3d_runner_v1",
    name: "3D Runner",
    mode: "physics3d",
    genre: "runner",
    defaultSpec: {
      mode: "physics3d",
      title: "Runner Prototype",
      description: "A simple endless-style 3D runner MVP.",
      scene: {
        objects: [
          { type: "ground", size: [40, 1, 120], position: [0, -0.5, 0], color: "#334155" },
          { type: "box", size: [2, 2, 2], position: [0, 1, -8], mass: 0, color: "#475569" },
        ],
      },
      player: {
        kind: "box",
        spawn: [0, 1.5, 8],
        move: { type: "keyboard", speed: 8 },
        jump: { enabled: true, strength: 6 },
      },
      camera: {
        mode: "follow",
        position: [0, 8, 16],
        target: [0, 0, 0],
        followOffset: [0, 7, 14],
      },
      rules: {
        objective: "Reach the goal lane while avoiding obstacles.",
        win: [{ type: "reachArea", position: [0, 1, -35], radius: 3 }],
        lose: [{ type: "fallBelow", y: -6 }],
        score: [{ type: "time", mode: "countdown", seconds: 45 }],
      },
      ui: { hud: [{ type: "text", value: "Runner MVP" }] },
    },
    requiredModules: ["runtime.physics3d.base", "runtime.physics3d.runner"],
    promptHints: ["runner", "endless", "obstacles", "lane"],
  },
  {
    id: "physics3d_driving_v1",
    name: "3D Driving",
    mode: "physics3d",
    genre: "driving",
    defaultSpec: {
      mode: "physics3d",
      title: "Driving Prototype",
      description: "A basic 3D driving MVP with checkpoints.",
      scene: {
        objects: [
          { type: "ground", size: [60, 1, 60], position: [0, -0.5, 0], color: "#1f2937" },
          { type: "ramp", size: [8, 1, 12], position: [0, 0, -10], rotation: [-0.2, 0, 0], color: "#475569" },
        ],
      },
      player: {
        kind: "box",
        spawn: [0, 1.2, 16],
        move: { type: "keyboard", speed: 10 },
        jump: { enabled: false, strength: 0 },
      },
      camera: {
        mode: "follow",
        position: [0, 10, 20],
        target: [0, 0, 0],
        followOffset: [0, 8, 16],
      },
      rules: {
        objective: "Drive to the finish marker.",
        win: [{ type: "reachArea", position: [0, 1, -22], radius: 4 }],
        lose: [{ type: "fallBelow", y: -6 }],
        score: [{ type: "time", mode: "countdown", seconds: 60 }],
      },
      ui: { hud: [{ type: "text", value: "Driving MVP" }] },
    },
    requiredModules: ["runtime.physics3d.base", "runtime.physics3d.driving"],
    promptHints: ["car", "driving", "race", "vehicle"],
  },
  {
    id: "physics3d_shooter_v1",
    name: "3D Shooter (Simple)",
    mode: "physics3d",
    genre: "shooter",
    defaultSpec: {
      mode: "physics3d",
      title: "Shooter Prototype",
      description: "A simple 3D shooter MVP using movement + reach objectives.",
      scene: {
        objects: [
          { type: "ground", size: [50, 1, 50], position: [0, -0.5, 0], color: "#1e293b" },
          { type: "box", size: [3, 3, 3], position: [8, 1.5, -8], mass: 0, color: "#334155" },
        ],
      },
      player: {
        kind: "sphere",
        spawn: [0, 1.5, 10],
        move: { type: "keyboard", speed: 7 },
        jump: { enabled: true, strength: 5 },
      },
      camera: {
        mode: "follow",
        position: [0, 9, 16],
        target: [0, 1, 0],
        followOffset: [0, 7, 13],
      },
      rules: {
        objective: "Reach enemy zones in a simple arena prototype.",
        win: [{ type: "reachArea", position: [0, 1, -18], radius: 3 }],
        lose: [{ type: "fallBelow", y: -6 }],
        score: [{ type: "time", mode: "countdown", seconds: 55 }],
      },
      ui: { hud: [{ type: "text", value: "Shooter MVP (no advanced combat module yet)" }] },
    },
    requiredModules: ["runtime.physics3d.base", "runtime.physics3d.shooter.simple"],
    promptHints: ["shooter", "fps", "gun", "shoot"],
  },
  {
    id: "physics3d_platformer_v1",
    name: "3D Platformer",
    mode: "physics3d",
    genre: "platformer",
    defaultSpec: {
      mode: "physics3d",
      title: "Platformer Prototype",
      description: "A simple 3D platformer MVP with jumps and ramps.",
      scene: {
        objects: [
          { type: "ground", size: [40, 1, 40], position: [0, -0.5, 0], color: "#0f172a" },
          { type: "box", size: [4, 1, 4], position: [0, 2, -8], mass: 0, color: "#334155" },
          { type: "ramp", size: [6, 1, 8], position: [7, 0, -4], rotation: [-0.3, 0.4, 0], color: "#475569" },
        ],
      },
      player: {
        kind: "box",
        spawn: [0, 1.5, 10],
        move: { type: "keyboard", speed: 7 },
        jump: { enabled: true, strength: 8 },
      },
      camera: {
        mode: "follow",
        position: [0, 10, 16],
        target: [0, 0, 0],
        followOffset: [0, 8, 14],
      },
      rules: {
        objective: "Reach the final platform.",
        win: [{ type: "reachArea", position: [0, 3, -16], radius: 2.5 }],
        lose: [{ type: "fallBelow", y: -8 }],
        score: [{ type: "time", mode: "countdown", seconds: 65 }],
      },
      ui: { hud: [{ type: "text", value: "Platformer MVP" }] },
    },
    requiredModules: ["runtime.physics3d.base", "runtime.physics3d.platformer"],
    promptHints: ["platformer", "jump", "platform", "parkour"],
  },
  {
    id: "board2d_ludo_v1",
    name: "2D Ludo",
    mode: "board2d",
    genre: "board",
    defaultSpec: {
      mode: "board2d",
      title: "Ludo Prototype",
      description: "A basic turn-based Ludo style board MVP.",
      board2d: {
        game: "ludo",
        size: 15,
        players: [
          { id: "p1", name: "Player 1", color: "#ef4444" },
          { id: "p2", name: "Player 2", color: "#3b82f6" },
        ],
        rules: { dice: { min: 1, max: 6 } },
      },
      rules: {
        objective: "Move tokens to the home lane before the opponent.",
      },
      ui: { hud: [{ type: "text", value: "Ludo MVP" }] },
    },
    requiredModules: ["runtime.board2d.base", "runtime.board2d.ludo"],
    promptHints: ["ludo", "board", "dice", "turn-based"],
  },
  {
    id: "board2d_snake_v1",
    name: "2D Snake",
    mode: "board2d",
    genre: "board",
    defaultSpec: {
      mode: "board2d",
      title: "Snake Prototype",
      description: "A basic snake board MVP.",
      board2d: {
        game: "snake",
        size: 20,
        players: [{ id: "p1", name: "Player", color: "#22c55e" }],
        rules: { dice: { min: 1, max: 6 } },
      },
      rules: {
        objective: "Collect food and avoid collisions.",
      },
      ui: { hud: [{ type: "text", value: "Snake MVP" }] },
    },
    requiredModules: ["runtime.board2d.base", "runtime.board2d.snake"],
    promptHints: ["snake", "grid", "arcade", "board"],
  },
  {
    id: "sports_cricket_v1",
    name: "Cricket (Placeholder)",
    mode: "physics3d",
    genre: "sports",
    defaultSpec: {
      mode: "physics3d",
      title: "Cricket Prototype Placeholder",
      description: "Placeholder only. Full cricket systems are not yet available.",
      scene: {
        objects: [{ type: "ground", size: [60, 1, 90], position: [0, -0.5, 0], color: "#14532d" }],
      },
      player: {
        kind: "box",
        spawn: [0, 1.2, 12],
        move: { type: "keyboard", speed: 6 },
        jump: { enabled: false, strength: 0 },
      },
      camera: {
        mode: "follow",
        position: [0, 9, 18],
        target: [0, 1, 0],
        followOffset: [0, 8, 14],
      },
      rules: {
        objective: "Sports placeholder objective.",
        win: [{ type: "reachArea", position: [0, 1, -14], radius: 3 }],
        lose: [{ type: "fallBelow", y: -6 }],
        score: [{ type: "time", mode: "countdown", seconds: 75 }],
      },
      ui: { hud: [{ type: "text", value: "Cricket placeholder MVP" }] },
    },
    requiredModules: ["runtime.sports.base", "runtime.sports.cricket"],
    promptHints: ["cricket", "bat", "bowling", "wicket"],
  },
  {
    id: "sports_prototype_v1",
    name: "Sports Prototype",
    mode: "physics3d",
    genre: "sports",
    hidden: true,
    defaultSpec: {
      mode: "physics3d",
      title: "Sports Prototype",
      description: "MVP sports sandbox while full sports modules are in development.",
      scene: {
        objects: [
          { type: "ground", size: [60, 1, 90], position: [0, -0.5, 0], color: "#14532d" },
          { type: "box", size: [2, 2, 2], position: [0, 1, -8], mass: 0, color: "#334155" },
        ],
      },
      player: {
        kind: "sphere",
        spawn: [0, 1.5, 16],
        move: { type: "keyboard", speed: 7 },
        jump: { enabled: true, strength: 5 },
      },
      camera: {
        mode: "follow",
        position: [0, 10, 18],
        target: [0, 1, 0],
        followOffset: [0, 8, 14],
      },
      rules: {
        objective: "Reach target zones in a sports-themed prototype.",
        win: [{ type: "reachArea", position: [0, 1, -20], radius: 4 }],
        lose: [{ type: "fallBelow", y: -6 }],
        score: [{ type: "time", mode: "countdown", seconds: 60 }],
      },
      ui: { hud: [{ type: "text", value: "Sports MVP prototype" }] },
    },
    requiredModules: ["runtime.sports.base"],
    promptHints: ["sports", "match", "arena"],
  },
];

const BOARD_HINTS = ["board", "ludo", "snake", "chess", "carrom", "tic tac toe", "dice", "grid"];
const SPORTS_HINTS = ["sports", "cricket", "football", "soccer", "tennis", "basketball"];
const UNSUPPORTED_SCOPE_HINTS = [
  "gta",
  "open world",
  "massive open world",
  "mmorpg",
  "online multiplayer",
  "100 players",
  "battle royale",
  "photorealistic city",
  "fully destructible city",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return patch === undefined ? base : patch;
  }

  const next = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const key of Object.keys(patch)) {
    const baseValue = next[key];
    const patchValue = patch[key];

    if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      next[key] = deepMerge(baseValue && typeof baseValue === "object" ? baseValue : {}, patchValue);
    } else {
      next[key] = patchValue;
    }
  }
  return next;
}

function normalizeText(text) {
  return String(text || "").toLowerCase();
}

export function getTemplateById(templateId) {
  return TEMPLATE_REGISTRY.find((template) => template.id === templateId) || null;
}

export function getPublicTemplates() {
  return TEMPLATE_REGISTRY.filter((template) => !template.hidden);
}

export function detectIntent(prompt, forceMode = "auto") {
  if (forceMode === "board2d" || forceMode === "physics3d") {
    return forceMode;
  }

  const value = normalizeText(prompt);
  if (BOARD_HINTS.some((hint) => value.includes(hint))) {
    return "board2d";
  }
  return "physics3d";
}

export function detectGenre(prompt) {
  const value = normalizeText(prompt);
  if (value.includes("runner") || value.includes("endless")) return "runner";
  if (value.includes("drive") || value.includes("driving") || value.includes("car") || value.includes("race")) return "driving";
  if (value.includes("shoot") || value.includes("shooter") || value.includes("fps") || value.includes("gun")) return "shooter";
  if (value.includes("platform") || value.includes("jump") || value.includes("parkour")) return "platformer";
  if (value.includes("ludo")) return "ludo";
  if (value.includes("snake")) return "snake";
  if (value.includes("cricket")) return "cricket";
  if (SPORTS_HINTS.some((hint) => value.includes(hint))) return "sports";
  if (BOARD_HINTS.some((hint) => value.includes(hint))) return "board";
  return "generic";
}

function areModulesAvailable(moduleIds = []) {
  return moduleIds.every((moduleId) => MODULE_AVAILABILITY[moduleId] === true);
}

function inferTemplateFromIntent(intent) {
  if (intent === "board2d") return getTemplateById("board2d_snake_v1");
  return getTemplateById("physics3d_runner_v1");
}

export function classifyPromptToTemplate({ prompt, forceMode = "auto", preferredTemplateId = "" }) {
  const intent = detectIntent(prompt, forceMode);
  const genre = detectGenre(prompt);
  const normalizedPrompt = normalizeText(prompt);

  const reason = [];
  let requestedTemplate = preferredTemplateId ? getTemplateById(preferredTemplateId) : null;

  if (!requestedTemplate) {
    if (genre === "runner") requestedTemplate = getTemplateById("physics3d_runner_v1");
    else if (genre === "driving") requestedTemplate = getTemplateById("physics3d_driving_v1");
    else if (genre === "shooter") requestedTemplate = getTemplateById("physics3d_shooter_v1");
    else if (genre === "platformer") requestedTemplate = getTemplateById("physics3d_platformer_v1");
    else if (genre === "ludo") requestedTemplate = getTemplateById("board2d_ludo_v1");
    else if (genre === "snake") requestedTemplate = getTemplateById("board2d_snake_v1");
    else if (genre === "cricket" || genre === "sports") requestedTemplate = getTemplateById("sports_cricket_v1");
    else requestedTemplate = inferTemplateFromIntent(intent);
  }

  if (requestedTemplate?.mode !== intent && forceMode !== "auto") {
    requestedTemplate = inferTemplateFromIntent(intent);
    reason.push(`forced ${intent} mode from user preference`);
  }

  const requestedTemplateId = requestedTemplate?.id || "";
  let selectedTemplate = requestedTemplate || inferTemplateFromIntent(intent);
  let limitationSummary = "";
  let unsupportedFeatures = [];
  let isFallback = false;
  const scopeLimitations = [];

  if (!areModulesAvailable(selectedTemplate.requiredModules)) {
    isFallback = true;
    unsupportedFeatures = selectedTemplate.requiredModules.filter((moduleId) => MODULE_AVAILABILITY[moduleId] !== true);

    if (selectedTemplate.id === "sports_cricket_v1") {
      selectedTemplate = getTemplateById("sports_prototype_v1") || selectedTemplate;
      limitationSummary =
        "Full cricket systems are not available yet. Generated a sports prototype MVP instead.";
      reason.push("cricket module unavailable, routed to sports prototype");
    }
  }

  if (UNSUPPORTED_SCOPE_HINTS.some((hint) => normalizedPrompt.includes(hint))) {
    scopeLimitations.push(
      "Requested scope is beyond current runtime capabilities. A truthful MVP is generated with currently supported systems.",
    );
    reason.push("large-scope request reduced to MVP");
  }

  if (normalizedPrompt.includes("multiplayer")) {
    scopeLimitations.push("Realtime multiplayer networking is not available yet in current modules.");
  }

  if (scopeLimitations.length > 0) {
    limitationSummary = [limitationSummary, ...scopeLimitations].filter(Boolean).join(" ");
  }

  const modulesEnabled = selectedTemplate.requiredModules.filter((moduleId) => MODULE_AVAILABILITY[moduleId] === true);
  const upgradePath = selectedTemplate.id === "sports_prototype_v1"
    ? [
        "Add runtime.sports.cricket module for batting, bowling, wickets, and overs.",
        "Add innings/scoreboard rules and match state transitions.",
        "Add team AI, field placements, and ball trajectory mechanics.",
      ]
    : [
        "Expand rules with richer win/lose/score systems.",
        "Add more level content and interactions.",
        "Swap in advanced modules as they become available.",
      ];

  return {
    intent,
    genre,
    requestedTemplateId,
    template: selectedTemplate,
    templateId: selectedTemplate.id,
    modulesEnabled,
    isFallback,
    unsupportedFeatures,
    limitationSummary,
    reason,
    upgradePath,
  };
}

export function applyTemplateToSpec(rawSpec, selection) {
  const template = selection?.template;
  if (!template) return rawSpec;

  const merged = deepMerge(clone(template.defaultSpec), rawSpec || {});
  merged.mode = template.mode;
  merged.templateId = template.id;
  merged.modules = selection.modulesEnabled;

  const limitationText = selection.limitationSummary
    ? `Limitations: ${selection.limitationSummary}`
    : "";

  const nextFeatures = Array.isArray(selection.upgradePath) ? selection.upgradePath : [];
  merged.capability = {
    ...(merged.capability || {}),
    intent: selection.intent,
    genre: selection.genre,
    requestedTemplateId: selection.requestedTemplateId,
    selectedTemplateId: selection.templateId,
    fallbackApplied: Boolean(selection.isFallback),
    limitationSummary: selection.limitationSummary || "",
    unsupportedFeatures: selection.unsupportedFeatures || [],
    nextFeatures,
  };

  merged.upgradePath = {
    summary:
      selection.limitationSummary ||
      "This is an MVP built with currently supported modules. You can expand it in next iterations.",
    nextFeatures,
  };

  if (!merged.ui || typeof merged.ui !== "object") {
    merged.ui = { hud: [] };
  }

  if (!Array.isArray(merged.ui.hud)) {
    merged.ui.hud = [];
  }

  if (limitationText && !merged.ui.hud.some((item) => String(item?.value || "").includes("Limitations:"))) {
    merged.ui.hud.push({ type: "text", value: limitationText });
  }

  if (merged.mode === "physics3d") {
    if (!merged.scene || typeof merged.scene !== "object") {
      merged.scene = { objects: [] };
    }
    if (!Array.isArray(merged.scene.objects)) {
      merged.scene.objects = [];
    }
    const hasGround = merged.scene.objects.some((object) => object?.type === "ground");
    if (!hasGround) {
      merged.scene.objects.unshift({
        type: "ground",
        size: [40, 1, 40],
        position: [0, -0.5, 0],
        color: "#334155",
      });
    }
  }

  if (merged.mode === "board2d") {
    if (!merged.board2d || typeof merged.board2d !== "object") {
      merged.board2d = clone(template.defaultSpec.board2d || {});
    }
    if (!Array.isArray(merged.board2d.players) || merged.board2d.players.length === 0) {
      merged.board2d.players = clone(template.defaultSpec.board2d?.players || [{ id: "p1", name: "Player" }]);
    }
    if (!merged.board2d.rules || typeof merged.board2d.rules !== "object") {
      merged.board2d.rules = { dice: { min: 1, max: 6 } };
    }
    if (!merged.board2d.rules.dice || typeof merged.board2d.rules.dice !== "object") {
      merged.board2d.rules.dice = { min: 1, max: 6 };
    }
  }

  return merged;
}

export { MODULE_AVAILABILITY, TEMPLATE_REGISTRY };