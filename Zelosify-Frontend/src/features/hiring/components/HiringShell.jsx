"use client";
import Link from "next/link";
import { useTheme } from "next-themes";
import { BriefcaseBusiness, ArrowUpRight, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "../hiring.module.css";
export default function HiringShell({ persona, children }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <Link href={`/${persona}/openings`} className={styles.brand}>
          <span className={styles.logo}>z</span>zelosify
          <span className={styles.brandDivider} />
          <span className={styles.productName}>Contract hiring</span>
        </Link>
        <div className={styles.headerActions}>
          <span className={styles.persona}>
            {persona === "vendor" ? "Vendor workspace" : "Hiring workspace"}
          </span>
          <button
            className={styles.iconButton}
            aria-label="Toggle color theme"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {mounted && resolvedTheme === "dark" ? (
              <Sun size={18} />
            ) : (
              <Moon size={18} />
            )}
          </button>
        </div>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <span className={styles.eyebrow}>WORKSPACE</span>
          <Link href={`/${persona}/openings`} className={styles.activeNav}>
            <BriefcaseBusiness size={18} />
            Openings<span>↗</span>
          </Link>
          <div className={styles.sidebarBottom}>
            <div className={styles.sidebarNote}>
              <span className={styles.statusDot} />
              Secure workspace
              <p>
                {persona === "vendor"
                  ? "Your submissions are shared only with the opening’s hiring manager."
                  : "Recommendations support your review. You make the final hiring decision."}
              </p>
            </div>
            <Link href="/user">
              Back to dashboard <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
        <main className={styles.main}>
          {children}
          <footer className={styles.footer}>
            Zelosify · Contract hiring<span>Built for better teams</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
