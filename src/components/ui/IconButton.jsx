function cx(...items) {
  return items.filter(Boolean).join(" ");
}

export default function IconButton({ className = "", active = false, children, ...props }) {
  return (
    <button type="button" className={cx("ui-icon-btn", active ? "is-active" : "", className)} {...props}>
      {children}
    </button>
  );
}
