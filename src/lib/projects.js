const USER_KEY = "jigrify_user";
const PROJECTS_KEY = "jigrify_projects";
const LAST_PROJECT_KEY = "jigrify_last_project_id";
const MIGRATION_VERSION = 1;

function projectBlobKey(projectId) {
  return `jigrify_project_${projectId}`;
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function persistJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readProjectIndex() {
  const list = safeParse(localStorage.getItem(PROJECTS_KEY), [);
}

function writeProjectIndex(index) {
  persistJson(PROJECTS_KEY, index);
}

function toIndexEntry(project) {
  return {
    id: project.id,
    userId: project.userId || "guest",
    title: project.title || "Untitled",
    createdAt: Number(project.createdAt || Date.now()),
    updatedAt: Number(project.updatedAt || Date.now()),
    templateId: project.templateId || "",
    provider: project.provider || "openai",
    mode: project.mode || "auto",
    modules: Array.isArray(project.modules) ? project.modules : [],
    lastPrompt: project.lastPrompt || "",
  };
}

function mergeLegacyData(projectId, baseProject) {
  const next = {
    ...baseProject,
    chat: Array.isArray(baseProject.chat) ? baseProject.chat : [],
    runs: Array.isArray(baseProject.runs) ? baseProject.runs : [],
    specHistory: Array.isArray(baseProject.specHistory) ? baseProject.specHistory : [],
  };

  const allLegacy = safeParse(localStorage.getItem(PROJECTS_KEY), []);
  const legacy = Array.isArray(allLegacy)
    ? allLegacy.find((entry) => entry?.id === projectId) || null
    : null;

  if (legacy && typeof legacy === "object") {
    next.userId = legacy.userId || next.userId;
    next.title = legacy.title || legacy.name || next.title;
    next.templateId = legacy.templateId || next.templateId;
    next.mode = legacy.mode || legacy.forceMode || next.mode;
    next.modules = Array.isArray(legacy.modules)
      ? legacy.modules
      : Array.isArray(legacy.requiredModules)
        ? legacy.requiredModules
        : next.modules;
    next.createdAt = Number(legacy.createdAt || next.createdAt);
    next.updatedAt = Number(legacy.updatedAt || next.updatedAt);
    next.lastPrompt = legacy.lastPrompt || legacy.prompt || next.lastPrompt || "";
    if (!Array.isArray(next.chat) || next.chat.length === 0) {
      next.chat = Array.isArray(legacy.chat)
        ? legacy.chat
        : Array.isArray(legacy.messages)
          ? legacy.messages
          : [];
    }
    if ((!Array.isArray(next.specHistory) || next.specHistory.length === 0) && Array.isArray(legacy.specHistory)) {
      next.specHistory = legacy.specHistory;
    }
    if (!Number.isInteger(next.specCursor)) {
      next.specCursor = Number.isInteger(legacy.specCursor)
        ? legacy.specCursor
        : (next.specHistory?.length || 0) - 1;
    }
  }

  try {
    const legacyMessages = safeParse(localStorage.getItem(`aigb_project_${projectId}_messages`), null);
    if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
      next.chat = legacyMessages;
    }
  } catch {
    // ignore migration parse failures
  }

  try {
    const legacySpec = safeParse(localStorage.getItem(`aigb_project_${projectId}_spec`), null);
    if (legacySpec && typeof legacySpec === "object" && !Array.isArray(legacySpec)) {
      if (!Array.isArray(next.specHistory) || next.specHistory.length === 0) {
        next.specHistory = [legacySpec];
      }
      if (!Number.isInteger(next.specCursor) || next.specCursor < 0) {
        next.specCursor = next.specHistory.length - 1;
      }
    }
  } catch {
    // ignore migration parse failures
  }

  next.chat = Array.isArray(next.chat) ? next.chat : [];
  next.runs = Array.isArray(next.runs) ? next.runs : [];
  next.specHistory = Array.isArray(next.specHistory) ? next.specHistory : [];
  next.specCursor = Number.isInteger(next.specCursor)
    ? next.specCursor
    : next.specHistory.length - 1;

  return next;
}

function normalizeProject(input = {}) {
  const now = Date.now();
  const project = {
    id: String(input.id || createId("project")),
    userId: input.userId || "guest",
    title: String(input.title || input.name || "Untitled").trim() || "Untitled",
    createdAt: Number(input.createdAt || now),
    updatedAt: Number(input.updatedAt || now),
    templateId: String(input.templateId || ""),
    provider: String(input.provider || "openai"),
    mode: String(input.mode || input.forceMode || "auto"),
    modules: Array.isArray(input.modules)
      ? input.modules
      : Array.isArray(input.requiredModules)
        ? input.requiredModules
        : [],
    chat: Array.isArray(input.chat)
      ? input.chat
      : Array.isArray(input.messages)
        ? input.messages
        : [],
    runs: Array.isArray(input.runs) ? input.runs : [],
    specHistory: Array.isArray(input.specHistory) ? input.specHistory : [],
    specCursor: Number.isInteger(input.specCursor) ? input.specCursor : (Array.isArray(input.specHistory) ? input.specHistory.length - 1 : -1),
    draftPrompt: typeof input.draftPrompt === "string" ? input.draftPrompt : "",
    lastPrompt: typeof input.lastPrompt === "string" ? input.lastPrompt : (typeof input.prompt === "string" ? input.prompt : ""),
    pendingBuild:
      input.pendingBuild && typeof input.pendingBuild === "object"
        ? {
            prompt: String(input.pendingBuild.prompt || "").trim(),
            templateId: input.pendingBuild.templateId ? String(input.pendingBuild.templateId) : "",
            mode: input.pendingBuild.mode ? String(input.pendingBuild.mode) : "auto",
            modules: Array.isArray(input.pendingBuild.modules) ? input.pendingBuild.modules : [],
            provider: String(input.pendingBuild.provider || input.provider || "openai"),
            runId: String(input.pendingBuild.runId || ""),
            createdAt: Number(input.pendingBuild.createdAt || Date.now()),
          }
        : null,
    migrationVersion: Number(input.migrationVersion || 0),
  };

  return project;
}

export function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeUser(input) {
  const email = String(input?.email || "").trim().toLowerCase();
  const name = String(input?.name || email || "Guest").trim();
  if (!email) {
    return { id: "guest", name: "Guest", email: "", isGuest: true };
  }
  return {
    id: encodeURIComponent(email),
    name,
    email,
    isGuest: false,
  };
}

export function getStoredUser() {
  return normalizeUser(safeParse(localStorage.getItem(USER_KEY), null));
}

export function setStoredUser(user) {
  const normalized = normalizeUser(user);
  persistJson(USER_KEY, normalized);
  return normalized;
}

function readLastMap() {
  const value = safeParse(localStorage.getItem(LAST_PROJECT_KEY), {});
  return value && typeof value === "object" ? value : {};
}

function writeLastMap(map) {
  persistJson(LAST_PROJECT_KEY, map);
}

export function saveProject(projectInput) {
  if (!projectInput?.id) return null;

  const normalized = normalizeProject(projectInput);
  const nextProject = {
    ...normalized,
    updatedAt: Date.now(),
    migrationVersion: MIGRATION_VERSION,
  };

  localStorage.setItem(projectBlobKey(nextProject.id), JSON.stringify(nextProject));

  const index = readProjectIndex();
  const idx = index.findIndex((entry) => entry?.id === nextProject.id);
  const entry = toIndexEntry(nextProject);
  if (idx >= 0) {
    index[idx] = entry;
  } else {
    index.unshift(entry);
  }

  writeProjectIndex(
    index
      .filter((entry) => entry?.id)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
  );

  return nextProject;
}

export function loadProject(projectId) {
  if (!projectId) return null;

  const legacyList = safeParse(localStorage.getItem(PROJECTS_KEY), [);
  const hadLegacyEntry = Array.isArray(legacyList)
    : false;

  const rawCanonical = safeParse(localStorage.getItem(projectBlobKey(projectId)), null);
  if (rawCanonical && typeof rawCanonical === "object") {
    const canonical = normalizeProject(rawCanonical);
    if (canonical.migrationVersion >= MIGRATION_VERSION) {
      return canonical;
    }

    const migrated = mergeLegacyData(projectId, canonical);
    migrated.migrationVersion = MIGRATION_VERSION;
    return saveProject(migrated);
  }

  const seeded = normalizeProject({ id: projectId });
  const migrated = mergeLegacyData(projectId, seeded);

  const hasAnyData =
    hadLegacyEntry
    ||
    Boolean(migrated.title && migrated.title !== "Untitled")
    || migrated.chat.length > 0
    || migrated.specHistory.length > 0
    || Boolean(migrated.templateId);

  if (!hasAnyData) {
    return null;
  }

  migrated.migrationVersion = MIGRATION_VERSION;
  return saveProject(migrated);
}

export function updateProjectMetadata(projectId, patch = {}) {
  const current = loadProject(projectId);
  if (!current) return null;
  return saveProject({
    ...current,
    ...patch,
  });
}

export function listRecentProjects(userId, limit = 10) {
  const index = readProjectIndex()
    .filter((entry) => entry?.id)
    .filter((entry) => !userId || entry.userId === userId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  return index.slice(0, Math.max(1, limit)).map((entry) => {
    const loaded = loadProject(entry.id);
    return loaded
      ? loaded
      : normalizeProject({
          id: entry.id,
          userId: entry.userId,
          title: entry.title,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          templateId: entry.templateId,
          provider: entry.provider || "openai",
          mode: entry.mode,
          modules: entry.modules,
          lastPrompt: entry.lastPrompt,
          migrationVersion: MIGRATION_VERSION,
        });
  });
}

export function getProjectsForUser(userId) {
  return listRecentProjects(userId, 200).map((project) => ({
    ...project,
    name: project.title,
    provider: project.provider || "openai",
    forceMode: project.mode || "auto",
    requiredModules: project.modules || [],
    messages: project.chat || [],
  }));
}

export function getProjectById(userId, projectId) {
  const project = loadProject(projectId);
  if (!project) return null;
  if (userId && project.userId !== userId) return null;
  return {
    ...project,
    name: project.title,
    forceMode: project.mode,
    requiredModules: project.modules,
    messages: project.chat,
  };
}

export function createProject({
  userId,
  name = "Untitled",
  title,
  prompt = "",
  seedPrompt,
  draftPrompt = "",
  provider = "openai",
  forceMode = "auto",
  mode,
  templateId = "",
  modules,
  requiredModules = [],
  pendingBuild = null,
}) {
  const project = normalizeProject({
    id: createId("project"),
    userId,
    title: title || name,
    lastPrompt: String(seedPrompt || prompt || "").trim(),
    provider,
    mode: mode || forceMode || "auto",
    templateId,
    modules: Array.isArray(modules) ? modules : (Array.isArray(requiredModules) ? requiredModules : []),
    chat: [],
    runs: [],
    specHistory: [],
    specCursor: -1,
    draftPrompt: String(draftPrompt || ""),
    pendingBuild,
    migrationVersion: MIGRATION_VERSION,
  });

  const saved = saveProject(project);
  setActiveProjectId(userId, saved.id);
  return {
    ...saved,
    name: saved.title,
    forceMode: saved.mode,
    requiredModules: saved.modules,
    messages: saved.chat,
  };
}

export function upsertProject(updatedProject) {
  return saveProject(updatedProject);
}

export function deleteProject(userId, projectId) {
  if (!projectId) return;

  localStorage.removeItem(projectBlobKey(projectId));

  const nextIndex = readProjectIndex().filter((project) => project.id !== projectId);
  writeProjectIndex(nextIndex);

  const lastMap = readLastMap();
  if (lastMap[userId] === projectId) {
    const replacement = nextIndex.find((project) => project.userId === userId);
    lastMap[userId] = replacement?.id || "";
    writeLastMap(lastMap);
  }
}

export function getActiveProjectId(userId) {
  const map = readLastMap();
  return typeof map[userId] === "string" ? map[userId] : "";
}

export function setActiveProjectId(userId, projectId) {
  const map = readLastMap();
  map[userId] = projectId || "";
  writeLastMap(map);
}
