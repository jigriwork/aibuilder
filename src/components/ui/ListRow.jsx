function cx(...items) {
  return items.filter(Boolean).join(" ");
}

export default function ListRow({ className = "", title, subtitle, left, actions }) {
  return (
    <div className={cx("ui-list-row", className)}>
      <div className="ui-list-row__left">
        {left || (
          <>
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </>
        )}
      </div>
      {actions ? <div className="ui-list-row__actions">{actions}</div> : null}
    </div>
  );
}
