import { useEffect, useMemo, useState } from "react";
import Landing from "./pages/Landing";
import Builder from "./pages/Builder";
import {
  createProject,
  deleteProject,
  getActiveProjectId,
  getProjectById,
  getProjectsForUser,
  getStoredUser,
  setActiveProjectId,
  setStoredUser,
} from "./lib/projects";

const STORAGE_MIGRATION_KEY = "jigrify_storage_migrated_v1";

function migrateLegacyStorageKeys() {
  if (typeof window === "undefined") return;

  try {
    if (localStorage.getItem(STORAGE_MIGRATION_KEY) === "1") {
      return;
    }

    const keys = Object.keys(localStorage);
    keys.forEach((oldKey) => {
      if (!oldKey.startsWith("aigb_")) return;

      const newKey = `jigrify_${oldKey.slice("aigb_".length)}`;
      if (localStorage.getItem(newKey) !== null) return;

      const oldValue = localStorage.getItem(oldKey);
      if (oldValue !== null) {
        localStorage.setItem(newKey, oldValue);
      }
    });

    localStorage.setItem(STORAGE_MIGRATION_KEY, "1");
  } catch {
    // Ignore migration issues and continue with fresh keys.
  }
}

function parseRoute(pathname) {
  const cleanPath = typeof pathname === "string" ? pathname : "/";
  const match = cleanPath.match(/^\/p\/([^/]+)$/);
  if (match) {
    return {
      name: "builder",
      projectId: decodeURIComponent(match[1]),
    };
  }
  return { name: "landing", projectId: "" };
}

function pathForRoute(routeName, projectId = "") {
  if (routeName === "builder" && projectId) {
    return `/p/${encodeURIComponent(projectId)}`;
  }
  return "/";
}

function createRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  migrateLegacyStorageKeys();

  const initialRoute = parseRoute(window.location.pathname);
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [routeState, setRouteState] = useState(initialRoute);
  const [buildRequest, setBuildRequest] = useState(null);
  const [projectsVersion, setProjectsVersion] = useState(0);
  const [lastProjectId, setLastProjectId] = useState(() => getActiveProjectId(getStoredUser().id));

  const projects = useMemo(
    () => getProjectsForUser(currentUser.id),
    [currentUser.id, projectsVersion],
  );

  useEffect(() => {
    setLastProjectId(getActiveProjectId(currentUser.id));
  }, [currentUser.id, projectsVersion]);

  useEffect(() => {
    const onPopState = () => {
      setRouteState(parseRoute(window.location.pathname));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  const refreshProjects = () => setProjectsVersion((v) => v + 1);

  const navigateTo = (routeName, projectId = "") => {
    const nextPath = pathForRoute(routeName, projectId);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setRouteState({ name: routeName, projectId: projectId || "" });
  };

  const setLastProject = (projectId) => {
    setActiveProjectId(currentUser.id, projectId || "");
    setLastProjectId(projectId || "");
  };

  const handleContinueAsGuest = () => {
    const guest = setStoredUser({});
    setCurrentUser(guest);
    navigateTo("landing");
  };

  const handleSignIn = ({ name, email }) => {
    const nextUser = setStoredUser({ name, email });
    setCurrentUser(nextUser);
    navigateTo("landing");
  };

  const handleCreateProject = ({
    name,
    prompt,
    provider,
    forceMode,
    templateId,
    requiredModules,
    autoRun = false,
  }) => {
    const normalizedPrompt = String(prompt || "").trim();
    const normalizedModules = Array.isArray(requiredModules) ? requiredModules : [];
    const pendingBuild = autoRun && normalizedPrompt
      ? {
          prompt: normalizedPrompt,
          templateId: templateId || "",
          mode: forceMode || "auto",
          modules: normalizedModules,
          provider: provider || "openai",
          runId: createRunId(),
          createdAt: Date.now(),
        }
      : null;

    const project = createProject({
      userId: currentUser.id,
      title: name || "Untitled",
      provider: provider || "openai",
      mode: forceMode || "auto",
      templateId: templateId || "",
      modules: normalizedModules,
      seedPrompt: normalizedPrompt,
      pendingBuild,
    });
    setLastProject(project.id);
    setBuildRequest(
      {
        id: Date.now(),
        projectId: project.id,
        provider: provider || project.provider,
        forceMode: forceMode || project.forceMode,
        templateId: templateId || project.templateId || "",
        requiredModules: normalizedModules,
        source: "new-project",
      },
    );
    navigateTo("builder", project.id);
  };

  const handleOpenProject = (projectId, request = null) => {
    const existing = getProjectById(currentUser.id, projectId);
    if (!existing) {
      navigateTo("landing");
      return;
    }
    setLastProject(projectId);
    setBuildRequest(request ? { ...request, id: Date.now(), projectId } : { id: Date.now(), projectId, source: "open-project" });
    navigateTo("builder", projectId);
  };

  const handleDeleteProject = (projectId) => {
    deleteProject(currentUser.id, projectId);
    refreshProjects();
    if (window.location.pathname === pathForRoute("builder", projectId)) {
      navigateTo("landing");
    }
  };

  useEffect(() => {
    if (routeState.name !== "builder") {
      return;
    }

    const exists = routeState.projectId ? getProjectById(currentUser.id, routeState.projectId) : null;
    if (!exists) {
      navigateTo("landing");
      return;
    }

    setLastProject(routeState.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState.name, routeState.projectId, currentUser.id, projectsVersion]);

  if (routeState.name === "builder") {
    return (
      <Builder
        user={currentUser}
        projectId={routeState.projectId}
        projects={projects}
        initialRequest={buildRequest}
        currentUser={currentUser}
        onSetActiveProject={handleOpenProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onProjectsChanged={refreshProjects}
        onBack={() => {
          navigateTo("landing");
        }}
      />
    );
  }

  return (
    <Landing
      user={currentUser}
      projects={projects}
      activeProjectId={lastProjectId}
      onContinueAsGuest={handleContinueAsGuest}
      onSignIn={handleSignIn}
      onCreateProject={handleCreateProject}
      onOpenProject={handleOpenProject}
      onDeleteProject={handleDeleteProject}
    />
  );
}
