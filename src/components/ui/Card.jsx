function cx(...items) {
  return items.filter(Boolean).join(" ");
}

export default function Card({ className = "", children, ...props }) {
  return (
    <section className={cx("ui-card", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className = "", children, ...props }) {
  return (
    <header className={cx("ui-card__header", className)} {...props}>
      {children}
    </header>
  );
}

export function CardBody({ className = "", children, ...props }) {
  return (
    <div className={cx("ui-card__body", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className = "", children, ...props }) {
  return (
    <footer className={cx("ui-card__footer", className)} {...props}>
      {children}
    </footer>
  );
}
