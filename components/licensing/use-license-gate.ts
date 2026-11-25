"use client";

import { useContext } from "react";
import { LicenseContext, type LicenseContextValue } from "./license-context";

/**
 * Activation-gate-only reader. Kept separate from the dashboard subscription
 * hook so a change to either UI surface stays inside its own execution flows.
 */
export function useLicenseGate(): LicenseContextValue {
  return useContext(LicenseContext);
}
