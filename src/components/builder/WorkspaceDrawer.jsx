import React from "react";
import Button from "../ui/Button";
import Card, { CardBody } from "../ui/Card";
import ListRow from "../ui/ListRow";
import Input from "../ui/Input";

export default function WorkspaceDrawer({
  activeTab,
  projects,
  specHistory,
  historyCursor,
  provider,
  forceMode,
  openAiKeyInput,
  geminiKeyInput,
  settingsMessage,
  showAdvancedHistory,
  onCreateProject,
  onSetActiveProject,
  onDeleteProject,
  onUndo,
  onRedo,
  onToggleAdvancedHistory,
  setProvider,
  setForceMode,
  setOpenAiKeyInput,
  setGeminiKeyInput,
  onSaveSettings,
  onTestKey,
  resolvedTemplate,
  resolvedModules,
}) {
  if (!activeTab) return null;

  return (
    <Card className="workspace-drawer">
      <CardBody>
        {activeTab === "projects" ? (
          <div className="workspace-block">
            <div className="workspace-head">
              <h3>Projects</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCreateProject}
              >
                New
              </Button>
            </div>
            <div className="workspace-list">
              {projects.slice(0, 10).map((entry) => (
                <ListRow
                  key={entry.id}
                  title={entry.name || "Untitled"}
                  subtitle={new Date(entry.updatedAt).toLocaleString()}
                  actions={(
                    <>
                      <Button size="sm" variant="secondary" onClick={() => onSetActiveProject?.(entry.id)}>
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (window.confirm(`Delete project "${entry.name || "Untitled"}"?`)) {
                            onDeleteProject?.(entry.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                />
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div className="workspace-block compact">
            <div className="workspace-head">
              <h3>Version History</h3>
              <div className="inline-actions">
                <Button size="sm" variant="ghost" onClick={onUndo} disabled={historyCursor <= 0}>Undo</Button>
                <Button size="sm" variant="ghost" onClick={onRedo} disabled={historyCursor >= specHistory.length - 1}>Redo</Button>
              </div>
            </div>
            <p>Version: {Math.max(0, historyCursor + 1)} / {specHistory.length}</p>
            <p>Drafts are saved automatically as you build and refine.</p>
            <Button size="sm" variant="secondary" onClick={onToggleAdvancedHistory}>
              {showAdvancedHistory ? "Hide advanced" : "Show advanced"}
            </Button>
            {showAdvancedHistory ? (
              <div className="advanced-history">
                <p>Template: {resolvedTemplate?.name || "Auto"}</p>
                <p>Modules: {resolvedModules.join(", ") || "None"}</p>
                <p>Cursor: {Math.max(0, historyCursor + 1)}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "settings" ? (
          <div className="workspace-block compact">
            <h3>Settings</h3>
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
              <Input
                id="builder-key"
                type="password"
                value={provider === "gemini" ? geminiKeyInput : openAiKeyInput}
                onChange={(event) =>
                  provider === "gemini" ? setGeminiKeyInput(event.target.value) : setOpenAiKeyInput(event.target.value)
                }
              />

              <div className="settings-actions">
                <Button type="button" variant="secondary" onClick={onSaveSettings}>Save</Button>
                <Button type="button" variant="ghost" onClick={onTestKey}>Test Key</Button>
              </div>
              {settingsMessage ? <p className="settings-msg">{settingsMessage}</p> : null}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
