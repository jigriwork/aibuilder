import React from "react";
import Badge from "../ui/Badge";
import Card, { CardBody, CardHeader } from "../ui/Card";

const MODULE_TAGS = {
  "runtime.physics3d.runner": "Runner",
  "runtime.physics3d.driving": "Driving",
  "runtime.physics3d.shooter.simple": "Shooter",
  "runtime.physics3d.platformer": "Platformer",
  "runtime.board2d.ludo": "Ludo",
  "runtime.board2d.snake": "Snake",
};

function getTemplateTags(template) {
  const raw = Array.isArray(template?.requiredModules) ? template.requiredModules : [];
  const tags = raw
    .filter((mod) => !mod.endsWith(".base"))
    .map((mod) => MODULE_TAGS[mod] || "Extra features");
  return Array.from(new Set(tags)).slice(0, 3);
}

export default function TemplateGallery({
  templates,
  activeTemplate,
  selectedTemplateId,
  suggestedSelection,
  selectedMode,
  onSelectTemplate,
}) {
  return (
    <Card className="templates-gallery">
      <CardHeader className="templates-gallery-head">
        <h2>Templates Gallery</h2>
        <div className="template-head-meta">
          <p>
            Suggested <strong>{activeTemplate?.name || "Auto"}</strong>
          </p>
          <p>
            Selected <strong>{activeTemplate?.name || "None"}</strong>
            {activeTemplate?.mode || selectedMode ? ` (${activeTemplate?.mode || selectedMode})` : ""}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <div className="templates-grid">
          {templates.map((template) => {
            const isActive = (selectedTemplateId || suggestedSelection.templateId) === template.id;
            return (
              <button
                key={template.id}
                type="button"
                className={`template-card ${isActive ? "active" : ""}`}
                onClick={() => onSelectTemplate(template)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectTemplate(template);
                  }
                }}
              >
                <div className="template-card-top">
                  <strong>{template.name}</strong>
                  <Badge variant={template.mode === "board2d" ? "secondary" : "brand"}>{template.mode}</Badge>
                </div>
                <p className="template-description">{template.defaultSpec?.description || "Fast-start playable template"}</p>
                <div className="template-tags">
                  {getTemplateTags(template).map((tag) => (
                    <Badge key={`${template.id}-${tag}`} variant="muted">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="template-affordance">
                  {isActive ? <Badge variant="success">Selected</Badge> : <span>Select</span>}
                </div>
              </button>
            );
          })}
        </div>
        {suggestedSelection.limitationSummary ? (
          <p className="template-note">Capability note: {suggestedSelection.limitationSummary}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
