const USER_KEY = "jigrify_user";
const PROJECTS_KEY = "jigrify_projects";
const ACTIVE_PROJECT_KEY = "jigrify_active_project_id";

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

function readAllProjects() {
  const list = safeParse(localStorage.getItem(PROJECTS_KEY), []);
  return Array.isArray(list) ? list : [];
}

function writeAllProjects(projects) {
  persistJson(PROJECTS_KEY, projects);
}

function readActiveMap() {
  const value = safeParse(localStorage.getItem(ACTIVE_PROJECT_KEY), {});
  return value && typeof value === "object" ? value : {};
}

function writeActiveMap(map) {
  persistJson(ACTIVE_PROJECT_KEY, map);
}

export function getProjectsForUser(userId) {
  return readAllProjects()
    .filter((project) => project?.userId === userId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export function getProjectById(userId, projectId) {
  return getProjectsForUser(userId).find((project) => project.id === projectId) || null;
}

export function createProject({
  userId,
  name = "Untitled",
  provider = "openai",
  forceMode = "auto",
  templateId = "",
  requiredModules = [],
}) {
  const now = Date.now();
  const project = {
    id: createId("project"),
    userId,
    name: name.trim() || "Untitled",
    createdAt: now,
    updatedAt: now,
    provider,
    forceMode,
    templateId,
    requiredModules: Array.isArray(requiredModules) ? requiredModules : [],
    messages: [],
    specHistory: [],
    specCursor: -1,
  };

  const allProjects = readAllProjects();
  writeAllProjects([project, ...allProjects]);
  setActiveProjectId(userId, project.id);
  return project;
}

export function upsertProject(updatedProject) {
  if (!updatedProject?.id) return null;
  const allProjects = readAllProjects();
  const now = Date.now();
  const nextProject = {
    ...updatedProject,
    updatedAt: now,
  };

  const index = allProjects.findIndex((project) => project.id === nextProject.id);
  if (index >= 0) {
    allProjects[index] = nextProject;
  } else {
    allProjects.unshift(nextProject);
  }
  writeAllProjects(allProjects);
  return nextProject;
}

export function deleteProject(userId, projectId) {
  const nextProjects = readAllProjects().filter((project) => project.id !== projectId);
  writeAllProjects(nextProjects);

  const activeMap = readActiveMap();
  if (activeMap[userId] === projectId) {
    const replacement = nextProjects.find((project) => project.userId === userId);
    activeMap[userId] = replacement?.id || "";
    writeActiveMap(activeMap);
  }
}

export function getActiveProjectId(userId) {
  const map = readActiveMap();
  return typeof map[userId] === "string" ? map[userId] : "";
}

export function setActiveProjectId(userId, projectId) {
  const map = readActiveMap();
  map[userId] = projectId || "";
  writeActiveMap(map);
}
