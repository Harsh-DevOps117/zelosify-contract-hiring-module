"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  MapPin,
  CalendarDays,
  BriefcaseBusiness,
  UserRound,
} from "lucide-react";
import { useHiringResource } from "../useHiringResource";
import ProfileUploader from "./ProfileUploader";
import ProfileList from "./ProfileList";
import { Badge, ErrorNotice, Pagination, Skeleton, formatDate } from "./Shared";
import styles from "../hiring.module.css";
export default function OpeningDetail({ persona, openingId }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const {
    data: opening,
    loading,
    error,
    refresh,
  } = useHiringResource(
    `/${persona}/openings/${openingId}?page=${page}&pageSize=${pageSize}`,
    persona === "hiring-manager",
  );
  return (
    <>
      <Link className={styles.backLink} href={`/${persona}/openings`}>
        <ArrowLeft size={16} />
        All openings
      </Link>
      <ErrorNotice message={error} onRetry={refresh} />
      {loading ? (
        <Skeleton />
      ) : (
        opening && (
          <>
            <div className={styles.detailHeading}>
              <Badge tone={opening.status === "OPEN" ? "positive" : "neutral"}>
                {opening.status.replaceAll("_", " ")}
              </Badge>
              <h1>{opening.title}</h1>
              <div className={styles.detailMeta}>
                <span>
                  <MapPin size={16} />
                  {opening.location || "Location not specified"}
                </span>
                <span>
                  <BriefcaseBusiness size={16} />
                  {opening.contractType || "Contract"}
                </span>
                <span>
                  <UserRound size={16} />
                  {opening.experienceMin}–{opening.experienceMax ?? "∞"} years
                </span>
                <span>
                  <CalendarDays size={16} />
                  Posted {formatDate(opening.postedDate)}
                </span>
              </div>
            </div>
            <section className={styles.openingSummary}>
              <div>
                <h2>About this opening</h2>
                <p>{opening.description || "No description provided."}</p>
                <div className={styles.skills}>
                  {opening.requiredSkills.map((skill) => (
                    <Badge key={skill}>{skill}</Badge>
                  ))}
                </div>
              </div>
              <aside>
                <span>HIRING MANAGER</span>
                <strong>{opening.hiringManagerName}</strong>
                <span>TARGET COMPLETION</span>
                <strong>{formatDate(opening.expectedCompletionDate)}</strong>
              </aside>
            </section>
            {persona === "vendor" &&
              (opening.status === "OPEN" ? (
                <ProfileUploader
                  openingId={opening.id}
                  onSubmitted={() => {
                    setPage(1);
                    refresh();
                  }}
                />
              ) : (
                <div className={styles.info}>
                  This opening is not accepting new submissions.
                </div>
              ))}
            <section className={styles.profilesSection}>
              <div className={styles.sectionHeader}>
                <h2>
                  {persona === "vendor"
                    ? "Your submitted profiles"
                    : "Candidate profiles"}
                  <span className={styles.count}>{opening.profilesCount}</span>
                </h2>
                <span className={styles.muted}>
                  {persona === "hiring-manager"
                    ? "AI assisted. Human decided."
                    : "Visible only to you and the hiring manager"}
                </span>
              </div>
              <ProfileList
                key={`${page}-${pageSize}`}
                profiles={opening.profiles.items}
                persona={persona}
                onChange={refresh}
              />
              <Pagination
                page={page}
                pageSize={pageSize}
                total={opening.profiles.total}
                onPage={setPage}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </section>
          </>
        )
      )}
    </>
  );
}
