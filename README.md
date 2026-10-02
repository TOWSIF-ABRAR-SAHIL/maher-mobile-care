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

On the shop PC you can also just double-click **`start-maher.bat`** — it builds
once if needed, then starts the server.

Other scripts:

| Command | Kaj |
|---|---|
| `npm run dev` | development server (`:3000`, hot reload) |
| `npm run build` | production build |
| `npm start` | production server (after build) |
| `npm test` | full regression on throwaway DBs — never touches shop data |
| `npm run cleanup:test-data` | list leftover test rows (dry-run; `-- --confirm` removes) |
| `npm run lint` | eslint check |
| `npm run seed -- --fresh` | wipe + load 16 sample entries (demo data!) |
| `npx prisma migrate dev` | apply DB migrations |
| `npx prisma generate` | regenerate client (auto-runs on postinstall) |

> ⚠️ `npm run seed -- --fresh` **deletes all real data.** Only for demo setup.

### Database location (advanced)

`lib/db-path.ts` is the single resolver used by the app, the Prisma CLI and the
test harness, in this order:

1. `MAHER_DB_PATH` — explicit override (used by the test harness)
2. `DATABASE_URL` — from `.env` (normal shop setup: `file:./prisma/dev.db`)
3. `./prisma/dev.db` — built-in default

`MAHER_BACKUP_DIR` overrides the `backups/` folder the same way. Change these
only if you deliberately keep the shop data somewhere else — nothing else needs
editing, and the CLI can no longer drift away from the running app.

> The server binds to `127.0.0.1` only. Do not change it to `0.0.0.0`: the app
> has no login, so anything that can reach the port can edit or wipe shop data.

---

## 3. Project structure

