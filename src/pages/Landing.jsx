import { useMemo, useState } from "react";
import { classifyPromptToTemplate, getPublicTemplates, getTemplateById } from "../lib/templates";
import Button from "../components/ui/Button";
import Card, { CardBody } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Toast from "../components/ui/Toast";
import AuthBar from "../components/landing/AuthBar";
import HeroSection from "../components/landing/HeroSection";
import TemplateGallery from "../components/landing/TemplateGallery";
import LandingSelectors from "../components/landing/LandingSelectors";
import ProjectList from "../components/landing/ProjectList";

import "./landing.css";

const TEMPLATE_ID_KEY = "aigb_selected_template_id";
const TEMPLATE_MODE_KEY = "aigb_selected_template_mode";
const TEMPLATE_MODULES_KEY = "aigb_selected_template_modules";

const SUGGESTIONS = [
  "A cozy 3D puzzle room with movable boxes",
  "A Ludo-style board game with turn-based moves",
  "A physics platform with ramps and bouncing balls",
];

const MODULE_TAGS = {
  "runtime.physics3d.runner": "Runner",
  "runtime.physics3d.driving": "Driving",
  "runtime.physics3d.shooter.simple": "Shooter",
  "runtime.physics3d.platformer": "Platformer",
  "runtime.board2d.ludo": "Ludo",
  "runtime.board2d.snake": "Snake",
};

function toRelativeTime(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts)) return "Updated recently";
  const delta = Math.max(0, Date.now() - ts);
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function getTemplateTags(template) {
  const raw = Array.isArray(template?.requiredModules) ? template.requiredModules : [];
  const tags = raw
    .filter((mod) => !mod.endsWith(".base"))
    .map((mod) => MODULE_TAGS[mod] || "Extra features");
  return Array.from(new Set(tags)).slice(0, 3);
}

export default function Landing({
  user,
  projects,
  activeProjectId,
  onContinueAsGuest,
  onSignIn,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
}) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("openai");
  const [modePreference, setModePreference] = useState("auto");
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => localStorage.getItem(TEMPLATE_ID_KEY) || "");
  const [selectedMode, setSelectedMode] = useState(() => localStorage.getItem(TEMPLATE_MODE_KEY) || "auto");
  const [selectedModules, setSelectedModules] = useState(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_MODULES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [lastTemplateHint, setLastTemplateHint] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [buildPulse, setBuildPulse] = useState(false);

  const recentProjects = useMemo(() => projects.slice(0, 10), [projects]);
  const templates = useMemo(() => getPublicTemplates(), []);

  const suggestedSelection = useMemo(
    () =>
      classifyPromptToTemplate({
        prompt,
        forceMode: modePreference,
        preferredTemplateId: selectedTemplateId,
      }),
    [prompt, modePreference, selectedTemplateId],
  );

  const activeTemplate = getTemplateById(selectedTemplateId || suggestedSelection.templateId);

  const selectTemplate = (template) => {
    const nextHint = template?.promptHints?.[0] || "";
    const currentPrompt = String(prompt || "").trim();
    const shouldAutofill = !currentPrompt || currentPrompt === lastTemplateHint;

    setSelectedTemplateId(template.id);
    setModePreference(template.mode);
    setSelectedMode(template.mode);
    setSelectedModules(Array.isArray(template.requiredModules) ? template.requiredModules : []);

    if (shouldAutofill && nextHint) {
      setPrompt(nextHint);
      setLastTemplateHint(nextHint);
    }

    localStorage.setItem(TEMPLATE_ID_KEY, template.id);
    localStorage.setItem(TEMPLATE_MODE_KEY, template.mode);
    localStorage.setItem(TEMPLATE_MODULES_KEY, JSON.stringify(template.requiredModules || []));
    setToastMessage(`Template selected: ${template.name}`);
    setBuildPulse(true);
    setTimeout(() => setBuildPulse(false), 950);
  };

  const handleNext = (autoRun = true) => {
    if (!prompt.trim()) return;

    const hasExplicitTemplate = Boolean(selectedTemplateId);
    const chosenTemplate = hasExplicitTemplate ? getTemplateById(selectedTemplateId) : null;
    const effectiveForceMode = chosenTemplate?.mode || selectedMode || modePreference || "auto";
    const requiredModules = hasExplicitTemplate
      ? (selectedModules.length > 0 ? selectedModules : chosenTemplate?.requiredModules || [])
      : [];

    onCreateProject?.({
      name: prompt.trim().slice(0, 42) || "Untitled",
      prompt: prompt.trim(),
      provider,
      forceMode: effectiveForceMode,
      templateId: hasExplicitTemplate ? selectedTemplateId : "",
      requiredModules,
      autoRun,
    });
  };

  const handleOpenActive = () => {
    if (!activeProjectId) {
      setAuthMessage("No project yet. Create a new project first.");
      return;
    }
    onOpenProject?.(activeProjectId);
  };

  const handleSignInSubmit = () => {
    if (!emailInput.trim()) {
      setAuthMessage("Enter an email to sign in.");
      return;
    }
    onSignIn?.({
      name: nameInput.trim() || emailInput.trim().split("@")[0],
      email: emailInput.trim(),
    });
    setShowSignIn(false);
    setAuthMessage("Signed in locally.");
  };

    return (
    <div className="landing-shell">
      <div className="landing-core">
        <AuthBar
          user={user}
          showSignIn={showSignIn}
          authMessage={authMessage}
          nameInput={nameInput}
          emailInput={emailInput}
          setNameInput={setNameInput}
          setEmailInput={setEmailInput}
          onContinueAsGuest={onContinueAsGuest}
          onSignInToggle={() => setShowSignIn((v) => !v)}
          onSignInSubmit={handleSignInSubmit}
        />

        <HeroSection
          prompt={prompt}
          setPrompt={setPrompt}
          buildPulse={buildPulse}
          onBuild={() => handleNext(true)}
          suggestions={SUGGESTIONS}
        />

        <TemplateGallery
          templates={templates}
          activeTemplate={activeTemplate}
          selectedTemplateId={selectedTemplateId || suggestedSelection.templateId}
          suggestedSelection={suggestedSelection}
          selectedMode={selectedMode}
          onSelectTemplate={selectTemplate}
        />

        <LandingSelectors
          modePreference={modePreference}
          setModePreference={setModePreference}
          setSelectedMode={setSelectedMode}
          activeTemplate={activeTemplate}
          provider={provider}
          setProvider={setProvider}
          physicsEnabled={physicsEnabled}
          setPhysicsEnabled={setPhysicsEnabled}
        />

        <div className="landing-bottom-actions">
          <Button
            variant="secondary"
            onClick={() =>
              onCreateProject?.({
                name: "Untitled",
                provider,
                forceMode: activeTemplate?.mode || modePreference,
                templateId: selectedTemplateId || "",
                requiredModules: selectedTemplateId
                  ? (selectedModules.length > 0 ? selectedModules : activeTemplate?.requiredModules || [])
                  : [],
                autoRun: false,
              })
            }
          >
            New Project
          </Button>
          {activeProjectId ? (
            <Button variant="ghost" onClick={handleOpenActive}>
              Continue last project
            </Button>
          ) : null}
        </div>

        <ProjectList
          recentProjects={recentProjects}
          onOpenProject={onOpenProject}
          onDeleteProject={onDeleteProject}
        />
      </div>

      <Toast open={Boolean(toastMessage)} message={toastMessage} onDone={() => setToastMessage("")} />
    </div>
  );
}
