"use client";

import { useEffect, useState } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseBnNumber } from "@/lib/utils";
import type { ProductCategoryDTO, ProductDTO } from "@/lib/types";

interface FormState {
  name: string;
  categoryId: string;
  sku: string;
  barcode: string;
  brand: string;
  supplier: string;
  sellingPrice: string;
  purchasePrice: string;
  lowStockThreshold: string;
  openingStock: string;
  description: string;
}

type FieldKey =
  | "name"
  | "categoryId"
  | "sku"
  | "barcode"
  | "sellingPrice"
  | "purchasePrice"
  | "lowStockThreshold"
  | "openingStock";

function emptyForm(): FormState {
  return {
    name: "",
    categoryId: "",
    sku: "",
    barcode: "",
    brand: "",
    supplier: "",
    sellingPrice: "",
    purchasePrice: "",
    lowStockThreshold: "3",
    openingStock: "",
    description: "",
  };
}

function formFromProduct(product: ProductDTO): FormState {
  return {
    name: product.name,
    categoryId: String(product.categoryId),
    sku: product.sku ?? "",
    barcode: product.barcode ?? "",
    brand: product.brand ?? "",
    supplier: product.supplier ?? "",
    sellingPrice: String(product.sellingPrice),
    purchasePrice: product.purchasePrice ? String(product.purchasePrice) : "",
    lowStockThreshold: String(product.lowStockThreshold),
    openingStock: "",
    description: product.description ?? "",
  };
}

/** Maps a server message to the field it most likely belongs to. */
function fieldForMessage(message: string): FieldKey | null {
  if (message.includes("প্রোডাক্টের নাম")) return "name";
  if (message.includes("ক্যাটাগরি")) return "categoryId";
  if (message.includes("SKU")) return "sku";
  if (message.includes("বারকোড")) return "barcode";
  if (message.includes("বিক্রয় মূল্য")) return "sellingPrice";
  if (message.includes("ক্রয় মূল্য")) return "purchasePrice";
  if (message.includes("কম স্টক")) return "lowStockThreshold";
  if (message.includes("ওপেনিং")) return "openingStock";
  return null;
}

