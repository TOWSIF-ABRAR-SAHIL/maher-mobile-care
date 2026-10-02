# MAHER MOBILE CARE — দৈনিক সার্ভিস ট্র্যাকার

Single-page, **100% offline** service tracker for a mobile repair shop.
Bengali UI, local SQLite database, no cloud, no login, no internet needed
(except WhatsApp/phone itself, which lives outside the app).

```
http://localhost:3000   →   dashboard (one page, everything here)
```

---

## 1. Technology stack

| Layer | Technology | Version |
|---|---|---|
| Framework | **Next.js** (App Router) | 14.2.35 |
| UI library | **React** | 18.3.1 |
| Language | **TypeScript** | 5.9.3 |
| Styling | **Tailwind CSS** + PostCSS + Autoprefixer | 3.4.19 |
| Components | **shadcn/ui** on **Radix UI** primitives (dialog, alert-dialog, select, label, tabs, scroll-area, slot) + `class-variance-authority`, `clsx`, `tailwind-merge` | — |
| Icons | **lucide-react** | 1.49.0 |
| Toasts | **sonner** | 2.0.8 |
| Font | **Noto Sans Bengali**, self-hosted via `next/font` (offline-safe) | — |
| ORM | **Prisma** | 7.10.0 |
| Database | **SQLite** via `better-sqlite3` + `@prisma/adapter-better-sqlite3` | 12.11.1 |
| Testing | **puppeteer-core** (headless Chrome E2E) | 24.43.1 |
| Runner | `tsx`, `dotenv` (dev only) | — |

**Why these choices:** Next.js gives API routes + UI in one process (single
`npm run dev` to run the whole shop system). SQLite is one file
(`prisma/dev.db`) — backup = copy one file, no DB server to manage.
Everything runs on the shop PC; after `next build`, even the font and CSS
are local files.

**Node version:** works on Node 20 (one harmless Prisma engine warning),
Node 22+ recommended (warning-free).

---

## 2. Quick start (shop PC)

```bash
npm install
npx prisma migrate dev        # one time — creates prisma/dev.db
npm run dev                   # → http://localhost:3000
```

Production (faster, recommended for daily shop use):

```bash
npm run build
npm start                     # → http://localhost:3000
```

Other scripts:

| Command | Kaj |
|---|---|
| `npm run dev` | development server (`:3000`, hot reload) |
| `npm run build` | production build |
| `npm start` | production server (after build) |
| `npm run lint` | eslint check |
| `npm run seed -- --fresh` | wipe + load 16 sample entries (demo data!) |
| `npx prisma migrate dev` | apply DB migrations |
| `npx prisma generate` | regenerate client (auto-runs on postinstall) |

> ⚠️ `npm run seed -- --fresh` **deletes all real data.** Only for demo setup.

---

## 3. Project structure

```
app/
  page.tsx                 → whole dashboard (state, data wiring, footer)
  layout.tsx               → Bengali metadata, Noto Sans Bengali, Toaster
  globals.css              → Tailwind + theme + overflow-x:clip (sticky-safe)
  icon.svg                 → favicon (local file, offline)
  api/
    services/route.ts      → GET ?date= / ?archived=true, POST create
    services/[id]/route.ts → PUT update (incl. serviceDate), DELETE = archive
    services/[id]/restore/route.ts → POST un-archive
    stats/route.ts         → GET ?date= daily + per-technician totals
    stats/monthly/route.ts → GET ?date= (rolling 30d) or ?from=&to= range
    backup/route.ts        → GET = CSV download, POST = DB snapshot
    backup/list/route.ts   → GET = snapshot list
    backup/restore/route.ts→ POST = restore snapshot (with safety copy)
components/
  Header.tsx               → sticky navbar: date nav, আজ, Sync, Backup, Restore, Print
  TechnicianStats.tsx      → 4 technician cards (NURUL/RONI/ASRAFUL/NAYEM)
  TodayStats.tsx           → 4 daily cards (কাজ/বিল/বাকি/খরচ)
  MonthlySummary.tsx       → range report: presets + custom থেকে–পর্যন্ত
  ServiceForm.tsx          → entry form (30%), live due calc, edit reuse
  ServiceTable.tsx         → service list (70%): search, chips, eye, 1-click status
  StatusBadge.tsx          → colored Bengali status badges
  Receipt.tsx              → customer bill (preview dialog + print-only bill)
  RestoreDialog.tsx        → snapshot list + 2-step restore confirm
  ui/                      → shadcn primitives (button, input, table, dialog…)
lib/
  prisma.ts                → cached Prisma client + local SQLite adapter
  dhaka.ts                 → Asia/Dhaka day bounds, shiftDateKey, monthContaining…
  utils.ts                 → technicians, statuses, Bengali-digit parse, due, ৳ format
  types.ts                 → shared DTOs (ServiceDTO, stats, RangeMode…)
  shop.ts                  → shop name/address/phone (receipt + footer source)
  generated/               → Prisma client output (generated, do not edit)
prisma/
  schema.prisma            → Service model (+ archived flag)
  dev.db                   → THE database (all shop records — back this up!)
  migrations/              → init + add_archived
backups/                   → timestamped dev.db snapshots (auto-pruned to 30)
scripts/
  seed-maher.ts            → 16 sample entries (tsx)
  e2e-maher.js             → core flow E2E (9 checks)
  e2e-p0.js                → P0 features E2E (13 checks)
  laneA.js                 → full Lane-A audit (19 checks)
  laneBC.js                → Lanes B+C audit (14 checks)
```

