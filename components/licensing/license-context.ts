"use client";

import { createContext } from "react";
import type { LicenseStatus } from "@/lib/licensing/types";

export interface LicenseContextValue {
  status: LicenseStatus | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** mode="renew" only changes the success toast; both call the same API. */
  activate: (key: string, mode?: "activate" | "renew") => Promise<boolean>;
}

export const LicenseContext = createContext<LicenseContextValue>({
  status: null,
  loaded: false,
  refresh: async () => {},
  activate: async () => false,
});
