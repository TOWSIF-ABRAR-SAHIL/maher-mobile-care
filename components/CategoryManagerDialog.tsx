"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProductCategoryDTO } from "@/lib/types";

export function CategoryManagerDialog({
  open,
  onOpenChange,
  categories,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ProductCategoryDTO[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    setNewName("");
    setAddError(null);
    setEditingId(null);
    setConfirmId(null);
    setRowError(null);
    setBusyId(null);
  }, [open]);

  const add = async () => {
    if (adding) return;
    if (!newName.trim()) {
      setAddError("ক্যাটাগরির নাম দিন");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/product-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data?.error || "ক্যাটাগরি যোগ করা যায়নি");
        return;
      }
      setNewName("");
      toast.success("ক্যাটাগরি যোগ হয়েছে");
      onChanged();
    } catch {
      setAddError("ক্যাটাগরি যোগ করা যায়নি");
    } finally {
      setAdding(false);
    }
  };

  const rename = async (category: ProductCategoryDTO) => {
    if (busyId !== null) return;
    if (!editName.trim()) {
      setRowError({ id: category.id, message: "ক্যাটাগরির নাম দিন" });
      return;
    }
    setBusyId(category.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/product-categories/${category.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({
          id: category.id,
          message: data?.error || "ক্যাটাগরি বদলানো যায়নি",
        });
        return;
      }
      setEditingId(null);
      toast.success("ক্যাটাগরি বদলানো হয়েছে");
      onChanged();
    } catch {
      setRowError({
        id: category.id,
        message: "ক্যাটাগরি বদলানো যায়নি",
      });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (category: ProductCategoryDTO) => {
    if (busyId !== null) return;
    setBusyId(category.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/product-categories/${category.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({
          id: category.id,
          message: data?.error || "ক্যাটাগরি মোছা যায়নি",
        });
        return;
      }
      setConfirmId(null);
      toast.success("ক্যাটাগরি মোছা হয়েছে");
      onChanged();
    } catch {
      setRowError({ id: category.id, message: "ক্যাটাগরি মোছা যায়নি" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busyId === null) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>ক্যাটাগরি ব্যবস্থাপনা</DialogTitle>
          <DialogDescription>
            প্রোডাক্ট থাকা ক্যাটাগরি মোছা যাবে না — আগে প্রোডাক্টগুলোর
            ক্যাটাগরি বদলান।
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder="নতুন ক্যাটাগরির নাম"
              aria-label="নতুন ক্যাটাগরির নাম"
            />
            {addError && (
              <p className="mt-1 text-xs text-maher-due">{addError}</p>
            )}
          </div>
          <Button onClick={() => void add()} disabled={adding}>
            {adding ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            যোগ
          </Button>
        </div>

        <div className="max-h-[52dvh] space-y-1.5 overflow-y-auto pr-1">
          {categories.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              এখনো কোনো ক্যাটাগরি নেই
            </p>
          ) : (
            categories.map((category) => {
              const busy = busyId === category.id;
              const error =
                rowError?.id === category.id ? rowError.message : null;
              const blocked = category.productCount > 0;

              return (
                <div
                  key={category.id}
                  className="rounded-lg border border-maher-border bg-white px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {editingId === category.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            setRowError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void rename(category);
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-8 flex-1"
                          autoFocus
                          aria-label="ক্যাটাগরির নতুন নাম"
                        />
                        <Button
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => void rename(category)}
                          disabled={busy}
                          aria-label="নাম সেভ করুন"
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          aria-label="বাতিল"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {category.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {category.activeProductCount}টি প্রোডাক্ট
                            {category.productCount >
                              category.activeProductCount &&
                              ` • ${category.productCount}টি রেকর্ড`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setEditingId(category.id);
                            setEditName(category.name);
                            setConfirmId(null);
                            setRowError(null);
                          }}
                          aria-label={`${category.name} নাম বদলান`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {confirmId === category.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 px-2 text-xs"
                              onClick={() => void remove(category)}
                              disabled={busy}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "মুছুন"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              onClick={() => setConfirmId(null)}
                              disabled={busy}
                            >
                              না
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-maher-due hover:text-maher-due"
                            onClick={() => {
                              if (blocked) {
                                setRowError({
                                  id: category.id,
                                  message: `এই ক্যাটাগরিতে ${category.productCount}টি প্রোডাক্ট আছে — মোছা যাবে না`,
                                });
                                return;
                              }
                              setConfirmId(category.id);
                              setRowError(null);
                            }}
                            aria-label={`${category.name} মোছেন`}
                            title={
                              blocked
                                ? "প্রোডাক্ট থাকা ক্যাটাগরি মোছা যাবে না"
                                : "ক্যাটাগরি মোছেন"
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {error && (
                    <p className="mt-1 text-xs text-maher-due">{error}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
