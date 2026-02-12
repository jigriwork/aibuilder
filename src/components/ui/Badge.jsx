function cx(...items) {
  return items.filter(Boolean).join(" ");
}

export default function Badge({ variant = "muted", className = "", children }) {
  return <span className={cx("ui-badge", `ui-badge--${variant}`, className)}>{children}</span>;
}
