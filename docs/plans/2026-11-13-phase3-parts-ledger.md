# Phase 3 — per-device parts ledger (পার্টস খাতা)

Status: **plan-only, approved for the money rule.** No code written yet.
Branch `stock-sync`, HEAD `b2fdfe1`. `package.json` stays `1.2.0`.

## 1. Goal

A device's repair cost can be entered as **itemized parts** (name, quantity,
unit cost, supplier) instead of one lump shop-expense code. Reports use the
parts total when parts exist, the lump code otherwise — never both.

Approved decisions (explicit user sign-off):

1. **Parts replace the lump per device.** `cost = sum(ServicePart.lineCost)`
   when the device has parts, else `expenseAmount` (unless
   `expenseWrittenOff`). Profit stays `bill − cost − damageLoss` daily and
   `bill − cost − damageLoss − productCost` monthly.
2. **Free-text parts first.** No stock movement, no `Product` link required in
   this phase (a `productId?` column is reserved but unused).
3. **Both entered → prefer parts, show a hint.** The save succeeds; the code
   stays on the row for audit; the form and the খরচ cell explain why it is
   not counted. No `400`, no data loss.

## 2. Non-goals (do not creep)

- No stock deduction, `STOCK_OUT`, or `Product.stock` change from parts.
- No `Supplier` table, no supplier dues from parts (purchases already exist).
- No change to `due`, paid, `FLOW_STATUSES`, refunds or the paid-slip money lock.
- No receipt/PDF change. No part name, unit cost or parts total may ever reach
  a customer copy — parts are internal exactly like `expenseAmount`.
- No `Service.partsCost` stored column: the total is always derived, so no
  denormalized money can drift.

## 3. Data model

```prisma
/// One part used on one device row. Internal cost only: never printed on a
/// receipt. `serviceId` deliberately has NO foreign key — a restore may swap
/// the Service table (same policy as SaleItem / PaymentAllocation).
model ServicePart {
  id           Int      @id @default(autoincrement())
  serviceId    Int
  /// Reserved for a later phase (stock-deducting part). Unused for now.
  productId    Int?
  nameSnapshot String
  skuSnapshot  String?
  quantity     Int      @default(1)
  unitCost     Int      @default(0)
  /// quantity × unitCost, computed by the server (never trusted from the client).
  lineCost     Int      @default(0)
  /// পার্টস কেনার দোকান for this line, or NULL (falls back to Service.partsShop).
  supplier     String?
  note         String?
  createdAt    DateTime @default(now())

  @@index([serviceId])
  @@index([productId])
}
```

Migration `20261113150000_add_service_parts` (additive only).

## 4. Money rule (single implementation)

`lib/parts.ts`:

```ts
export function effectiveRepairCost(
  row: { expenseAmount: number; expenseWrittenOff: boolean; status: string },
  partsCost: number
): number {
  if (row.expenseWrittenOff) return 0;      // return cancelled the cost
  return partsCost > 0 ? partsCost : row.expenseAmount;
}
export async function partsCostByService(ids: number[]): Promise<Map<number, number>>
// one groupBy(by: ["serviceId"], _sum: { lineCost: true }) — never N+1
```

Rules that fall out of it:

- A returned row keeps its parts rows for audit; `expenseWrittenOff = true`
  (the existing switch, no new flag) removes both the parts total and the lump
  from খরচ/লাভ.
- Product anchors (`entryKind = "PRODUCT"`) reject parts with `400` — they are
  bill holders, not repairs.
- Historical rows have no parts, so **every existing profit figure stays
  byte-identical**. Only rows that gain parts change, which is the approved
  change.

## 5. Server changes

| File | Change |
|---|---|
| `lib/parts.ts` (new) | `partsCostByService`, `effectiveRepairCost`, `normalizeParts` (validate + compute `lineCost`) |
| `lib/types.ts` | `ServicePartDTO`; `ServiceDTO.partsCost?: number`, `ServiceDTO.parts?: ServicePartDTO[]` |
| `lib/service-validation.ts` | accept `parts` on create/update/batch bodies: ≤ 8 lines, name 1–80, qty 1–999, unitCost 0–1,000,000, supplier ≤ 100, note ≤ 200; reject on `PRODUCT` |
| `app/api/services/route.ts` | insert parts inside the create transaction; attach `partsCost` to day/all/range/archived lists via one `groupBy` |
| `app/api/services/batch/route.ts` | parts per device inside the existing batch transaction |
| `app/api/services/[id]/route.ts` | `PUT` runs in `$transaction` (update row + replace parts); the paid-slip guard keeps guarding only `totalBill`/`advance`, so parts stay editable on a paid slip |
| `app/api/stats/route.ts` | `expense` uses `effectiveRepairCost` with the day's parts map |
| `app/api/stats/monthly/route.ts` | same, feeding `profit = bill − expense − damageLoss − productCost` |
| `lib/export.ts` | `dailyBreakdown` uses `r.partsCost` via `effectiveRepairCost`; no formula change elsewhere |
| `lib/backup-workbook.ts` | one parts query; summary expense + profit + the audit sheet gain a `partsCost` column |
| `app/api/backup/route.ts` | CSV audit columns: `partsCost` (plus the lines stay in the DB snapshot) |
| `app/api/backup/restore/route.ts` | `PHASE3_TABLES = [ServicePart]`, own `phase3Warning`; delete before `Service`, insert after; older snapshot clears parts and warns |

