function cx(...items) {
  return items.filter(Boolean).join(" ");
}

export default function Button({
  as: Component = "button",
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  onClick,
  type,
  ...props
}) {
  const isDisabled = Boolean(disabled || loading);
  const resolvedType = Component === "button" ? type || "button" : type;
  const handleClick = (event) => {
    if (isDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <Component
      className={cx("ui-btn", `ui-btn--${variant}`, `ui-btn--${size}`, loading ? "is-loading" : "", className)}
      type={resolvedType}
      disabled={Component === "button" ? isDisabled : undefined}
      aria-disabled={Component === "button" ? undefined : isDisabled || undefined}
      aria-busy={loading || undefined}
      {...props}
      onClick={handleClick}
    >
      <span className="ui-btn__label">{children}</span>
    </Component>
  );
}
