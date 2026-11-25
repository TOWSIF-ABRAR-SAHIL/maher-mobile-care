import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";

/**
 * Deterministic hardware fingerprint for one installed PC.
 *
 * No network, no DB, no writable state: the same machine always hashes to the
 * same MHR-XXXX-XXXX-XXXX-XXXX string, even after a reboot, app update or a
 * full database restore. MAHER_MACHINE_ID is a CI/test override only.
 */
const MACHINE_ID_RE = /^MHR-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;
const PLACEHOLDER_RE =
  /^(none|n\/a|na|null|unknown|default|to be filled by o\.e\.m\.|0{4,})$/i;

type RunOptions = { timeout?: number };

function runLines(command: string, args: string[] = [], options: RunOptions = {}): string[] {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      timeout: options.timeout ?? 2500,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function runText(command: string, args: string[] = [], options: RunOptions = {}): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: options.timeout ?? 2500,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function clean(value: string | undefined | null): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!text || PLACEHOLDER_RE.test(text)) return "";
  return text;
}

function wmicValue(command: string, args: string[], header: string): string {
  const lines = runLines(command, args);
  const at = lines.findIndex((line) => line.toUpperCase() === header.toUpperCase());
  return clean(at >= 0 ? lines[at + 1] : lines[0]);
}

const CIM_MARKER = "__MAHER_CIM__";

/**
 * Read every hardware value in ONE PowerShell process. The legacy fallback
 * wrapped `try` in parentheses (`(try { ... } catch { '' })`), which PowerShell
 * always rejects with exit 1, and spawned four separate processes.
 *
 * `$()` is a real statement wrapper, so the generated script is valid PowerShell.
 * `-Property` keeps each CIM call to the single column we need: four reads in
 * one process take ~350ms instead of ~1.4s for full instances.
 */
function powershellValues(expressions: string[]): string[] {
  const script = expressions
    .map(
      (expression, index) =>
        `Write-Output ('${CIM_MARKER}${index}=' + $(try { ${expression} } catch { '' }))`
    )
    .join("; ");
  const output = runText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 6000,
  });
  const values = Array.from({ length: expressions.length }, () => "");
  const marker = new RegExp(`^${CIM_MARKER}(\\d+)=(.*)$`);
  for (const line of output.split(/\r?\n/)) {
    const match = marker.exec(line.trim());
    if (match && Number(match[1]) < values.length) {
      values[Number(match[1])] = match[2] ?? "";
    }
  }
  return values.map(clean);
}

function readStableFile(file: string): string {
  try {
    return clean(readFileSync(file, "utf8").split(/\r?\n/)[0]);
  } catch {
    return "";
  }
}

function windowsParts(): string[] {
  // Physical hardware lock: motherboard UUID, baseboard serial, CPU ID, BIOS
  // serial. CIM is the primary source on modern Windows (wmic is removed).
  const cimParts = powershellValues([
    "(Get-CimInstance Win32_ComputerSystemProduct -Property UUID).UUID",
    "(Get-CimInstance Win32_BaseBoard -Property SerialNumber).SerialNumber",
    "(Get-CimInstance Win32_Processor -Property ProcessorId | Select-Object -First 1).ProcessorId",
    "(Get-CimInstance Win32_BIOS -Property SerialNumber).SerialNumber",
  ]);
  if (cimParts.some(Boolean)) return cimParts;

  // Older machines without CIM: keep the legacy wmic path.
  return [
    wmicValue("wmic", ["csproduct", "get", "uuid"], "UUID"),
    wmicValue("wmic", ["baseboard", "get", "serialnumber"], "SerialNumber"),
    wmicValue("wmic", ["cpu", "get", "processorid"], "ProcessorId"),
    wmicValue("wmic", ["bios", "get", "serialnumber"], "SerialNumber"),
  ];
}

function linuxParts(): string[] {
  let cpu = "";
  try {
    cpu = clean(readFileSync("/proc/cpuinfo", "utf8").match(/^processor\s*:\s*(.+)$/m)?.[1]);
  } catch {
    cpu = "";
  }
  return [
    readStableFile("/etc/machine-id"),
    readStableFile("/var/lib/dbus/machine-id"),
    readStableFile("/sys/class/dmi/id/product_uuid"),
    readStableFile("/sys/class/dmi/id/board_serial"),
    cpu,
    clean(runLines("lsblk", ["-n", "-o", "SERIAL"])[0]),
  ];
}

function macParts(): string[] {
  const ioreg = runText("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  return [
    clean(ioreg.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1]),
    clean(runText("sysctl", ["-n", "machdep.cpu.brand_string"])),
    clean(ioreg.match(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/)?.[1]),
  ];
}

function fallbackParts(): string[] {
  return [clean(os.hostname()), clean(os.platform()), clean(os.arch())];
}

export function isValidMachineId(value: string): boolean {
  return MACHINE_ID_RE.test(String(value ?? "").trim().toUpperCase());
}

export function computeMachineId(): string {
  const override = String(process.env.MAHER_MACHINE_ID ?? "").trim().toUpperCase();
  if (override && MACHINE_ID_RE.test(override)) return override;

  let sources: string[];
  if (process.platform === "win32") {
    // Windows exposes the best identifiers through WMI/CIM; a VM may hide the
    // board serial, which is why more than one source is hashed together.
    sources = windowsParts();
  } else if (process.platform === "darwin") {
    sources = macParts();
  } else {
    sources = linuxParts();
  }
  const usable = sources.filter(Boolean);
  const seed = (usable.length > 0 ? usable : fallbackParts()).join("|");
  const digest = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16).toUpperCase();
  return `MHR-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}`;
}

let cachedMachineId: string | null = null;

export function getMachineId(): string {
  if (!cachedMachineId) cachedMachineId = computeMachineId();
  return cachedMachineId;
}

/** Only used by isolated tests that switch MAHER_MACHINE_ID in one process. */
export function resetMachineIdCache(): void {
  cachedMachineId = null;
}