Parts are written **only** through the service payload (create/update/batch) —
no second `/parts` endpoint, so there is one validation path and one
transactional write.

## 6. Client changes

- `components/ServiceForm.tsx`
  - Inside each device's **আরও তথ্য**: a **পার্টস** repeater under IMEI/সমাধান —
    name, পরিমাণ, একক দাম, live line total, per-line ✕, **+ পার্টস যোগ করুন**
    (max 8). Device footer shows the device's parts total.
  - When a shop-expense code is also present: inline hint
    **“খরচ হিসাবে পার্টস ধরা হবে; কোডটি শুধু অডিটে থাকবে।”**
  - `partsShop` stays once per visit on ডিভাইস ১ (unchanged).
  - Testids: `parts-editor-<n>`, `part-name-<n>-<i>`, `part-qty-…`,
    `part-unit-cost-…`, `part-line-cost-…`, `part-remove-…`, `add-part-<n>`.
- `components/ServiceTable.tsx` — খরচ cell: when `partsCost > 0`, show
  **পার্টস** marker + count, and the taka total only under the existing reveal
  controls (header eye / per-row eye). `data-testid="parts-cost-<id>"`.
  `expense-amount-<id>` keeps its meaning (the lump, audit only).
- `components/ServiceAdjustDialog.tsx` — write-off copy now says it cancels the
  parts cost **and** the shop-expense code.
- `components/TodayStats.tsx` / `MonthlySummary.tsx` — unchanged (they render
  API numbers).

## 7. Tests

- **`scripts/laneJ.js` (new, ~16 checks)** — register in
  `scripts/run-tests.js` `DEFAULT_SUITES`:
  1. create with 2 parts → `partsCost` = sum, খরচ/লাভ move by that sum
  2. the same row also carrying a code → code excluded, parts counted
  3. device without parts → lump still counts (no regression)
  4. returned + written-off → neither counted
  5. paid slip (`due = 0`) accepts a parts edit but still refuses bill/advance
  6. `PRODUCT` anchor rejects parts (400)
  7. client-sent `lineCost` is ignored; server computes qty × unitCost
  8. validation: qty 0, negative cost, 9 lines, 81-char name → 400 each
  9. service list shows the پار্টস marker, total hidden until reveal
  10. receipt/PDF text contains no part name, unit cost or parts total
  11. old snapshot → parts cleared + Bengali warning
  12. new snapshot → parts survive the round-trip
- **`scripts/api-check.js`** — +4 (validation matrix, daily/monthly aggregate
  agreement, no-FK restore safety).
- **`scripts/service-list-design.js`** — +2: the repeater fits the 340px form
  column at 1280 without page overflow; adding a part does not push the sticky
  save bar over the bill field.
- **`MANUAL-TEST.md`** — new **S1–S8** section + two stop conditions
  (a part cost on a receipt; খরচ/লাভ disagreeing between card and report).
- Expected totals: **21 suites, ~431 checks**; design contract 19 → 21.

## 8. Docs

- `README.md`: §3 file tree (`lib/parts.ts`, `laneJ.js`), §4 feature paragraph,
  §5 money rule (parts > lump, write-off covers both), §7 counts, §9
  **Added**/**Changed** bullets, migration list, Service “33 columns” line
  (Service itself gains no column — state that explicitly).
- `MANUAL-TEST.md`: S-section, baselines, step count.

## 9. Risk & verification

- GitNexus `impact` **before** editing: `effectiveRepairCost` consumers,
  `expenseAmount` readers (`stats`, `stats/monthly`, `export`,
  `backup-workbook`, `restore`), `ServiceForm.submit`, `ServiceTable`
  খরচ cell, restore `POST`. Expect HIGH on `expenseAmount` — it is the
  money path, so every call site is enumerated in the plan above.
- Coefficient of safety: no stored total, no FK, additive migration, old
  snapshots restore, historical profit unchanged.
- Gate: `npx tsc --noEmit` → `npm run lint` → `git diff --check` → full
  `npm test` (throwaway DBs, live hash must stay
  `977a3f01a7f0063b2d03cc357f98cfebd5043197d36eb00a0bd40736f7bbd6ab`) →
  design contract → `detect_changes(scope: "all")` → commit.

## 10. Implementation order

1. Schema + migration + `prisma generate`.
2. `lib/parts.ts`, DTOs, validation.
3. API writes (create/batch/update) inside transactions.
4. API reads (list `partsCost`, stats, monthly) + exports.
5. Restore table set + warning.
6. UI (form repeater, খরচ cell, adjust copy).
7. Tests (laneJ, api-check, design, manual) and docs.
8. Full gate + commit.

Definition of done: a device with itemized parts reports the parts sum exactly
once, a device without parts reports exactly what it reported before, and no
customer-facing surface changed.