export function ProductDialog({
  open,
  onOpenChange,
  product,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDTO | null;
  categories: ProductCategoryDTO[];
  onSaved: () => void;
}) {
  const editing = !!product;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh dialog never inherits the previous product's values or errors.
  useEffect(() => {
    if (!open) return;
    setForm(product ? formFromProduct(product) : emptyForm());
    setErrors({});
    setFormError(null);
    setSaving(false);
  }, [open, product]);

  const set = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
    setErrors((prev) => {
      if (!prev[key as FieldKey]) return prev;
      const next = { ...prev };
      delete next[key as FieldKey];
      return next;
    });
  };

  const submit = async () => {
    if (saving) return;
    const next: Partial<Record<FieldKey, string>> = {};
    if (!form.name.trim()) next.name = "প্রোডাক্টের নাম দিন";
    if (!form.categoryId) next.categoryId = "ক্যাটাগরি বাছুন";

    const selling = parseBnNumber(form.sellingPrice);
    if (selling === null) next.sellingPrice = "বিক্রয় মূল্যে সঠিক সংখ্যা দিন";

    const purchase =
      form.purchasePrice.trim() === "" ? 0 : parseBnNumber(form.purchasePrice);
    if (purchase === null) next.purchasePrice = "ক্রয় মূল্যে সঠিক সংখ্যা দিন";

    const threshold =
      form.lowStockThreshold.trim() === ""
        ? 3
        : parseBnNumber(form.lowStockThreshold);
    if (threshold === null) next.lowStockThreshold = "সঠিক সংখ্যা দিন";

    let opening = 0;
    if (!editing) {
      const parsed = parseBnNumber(form.openingStock);
      if (parsed === null) next.openingStock = "ওপেনিং স্টকে সঠিক সংখ্যা দিন";
      else opening = parsed;
    }

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    if (selling === null || purchase === null || threshold === null) return;

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        categoryId: Number(form.categoryId),
        sku: form.sku.trim(),
        barcode: form.barcode.trim(),
        brand: form.brand.trim(),
        supplier: form.supplier.trim(),
        sellingPrice: selling,
        purchasePrice: purchase,
        lowStockThreshold: threshold,
        description: form.description.trim(),
        ...(editing ? {} : { openingStock: opening }),
      };
      const res = await fetch(
        editing ? `/api/products/${product!.id}` : "/api/products",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.error || "প্রোডাক্ট সেভ করা যায়নি";
        const field = fieldForMessage(message);
        if (field) setErrors({ [field]: message });
        else setFormError(message);
        return;
      }
      toast.success(editing ? "প্রোডাক্ট আপডেট হয়েছে" : "প্রোডাক্ট যোগ হয়েছে");
      onSaved();
      onOpenChange(false);
    } catch {
      setFormError("প্রোডাক্ট সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-maher-navy" />
            {editing ? "প্রোডাক্ট বদলান" : "নতুন প্রোডাক্ট"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "স্টক এখান থেকে বদলায় না — স্টক ইন/আউট দিয়ে বদলান।"
              : "ওপেনিং স্টক দিয়ে শুরু করুন; পরে স্টক ইন/আউট করতে পারবেন।"}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="sm:col-span-2">
            <Label htmlFor="product-name">প্রোডাক্টের নাম *</Label>
            <Input
              id="product-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="যেমন: Samsung 25W Charger"
              autoFocus
            />
            {errors.name && (
              <p className="mt-1 text-xs text-maher-due">{errors.name}</p>
            )}
          </div>

          <div>
            <Label>ক্যাটাগরি *</Label>
            <Select
              value={form.categoryId}
              onValueChange={(value) => set("categoryId", value)}
            >
              <SelectTrigger aria-label="ক্যাটাগরি">
                <SelectValue placeholder="ক্যাটাগরি বাছুন" />
              </SelectTrigger>
              <SelectContent>
                {categories.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    আগে ক্যাটাগরি যোগ করুন
                  </SelectItem>
                ) : (
                  categories.map((category) => (
                    <SelectItem
                      key={category.id}
                      value={String(category.id)}
                    >
                      {category.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.categoryId && (
              <p className="mt-1 text-xs text-maher-due">
                {errors.categoryId}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="product-brand">ব্র্যান্ড</Label>
            <Input
              id="product-brand"
              value={form.brand}
              onChange={(e) => set("brand", e.target.value)}
              placeholder="যেমন: Samsung"
            />
          </div>

          <div>
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              value={form.sku}
              onChange={(e) => set("sku", e.target.value.toUpperCase())}
              placeholder="SKU-001"
              className="uppercase"
            />
            {errors.sku && (
              <p className="mt-1 text-xs text-maher-due">{errors.sku}</p>
            )}
          </div>

          <div>
            <Label htmlFor="product-barcode">বারকোড</Label>
            <Input
              id="product-barcode"
              value={form.barcode}
              onChange={(e) => set("barcode", e.target.value)}
              placeholder="ইচ্ছা হলে"
            />
            {errors.barcode && (
              <p className="mt-1 text-xs text-maher-due">{errors.barcode}</p>
            )}
          </div>

          <div>
            <Label htmlFor="product-selling">বিক্রয় মূল্য (৳) *</Label>
            <Input
              id="product-selling"
              value={form.sellingPrice}
              onChange={(e) => set("sellingPrice", e.target.value)}
              inputMode="numeric"
              placeholder="0"
            />
            {errors.sellingPrice && (
              <p className="mt-1 text-xs text-maher-due">
                {errors.sellingPrice}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="product-purchase">ক্রয় মূল্য (৳)</Label>
            <Input
              id="product-purchase"
              value={form.purchasePrice}
              onChange={(e) => set("purchasePrice", e.target.value)}
              inputMode="numeric"
              placeholder="শুধু দোকানের হিসাবের জন্য"
            />
            {errors.purchasePrice && (
              <p className="mt-1 text-xs text-maher-due">
                {errors.purchasePrice}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="product-threshold">কম স্টক সীমা</Label>
            <Input
              id="product-threshold"
              value={form.lowStockThreshold}
              onChange={(e) => set("lowStockThreshold", e.target.value)}
              inputMode="numeric"
              placeholder="3"
            />
            {errors.lowStockThreshold && (
              <p className="mt-1 text-xs text-maher-due">
                {errors.lowStockThreshold}
              </p>
            )}
          </div>

          <div>
            {editing ? (
              <>
                <Label>বর্তমান স্টক</Label>
                <div className="flex h-9 items-center rounded-md border bg-maher-surface px-3 text-sm font-semibold">
                  {product!.stock} পিস
                </div>
              </>
            ) : (
              <>
                <Label htmlFor="product-opening">ওপেনিং স্টক *</Label>
                <Input
                  id="product-opening"
                  value={form.openingStock}
                  onChange={(e) => set("openingStock", e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                />
                {errors.openingStock && (
                  <p className="mt-1 text-xs text-maher-due">
                    {errors.openingStock}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="product-supplier">সাপ্লায়ার</Label>
            <Input
              id="product-supplier"
              value={form.supplier}
              onChange={(e) => set("supplier", e.target.value)}
              placeholder="ইচ্ছা হলে"
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="product-description">বিবরণ</Label>
            <Textarea
              id="product-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
              placeholder="ইচ্ছা হলে"
            />
          </div>

          {formError && (
            <p className="sm:col-span-2 rounded-md border border-maher-due/30 bg-maher-due/10 px-3 py-2 text-sm text-maher-due">
              {formError}
            </p>
          )}

          <DialogFooter className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              বাতিল
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editing ? "আপডেট করুন" : "যোগ করুন"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
