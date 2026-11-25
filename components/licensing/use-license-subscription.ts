"use client";

import { useContext } from "react";
import { LicenseContext, type LicenseContextValue } from "./license-context";

/**
 * Dashboard-card-only reader. The renewal card can evolve without putting the
 * root-level activation gate into the same blast radius.
 */
export function useLicenseSubscription(): LicenseContextValue {
  return useContext(LicenseContext);
}
