import { prisma } from "./prisma";

/**
 * Technician list rules (v1.1).
 *
 * `Service.technician` stays a plain TEXT column on purpose — a foreign key
 * would break the backup/restore column validation in
 * `app/api/backup/restore/route.ts`, which deliberately knows nothing about
 * this table. Everything here therefore works with names, not ids, and rename
 * has to rewrite history explicitly (see `renameTechnician`).
 *
 * Names are stored normalized (trim + UPPERCASE). SQLite's UNIQUE index is
 * case-SENSITIVE (BINARY collation), so "nurul" and "NURUL" would happily
 * coexist at the database level — the case-insensitive duplicate check below is
 * the only thing preventing that.
 */

export const MAX_NAME_LENGTH = 24;

export class TechnicianError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TechnicianError";
    this.status = status;
  }
}

export interface TechnicianDTO {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface CardSpec {
  technician: string;
  isActive: boolean;
}

/** Trim + uppercase + collapse inner whitespace. Throws on an unusable name. */
export function normalizeName(raw: unknown): string {
  const name = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!name) throw new TechnicianError("টেকনিশিয়ানের নাম দিন");
  if (name.length > MAX_NAME_LENGTH) {
    throw new TechnicianError(`নাম ${MAX_NAME_LENGTH} অক্ষরের মধ্যে দিন`);
  }
  return name;
}

function toDTO(t: {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: Date;
}): TechnicianDTO {
  return {
    id: t.id,
    name: t.name,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Every technician, newest name last. `includeInactive` powers the dialog. */
export async function listTechnicians(
  includeInactive = false
): Promise<TechnicianDTO[]> {
  const rows = await prisma.technician.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: "asc" },
  });
  return rows.map(toDTO);
}

/** Names accepted by the service form / API validation. */
export async function activeTechnicianNames(): Promise<string[]> {
  return listTechnicians(false).then((rows) => rows.map((t) => t.name));
}

/** Case-insensitive duplicate guard across active AND inactive technicians. */
export async function assertUniqueName(
  name: string,
  exceptId?: number
): Promise<void> {
  const existing = await prisma.technician.findMany();
  const clash = existing.find(
    (t) =>
      t.name.toUpperCase() === name.toUpperCase() &&
      (exceptId === undefined || t.id !== exceptId)
  );
  if (clash) {
    throw new TechnicianError(
      "এই নামে ইতিমধ্যে একজন টেকনিশিয়ান আছে।"
    );
  }
}

/**
 * Exact spellings actually used by historical Service rows for a given
 * technician. Compared in JS because Prisma has no case-insensitive mode on
 * SQLite; the result feeds `in` so the rewrite stays a single query.
 */
async function serviceNameVariants(name: string): Promise<string[]> {
  const rows = await prisma.service.findMany({
    distinct: ["technician"],
    select: { technician: true },
  });
  const target = name.toUpperCase();
  return rows
    .map((r) => r.technician)
    .filter((t) => t.trim().toUpperCase() === target);
}

/** How many historical rows a rename would rewrite (drives the confirm). */
export async function affectedServiceCount(name: string): Promise<number> {
  const variants = await serviceNameVariants(name);
  if (variants.length === 0) return 0;
  return prisma.service.count({ where: { technician: { in: variants } } });
}

/**
 * Which cards the dashboard shows for a given day.
 *
 * Every ACTIVE technician is listed (so a technician with no jobs today still
 * has a clickable card and the "no work" empty state is reachable), plus any
 * technician who has rows that day but is no longer active — greyed out, so
 * the day total and the cards always reconcile.
 */
export async function cardRows(dayTechnicians: string[]): Promise<CardSpec[]> {
  const all = await prisma.technician.findMany({ orderBy: { name: "asc" } });
  const active = all.filter((t) => t.isActive);
  const activeUpper = new Set(active.map((t) => t.name.toUpperCase()));

  const extras: string[] = [];
  const seen = new Set<string>();
  for (const raw of dayTechnicians) {
    const key = raw.trim().toUpperCase();
    if (!key || activeUpper.has(key) || seen.has(key)) continue;
    seen.add(key);
    extras.push(raw);
  }

  return [
    ...active.map((t) => ({ technician: t.name, isActive: true })),
    ...extras.map((name) => ({ technician: name, isActive: false })),
  ];
}

export async function createTechnician(raw: unknown): Promise<TechnicianDTO> {
  const name = normalizeName(raw);
  await assertUniqueName(name);
  const created = await prisma.technician.create({
    data: { name, isActive: true },
  });
  return toDTO(created);
}

/**
 * Rename a technician, optionally rewriting historical Service rows.
 *
 * `confirmCascade` is the two-step guard: with affected rows and no explicit
 * confirmation the caller gets a 409 carrying the count and nothing is written.
 * Technician row and Service rows move in ONE transaction so a crash can never
 * leave the two halves disagreeing.
 */
export async function renameTechnician(
  id: number,
  raw: unknown,
  confirmCascade: boolean
): Promise<{ technician: TechnicianDTO; updatedServices: number }> {
  const existing = await prisma.technician.findUnique({ where: { id } });
  if (!existing) throw new TechnicianError("টেকনিশিয়ান পাওয়া যায়নি", 404);

  const name = normalizeName(raw);
  await assertUniqueName(name, id);
  if (name === existing.name) {
    return { technician: toDTO(existing), updatedServices: 0 };
  }

  const variants = await serviceNameVariants(existing.name);
  const updatedServices = await prisma.service.count({
    where: { technician: { in: variants.length ? variants : ["__none__"] } },
  });

  if (updatedServices > 0 && !confirmCascade) {
    const error = new TechnicianError(
      `এই নাম পরিবর্তনে মোট ${updatedServices}টি পুরনো রেকর্ডের নামও বদলে যাবে।`,
      409
    );
    throw Object.assign(error, { affected: updatedServices });
  }

  const [, technician] = await prisma.$transaction([
    prisma.service.updateMany({
      where: { technician: { in: variants.length ? variants : ["__none__"] } },
      data: { technician: name },
    }),
    prisma.technician.update({ where: { id }, data: { name } }),
  ]);

  return { technician: toDTO(technician), updatedServices };
}

/**
 * Soft-delete only. The shop must always keep at least one technician, and a
 * technician with history must never be hard-deleted — old receipts and
 * service rows reference the name.
 */
export async function deactivateTechnician(
  id: number
): Promise<TechnicianDTO> {
  const existing = await prisma.technician.findUnique({ where: { id } });
  if (!existing) throw new TechnicianError("টেকনিশিয়ান পাওয়া যায়নি", 404);
  if (!existing.isActive) return toDTO(existing);

  const activeCount = await prisma.technician.count({ where: { isActive: true } });
  if (activeCount <= 1) {
    throw new TechnicianError("কমপক্ষে ১ জন টেকনিশিয়ান থাকতে হবে।");
  }

  const updated = await prisma.technician.update({
    where: { id },
    data: { isActive: false },
  });
  return toDTO(updated);
}

/** Bring a previously deactivated technician back (reactivate). */
export async function reactivateTechnician(id: number): Promise<TechnicianDTO> {
  const existing = await prisma.technician.findUnique({ where: { id } });
  if (!existing) throw new TechnicianError("টেকনিশিয়ান পাওয়া যায়নি", 404);
  await assertUniqueName(existing.name, id);
  const updated = await prisma.technician.update({
    where: { id },
    data: { isActive: true },
  });
  return toDTO(updated);
}