```
app/
  page.tsx                 → whole dashboard (state, data wiring, footer)
  layout.tsx               → Bengali metadata, Noto Sans Bengali, Toaster
  globals.css              → Tailwind + theme + overflow-x:clip (sticky-safe)
  icon.svg                 → favicon (local file, offline)
  api/
    health/route.ts        → GET = readiness probe (reports which DB file is live)
    services/route.ts      → GET ?date= / ?archived=true, POST create
    services/[id]/route.ts → PUT update (incl. serviceDate), DELETE = archive
    services/[id]/restore/route.ts → POST un-archive
    services/dues/route.ts → GET = all-dates বাকি list + total due
    services/search/route.ts → GET ?q= all-dates search (minimum 2 characters)
    stats/route.ts         → GET ?date= daily + per-technician totals
    stats/monthly/route.ts → GET ?date= (rolling 30d) or ?from=&to= range
    backup/route.ts        → GET = CSV download, POST = DB snapshot
    backup/list/route.ts   → GET = snapshot list
    backup/restore/route.ts→ POST = restore snapshot (atomic + column-validated)
components/
  Header.tsx               → sticky navbar: date nav, আজ, Sync, Backup, Restore, Print
  TechnicianStats.tsx      → 4 technician cards (NURUL/RONI/ASRAFUL/NAYEM)
  TodayStats.tsx           → 4 daily cards (কাজ/বিল/বাকি/খরচ)
  MonthlySummary.tsx       → range report: presets + custom থেকে–পর্যন্ত
  ServiceForm.tsx          → entry form (30%), live due calc, edit reuse
  ServiceTable.tsx         → service list (70%): search, chips, eye, 1-click status
  OutstandingDues.tsx      → all-dates বাকি list with call/WhatsApp buttons
  GlobalServiceSearch.tsx  → all-dates search across every date
  ContactButtons.tsx       → phone / WhatsApp links (message text from lib/contact.ts)
  StatusBadge.tsx          → colored Bengali status badges
  Receipt.tsx              → customer bill (preview dialog + print-only bill)
  RestoreDialog.tsx        → snapshot list + 2-step restore confirm
  ui/                      → shadcn primitives (button, input, table, dialog…)
lib/
  prisma.ts                → cached Prisma client + local SQLite adapter
  db-path.ts               → single source of truth for the DB file + backup dir
  service-validation.ts    → shared create/update rules (UI and API can't drift)
  dhaka.ts                 → Asia/Dhaka day bounds, real calendar-date validation
  utils.ts                 → technicians, statuses, Bengali-digit parse, due, ৳ format
  types.ts                 → shared DTOs (ServiceDTO, stats, RangeMode…)
  contact.ts               → WhatsApp/phone message text
  shop.ts                  → shop name/address/phone (receipt + footer source)
  generated/               → Prisma client output (generated, do not edit)
prisma/
  schema.prisma            → Service model (+ archived flag)
  dev.db                   → THE database (all shop records — back this up!)
  migrations/              → init + add_archived
backups/                   → timestamped dev.db snapshots (auto-pruned to 30)
scripts/
  run-tests.js             → npm test: one fresh throwaway DB per suite + live-DB guard
  test-support.js          → shared browser helpers (launch, type, wait, api…)
  e2e-maher.js             → core flow E2E (9 checks)
  e2e-p0.js                → P0 features E2E (13 checks)
  laneA.js                 → Lane A audit (19 checks)
  laneBC.js                → Lanes B+C audit (15 checks)
  api-check.js             → API contract + validation + restore-guard checks (18)
  responsive-check.js      → 360/768/1024px overflow + JS-error checks (6)
  seed-maher.ts            → 16 sample entries (tsx)
  cleanup-test-data.ts     → dry-run list + `--confirm` cleanup of leftover test rows
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
  accepted (`১৬০০` → 1600). Edit reuses the same form (incl. date correction —
  no delete+recreate).
- **কাস্টমারের কাছ থেকে পাওয়া টাকা (Cash Received)** — a till calculator only.
  Type what the customer handed over and the box below shows the change to
  return (bill 850, cash 1000 → “ফেরত দিন ৳150”), or the shortfall when it is
  less. **It is never saved and never sent to the server.**
- **Overpay is rejected.** জমা can never exceed মোট বিল — the save is blocked
  with “জমা মোট বিলের বেশি হতে পারে না”. Cash above the bill belongs in the
  calculator above, not in the ledger.
- **💰 বাকি তালিকা (সব তারিখ)** — every active record with money outstanding,
  independent of the selected day, with call + WhatsApp buttons per row.
  The headline **মোট বাকি** is a SQL aggregate over *all* matching rows, so it
  stays 100% accurate even when the rendered list is capped.
- **🌍 সব তারিখে খুঁজুন** — global search by name / phone / model / problem /
  bill no, minimum 2 characters.
- Service table — search (name/ID/phone/model), status chips with counts,
  eye-toggle for the খরচ column (hidden by default = customer privacy),
  **1-click status advance** (badge click → next stage), edit/delete(→archive)
  + per-row **bill print** button.

**Safety:**
- Delete = archive (soft). Archive view (all dates) + 1-click restore.
- Backup button = server snapshot (`backups/maher-*.db`, keeps 30) + full
  CSV download (Excel-safe Bengali) + “সর্বশেষ ব্যাকআপ” label.
- Auto snapshot on first load of the day (staff can forget safely).
- Restore dialog = snapshot list + 2-step confirm + pre-restore safety copy
  (the restore itself is atomic and snapshot-column-validated — a bad snapshot
  is rejected *before* anything is touched).
- Print guard blocks blank prints; paper gets receipt-only or clean dashboard.

**Customer bill (print):**
- Preview dialog → print. Shop header (name/address/phone from `lib/shop.ts`),
  bill no/date/status, customer+job+technician, bill/জমা/**বাকি**,
  signature lines. **Shop cost never appears on the customer copy.**

---

## 5. Business rules (locked)

- `due = max(0, totalBill − advance)` — always derived, never typed.
- **Overpay is invalid data, not a discount.** `advance ≤ totalBill` is enforced
  in the shared validator, so both the form and `POST`/`PUT /api/services`
  reject it with 400. A bill paid in full (`advance = totalBill`) is fine and
  simply leaves `due = 0`, which is what removes it from বাকি তালিকা.
- **Cash Received / change is never stored.** It exists only to help the cashier
  return change; there is no `cashReceived` column and no payment is recorded
  beyond the single `advance` figure.
- Repair status and payment are **independent**: setting `Completed` or
  `Delivered` does not clear বাকি. A row leaves বাকি তালিকা only when its money
  is actually collected.
- `shopExpense`: number → counts in খরচ/profit; code (`*M#`) → counted
  separately, numeric expense 0.
- `profit = totalBill − expenseAmount` (per-job parts only — shop overhead
  like rent is NOT in the system; “লাভ” = gross margin).
- Dates are Asia/Dhaka day boundaries; new entries stored ~midday +06:00.
- Archived rows are excluded from every list/stat.
- Technicians: `NURUL, RONI, ASRAFUL, NAYEM` (fixed list in `lib/utils.ts`).
- Statuses: `Pending → In-Progress → Completed → Delivered` (badge click order).
- **Cost privacy is local-only.** The APIs return `shopExpense`/`expenseAmount`
  because the app runs on the shop's own PC behind `127.0.0.1`. The guarantee
  that matters is the paper: the customer receipt never prints cost, and the
  খরচ column stays hidden until the eye-toggle is used.

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

