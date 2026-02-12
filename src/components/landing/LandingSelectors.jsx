import React from "react";
import Card, { CardBody } from "../ui/Card";

export default function LandingSelectors({
  modePreference,
  setModePreference,
  setSelectedMode,
  activeTemplate,
  provider,
  setProvider,
  physicsEnabled,
  setPhysicsEnabled,
}) {
  return (
    <section className="landing-selectors" aria-label="Build settings">
      <Card className="selector-item">
        <CardBody>
          <label htmlFor="framework-select">Framework</label>
          <select
            id="framework-select"
            value={activeTemplate?.mode || modePreference}
            onChange={(event) => {
              setModePreference(event.target.value);
              setSelectedMode(event.target.value);
            }}
          >
            <option value="auto">Auto</option>
            <option value="physics3d">3D Physics</option>
            <option value="board2d">Board Game</option>
          </select>
        </CardBody>
      </Card>

      <Card className="selector-item">
        <CardBody>
          <label htmlFor="provider-select">Provider</label>
          <select id="provider-select" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </CardBody>
      </Card>

      <Card className="selector-item toggle-item">
        <CardBody>
          <label htmlFor="physics-toggle">Physics</label>
          <label className="switch" htmlFor="physics-toggle">
            <input
              id="physics-toggle"
              type="checkbox"
              checked={physicsEnabled}
              onChange={(event) => setPhysicsEnabled(event.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </CardBody>
      </Card>
    </section>
  );
}
