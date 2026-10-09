"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, MapPin, BriefcaseBusiness } from "lucide-react";
import { useHiringResource } from "../useHiringResource";
import {
  Badge,
  EmptyState,
  ErrorNotice,
  Pagination,
  Skeleton,
  formatDate,
} from "./Shared";
import styles from "../hiring.module.css";
export default function OpeningList({ persona }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, loading, error, refresh } = useHiringResource(
    `/${persona}/openings?page=${page}&pageSize=${pageSize}`,
  );
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>CONTRACT OPPORTUNITIES</span>
          <h1>
            {persona === "vendor"
              ? "Find your next placement."
              : "Build your next great team."}
          </h1>
          <p>
            {persona === "vendor"
              ? "Explore openings and connect the right people with the right work."
              : "Review your openings, evaluate candidates, and move great people forward."}
          </p>
        </div>
        <div className={styles.headingIcon}>
          <BriefcaseBusiness size={30} />
        </div>
      </div>
      <div className={styles.summary}>
        <div>
          <span className={styles.statusDot} />
          <strong>{data?.total ?? "—"}</strong>
          <span>
            {persona === "vendor" ? "available openings" : "assigned openings"}
          </span>
        </div>
        <span>One workspace. Every opportunity.</span>
      </div>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <h2>{persona === "vendor" ? "All openings" : "Your openings"}</h2>
          <span className={styles.muted}>Latest posted first</span>
        </div>
        <ErrorNotice message={error} onRetry={refresh} />
        {loading ? (
          <Skeleton />
        ) : !data?.items?.length ? (
          !error && (
            <EmptyState title="No openings yet">
              New contract openings will appear here.
            </EmptyState>
          )
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>ROLE / OPENING</th>
                    <th>LOCATION</th>
                    <th>CONTRACT</th>
                    <th>POSTED</th>
                    <th>HIRING MANAGER</th>
                    <th>
                      <span className={styles.srOnly}>Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((opening) => (
                    <tr key={opening.id}>
                      <td>
                        <Link
                          className={styles.roleLink}
                          href={`/${persona}/openings/${opening.id}`}
                        >
                          {opening.title}
                        </Link>
                        <div className={styles.rowMeta}>
                          {opening.experienceMin}–{opening.experienceMax ?? "∞"}{" "}
                          years experience{" "}
                          <Badge
                            tone={
                              opening.status === "OPEN" ? "positive" : "neutral"
                            }
                          >
                            {opening.status.replaceAll("_", " ")}
                          </Badge>
                        </div>
                      </td>
                      <td>
                        <span className={styles.inlineIcon}>
                          <MapPin size={14} />
                          {opening.location || "Not specified"}
                        </span>
                      </td>
                      <td>{opening.contractType || "—"}</td>
                      <td>{formatDate(opening.postedDate)}</td>
                      <td>{opening.hiringManagerName}</td>
                      <td>
                        <Link
                          className={styles.iconButton}
                          aria-label={`View ${opening.title}`}
                          href={`/${persona}/openings/${opening.id}`}
                        >
                          <ArrowUpRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </section>
    </>
  );
}
