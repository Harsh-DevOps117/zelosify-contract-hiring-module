"use client";
import { useState } from "react";
import {
  FileText,
  ArrowUpRight,
  Check,
  X,
  Sparkles,
  Clock3,
  Trash2,
} from "lucide-react";
import { hiringApi, fileUrl, errorMessage } from "../api";
import { Badge, EmptyState, ErrorNotice, formatDate } from "./Shared";
import styles from "../hiring.module.css";
function recommendation(profile) {
  if (profile.recommendationStatus === "FAILED")
    return { label: "Review unavailable", tone: "negative" };
  if (profile.recommendationStatus !== "COMPLETED")
    return { label: "Processing", tone: "neutral" };
  const score = profile.recommendationScore;
  return score >= 0.75
    ? { label: "Recommended", tone: "positive" }
    : score >= 0.5
      ? { label: "Borderline", tone: "warning" }
      : { label: "Not recommended", tone: "negative" };
}
function ProfileCard({ profile, persona, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const manager = persona === "hiring-manager";
  const result = recommendation(profile);
  async function action(name) {
    setBusy(true);
    setError("");
    try {
      if (name === "delete")
        await hiringApi.delete(`/vendor/profiles/${profile.id}`);
      else
        await hiringApi.post(`/hiring-manager/profiles/${profile.id}/${name}`);
      onChange();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={`${styles.profileCard} ${manager ? styles.managerCard : ""}`}
    >
      <div className={styles.profileHeader}>
        <div className={styles.documentIcon}>
          <FileText size={22} />
        </div>
        <div className={styles.profileName}>
          <a
            href={fileUrl(persona, profile.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {profile.fileName}
            <ArrowUpRight size={14} />
          </a>
          <span>Submitted {formatDate(profile.submittedAt)}</span>
        </div>
        <Badge
          tone={
            profile.status === "SHORTLISTED"
              ? "positive"
              : profile.status === "REJECTED"
                ? "negative"
                : "neutral"
          }
        >
          {profile.status.toLowerCase()}
        </Badge>
      </div>
      {manager && (
        <div className={styles.recommendation}>
          <div className={styles.recommendationHeader}>
            <span>
              <Sparkles size={14} />
              AI assessment
            </span>
            <Badge tone={result.tone}>{result.label}</Badge>
          </div>
          {profile.recommendationStatus === "COMPLETED" ? (
            <>
              <div className={styles.scoreRow}>
                <div>
                  <strong>
                    {Math.round(profile.recommendationScore * 100)}
                    <small>%</small>
                  </strong>
                  <span>Match score</span>
                </div>
                <div>
                  <strong>
                    {Math.round(profile.recommendationConfidence * 100)}
                    <small>%</small>
                  </strong>
                  <span>Confidence</span>
                </div>
                <span className={styles.latency}>
                  <Clock3 size={13} />
                  {profile.recommendationLatencyMs} ms
                </span>
              </div>
              <p className={styles.reason} tabIndex={0}>
                {profile.recommendationReason}
              </p>
            </>
          ) : (
            <div className={styles.pending}>
              <p>
                {profile.recommendationStatus === "FAILED"
                  ? "The assessment could not be completed. You can review the document and decide, or retry."
                  : "The profile is queued for assessment. You can keep reviewing while it processes."}
              </p>
              {profile.recommendationStatus === "FAILED" && (
                <button
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() => action("recommend")}
                >
                  Retry assessment
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <ErrorNotice message={error} />
      <div className={styles.profileActions}>
        <a
          className={styles.textButton}
          href={fileUrl(persona, profile.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {profile.contentType === "application/pdf"
            ? "Preview profile"
            : "Download profile"}
          <ArrowUpRight size={14} />
        </a>
        {manager ? (
          <div>
            <button
              className={styles.secondaryButton}
              disabled={busy || profile.status === "REJECTED"}
              onClick={() => action("reject")}
            >
              <X size={15} />
              Reject
            </button>
            <button
              className={styles.primaryButton}
              disabled={busy || profile.status === "SHORTLISTED"}
              onClick={() => action("shortlist")}
            >
              <Check size={15} />
              Shortlist
            </button>
          </div>
        ) : confirmDelete ? (
          <div>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
            <button
              className={styles.dangerButton}
              disabled={busy}
              onClick={() => action("delete")}
            >
              Confirm removal
            </button>
          </div>
        ) : (
          <button
            className={styles.iconButton}
            aria-label={`Remove ${profile.fileName}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
export default function ProfileList({ profiles, persona, onChange }) {
  const [scrollTop, setScrollTop] = useState(0);
  if (!profiles.length)
    return (
      <EmptyState
        title={
          persona === "vendor"
            ? "Your candidates belong here."
            : "No profiles submitted yet."
        }
      >
        {persona === "vendor"
          ? "Upload a candidate profile to get started."
          : "Vendor submissions will appear here, together with their assessment."}
      </EmptyState>
    );
  if (profiles.length <= 50)
    return (
      <div className={styles.profileGrid}>
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            persona={persona}
            onChange={onChange}
          />
        ))}
      </div>
    );
  const rowHeight = persona === "hiring-manager" ? 380 : 188;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const end = Math.min(profiles.length, start + Math.ceil(720 / rowHeight) + 4);
  return (
    <div
      className={styles.virtualList}
      style={{ height: 720 }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="region"
      aria-label="Scrollable candidate profiles"
      tabIndex={0}
    >
      <div
        style={{ height: profiles.length * rowHeight, position: "relative" }}
      >
        {profiles.slice(start, end).map((profile, index) => (
          <div
            key={profile.id}
            style={{
              position: "absolute",
              top: (start + index) * rowHeight,
              height: rowHeight,
              left: 0,
              right: 0,
              paddingBottom: 16,
            }}
          >
            <ProfileCard
              profile={profile}
              persona={persona}
              onChange={onChange}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
