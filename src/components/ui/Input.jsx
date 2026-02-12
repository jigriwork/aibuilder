function cx(...items) {
  return items.filter(Boolean).join(" ");
}

export default function Input({ className = "", type = "text", ...props }) {
  return <input type={type} className={cx("ui-input", className)} {...props} />;
}
