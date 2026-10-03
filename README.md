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
| Font | **Noto Sans Bengali**, self-hosted as plain `@font-face` + `.woff2` in `app/fonts/` (SIL OFL, no CDN, no `next/font`) | — |
| ORM | **Prisma** | 7.10.0 |
| Database | **SQLite** via `better-sqlite3` + `@prisma/adapter-better-sqlite3` | 12.11.1 |
| Testing | **puppeteer-core** (headless Chrome E2E) | 24.43.1 |
| Runner | `tsx`, `dotenv` (dev only) | — |

**Why these choices:** Next.js gives API routes + UI in one process (single
`npm run dev` to run the whole shop system). SQLite is one file
(`prisma/dev.db`) — backup = copy one file, no DB server to manage.
Everything runs on the shop PC; after `next build`, even the font and CSS
are local files.

`better-sqlite3` is a native module, so `next.config.mjs` keeps it out of the
webpack bundle (`serverComponentsExternalPackages`) — this is required for the
build to succeed, not an optimisation.

**Node version:** developed and verified on **Node 20.20.2 / npm 10.8.2**
(build, lint, typecheck and the full 146-check suite all pass on it).

**Client PCs run Node 22 — and it is bundled.** The Windows package ships its own
`runtime/node.exe` (Node 22.14.0) instead of asking the shop to install anything.
That is not a preference: `better-sqlite3` only publishes ready-made Windows
binaries for the Node 22 and Node 24 ABIs, so on Node 20 the client PC would have
to compile it, which means a multi-GB toolchain and a failed install. The
bundled `better_sqlite3.node` is built for **ABI 127** (Node 22), so the runtime
and the database engine have to match.

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

