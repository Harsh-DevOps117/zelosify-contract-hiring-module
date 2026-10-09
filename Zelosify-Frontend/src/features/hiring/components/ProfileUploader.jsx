"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, FileText, X, Check } from "lucide-react";
import { hiringApi, errorMessage } from "../api";
import { ErrorNotice } from "./Shared";
import styles from "../hiring.module.css";
const PDF = "application/pdf";
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export default function ProfileUploader({ openingId, onSubmitted }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const abort = useRef(null);
  const batch = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  const onDrop = useCallback((accepted, rejected) => {
    setError(
      rejected.length
        ? "Choose PDF or PPTX files up to 10 MB each, with a maximum of 10 files."
        : "",
    );
    setSuccess("");
    batch.current = null;
    setItems((current) =>
      [
        ...current,
        ...accepted.map((file) => ({
          file,
          id: crypto.randomUUID(),
          progress: 0,
          status: "Ready",
        })),
      ].slice(0, 10),
    );
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { [PDF]: [".pdf"], [PPTX]: [".pptx"] },
    maxSize: 10 * 1024 * 1024,
    maxFiles: 10,
    disabled: busy,
  });
  function update(id, data) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...data } : item)),
    );
  }
  async function submit() {
    setBusy(true);
    setError("");
    setSuccess("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const files = items.map((item) => ({
        fileName: item.file.name.replace(/\.(pdf|pptx)$/i, (match) =>
          match.toLowerCase(),
        ),
        size: item.file.size,
        contentType: item.file.name.toLowerCase().endsWith(".pdf") ? PDF : PPTX,
      }));
      if (!batch.current) {
        const { data } = await hiringApi.post(
          `/vendor/openings/${openingId}/profiles/presign`,
          { files },
          { signal: controller.signal },
        );
        batch.current = { uploads: data.uploads, completed: new Set() };
      }
      const data = batch.current;
      for (const [index, item] of items.entries()) {
        if (data.completed.has(item.id)) continue;
        update(item.id, { status: "Uploading", progress: 0 });
        try {
          await hiringApi.put(data.uploads[index].uploadPath, item.file, {
            headers: { "Content-Type": files[index].contentType },
            signal: controller.signal,
            timeout: 30000,
            onUploadProgress: (event) =>
              update(item.id, {
                progress: Math.round(
                  (100 * event.loaded) / (event.total || item.file.size),
                ),
              }),
          });
          data.completed.add(item.id);
          update(item.id, { status: "Uploaded", progress: 100 });
        } catch (failure) {
          update(item.id, { status: "Failed" });
          throw failure;
        }
      }
      await hiringApi.post(
        `/vendor/openings/${openingId}/profiles/upload`,
        { uploadIds: data.uploads.map((upload) => upload.id) },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        batch.current = null;
        setItems([]);
        setSuccess(
          `${items.length} ${items.length === 1 ? "profile" : "profiles"} submitted successfully.`,
        );
        onSubmitted();
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <h2>Submit candidate profiles</h2>
        <span className={styles.muted}>PDF & PPTX</span>
      </div>
      <div className={styles.uploadBody}>
        <div
          {...getRootProps({
            className: `${styles.dropzone} ${isDragActive ? styles.dragActive : ""}`,
            "aria-label": "Choose candidate profiles",
          })}
        >
          <input {...getInputProps()} />
          <div className={styles.uploadIcon}>
            <UploadCloud size={24} />
          </div>
          <strong>
            {isDragActive
              ? "Drop your profiles here"
              : "Drag and drop candidate profiles"}
          </strong>
          <p>
            or <span>browse files</span> from your device
          </p>
          <small>Up to 10 files · 10 MB per file</small>
        </div>
        {items.length > 0 && (
          <ul className={styles.fileQueue}>
            {items.map((item) => (
              <li key={item.id}>
                <FileText size={18} />
                <div>
                  <strong>{item.file.name}</strong>
                  <span>
                    {(item.file.size / 1024).toFixed(0)} KB · {item.status}
                    {item.status === "Uploading" ? ` ${item.progress}%` : ""}
                  </span>
                </div>
                {item.status === "Uploaded" ? (
                  <Check size={18} />
                ) : (
                  <button
                    className={styles.iconButton}
                    disabled={busy}
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => {
                      batch.current = null;
                      setItems((current) =>
                        current.filter((file) => file.id !== item.id),
                      );
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorNotice message={error} />
        {success && (
          <p className={styles.successMessage} role="status">
            {success}
          </p>
        )}
        <div className={styles.uploadFooter}>
          <span>Files are shared securely with the hiring manager.</span>
          <button
            className={styles.primaryButton}
            disabled={busy || !items.length}
            onClick={submit}
          >
            {busy
              ? "Submitting…"
              : `Submit ${items.length || ""} ${items.length === 1 ? "profile" : "profiles"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
