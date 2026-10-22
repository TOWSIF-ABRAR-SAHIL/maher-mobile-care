"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query. The first render uses `defaultValue` so the
 * server and client agree; the effect then switches to the real match.
 *
 * Callers that need the desktop table to be present immediately should keep
 * the default `true` (desktop-first). Mobile-first callers can pass `false`.
 */
export function useMediaQuery(query: string, defaultValue = true): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }

    // Safari < 14 fallback.
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, [query]);

  return matches;
}
