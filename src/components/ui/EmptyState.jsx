import Button from "./Button";

export default function EmptyState({ title, subtitle, ctaLabel, onCta, ctaVariant = "primary", className = "" }) {
  return (
    <div className={`ui-empty ${className}`.trim()}>
      <h3>{title}</h3>
      {subtitle ? <p>{subtitle}</p> : null}
      {ctaLabel && onCta ? (
        <Button variant={ctaVariant} onClick={onCta}>
          {ctaLabel}
        </Button>
      ) : null}
    </div>
  );
}
