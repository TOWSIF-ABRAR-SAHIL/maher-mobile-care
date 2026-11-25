import { createPublicKey, verify as verifySignature } from "node:crypto";
import { LICENSE_PUBLIC_KEY_PEM } from "./public-key";
import { isValidMachineId } from "./machine-id";
import type { LicensePayload, LicenseType } from "./types";

/** Server-side Ed25519 verification. The private key never exists here. */
export const LICENSE_TOKEN_PREFIX = "MHR-KEY-";
const VALID_TYPES = new Set<LicenseType>([
  "TRIAL",
  "30_DAYS", // admin alias for a 30-day trial extension
  "1_YEAR",
  "2_YEARS",
  "3_YEARS",
  "LIFETIME",
  "ANNUAL", // legacy alias, still honoured for keys issued before v1.3
]);
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export type VerifyReason =
  | "FORMAT"
  | "SIGNATURE"
  | "MACHINE"
  | "EXPIRED"
  | "TYPE";

export interface VerificationResult {
  ok: boolean;
  reason?: VerifyReason;
  payload?: LicensePayload;
}

interface VerifyOptions {
  /** Machine the token must be bound to. Omit only for offline unit checks. */
  machineId?: string;
  now?: number;
  publicKeyPem?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePayload(value: unknown): LicensePayload | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const { machineId, shopName, type, issuedAt, expiresAt } = raw;
  if (typeof machineId !== "string" || !isValidMachineId(machineId)) return null;
  if (typeof shopName !== "string" || shopName.trim().length === 0) return null;
  if (typeof type !== "string" || !VALID_TYPES.has(type as LicenseType)) return null;
  if (typeof issuedAt !== "string" || !Number.isFinite(Date.parse(issuedAt))) return null;
  if (expiresAt !== null && typeof expiresAt !== "string") return null;
  if (typeof expiresAt === "string" && !Number.isFinite(Date.parse(expiresAt))) return null;
  return {
    machineId: machineId.trim().toUpperCase(),
    shopName: shopName.trim(),
    type: type as LicenseType,
    issuedAt,
    expiresAt,
  };
}

/**
 * MHR-KEY-<base64url(JSON payload)>.<base64url(64-byte Ed25519 signature)>
 * The signature covers the exact ASCII bytes of the payload segment, so JSON
 * key ordering can never change verification semantics.
 */
export function verifyLicenseToken(
  token: string,
  options: VerifyOptions = {}
): VerificationResult {
  const raw = String(token ?? "").trim();
  // The prefix is case-insensitive for typists; the signed body never is.
  if (!raw.toUpperCase().startsWith(LICENSE_TOKEN_PREFIX)) {
    return { ok: false, reason: "FORMAT" };
  }
  const body = raw.slice(LICENSE_TOKEN_PREFIX.length);
  const dot = body.lastIndexOf(".");
  if (dot <= 0 || dot === body.length - 1) return { ok: false, reason: "FORMAT" };

  const payloadPart = body.slice(0, dot);
  const signaturePart = body.slice(dot + 1);
  if (!BASE64URL_RE.test(payloadPart) || !BASE64URL_RE.test(signaturePart)) {
    return { ok: false, reason: "FORMAT" };
  }

  let payload: LicensePayload | null = null;
  let signature: Buffer | null = null;
  try {
    payload = parsePayload(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")));
    signature = Buffer.from(signaturePart, "base64url");
  } catch {
    return { ok: false, reason: "FORMAT" };
  }
  if (!payload || !signature || signature.length !== 64) {
    return { ok: false, reason: "FORMAT" };
  }

  let key;
  try {
    key = createPublicKey(options.publicKeyPem ?? LICENSE_PUBLIC_KEY_PEM);
  } catch {
    return { ok: false, reason: "FORMAT" };
  }
  if (!verifySignature(null, Buffer.from(payloadPart, "utf8"), key, signature)) {
    return { ok: false, reason: "SIGNATURE" };
  }

  if (options.machineId && payload.machineId !== options.machineId.trim().toUpperCase()) {
    return { ok: false, reason: "MACHINE", payload };
  }
  if (payload.type === "LIFETIME") {
    if (payload.expiresAt !== null) return { ok: false, reason: "TYPE", payload };
  } else if (!payload.expiresAt) {
    return { ok: false, reason: "TYPE", payload };
  } else if (Date.parse(payload.expiresAt) <= (options.now ?? Date.now())) {
    return { ok: false, reason: "EXPIRED", payload };
  }
  return { ok: true, payload };
}

export const LICENSE_ERROR_MESSAGES: Record<VerifyReason, string> = {
  FORMAT: "লাইসেন্স কি সঠিক ফরম্যাটে নয়।",
  SIGNATURE: "লাইসেন্স কির স্বাক্ষর বৈধ নয়।",
  MACHINE: "এই লাইসেন্স কি অন্য মেশিনের জন্য।",
  EXPIRED: "লাইসেন্স কির মেয়াদ শেষ হয়ে গেছে।",
  TYPE: "লাইসেন্স কির ধরন স্বীকৃত নয়।",
};
