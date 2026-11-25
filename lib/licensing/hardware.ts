import { getMachineId } from "./machine-id";

/**
 * Root-level hardware fingerprint entry point.
 *
 * The machine ID is derived exclusively from physical PC identifiers. Nothing
 * here reads shop profile fields, browser storage, or any persistence layer,
 * so renaming a store or changing its contact details can never move the ID.
 */
export function getMachineFingerprint(): string {
  return getMachineId();
}
