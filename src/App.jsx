import { useEffect, useMemo, useState } from "react";
import Landing from "./pages/Landing";
import Builder from "./pages/Builder";
import {
  createProject,
  deleteProject,
  getActiveProjectId,
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

export default function App() {
  migrateLegacyStorageKeys();

  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [route, setRoute] = useState("landing");
  const [activeProjectId, setActiveProjectIdState] = useState(() => getActiveProjectId(getStoredUser().id));
  const [buildRequest, setBuildRequest] = useState(null);
  const [projectsVersion, setProjectsVersion] = useState(0);

  const projects = useMemo(
    () => getProjectsForUser(currentUser.id),
    [currentUser.id, projectsVersion],
  );

  useEffect(() => {
    const nextActive = getActiveProjectId(currentUser.id);
    setActiveProjectIdState(nextActive);
  }, [currentUser.id, projectsVersion]);

  const refreshProjects = () => setProjectsVersion((v) => v + 1);

  const setActiveProject = (projectId) => {
    setActiveProjectId(currentUser.id, projectId);
    setActiveProjectIdState(projectId);
    refreshProjects();
  };

  const handleContinueAsGuest = () => {
    const guest = setStoredUser({});
    setCurrentUser(guest);
    setRoute("landing");
  };

  const handleSignIn = ({ name, email }) => {
    const nextUser = setStoredUser({ name, email });
    setCurrentUser(nextUser);
    setRoute("landing");
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
    const project = createProject({
      userId: currentUser.id,
      name: name || "Untitled",
      provider: provider || "openai",
      forceMode: forceMode || "auto",
      templateId: templateId || "",
      requiredModules: Array.isArray(requiredModules) ? requiredModules : [],
    });
    setActiveProject(project.id);
    setBuildRequest(
      autoRun && prompt
        ? {
            id: Date.now(),
            projectId: project.id,
            prompt,
            provider: provider || project.provider,
            forceMode: forceMode || project.forceMode,
            templateId: templateId || project.templateId || "",
            requiredModules:
              Array.isArray(requiredModules) && requiredModules.length > 0
                ? requiredModules
                : project.requiredModules || [],
            mode: "generate",
            source: "new-project",
          }
        : { id: Date.now(), projectId: project.id, source: "new-project" },
    );
    setRoute("builder");
  };

  const handleOpenProject = (projectId, request = null) => {
    setActiveProject(projectId);
    setBuildRequest(request ? { ...request, id: Date.now(), projectId } : { id: Date.now(), projectId, source: "open-project" });
    setRoute("builder");
  };

  const handleDeleteProject = (projectId) => {
    deleteProject(currentUser.id, projectId);
    refreshProjects();
  };

  if (route === "builder") {
    return (
      <Builder
        user={currentUser}
        activeProjectId={activeProjectId}
        projects={projects}
        initialRequest={buildRequest}
        currentUser={currentUser}
        onSetActiveProject={handleOpenProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onProjectsChanged={refreshProjects}
        onBack={() => {
          setRoute("landing");
        }}
      />
    );
  }

  return (
    <Landing
      user={currentUser}
      projects={projects}
      activeProjectId={activeProjectId}
      onContinueAsGuest={handleContinueAsGuest}
      onSignIn={handleSignIn}
      onCreateProject={handleCreateProject}
      onOpenProject={handleOpenProject}
      onDeleteProject={handleDeleteProject}
    />
  );
}