> For a **client PC** you do not run any of the above. Build the portable package
> (`npm run build:portable`) and hand over the folder or zip: it contains its own
> Node, creates its own database on first run, and needs no install and no
> internet. See [§2.1 Windows client delivery](#21-windows-client-delivery).

Other scripts:

| Command | Kaj |
|---|---|
| `npm run dev` | development server (`:3000`, hot reload) |
| `npm run build` | production build |
| `npm start` | production server (after build) |
| `npm run build:portable` | build the Windows package into `out/MAHER/` |
| `npm run test:first-run` | create/upgrade the database without the Prisma CLI |
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

### 2.1 Windows client delivery

```bash
npm run build:portable     # → out/MAHER/  (and out/MAHER-Windows-Test.zip if you zip it)
```

The client copies that folder to `C:\MAHER` and double-clicks
**`MAHER MOBILE CARE.bat`**. No installer, no compiler, no Node install, no
internet. The shop window opens in Chrome/Edge app mode — no address bar, so it
behaves like normal desktop software.

```
MAHER\
├── MAHER MOBILE CARE.bat   ← double-click this
├── start-maher.bat         ← server-only fallback, for troubleshooting
├── runtime\node.exe        ← bundled Node 22, nothing to install
├── app\                    ← standalone server + assets + migrations
├── data\                   ← shop.db + backups\  (THE SHOP'S RECORDS)
└── logs\maher.log          ← written here, safe to send to support
```

**`data\` is the whole point.** Shop records live in `data\shop.db`, outside the
app folder, so an upgrade can replace `app\` and `runtime\` wholesale without ever
touching the records. That was verified, not assumed: the `app\` folder was
deleted and rebuilt, and the existing record, roster and backups all survived.

**A fresh PC needs nothing typed into it.** `scripts/first-run.mjs` applies the
committed migrations on first launch. It uses `better-sqlite3` rather than
`prisma migrate deploy` because the Prisma CLI needs a platform-specific
`schema-engine`, and Prisma 7 needs no engine at runtime only because it queries
through a driver adapter. It records each migration in `_prisma_migrations` with
Prisma's exact `sha256` checksum, so running the real CLI against the same file
later reports "up to date" instead of re-running anything.

**The build refuses to ship shop data.** Next 14 has no
`outputFileTracingExcludes`, so the standalone trace follows `./backups` and
copies `.env` into the output. Left alone, a client's package would have contained
the developer's backups. `scripts/build-portable.mjs` deletes both and then
**fails the build** if any `.db` or `.env` is still present, or if any Linux `.node`
binary survived the swap. Do not relax either check.

**Why `output: "standalone"` is opt-in** (`MAHER_STANDALONE=1`, set by the
packaging script): in standalone mode Next 14 says `next start` is not the
supported entry point, so keeping it off by default leaves `npm start` and the
test harness working normally. The package launches `server.js` directly.

Three defects were found while building this, none of which a Linux test would
have caught:

- **The shop window could open an unrelated program.** Readiness was checked by
  "is port 3000 answering", so if anything else owned the port the launcher opened
  *that* — on a shop PC, plausibly the banking software. `scripts/launch.mjs` now
  confirms the response really is `maher-mobile-care` and refuses otherwise.
- **Starting could hang for minutes.** The port check used
  `Test-NetConnection`, which takes seconds per call, up to 60 times. It now
  polls from Node and typically reaches ready in about 1.3 s.
- **A PC without Chrome would show a crash.** `spawn` reports failure through an
  async `'error'` event, so the surrounding `try/catch` never caught it. Every
  browser launch is now error-handled, and the last resort is `rundll32` rather
  than `cmd /c start`.

`/api/health` never *fails* because the database is unhappy — the server is still
listening and support needs to see that — but it does report the absolute
database path and whether the shop tables exist, so it is a real diagnostic
rather than a bare "yes I'm listening".

That detail exists because of a Windows failure that no Linux test could have
caught. The shop window opened with no data at all, on every start, and the log
showed a perfect database being created followed by no server output whatsoever.
Servers are started detached, so one outlived both the launcher and its window; a
run whose folder was later deleted left a server holding port 3000 and pointing
at a database that no longer existed. The launcher had treated "a MAHER server
is answering" as "the right MAHER server is running", so it opened a window onto
that leftover and could only be recovered from Task Manager.

The launcher now establishes identity instead of assuming it: it compares the
running server's database path with the copy it is meant to serve and requires
the tables to actually read. A mismatch means a leftover server, so it is stopped
and the correct one started. Reuse is allowed only for the same installation with
readable data, and an unrelated program on the port is still refused and never
touched. `MAHER STOP.bat` stops the shop by port owner.

See **[`PREPARE-WINDOWS.md`](PREPARE-WINDOWS.md)** for the step-by-step handout.

---

## 3. Project structure

```
prisma7.config.ts           → Prisma CLI config; imports lib/db-path so the CLI
                              always migrates the same file the app reads
start-maher.bat             → dev-machine launcher (builds once, then start)
packaging/                  → launchers copied verbatim into the Windows package
  MAHER MOBILE CARE.bat     → client double-click: first-run + start + open window
  start-maher.bat           → server-only fallback for troubleshooting
PREPARE-WINDOWS.md          → step-by-step Windows handover guide (Bangla)
next.config.mjs             → keeps native better-sqlite3 out of the webpack bundle;
                              MAHER_STANDALONE=1 opts into the standalone build
tailwind.config.ts          → Tailwind theme + content globs
postcss.config.mjs          → PostCSS (Tailwind + Autoprefixer)
tsconfig.json / .eslintrc.json
.env                        → DATABASE_URL only (git-ignored, never commit)
.env.example                → committed template
app/
  page.tsx                 → whole dashboard (state, data wiring, footer)
  layout.tsx               → Bengali metadata, font CSS, Toaster
  globals.css              → Tailwind + theme + overflow-x:clip (sticky-safe)
  icon.svg                 → favicon (local file, offline)
  fonts/                   → self-hosted Noto Sans Bengali: *.woff2 + @font-face
                              CSS + OFL.txt licence (bundled, zero network)
  api/
    health/route.ts        → GET = readiness probe (reports which DB file is live)
    technicians/route.ts   → GET (?all=true) roster, POST add
    technicians/[id]/route.ts → PUT rename (2-step cascade), DELETE deactivate,
                                POST reactivate
    services/route.ts      → GET ?date= / ?archived=true, POST create
    services/[id]/route.ts → PUT update (incl. serviceDate), DELETE = archive
    services/[id]/restore/route.ts → POST un-archive
    services/dues/route.ts → GET = all-dates বাকি list + SQL-aggregate total
    services/search/route.ts → GET ?q= all-dates search (minimum 2 characters)
    stats/route.ts         → GET ?date= daily + per-technician totals
    stats/monthly/route.ts → GET ?date= (rolling 30d) or ?from=&to= range
    backup/route.ts        → GET = CSV download, POST = DB snapshot + prune
    backup/list/route.ts   → GET = snapshot list
    backup/restore/route.ts→ POST = restore snapshot (atomic + column-validated)
components/
  Header.tsx               → sticky navbar: date nav, আজ, Sync, Backup, Restore, Print
  TechnicianStats.tsx      → 4 technician cards (NURUL/RONI/ASRAFUL/NAYEM)
  TodayStats.tsx           → 4 daily cards (কাজ/বিল/বাকি/খরচ)
  MonthlySummary.tsx       → range report: presets + custom থেকে–পর্যন্ত
  ServiceForm.tsx          → entry form (30%), live due + change calc, edit reuse
  ServiceTable.tsx         → service list (70%): search, chips, eye, 1-click status
  OutstandingDues.tsx      → all-dates বাকি list with call/WhatsApp buttons
  GlobalServiceSearch.tsx  → all-dates search across every date
  ContactButtons.tsx       → phone / WhatsApp links (message text from lib/contact.ts)
  StatusBadge.tsx          → colored Bengali status badges
  Receipt.tsx              → customer bill (preview dialog + print-only bill)
  RestoreDialog.tsx        → snapshot list + 2-step restore confirm
  TechnicianManager.tsx    → roster dialog: add / rename / deactivate / reactivate
  ui/                      → shadcn primitives (button, input, table, dialog…)
lib/
  prisma.ts                → cached Prisma client + local SQLite adapter
  db-path.ts               → single source of truth for the DB file + backup dir
  technicians.ts           → roster rules: normalize, duplicate guard, cascade rename,
                             card list (active ∪ worked-today), last-active guard
  service-validation.ts    → shared create/update rules (UI and API can't drift)
  dhaka.ts                 → Asia/Dhaka day bounds, real calendar-date validation
  utils.ts                 → statuses, Bengali-digit parse, due, ৳ format
                             (+ FALLBACK_TECHNICIANS, only used if the roster
                             request fails)
  types.ts                 → shared DTOs (ServiceDTO, stats, RangeMode…)
  contact.ts               → WhatsApp/phone message text
  shop.ts                  → shop name/address/phone (receipt + footer source)
  generated/               → Prisma client output (generated, do not edit)
prisma/
  schema.prisma            → Service model (16 columns, incl. archived soft-delete)
                              + Technician model (v1.1 roster)
  dev.db                   → THE database (all shop records — back this up!)
  migrations/              → init + add_archived + add_technician
backups/                   → snapshots: maher-*.db (keeps 30) + safety-*.db (keeps 5)
scripts/
  run-tests.js             → npm test: one fresh throwaway DB per suite + live-DB guard
  build-portable.mjs       → npm run build:portable: bundle Node 22, swap in the
                             Windows better-sqlite3, strip leaks, assert no .db/.env
  first-run.mjs            → create/upgrade the shop DB without the Prisma CLI
  launch.mjs               → start the server, wait for real readiness, open the window
                               (--stop ends it by port owner)
    launch-decide.mjs         → reuse / takeover / refuse rules, unit tested
  test-support.js          → shared browser helpers (launch, type, wait, api…)
  e2e-maher.js             → core flow E2E (9 checks)
  e2e-p0.js                → P0 features E2E (13 checks)
  laneA.js                 → Lane A audit (22 checks)
  laneBC.js                → Lanes B+C audit (15 checks)
  api-check.js             → API contract + validation + restore-guard + roster (43)
  technician-mgmt.js       → v1.1 roster dialog + card filtering (24 checks)
  responsive-check.js      → 360/768/1024px overflow + JS-error checks (6)
  seed-maher.ts            → 16 sample entries (tsx)
  cleanup-test-data.ts     → dry-run list + `--confirm` cleanup of leftover test rows
out/                        → build output: MAHER/ package + zip (git-ignored)
```

> There is no `public/` folder — every asset (icon, font, CSS) lives under
> `app/`, which is why the app has no external file dependencies at runtime.

---

## 4. Features (user manual, short)

**Dashboard (one page):**
- Sticky blue-gradient navbar — date prev/next/picker, **আজ** button, Sync,
  Backup, Restore, Print. Keyboard `←`/`→` changes day (not while typing).
- Technician cards — one per **active** technician (card count follows the
  roster), plus a greyed “নিষ্ক্রিয়” card for anyone who has left the shop but
  still has work on the shown date, so the day's cards always add up to
  আজকের মোট কাজ. **Clicking a card filters the daily table to that technician**;
  clicking it again clears the filter.
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
  bill no, minimum 2 characters. Runs on the server across every date.
- **⚙️ টেকনিশিয়ান** (header) → **টেকনিশিয়ান ব্যবস্থাপনা** dialog: add, rename and
  deactivate technicians. Renaming asks first when it would rewrite history;
  deleting is a soft-delete that keeps every old record intact.
- Service table — client-side filter within the selected day (name / ID /
  phone / model / problem), status chips with counts, eye-toggle for the খরচ
  column (hidden by default = customer privacy), **1-click status advance**
  (badge click → next stage), edit/delete(→archive) + per-row **bill print**
  button.

**Safety:**
- Delete = archive (soft). Archive view (all dates) + 1-click restore.
- Backup button = server snapshot (`backups/maher-*.db`, newest **30** kept) +
  full CSV download (Excel-safe Bengali) + “সর্বশেষ ব্যাকআপ” label.
- Auto snapshot on first load of the day (staff can forget safely).
- Restore dialog = snapshot list + 2-step confirm. A restore first writes
  `backups/safety-*.db` (newest **5** kept) holding your *current* data, so a
  wrong restore is itself restorable. The swap is atomic and
  snapshot-column-validated — a bad snapshot is rejected *before* anything is
  touched.
- Print guard blocks blank prints; paper gets receipt-only or clean dashboard.

**Customer bill (print):**
- Preview dialog → print. Shop header (name/address/phone from `lib/shop.ts`),
  `বিল নং` (= row id), date, status, customer + job + technician,
  বিল / জমা / **বাকি**, a customer signature line and “ধন্যবাদ, আবার আসবেন”.
  **Shop cost never appears on the customer copy** — enforced in
  `Receipt.tsx` and covered by a test.

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
- **The roster is data, not code (v1.1).** Technicians live in the `Technician`
  table; `lib/utils.ts` keeps only a fallback list for when the roster request
  fails. Names are stored `trim()`ed and UPPERCASEd, and duplicates are rejected
  case-insensitively (SQLite's UNIQUE index alone would allow “nurul” + “NURUL”).
- **Rename rewrites history, with consent.** Because `Service.technician` is a
  plain String (a foreign key would break restore validation), a rename that
  would touch old rows answers `409` with the count first and only cascades
  after an explicit confirmation — the roster row and the service rows move in
  one transaction.
- **Deleting is deactivating.** Old receipts and records keep the name; only
  future bookings stop. The last remaining technician cannot be deactivated.
- A technician's own historical job stays editable after they leave — the form
  still offers their name (marked “নিষ্ক্রিয়”) so saving cannot silently
  reassign the job to somebody else.
- Statuses: `Pending → In-Progress → Completed → Delivered` (badge click order).
- **Cost privacy is local-only.** The APIs return `shopExpense`/`expenseAmount`
  because the app runs on the shop's own PC behind `127.0.0.1`. The guarantee
  that matters is the paper: the customer receipt never prints cost, and the
  খরচ column stays hidden until the eye-toggle is used.

### Data model (`prisma/schema.prisma`)

One table, `Service`, 16 columns (grouped below by role):

| Column | Type | Meaning |
|---|---|---|
| `id` | Int | primary key, **auto-increment** — printed as `বিল নং` |
| `customerName`, `phone` | String | customer; `phone` drives the call/WhatsApp buttons |
| `model`, `problem` | String | handset + reported fault |
| `technician` | String | one of the four fixed names |
| `totalBill`, `advance`, `due` | Int | the money triple (`due` is derived) |
| `status` | String | `Pending`/`In-Progress`/`Completed`/`Delivered` |
| `shopExpense` | String? | part code (`*M#`) **or** a number, free text |
| `expenseAmount` | Int | numeric cost for profit (0 when `shopExpense` is a code) |
| `serviceDate` | DateTime | stored ~midday +06:00 so day bucketing is unambiguous |
| `archived` | Boolean | soft-delete flag; hides the row from every list and stat |
| `createdAt`, `updatedAt` | DateTime | audit trail (used by the CSV export) |

There is deliberately **no `cashReceived` column and no payment-history table** —
`advance` is the single payment figure the shop records.

A second, tiny table holds the roster (v1.1):

| Column | Type | Meaning |
|---|---|---|
| `id` | Int | primary key, auto-increment |
| `name` | String | unique, stored trimmed + UPPERCASE |
| `isActive` | Boolean | `false` = left the shop (soft-delete) |
| `createdAt` | DateTime | when they were added |

`Service.technician` intentionally stays TEXT rather than a foreign key to this
table, so restore's column validation is unaffected.

---

## 6. Offline & data-safety notes

- App needs **zero internet** (font/CSS/JS/DB all local after build). The only
  outward links are the per-row **কল** (`tel:`) and **WhatsApp** buttons, which
  the user taps deliberately — nothing phones home on its own.
- SQLite is crash-safe: committed (Saved) rows survive power cuts; only an
  unsaved open form is lost.
- A restore never leaves you without a way back: it writes a `safety-*.db` copy
  of your current data first, then swaps atomically, and a snapshot that does
  not match the expected schema is refused before any row is touched.
- Same-disk backup does NOT protect against disk death/theft — copy the CSV
  (or `backups/`) to a pen drive periodically. Browser code cannot write to
  pen drives automatically (security rule) — this one step stays manual.
- Daily rule for staff: morning auto-backup happens alone; **press Backup
  once before closing shop.**
- Shop data never enters git: `.env`, `prisma/dev.db`, `backups/`, `node_modules`,
  `.next`, `out/` and agent tool folders are all ignored. Only `.env.example` is
  committed. `npm test` additionally hash-guards `prisma/dev.db` and fails the
  run if a single byte of it changed.
- **The built package is guarded the same way.** `out/` is git-ignored, and the
  packaging step fails outright if a `.db` or `.env` reaches the output, so a
  client's zip cannot carry another shop's records.
- **Moving the shop to a new PC:** copy the whole `MAHER` folder. Copying only
  `app\` loses nothing but also brings nothing — the records are in `data\`.

## 7. Test status

`npm test` runs the full regression (8 suites, 146 checks) entirely on
**throwaway databases** — it never starts the app against `prisma/dev.db`.

For a by-hand walkthrough of the whole app — paper printouts, real WhatsApp and
dialer, Excel opening the CSV, touch on a phone, two tabs at once — see
**[`MANUAL-TEST.md`](MANUAL-TEST.md)** (110 steps, each marked safe or risky).

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
- **The client is regenerated per suite.** `lib/generated/prisma` is gitignored,
  so `run-tests.js` runs `prisma generate` after `migrate deploy`; without it a
  schema change would build against a stale client.
- Latest full run: **8/8 suites, 146/146 checks** — core E2E 9 · P0 E2E 13 ·
Lane A 22 · Lane B+C 15 · API 43 · roster E2E 24 · responsive 6 · launcher
    decisions 14 · 0 FAIL, 0 JS errors.
- **The by-hand checklist is executed too.** All 110 steps of
  `MANUAL-TEST.md` were run end-to-end against a throwaway database — including
  printing a real PDF and reading it back — and every one passes. That pass is
  what found the three bugs listed in §9.
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
- **Version control.** The repo is initialized and pushed to a **private** GitHub
  remote. `.env`, `prisma/dev.db`, `backups/`, `node_modules`, `.next`, `out/`
  and agent tool folders are ignored. Private because the code carries the shop's
  business logic and brand name; it stays a template, not something a client can
  fork and resell.
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

---

## 9. v1.1 changelog — dynamic technicians & clickable cards

**Added**
- `Technician` table + migration that seeds the four previous hardcoded names,
  so existing installs and every test database start ready.
- `GET/POST /api/technicians`, `PUT/DELETE/POST /api/technicians/[id]`.
- **⚙️ টেকনিশিয়ান** dialog in the header: add, rename, deactivate, reactivate.
- Technician cards are clickable and filter the daily table; the notice, status
  chip counts and empty states all follow the filter, and the date change
  resets it.
- `scripts/technician-mgmt.js` (24 checks) and 16 roster checks in
  `api-check.js`.

**Rules worth knowing**
- Names are normalized (trim + UPPERCASE) and duplicates are rejected
  case-insensitively — SQLite's UNIQUE index is case-sensitive, so this check is
  the only thing stopping “nurul” and “NURUL” coexisting.
- A rename that would rewrite history returns `409` with the affected row count
  and writes nothing until the UI confirms; the roster row and the service rows
  then move in a single transaction.
- Deleting is deactivating. The last active technician is protected, and a
  deactivated technician's own old job stays editable (their name is still
  offered, marked “নিষ্ক্রিয়”).
- Cards are *active ∪ worked-today*, matched case-insensitively, so
  `sum(card counts) === আজকের মোট কাজ` always holds — asserted by `TC11`.

**v1.1.1 — three defects the by-hand checklist caught**

None of these were visible to the browser suite; all three came from executing
`MANUAL-TEST.md` the way a shop staff member would.

- **The app footer printed on the customer's bill.** `<footer>` sat outside
  `<main>`, so the dark banner (shop name, "১০০% অফলাইন", "ডেটা আপনার পিসিতেই
  থাকে") appeared under every receipt. It is now hidden while a receipt is open,
  the same rule `<main>` already used — a dashboard printout still carries the
  shop name. Regression test `T19`.
- **The second entry in a row could not be saved.** Resetting the form used
  `technician: ""`, but the roster-sync effect only runs when the option list
  changes, so after saving once the dropdown was blank and the next save failed
  with "সঠিক টেকনিশিয়ান বাছুন" until a manual reload. The reset now carries a
  valid technician. Regression test `T17`.
- **Triple-clicking save created three duplicate rows.** `if (saving) return`
  reads React state, which has not re-rendered yet inside a single tick, so all
  three clicks passed the guard. A ref now flips synchronously; the status badge
  got the same guard. Regression test `T18`.

Also: returning to a backgrounded tab now refetches the roster, so a change made
in another tab can no longer leave the entry form holding an unselectable
technician.

**Known behaviour, not a bug**

- The daily search box is a substring match across name/id/phone/model/problem,
  so searching `1` also matches ids `10`, `11`, `12`. Use a longer term.
- Card values always render **Western** digits, even though Bengali digits are
  accepted on input (`১৬০০` → `1,600`).

**Deliberately untouched**
- `Service` keeps all 16 columns and `app/api/backup/*` is byte-for-byte
  unchanged, so the restore column validation still rejects a bad snapshot.
  Restore only swaps `Service` rows, which means **the roster survives a
  restore** — and restoring an old v1.0 snapshot (which has no `Technician`
  table) cannot wipe the current one.
- The CSV export still contains services only; the `.db` snapshot is what
  captures the roster.

---

## 10. Windows delivery changelog

The app was developed on Linux, so nothing here could be assumed to work on a
client's PC — every Windows-specific claim was verified against the real
Windows binaries instead.

**Added**
- `npm run build:portable` → `out/MAHER/`: a self-contained folder with a bundled
  Node 22 runtime and a Windows `better-sqlite3` (ABI 127). About **118 MB**
  unpacked, ~**43 MB** zipped, versus ~1 GB for `node_modules` + `.next`.
- `scripts/first-run.mjs` — creates the shop database on a fresh PC with no
  install and no typing, without the Prisma CLI.
- `scripts/launch.mjs` — waits for genuine readiness, then opens the shop in a
  Chrome/Edge app window.
- `scripts/build-portable.mjs` — bundles the runtime, swaps the native binary,
  strips developer data, and fails the build on any leak.
- `packaging/` launchers (CRLF, no BOM) and `PREPARE-WINDOWS.md`.

**Verified, not assumed**
- `node.exe` and `better_sqlite3.node` in the finished package are both
  `PE32+ executable for MS Windows`, and the zip's copy starts with `MZ`.
- The packaged server boots (45 ms), serves the Bengali UI, returns HTTP 200 for
  its CSS and JS bundles, rejects overpayment with 400, and writes backups to
  `data\backups` — all against a fresh empty database, on the packaged build.
- `prisma migrate status` reports the database "up to date" against a database
  created by `first-run.mjs`, proving the hand-written ledger is byte-compatible
  with the real CLI.
- Deleting `app\` and rebuilding it left `data\` intact, record and roster and
  backups included.
- The zip contains no `.db`, no `.env` and no backup; the live `prisma/dev.db`
  hash does not appear anywhere in it.
- All **146** automated checks pass, and the live database is byte-identical.

**Not yet verified on real hardware.** The package is built for
`windows-x64` and inspected as Windows binaries, but it has never been
*executed* on Windows — no Windows machine or CI runner was available here. The
launcher's shell behaviour (`cd /d`, `errorlevel`, CRLF, Chrome `--app` mode) is
therefore the part that still needs one real Windows run to confirm. Until then,
treat `PREPARE-WINDOWS.md` as the first-run checklist.