---

## 4. Features (user manual, short)

**Dashboard (one page):**
- Sticky blue-gradient navbar — date prev/next/picker, **আজ** button, Sync,
  Backup, Restore, Print. Keyboard `←`/`→` changes day (not while typing).
- 4 technician cards (always all four) — কাজ + মোট বিল.
- 4 daily cards — কাজ / বিল / বাকি / খরচ (+কোড hint).
- Range report — presets (বিগত ৩০ দিন / এই মাস / গত মাস) + custom
  থেকে–পর্যন্ত. Presets follow the navbar date; custom stays fixed.
  Cards: কাজ / বিল / খরচ / **বাকি** / লাভ + date-range label.
- Entry form — all fields, **বাকি auto-calculates live**, Bengali digits
  accepted (`১৬০০` → 1600), overpay clamps due to 0. Edit reuses the same
  form (incl. date correction — no delete+recreate).
- Service table — search (name/ID/phone/model), status chips with counts,
  eye-toggle for the খরচ column (hidden by default = customer privacy),
  **1-click status advance** (badge click → next stage), edit/delete(→archive)
  + per-row **bill print** button.

**Safety:**
- Delete = archive (soft). Archive view (all dates) + 1-click restore.
- Backup button = server snapshot (`backups/maher-*.db`, keeps 30) + full
  CSV download (Excel-safe Bengali) + “সর্বশেষ ব্যাকআপ” label.
- Auto snapshot on first load of the day (staff can forget safely).
- Restore dialog = snapshot list + 2-step confirm + pre-restore safety copy.
- Print guard blocks blank prints; paper gets receipt-only or clean dashboard.

**Customer bill (print):**
- Preview dialog → print. Shop header (name/address/phone from `lib/shop.ts`),
  bill no/date/status, customer+job+technician, bill/জমা/**বাকি**,
  signature lines. **Shop cost never appears on the customer copy.**

---

## 5. Business rules (locked)

- `due = max(0, totalBill − advance)` — always derived, never typed.
- `shopExpense`: number → counts in খরচ/profit; code (`*M#`) → counted
  separately, numeric expense 0.
- `profit = totalBill − expenseAmount` (per-job parts only — shop overhead
  like rent is NOT in the system; “লাভ” = gross margin).
- Dates are Asia/Dhaka day boundaries; new entries stored ~midday +06:00.
- Archived rows are excluded from every list/stat.
- Technicians: `NURUL, RONI, ASRAFUL, NAYEM` (fixed list in `lib/utils.ts`).
- Statuses: `Pending → In-Progress → Completed → Delivered` (badge click order).

---

## 6. Offline & data-safety notes

- App needs **zero internet** (font/CSS/JS/DB all local after build).
- SQLite is crash-safe: committed (Saved) rows survive power cuts; only an
  unsaved open form is lost.
- Same-disk backup does NOT protect against disk death/theft — copy the CSV
  (or `backups/`) to a pen drive periodically. Browser code cannot write to
  pen drives automatically (security rule) — this one step stays manual.
- Daily rule for staff: morning auto-backup happens alone; **press Backup
  once before closing shop.**

## 7. Test status

- Lane A (entry/table): **19/19** · Lane B+C (report/backup/print/mobile): **14/14**
- Core E2E: **9/9** · P0 E2E: **13/13** · API suite (400/404/validation): **10/10**
- Zero JS errors; desktop + 360px mobile + print-emulation verified.
- Run: `node scripts/e2e-maher.js` (needs server on `:3000`).
