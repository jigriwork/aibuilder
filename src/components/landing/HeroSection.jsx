import React from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";

export default function HeroSection({
  prompt,
  setPrompt,
  buildPulse,
  onBuild,
  suggestions,
}) {
  return (
    <section className="hero-block">
      <p className="landing-kicker">AI game builder from India</p>
      <h1>What do you want to build?</h1>
      <div className="landing-input-wrap">
        <Input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe your game idea..."
          aria-label="Build prompt"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onBuild();
            }
          }}
        />
        <Button
          type="button"
          className={buildPulse ? "btn-pulse-once" : ""}
          onClick={onBuild}
        >
          Build
        </Button>
      </div>

      <div className="landing-suggestions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion-pill"
            onClick={() => setPrompt(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
