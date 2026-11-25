"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Settings, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TechnicianDTO } from "@/lib/types";

/** Stable, dependency-free initials badge palette (no image/CDN calls). */
const AVATAR_TONES = [
  "border-[#35648C]/30 bg-[#35648C]/10 text-[#2F5F88]",
  "border-[#2E7D5C]/30 bg-[#2E7D5C]/10 text-[#2E7D5C]",
  "border-[#9A6714]/30 bg-[#9A6714]/10 text-[#9A6714]",
  "border-[#7C96AD]/40 bg-[#7C96AD]/15 text-[#223D57]",
];

function avatarTone(name: string): string {
  return AVATAR_TONES[
    Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length
  ];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

/**
 * Roster management (v1.1). Self-contained like RestoreDialog: it refetches
 * when opened and calls `onChanged` after every mutation, which is what makes
 * the entry form's dropdown and the dashboard cards refresh in one place.
 */
export function TechnicianManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [all, setAll] = useState<TechnicianDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TechnicianDTO | null>(null);
  // Rename needs two steps: the API answers 409 with the affected row count
  // before anything is written, and only an explicit confirm cascades it.
  const [pendingRename, setPendingRename] = useState<{
    tech: TechnicianDTO;
    name: string;
    affected: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/technicians?all=true");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "তালিকা আসেনি");
      setAll(data.technicians ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "তালিকা আসেনি");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setNewName("");
    setEditingId(null);
    setDeleteTarget(null);
    setPendingRename(null);
    void load();
  }, [open, load]);

  const active = all.filter((t) => t.isActive);
  const inactive = all.filter((t) => !t.isActive);

  const send = (id: number, method: string, body?: unknown) =>
    fetch(`/api/technicians/${id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const add = async () => {
    if (adding || !newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/technicians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "যোগ করা যায়নি");
      toast.success(`${data.technician.name} যোগ হয়েছে`);
      setNewName("");
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "যোগ করা যায়নি");
    } finally {
      setAdding(false);
    }
  };

  const rename = async (tech: TechnicianDTO, name: string, confirmCascade: boolean) => {
    setBusyId(tech.id);
    try {
      const res = await send(tech.id, "PUT", { name, confirmCascade });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPendingRename({ tech, name, affected: data.affected ?? 0 });
        return;
      }
      if (!res.ok) throw new Error(data?.error || "নাম বদলানো যায়নি");
      toast.success(
        data.updatedServices > 0
          ? `নাম বদলানো হয়েছে (${data.updatedServices}টি পুরনো রেকর্ড সহ)`
          : "নাম বদলানো হয়েছে"
      );
      // Close the cascade prompt too — leaving it open would trap the user
      // behind a warning about a rename that already happened.
      setPendingRename(null);
      setEditingId(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "নাম বদলানো যায়নি");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      const res = await send(deleteTarget.id, "DELETE");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ডিলিট করা যায়নি");
      toast.success(`${deleteTarget.name} নিষ্ক্রিয় করা হয়েছে`);
      setDeleteTarget(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ডিলিট করা যায়নি");
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (tech: TechnicianDTO) => {
    setBusyId(tech.id);
    try {
      const res = await send(tech.id, "POST");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ফিরিয়ে আনা যায়নি");
      toast.success(`${tech.name} আবার সক্রিয় হয়েছে`);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ফিরিয়ে আনা যায়নি");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="print:hidden">
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DialogContent
          data-testid="tech-manager"
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold text-maher-navy">
              <span className="inline-flex items-center gap-2">
                <Settings className="h-5 w-5 text-maher-royal" />
                👥 টেকনিশিয়ান ও স্টাফ ব্যবস্থাপনা
              </span>
            </DialogTitle>
            <p className="pt-1 text-xs font-medium text-muted-foreground">
              মোট {active.length} জন কর্মী • কাজের ইতিহাস সুরক্ষিত
            </p>
          </DialogHeader>

          <div className="rounded-xl border border-maher-border bg-maher-surface/40 p-2.5">
            <label
              htmlFor="tech-new-name"
              className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-maher-royal"
            >
              নতুন কর্মী
            </label>
            <div className="flex items-stretch gap-2">
              <Input
                id="tech-new-name"
                data-testid="technician-name-input"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void add();
                  }
                }}
                placeholder="যেমন: RAKIB"
                className="h-11 min-w-0 flex-1 border-maher-navy/25 bg-white font-medium text-maher-navy shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-maher-navy/25"
              />
              <span data-testid="technician-add-btn" className="inline-flex">
                <Button
                  onClick={() => void add()}
                  disabled={adding || !newName.trim()}
                  data-testid="btn-add-technician"
                  className="h-11 shrink-0 gap-1.5 whitespace-nowrap bg-maher-navy px-3 text-xs font-bold text-white hover:bg-maher-royal disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  ＋ কর্মী যোগ করুন
                </Button>
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              নাম স্বয়ংক্রিয়ভাবে বড় হাতের অক্ষরে সেভ হবে; ডুপ্লিকেট চলবে না।
            </p>
          </div>

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              তালিকা আসছে…
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-maher-navy">
                সক্রিয় টেকনিশিয়ান তালিকা ({active.length})
              </p>
              {active.length === 0 ? (
                <p className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
                  কোনো টেকনিশিয়ান নেই। উপরে নাম লিখে যোগ করুন।
                </p>
              ) : (
                <ul data-testid="technician-list" className="space-y-2">
                  {active.map((t) => (
                    <li
                      key={t.id}
                      data-testid={`tech-row-${t.name}`}
                      onDoubleClick={() => {
                        if (editingId !== t.id) {
                          setEditingId(t.id);
                          setEditName(t.name);
                        }
                      }}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-maher-border bg-white px-2.5 py-2 shadow-card transition-colors hover:border-maher-navy/30 hover:bg-maher-surface/40"
                    >
                      <span
                        data-testid={`technician-item-${t.name}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border font-mono text-sm font-extrabold ${avatarTone(t.name)}`}
                        >
                          {initialsOf(t.name)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-bold text-maher-navy">
                            {t.name}
                          </span>
                          <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full border border-[#2E7D5C]/25 bg-[#2E7D5C]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#2E7D5C]">
                            <span aria-hidden="true">●</span> সক্রিয়
                          </span>
                        </span>
                      </span>
                      {editingId === t.id ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Input
                            id="tech-edit-name"
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void rename(t, editName, false);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingId(null);
                              }
                            }}
                            className="h-8 w-28 sm:w-36"
                            aria-label={`${t.name} নতুন নাম`}
                          />
                          <Button
                            size="sm"
                            aria-label="সংরক্ষণ"
                            className="h-8 bg-maher-navy px-2 text-[11px] font-bold text-white hover:bg-maher-royal"
                            disabled={busyId === t.id || !editName.trim()}
                            onClick={() => void rename(t, editName, false)}
                          >
                            সংরক্ষণ
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-[11px] font-semibold"
                            onClick={() => setEditingId(null)}
                          >
                            বাতিল
                          </Button>
                        </span>
                      ) : (
                        <span className="flex shrink-0 gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg text-maher-royal transition-colors hover:bg-maher-navy/10"
                            title="এডিট"
                            aria-label={`${t.name} এডিট`}
                            onClick={() => {
                              setEditingId(t.id);
                              setEditName(t.name);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg text-maher-due transition-colors hover:bg-maher-due/10"
                            title="ডিলিট"
                            aria-label={`${t.name} ডিলিট`}
                            // The shop must always keep one technician.
                            disabled={active.length <= 1}
                            onClick={() => setDeleteTarget(t)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {inactive.length > 0 ? (
                <>
                  <p className="pt-1 text-sm font-semibold text-foreground">
                    নিষ্ক্রিয় ({inactive.length})
                  </p>
                  <ul className="space-y-2">
                    {inactive.map((t) => (
                      <li
                        key={t.id}
                        data-testid={`tech-inactive-${t.name}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-maher-surface/70 p-2"
                      >
                        <span className="min-w-0 truncate text-muted-foreground line-through">
                          {t.name}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === t.id}
                          onClick={() => void restore(t)}
                        >
                          ফিরিয়ে আনুন
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete is a soft-delete: history keeps the name, only future bookings stop. */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>টেকনিশিয়ান ডিলিট করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              এই টেকনিশিয়ান কে ডিলিট করলে ভবিষ্যতে আর ব্যবহার করা যাবে না। পুরনো
              সার্ভিস রেকর্ড ঠিক থাকবে। চালিয়ে যাবেন?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              className="bg-maher-due text-white hover:bg-maher-due/90"
            >
              {busyId !== null ? "হচ্ছে…" : "ডিলিট"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename cascade guard — only shown when history would be rewritten. */}
      <AlertDialog
        open={!!pendingRename}
        onOpenChange={(o) => {
          if (!o) setPendingRename(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>নাম পরিবর্তন করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              ⚠️ এই নাম পরিবর্তনে মোট {pendingRename?.affected ?? 0}টি পুরনো রেকর্ডের
              নামও বদলে যাবে। চালিয়ে যাবেন?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault();
                if (pendingRename) {
                  void rename(pendingRename.tech, pendingRename.name, true);
                }
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busyId !== null ? "হচ্ছে…" : "হ্যাঁ, বদলান"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