`npm test` runs the full regression (6 suites, 92 checks) entirely on
**throwaway databases** — it never starts the app against `prisma/dev.db`.

- **One fresh database, backup folder and server per suite.** Each DB has a
  unique filename and `/api/health` must report it before the suite runs, so a
  crashed or interrupted suite can never leak rows or snapshots into the next.
- **Live-DB guard.** The runner hashes `prisma/dev.db` before the run and after
  every suite; if it ever changes, the run stops and names the offending suite.
- **Suites refuse to run unguarded.** A suite invoked directly (without
  `MAHER_TEST_URL` + `MAHER_TEST_DB_FILE`) aborts immediately instead of
  defaulting to a dev server on port 3000, so a test can never archive or
  restore rows in the live shop database.
- **Focused runs:** `MAHER_TEST_SUITES=scripts/laneBC.js npm test` (or a
  comma-separated list) runs a subset, each on its own fresh database.
- Latest full run: **6/6 suites, 92/92 checks** — core E2E 9 · P0 E2E 13 ·
  Lane A 22 · Lane B+C 15 · API 27 · responsive 6 · 0 FAIL, 0 JS errors.
- Desktop + 360px mobile + print-emulation verified; the shop DB stayed
  byte-identical (hash-checked).

---

## 8. Hardening notes (recent work)

- **Restore is atomic and column-validated.** `POST /api/backup/restore`
  checks the snapshot's `Service` columns *before* touching anything, then
  swaps rows inside a single `BEGIN IMMEDIATE … COMMIT` transaction. Old or
  incomplete snapshots get a 400 naming the missing columns; a bad snapshot or
  a power cut can no longer empty the live database.
- **Real calendar-date validation.** Impossible dates (`2026-02-30`) are
  rejected with 400 on `?date=`, create/update bodies and report ranges. The
  Bengali validation classifier now maps form errors to 400 instead of 500.
- **Isolated, order-independent suites.** laneBC compares before→after deltas
  from an API snapshot instead of absolute counts; laneA archives its reference
  row; the prev-day navigation check compares against the API instead of
  assuming 0 rows.
- **Reliable runner.** The test server is spawned as a direct Node process and
  killed with SIGTERM → SIGKILL (hard-capped), so a failing suite can never
  hang the run; the live-DB guard reports on every run, pass or fail.
- **Test-data cleanup.** `npm run cleanup:test-data` lists known leftover test
  rows (dry-run); adding `-- --confirm` snapshots first, then deletes only
  pattern-matched rows.
- **Version control.** The repo is initialized; `.env`, `prisma/dev.db`,
  `backups/`, `node_modules`, `.next` and agent tool folders are ignored.
- **Overpay rejected, change calculated.** `lib/service-validation.ts` refuses
  `advance > totalBill` on create *and* partial update (400, nothing written),
  and the form gained a Cash Received calculator that is UI-only.
- **বাকি total can no longer be truncated.** `GET /api/services/dues` computes
  `count` and `totalDue` with a SQL aggregate over every matching row while the
  rendered list stays capped at 500; the response carries `hasMore`/`listed`
  and the UI says so instead of quietly showing a partial list. Covered by a
  505-row boundary test.
- **One database resolver for app, CLI and tests.** `lib/db-path.ts` is the
  single source of truth (`MAHER_DB_PATH` → `DATABASE_URL` → `./prisma/dev.db`)
  and `prisma7.config.ts` now imports it, so `prisma migrate` can never target a
  different file than the running app. `MAHER_BACKUP_DIR` isolates snapshots.
- **Fallback report date validated.** `?date=` on `/api/stats/monthly` now
  rejects impossible dates with 400 instead of crashing Prisma with a 500.
- **AUTOINCREMENT after restore (verified).** A crafted snapshot with a high
  `id` was restored and the next entry received a *larger* id — SQLite bumps
  `sqlite_sequence` on an explicit larger rowid, so a paper receipt's বিল নং
  can never end up pointing at a different customer. Kept as regression test R3.
- **Test selectors no longer depend on hit-testing.** The daily search box has
  `id="svc-search"` and suites type through the React value setter, so a
  growing form or sticky header can no longer swallow the keystrokes and fail a
  suite for the wrong reason.
- **Crashed suites clean up after themselves.** `browser.close()` runs from the
  crash handler too, so a failing suite leaves no orphaned Chrome processes.
