"use client";
import styles from "../hiring.module.css";
export function Badge({ children, tone = "neutral" }) {
  return (
    <span className={`${styles.badge} ${styles[tone] || ""}`}>{children}</span>
  );
}
export function ErrorNotice({ message, onRetry }) {
  return message ? (
    <div className={styles.error} role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className={styles.textButton} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  ) : null;
}
export function Skeleton() {
  return (
    <div
      className={styles.skeletons}
      role="status"
      aria-label="Loading openings"
    >
      {[1, 2, 3, 4].map((key) => (
        <div key={key} className={styles.skeleton} />
      ))}
    </div>
  );
}
export function EmptyState({ title, children }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>◇</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={styles.pagination}>
      <span>
        {total} {total === 1 ? "record" : "records"}
      </span>
      <label>
        Rows{" "}
        <select
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          {[20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ←
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          →
        </button>
      </div>
    </div>
  );
}
export function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "—";
}
