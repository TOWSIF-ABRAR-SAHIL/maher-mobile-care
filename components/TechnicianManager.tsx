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
            <DialogTitle>
              <span className="inline-flex items-center gap-2">
                <Settings className="h-5 w-5" />
                টেকনিশিয়ান ব্যবস্থাপনা
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="tech-new-name"
                className="mb-1 block text-sm font-medium"
              >
                নতুন টেকনিশিয়ানের নাম
              </label>
              <Input
                id="tech-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void add();
                  }
                }}
                placeholder="যেমন: RAKIB"
              />
            </div>
            <Button
              onClick={() => void add()}
              disabled={adding || !newName.trim()}
              className="bg-blue-700 hover:bg-blue-800"
            >
              {adding ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-1 h-4 w-4" />
              )}
              যোগ করুন
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            নাম ছোট হাতের অক্ষরে লিখলেও বড় হাতের অক্ষরে সেভ হবে (যেমন
            &quot;rakib&quot; → RAKIB)। একই নাম দুইবার যোগ করা যাবে না।
          </p>

          {loading ? (
            <p className="py-6 text-center text-sm text-gray-500">
              তালিকা আসছে…
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700">
                সক্রিয় টেকনিশিয়ান ({active.length})
              </p>
              {active.length === 0 ? (
                <p className="rounded-lg border border-dashed py-4 text-center text-sm text-gray-500">
                  কোনো টেকনিশিয়ান নেই। উপরে নাম লিখে যোগ করুন।
                </p>
              ) : (
                <ul className="space-y-2">
                  {active.map((t) => (
                    <li
                      key={t.id}
                      data-testid={`tech-row-${t.name}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2"
                    >
                      {editingId === t.id ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <Input
                            id="tech-edit-name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8"
                            aria-label={`${t.name} নতুন নাম`}
                          />
                          <Button
                            size="sm"
                            className="bg-blue-700 hover:bg-blue-800"
                            disabled={busyId === t.id || !editName.trim()}
                            onClick={() => void rename(t, editName, false)}
                          >
                            সেভ
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                          >
                            বাতিল
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="min-w-0 truncate font-medium">
                            {t.name}
                          </span>
                          <span className="flex shrink-0 gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="এডিট"
                              aria-label={`${t.name} এডিট`}
                              onClick={() => {
                                setEditingId(t.id);
                                setEditName(t.name);
                              }}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-600"
                              title="ডিলিট"
                              aria-label={`${t.name} ডিলিট`}
                              // The shop must always keep one technician.
                              disabled={active.length <= 1}
                              onClick={() => setDeleteTarget(t)}
                            >
                              <Trash2 />
                            </Button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {inactive.length > 0 ? (
                <>
                  <p className="pt-1 text-sm font-semibold text-gray-700">
                    নিষ্ক্রিয় ({inactive.length})
                  </p>
                  <ul className="space-y-2">
                    {inactive.map((t) => (
                      <li
                        key={t.id}
                        data-testid={`tech-inactive-${t.name}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-gray-50 p-2"
                      >
                        <span className="min-w-0 truncate text-gray-500 line-through">
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
              className="bg-red-600 text-white hover:bg-red-700"
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
              className="bg-blue-700 text-white hover:bg-blue-800"
            >
              {busyId !== null ? "হচ্ছে…" : "হ্যাঁ, বদলান"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
