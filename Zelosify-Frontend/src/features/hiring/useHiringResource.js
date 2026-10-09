"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { hiringApi, errorMessage } from "./api";
export function useHiringResource(path, poll = false) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const previousPath = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    if (previousPath.current !== path) {
      setData(null);
      setLoading(true);
      previousPath.current = path;
    }
    async function load() {
      try {
        const response = await hiringApi.get(path, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setData(response.data);
        setError("");
        const profiles =
          response.data.profiles?.items || response.data.items || [];
        if (
          poll &&
          profiles.some((profile) =>
            ["PENDING", "PROCESSING"].includes(profile.recommendationStatus),
          )
        )
          timer = setTimeout(load, 2500);
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, poll, revision]);
  return { data, loading, error, refresh };
}
