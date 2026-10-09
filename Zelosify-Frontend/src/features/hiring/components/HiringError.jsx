"use client";
import Link from "next/link";
import styles from "../hiring.module.css";
export default function HiringError({ reset }) {
  return (
    <div className={styles.workspace}>
      <div className={styles.empty} role="alert">
        <h2>Something interrupted your workspace.</h2>
        <p>Please retry. If your session expired, sign in again.</p>
        <button className={styles.primaryButton} onClick={reset}>
          Try again
        </button>{" "}
        <Link href="/login" className={styles.textButton}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
