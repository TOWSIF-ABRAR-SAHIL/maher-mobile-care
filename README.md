# MSS (Mobile Service System) — দৈনিক সার্ভিস ট্র্যাকার

Single-page, **100% offline** service tracker for a mobile repair shop.
Bengali UI, local SQLite database, no cloud, no login, no internet needed
(except WhatsApp/phone itself, which lives outside the app).

```
http://localhost:3000   →   /service — the service desk (the landing page)
http://localhost:3000/products → the stock page (প্রোডাক্ট ও ইনভেন্টরি)
```

## Unreleased / NOTUN (v1.2.0-er por) — MSS white-label

- **Platform brand = MSS.** Installer (`MSS-Setup-1.2.0.exe`), app/taskbar/window
  title (`MSS (Mobile Service System)`), Electron app name and system alerts.
  `PLATFORM_BRAND` in `lib/shop.ts` owns these strings; vendor support stays on
  `01533315357` / `https://wa.me/8801533315357`.
- **Tenant identity = `ShopSettings` only.** Navbar, footer, receipt, WhatsApp
  text, licence hub, reports and backup workbooks read the live shop profile.
  Empty profile falls back to setup hints (`MSS - শপ প্রোফাইল সেটআপ করুন`,
  `আপনার দোকানের নাম`) or the MSS platform brand — never an old shop name.
- **Clean-slate first launch.** Migrations seed no services, debts, products,
  categories, technicians or shop profile. Dashboard counters start at `৳0`/`0`
  and the onboarding banner is visible. `scripts/clean-slate-fresh-install.js`
  pins the contract on a throwaway database.
- The private wire identifier `maher-mobile-care` and `MAHER_*` environment
  names are retained for older launchers/tests; they are never rendered.
- **Assisted installer.** `MSS-Setup-<version>.exe` is no longer one-click: the
  wizard offers the install path plus a second page for the shop data folder,
  defaulting to `D:\MSS-Data` on a non-C drive. Drive C: is always rejected
  (empty/uncreatable folders are rejected too), and the chosen root is written beside `MSS.exe`
  and into the registry for the next update. `scripts/mss-installer-contract.js`
  pins the wizard, the no-C rule and the legacy-data move on throwaway folders.
- **In-place updates.** Running a newer `MSS-Setup-<version>.exe` on a PC that
  already has MSS first shows an **Update / Cancel** dialog. Cancel quits
  without touching data; Update keeps the existing appId, install path and data
  root. electron-builder 26 has no `deleteAppDataOnUpdate` setting: an update
  never touches the chosen data root by design. The schema-valid
  `nsis.deleteAppDataOnUninstall` is pinned `false`. A pre-wizard install that
  still has `%AppData%\MSS\data\shop.db` or `%AppData%\MAHER-MOBILE-CARE\data\shop.db`
  is copied into the new non-C root on first run (never its old DB pointer), and
  pending migrations then apply with a safety snapshot. See
  `PREPARE-WINDOWS.md` "Update by installer"; `scripts/mss-update-contract.js`
  pins the migration promise on a throwaway database.

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
(build, lint and typecheck pass on it). The current 564-check regression (and
the earlier v1.2.0 312-check run) also ran on **Node 24.15.0 / npm 11.12.1**
on the Windows build host.

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
| `npm run backfill:expense-codes` | dry-run repair of old numeric/code rows; add `-- --confirm` to write |
| `npm run audit:money` | dry-run ledger audit (due/refund/expense); add `-- --confirm` for safe repairs |
| `npx prisma migrate dev` | apply DB migrations |
| `npx prisma generate` | regenerate client (auto-runs on postinstall) |

> ⚠️ `npm run seed -- --fresh` **deletes all real data.** Only for demo setup.

### Database location (advanced)

`lib/db-path.ts` is the single resolver used by the app, the Prisma CLI and the
test harness, in this order:

1. **Verified custom location** — `maher-db-location.json` beside the default DB
   (written by the Dashboard's location dialog, see below)
2. `MAHER_DB_PATH` — explicit override (used by the test harness and launchers)
3. `MAHER_USER_DATA_DIR` — Electron/test root; the installed app uses the wizard's
   non-C root from `mss-data-root.txt` (default `D:\MSS-Data`)
4. `DATABASE_URL` — from `.env` (normal shop setup: `file:./prisma/dev.db`)
5. `./prisma/dev.db` — built-in default

The pointer is a small local config file, **not** a `ShopSettings` row: a row can
only be read after the database is already open, so the pointer has to win before
any connect. It accepts either a folder (the default DB filename is appended) or
a direct `.db` file path. It is honoured only when the folder is reachable and the
file has a real SQLite header; a disconnected D: drive silently falls back to the
default location and the Dashboard shows **কাস্টম ডাটাবেজ লোকেশন পাওয়া যায়নি — আগের
নিরাপদ লোকেশনে ফিরে এসেছি।** instead of crashing. `lib/prisma.ts` keeps one stable
proxy and re-resolves on every access, so a successful move switches the **live**
connection over without a restart (and re-applies WAL/NORMAL/5000 on the new
handle). `scripts/first-run.mjs` mirrors the resolver so portable migrations can
never land on the old C: file.

`MAHER_BACKUP_DIR` overrides the `backups/` folder the same way. Change these
only if you deliberately keep the shop data somewhere else — nothing else needs
editing, and the CLI can no longer drift away from the running app.

> The server binds to `127.0.0.1` only. Do not change it to `0.0.0.0`: the app
> has no login, so anything that can reach the port can edit or wipe shop data.

### 2.1 Windows client delivery

```bash
npm run build:portable     # → out/MAHER/  (zip it as out/MAHER-Windows-Client.zip)
```

The client zip is `out/MAHER-Windows-Client.zip` (test-data free) and is
published as release `v1.2.0-windows` - the repo is **private**, so the release
URL needs a GitHub login and the file itself is what goes to the client (pen
drive, chat, email). `build:portable` only builds the `out/MAHER/` folder —
zipping it is a separate step, so re-zip after a rebuild if the handover should
carry the latest changes. The client unpacks that folder on
any **local fixed drive** — `C:\MAHER` and `D:\MAHER` both work, because every
path is resolved relative to the launcher — and double-clicks
**`MAHER MOBILE CARE.bat`**. No installer, no compiler, no Node install, no
internet. The shop window opens in Chrome/Edge app mode — no address bar, so it
behaves like normal desktop software.

A second partition (`D:`) survives a Windows reinstall that only formats `C:`,
which is why the shop chose it. It is **not** a backup: a full disk wipe, a dead
drive or an accidental delete takes `D:` too, so `data\backups` still needs a
pen-drive copy now and then.

```
MAHER\
├── MAHER MOBILE CARE.bat   ← double-click this
├── MAHER STOP.bat          ← stops the server by port owner
├── start-maher.bat         ← server-only fallback, for troubleshooting
├── README.txt              ← Bangla instructions for the shopkeeper
├── runtime\node.exe        ← bundled Node 22, nothing to install
├── app\                    ← standalone server + assets + migrations
├── data\                   ← shop.db + backups\  (THE SHOP'S RECORDS)
└── logs\maher.log          ← written here, safe to send to support
```

**`data\` is the whole point.** Shop records live in `data\shop.db`, outside the
app folder, so an upgrade can replace `app\` and `runtime\` wholesale without ever
touching the records. That was verified, not assumed: the `app\` folder was
deleted and rebuilt, and the existing record, roster and backups all survived.
Rebuilding the package itself also keeps them: `data\` and `logs\` are held
outside the wipe and put back afterwards, so `npm run build:portable` can never
delete the shop database (pinned by `scripts/portable-keep.test.js`).

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
- **The build machine's path was baked into the bundle.** Next inlines
  `import.meta.url`, so the generated Prisma Client shipped
  `fileURLToPath("file:///home/me/app/...")`. That path exists on the build
  machine, so every Linux test passed — on Windows it names a folder that does
  not exist, and since every API route imports the client, the page rendered
  while no API call could succeed (`ERR_INVALID_FILE_URL_PATH`).
  `scripts/build-portable.mjs` now rewrites that prefix to a runtime expression
  reading `__MAHER_APP__` (set to `__dirname` at the top of `server.js`), and
  the build fails if anything baked survives or a rewritten file stops parsing.

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
  MAHER STOP.bat            → stops the shop by port owner
  start-maher.bat           → server-only fallback for troubleshooting
  README.txt                → Bangla instructions shipped inside the package
tools/keygen-crm/           → STANDALONE admin desk (never shipped to the shop):
                              Ed25519 private key, CLI + localhost GUI, SQLite
                              customer ledger and one-click WhatsApp messages
PREPARE-WINDOWS.md          → step-by-step Windows handover guide (Bangla)
next.config.mjs             → keeps native better-sqlite3 out of the webpack bundle;
                              MAHER_STANDALONE=1 opts into the standalone build
tailwind.config.ts          → Tailwind theme + content globs
postcss.config.mjs          → PostCSS (Tailwind + Autoprefixer)
tsconfig.json / .eslintrc.json
.env                        → DATABASE_URL only (git-ignored, never commit)
.env.example                → committed template
app/
  page.tsx                 → thin redirect: `/` forwards date/edit/receipt/
                              status/mode params to `/service` (old bookmarks
                              keep working; the Home dashboard is gone)
  service/
    page.tsx               → the service desk route (parses + validates params)
    ServiceWorkspace.tsx   → the real workspace: state, data wiring, layout
                              (form column + list column, header, footer)
  products/
    page.tsx               → stock & product sales page (state + dialogs)
  layout.tsx               → Bengali metadata, font CSS, Toaster, LicenseProvider
                              (full-screen gate when the machine is locked)
  globals.css              → Tailwind + theme + overflow-x:clip (sticky-safe)
  icon.svg                 → favicon (local file, offline)
  fonts/                   → self-hosted Noto Sans Bengali: *.woff2 + @font-face
                              CSS + OFL.txt licence (bundled, zero network)
  api/
    health/route.ts        → GET = readiness probe (reports which DB file is live)
    license/status/route.ts → GET = machine ID, active/trial state, expiry, guard
    license/activate/route.ts → POST = Ed25519 + machine + expiry verification
    license/preview/route.ts → POST = read-only signature check for the renewal chip
    license/test/route.ts  → POST = env-guarded test hooks (never in a shop build)
    technicians/route.ts   → GET (?all=true) roster, POST add
    technicians/[id]/route.ts → PUT rename (2-step cascade), DELETE deactivate,
                                POST reactivate
    services/route.ts      → GET ?date= / ?from=&to= / ?all=1 (capped list +
                             count aggregate) / ?archived=true / ?groupId=, POST create
    services/batch/route.ts → POST one grouped visit (up to 8 devices, one transaction)
    services/[id]/route.ts → PUT update (incl. serviceDate/damageLoss/deliveryDate), DELETE = archive
    services/[id]/restore/route.ts → POST un-archive
    services/[id]/refund/route.ts → POST full-advance refund → status Returned
    services/dues/route.ts → GET = all-dates বাকি list + SQL-aggregate total
    services/overdue/route.ts → GET = delivery-date overdue list (landing summary)
    services/search/route.ts → GET ?q= all-dates search (minimum 2 characters)
    products/route.ts      → GET list / POST create, products/[id] → PUT / DELETE
                              (DELETE refuses while sales still reference it)
    product-categories/route.ts → GET / POST, [id] → PUT / DELETE (guard applies)
    parts-shops/route.ts   → GET ?all=true parts-shop names for the form shop picker
    stats/route.ts         → GET ?date= / ?from=&to= / ?all=1 daily + per-technician totals
    stats/monthly/route.ts → GET ?date= (rolling 30d) or ?from=&to= range
    backup/route.ts        → GET = CSV, Excel (?format=xlsx), system SQLite
                              snapshot (?format=system) or PDF (?format=pdf),
                              POST = DB snapshot + prune
    backup/list/route.ts   → GET = snapshot list
    backup/restore/route.ts→ POST = restore a named snapshot or an uploaded
                              .db / .sql / .maherbackup file (atomic +
                              column-validated, ShopSettings never swapped)
components/
  AppHeader.tsx            → the live header: sticky navbar, date nav, আজ,
                             Sync, Backup, Restore, ⚙️ technician, Print,
                             search (Ctrl+K) + nav links
  AppNavLinks.tsx          → renders lib/nav-links.ts (সার্ভিস / প্রোডাক্ট / পার্টস;
                              service desk is landing)
  Header.tsx, ProductsHeader.tsx → legacy headers, currently unimported
  HeaderSearch.tsx         → navbar search: live dropdown; mobile 🔍 sheet
  HeaderDatePicker.tsx     → calendar popover in the header (opens once,
                             toggles closed on the second click)
  PageLead.tsx             → page lead block under the header (title + sub)
  BrandMark.tsx            → logo mark used by the header
  licensing/LicenseProvider.tsx → root status fetch + global gatekeeper
  licensing/LicenseGate.tsx → premium full-screen activation screen (machine ID,
                              copy feedback, key, support bar), only when locked
  licensing/license-context.ts → shared status/activate context for card + gate
  dashboard/LicenseCard.tsx → premium subscription hub: status badge, progress
                              bar, machine ID, WhatsApp support, renewal modal
  DailySummary.tsx         → daily cards row (wraps TodayStats + TechnicianStats)
  TechnicianStats.tsx      → one card per roster technician (5-col desktop grid)
  TodayStats.tsx           → 4 daily cards (কাজ/বিল/বাকি/খরচ) + refund/damage hints
  MonthlySummary.tsx       → range report cards/presets (dialog + hidden print
                             copy; the dialog alone shows the PDF/CSV/Excel row)
  ServiceForm.tsx          → entry form (4/12): service/product toggle, live due,
                             numbered multi-device rows with one shared visit
                             money block, optional IMEI per device, expected
                             delivery date (no device-lock field)
  ServiceTable.tsx         → service list (8/12): date-mode switch (একদিন/
                             তারিখ রেঞ্জ/সব তারিখ) with per-day sections,
                             search, chips, universal/row eye,
                             1-click status, group/device badges (sr-only for
                             screen readers), delivery dates, sticky actions
  ServiceAdjustDialog.tsx  → ⚖️ return/refund + parts-cost write-off + damage ledger
  OutstandingDues.tsx      → বাকি table rendered inside the dues dialog (grouped
                             into date sections with per-day subtotals)
  report/ReportDocument.tsx → off-screen Bengali report sheet captured into the
                             multi-page PDF export
  ContactButtons.tsx       → phone / WhatsApp links (message text from lib/contact.ts)
  StatusBadge.tsx          → colored Bengali status badges
  Receipt.tsx              → customer bill (single + combined group slip, print/PDF)
                             + PaidStamp (জমা paid marker)
  dashboard/BackupExportDialog.tsx → 4-format backup picker on the Dashboard
  RestoreDialog.tsx        → uploaded file / snapshot list + 2-step restore confirm
  TechnicianManager.tsx    → roster dialog: add / rename / deactivate / reactivate
  ProductDialog.tsx        → product create/edit dialog (products page)
  CategoryManagerDialog.tsx→ category add/rename/delete dialog (products page)
  PurchasesPanel.tsx       → দোকান ও ক্রয় tab: purchase bills, summary cards,
                              supplier payment dialog (oldest bill first)
  PurchaseDialog.tsx       → নতুন ক্রয়: supplier/invoice/date, line items,
                              optional now-payment; receiving writes stock
  PaymentDialog.tsx        → টাকা নিন: amount, method (নগদ/বিকাশ/অন্য), note,
                              live slip preview (oldest first, no overpay)
  AutoBackup.tsx           → client-side backup nudge (mounted in app/layout)
  ui/                      → shadcn primitives (button, input, table, dialog…)
lib/
  prisma.ts                → cached Prisma client + local SQLite adapter
  db-path.ts               → single source of truth for the DB file + backup dir
  licensing/machine-id.ts  → deterministic Windows/macOS/Linux hardware fingerprint
  licensing/hardware.ts    → getMachineFingerprint() alias; hardware-only, no shop/DB reads
  licensing/crypto.ts      → Ed25519 token verification (public key only)
  licensing/public-key.ts  → generated public key — the only key in the app
  licensing/clock-guard.ts → monotonic lastSeenTimestamp, >1h rollback lock
  licensing/license-store.ts → atomic local state/trial/clock file
  licensing/license-status.ts → status computation shared by both API routes
  licensing/types.ts       → dependency-free DTOs for client + server
  technicians.ts           → roster rules: normalize, duplicate guard, cascade rename,
                             card list (active ∪ worked-today), last-active guard
  service-validation.ts    → shared create/update rules (UI and API can't drift)
  dhaka.ts                 → Asia/Dhaka day bounds, real calendar-date validation
  nav-links.ts             → single source of truth for the three navbar destinations
                              (pure data: key/route/Bengali label; no React)
  utils.ts                 → statuses (incl. Returned), Bengali-digit parse, due,
                             ৳ format (+ FALLBACK_TECHNICIANS, only used if the
                             roster request fails)
  types.ts                 → shared DTOs (ServiceDTO, stats, RangeMode,
                             ListMode + ServicesListResponse, product/stock
                             DTOs…)
  inventory.ts             → stock rules: Bengali status labels, low-stock
                             threshold, movement validation
  inventory-data.ts        → product/category/stock read-write helpers used by
                             the products API routes
  payments.ts              → customer receipts: normalize customer key, validate
                             amount/method, allocate oldest unpaid slip first,
                             refuse overpay, per-customer ledger
  payment-methods.ts       → client-safe method vocabulary (CASH/BKASH/OTHER +
                             Bengali labels), re-exported by payments.ts
  purchases.ts             → supplier bills: validate lines, receive stock,
                             supplier payments oldest-first, refuse overpay
  expense-code.ts          → shop-expense keypad code (*J# ⇄ 1500) encode/decode,
                             mirrored on server and form
  contact.ts               → WhatsApp/phone message text
  shop.ts                  → shop name/address/phone (receipt + footer source)
  receipt-pdf.ts           → client-side receipt PDF file name + download
  download.ts              → shared Blob → browser download helper
  export.ts                → shared report layout (newest-first sort, Bengali status, daily roll-up),
                             BOM CSV + ExcelJS xlsx builders, paginate helper, privacy column policy
  backup-workbook.ts       → server-side Excel backup workbook (ExcelJS):
                             summary, date-ordered service ledger, full audit
  report-pdf.ts            → multi-page A4 report PDF (one PDF page per report page)
  backup.ts                → shared localStorage keys/stamps for auto-backup
  use-last-backup.ts       → hook: last-backup stamp (AutoBackup + backup strip)
  use-media-query.ts       → hook: CSS media query, SSR-safe (defaultValue first)
  generated/               → Prisma client output (generated, do not edit)
prisma/
  schema.prisma            → Service model (33 columns, incl. return/refund/damage,
                              write-off, grouped visits, delivery dates, optional
                              IMEI, check-off + archived soft-delete) + Technician
                              model (v1.1 roster) + inventory models:
                              ProductCategory, Product, SaleItem, StockMovement
                               + payments/purchases: Payment, PaymentAllocation,
                               Purchase, PurchaseItem, PurchasePayment,
                               PurchasePaymentAllocation, ServicePart
  dev.db                   → THE database (all shop records — back this up!)
  migrations/              → init + add_archived + add_technician + add_parts_shop
                              + add_return_refund_damage_loss
                              + add_group_delivery_expense_flag
                              + add_service_imei + add_inventory + stock_sync
                               + sale_line_price_note + add_solution_condition
                               + add_payments_purchases + add_service_parts
                               + add_service_part_purchases
                               + clear_demo_technician_seed (untouched DB only)
backups/                   → snapshots: maher-*.db (keeps 30) + safety-*.db (keeps 5)
scripts/
  run-tests.js             → npm test: one fresh throwaway DB per suite + live-DB
                              guard; legacy roster seeded on throwaway DBs only
                              (clean-slate suite excepted)
  build-portable.mjs       → npm run build:portable: bundle Node 22, swap in the
                             Windows better-sqlite3, strip leaks, assert no .db/.env
  first-run.mjs            → create/upgrade the shop DB without the Prisma CLI;
                             converts old numeric expense rows to codes on every start
  launch.mjs               → start the server, wait for real readiness, open the window
                               (--stop ends it by port owner)
    launch-decide.mjs         → reuse / takeover / refuse rules, unit tested
  audit-money.ts           → dry-run ledger audit; --confirm applies safe repairs
  backfill-expense-codes.ts→ dry-run/convert old expense rows; --confirm writes
  expense-upgrade.test.js  → first-run/backfill/audit repair suite (10 checks)
  test-support.js          → shared browser helpers (launch, type, wait, api…)
  offline-licensing.test.js → isolated licensing suite: machine ID, signature/
                              machine/expiry rejection, clock lock, activation,
                              dashboard renewal (own license file + test hooks)
  e2e-maher.js             → core flow E2E (9 checks)
  e2e-p0.js                → P0 features E2E (11 checks)
  laneA.js                 → Lane A audit (26 checks)
  laneBC.js                → Lanes B+C audit (24 checks)
  laneD.js                 → redesign/search/product-sale audit (19 checks)
  laneE.js                 → return/refund + damage-loss/write-off audit (18 checks)
  laneF.js                 → v1.2.0 grouped visits, delivery dates, returned-row
                             edit + write-off audit (22 checks)
  laneG.js                 → optional IMEI, posted lock fields ignored,
                             multi-device independence (18 checks)
  laneH.js                 → per-device solution + per-visit condition:
                             validation, সমাধান খাতা search, receipt শর্ত,
                             grouped copy, old-snapshot restore (14 checks)
  laneI.js                 → Phase 2 payments & purchases: allocation
                              oldest-first, overpay, paid-slip lock, retired
                              verify tick (404), purchase intake + supplier
                              dues (20 checks)
  laneJ.js                 → service-part purchase bills: linked device,
                              wholesale lines, partial supplier payment and
                              cost isolation (5 checks)
  laneK.js                 → customer history by normalized mobile number:
                              history dialog, header search shows সমাধান/শর্ত
                              only for number queries (7 checks)
  laneLanding.js           → `/` redirect, exactly three nav links, refresh +
                             backup + restore on the Service page (10 checks)
  product-dashboard.js     → stock-room metric cards + corner icons, 10s privacy
                              reveal, unified toolbar, status chips, quick
                              STOCK_IN + toast, both empty states (17)
  api-check.js             → API contract + validation + restore-guard + roster (67)
  technician-mgmt.js       → v1.1 roster dialog + card filtering (25 checks)
  responsive-check.js      → 10 widths, 360–1920px: header, search, card/table,
                             grid, sticky actions + dialogs (74 checks)
  date-nav-flicker.js      → changing day keeps the list on screen, no skeletons (4)
  header-calendar.js       → the navbar calendar closes on the 2nd click (5)
  real-viewport.js         → laptop-height layout: 1280x585/650, 1366x650,
                             1536x730, 1920x1080 (9 checks)
  launcher-decide.test.js  → launcher reuse / takeover / refuse rules (14 checks)
  portable-keep.test.js    → a portable rebuild keeps the shop DB intact (10 checks)
  service-part-resolution.js → 4-way part status, stock/writeoff/damage,
                               restore + privacy (25 checks)
  parts-date-shop-filter.js → /parts 3-mode date switcher, saved+past shop
                               dropdown, table/card scope, visible code +
                               masked amount, row/reveal-all eyes, badge
                               colours, toolbar line, shop dashboard + jump (20)
  service-return-workflow.js → checking fee, warranty/custom refunds, grouped
                               cash/transfer, bulk part resolution (22 checks)
  form-field-order.js      → new entry and Edit share field order AND structure
                              (form-more + device-1 card, same labels, both bill
                              inputs editable and in sync), no duplicate svc-*
                              ids, saved parts keep their entry order, clean field copy (11)
  customer-address-warranty.js → visit address + per-device warranty: validation,
                               form chips, both searches, receipts, grouped and
                               product-anchor copy, old-snapshot restore (13)
  dashboard-cipher-qc.js   → Secret Code Engine/Converter QC contract: live
                              bidirectional converter, unified 11-card keypad,
                              collision banner + rose field styling, sr-only
                              legacy word input, shared Save/Sync gate (15 checks)
  clean-slate-fresh-install.js → fresh DB has zero services/debts/products/staff,
                              empty profile, onboarding banner and MSS chrome (10)
  mss-rebrand-contract.js  → MSS platform brand, dynamic tenant identity, empty
                               first run, private wire ids and shipped docs (24)
  mss-update-contract.js   → reinstall over an existing MSS is an in-place update:
                               chosen data root kept, pending migrations + safety
                               snapshot, idempotent rerun (9)
  mss-installer-contract.js → assisted wizard, D:\MSS-Data default, drive C rejected,
                               Update / Cancel prompt, legacy AppData move (15)
  service-list-design.js   → Counter Ledger design contract (19 checks) — kept OUT
                              of the default run; run it with MAHER_TEST_SUITES
                              =scripts/service-list-design.js npm test
  seed-maher.ts            → 16 sample entries (tsx)
  cleanup-test-data.ts     → dry-run list + `--confirm` cleanup of leftover test rows
out/                        → build output: MAHER/ package + zip (git-ignored)
```

> There is no `public/` folder — every asset (icon, font, CSS) lives under
> `app/`, which is why the app has no external file dependencies at runtime.

---

## 4. Features (user manual, short)

**Service desk (the landing page):**
- The shop opens on the service desk; `/` is a thin redirect that forwards any
  bookmarked `date` / `edit` / `receipt` / `status` / `mode` params to it. The
  header carries exactly two destinations: **সার্ভিস** (this page) and
  **স্টক** (`/products`, the stock page).
- Sticky blue-gradient navbar — date prev/next/picker, **আজ**, Sync, Backup,
  Restore, টেকনিশিয়ান, Print, plus the **navbar search**:
  `🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)`. Typing 2+ characters shows a
  live dropdown; clicking a result opens its receipt, and the pencil loads it
  into the form. `Ctrl+K` focuses the input; below 1280px a 🔍 icon opens a top
  search sheet. The header compacts to three rows on phones/tablets and two rows
  from 1280px, so it never eats half the screen. Keyboard `←`/`→` changes day
  (not while typing). The two search boxes state their scope: the header search
  keeps `🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)` and searches every day;
  typing a **mobile number** (local `01…` or `+880…`) lists that customer's
  older jobs with **every detail** — date, model, problem, technician,
  বিল / জমা / বাকি, delivery date, status — plus the stored **সমাধান** and
  **শর্ত** notes, so the technician can read the past fix before starting;
  the service list's own search reads **এই তালিকায় খুঁজুন...** and filters only
  what is on screen, with the searchable fields in its `aria-label`/`title`.
  Both carry `data-scope`.
- **নতুন সার্ভিস এন্ট্রি** — this is now just the heading of the entry form;
  the duplicate masthead button with the same label was removed. Deep links and
  the header CTA still scroll to the form and put the cursor in কাস্টমারের নাম
  (on a phone they switch to the form tab first).
- Technician cards — one per **active** technician (card count follows the
  roster), plus a greyed “নিষ্ক্রিয়” card for anyone who has left the shop but
  still has work on the shown date, so the day's cards always add up to
  আজকের মোট কাজ. Cards sit in a 5-column desktop grid (3 on tablet, 2 on phone)
  and **clicking one filters the daily list to that technician**; clicking it
  again clears the filter.
- 4 daily cards — কাজ / বিল / বাকি / খরচ. The খরচ card always shows the real
  decoded total **including damage loss** (+`Nটি কোড` hint when codes are in
  use). The বিল card also shows **জমা** (advance) and, when applicable, the
  refund memo. Only the service table's cost codes stay private. A returned job
  adds `+Nটি ফেরত` under কাজ; returned bills are excluded from বিল, বাকি and
  technician totals.
- **📊 ওভারঅল রিপোর্ট** opens the report dialog: **একদিন / তারিখ রেঞ্জ / সব
  তারিখ** (রেঞ্জ default), presets (বিগত ৩০ দিন / এই মাস / গত মাস) + custom
  থেকে–পর্যন্ত in range mode, then cards কাজ / বিল / খরচ / **বাকি** / লাভ + the
  window label. বিল shows **জমা** as a hint. লাভ = বিল − খরচ − ড্যামেজ ক্ষতি.
  Returned refunds are grouped by the job's service date (not the later refund
  timestamp). Below the cards a **কাস্টমার ডিটেইল রিপোর্ট** table lists every
  row of the chosen window — তারিখ / বিল নং / কাস্টমার / ফোন / মডেল / সমস্যা /
  টেকনিশিয়ান / অবস্থা / বিল / জমা / বাকি / ফেরত — with returned rows showing
  their refund + return date and বাকি ৳0; 300 rows render first and **আরও
  দেখুন** appends the rest. Presets follow the navbar date; custom stays fixed.
  Close with X or Escape. Dashboard printing still carries the same report via a
  hidden print-only copy.
- **💰 বাকি তালিকা** — a status chip row **সব / পেন্ডিং / চলছে / সম্পন্ন /
  ডেলিভারি / ফেরত** above the dues list, with live visit counts and the same
  coloured dots as the service list. Chips filter the visit rows; **ফেরত**
  explains that a returned job never carries বাকি and offers **সব দেখান**. The
  row scrolls inside itself on narrow screens without widening the dialog.
- **Report export (post-v1.2.0)** — the report dialog has an
  “এই হিসাবের এক্সপোর্ট:” row with **PDF / CSV / Excel**, always following the
  chosen window (একদিন / তারিখ রেঞ্জ / সব তারিখ) and its presets. All three
  build locally (offline, no cloud) from one shared layout so all three agree:
  title + window → summary → daily roll-up → detail ledger → footer, newest
  day / highest id first, with Bengali status labels. CSV is UTF-8 **with BOM**
  + CRLF + every cell quoted (Excel-safe on Windows); Excel is a real `.xlsx`
  with 3 titled sheets (সারাংশ / দৈনিক ভাঙতি / সার্ভিস) via **ExcelJS**, with
  column widths, frozen headers and totals rows; the PDF captures the
  print-friendly Bengali report sheet one section page per A4 sheet, repeating
  headings and page n/N (detail capped at 1000 rows with an on-page notice,
  CSV/Excel carry up to 5000). Returned-only days with no work or cost are
  dropped from the roll-up. Row blocks include **ফেরত / ফেরত তারিখ** but never
  per-row খরচ / write-off flags / IMEI / notes — only the aggregate খরচ appears.
  Files are stamped `MSS-Report-<from>_<to>.*`, or `MSS-Report-all.*` for
  সব তারিখ. The sheet headline uses the live shop name (MSS before setup).
  Export buttons exist only in the dialog, never in the print copy.
- **List date modes (post-v1.2.0)** — a segmented switch on the service list
  masthead: **একদিন** (default, byte-identical legacy view with the day nav and
  `←`/`→` keys), **তারিখ রেঞ্জ** (শুরু/শেষ pickers; starts as the selected day
  and widens freely) and **সব তারিখ** (whole ledger). Multi-date views group
  rows under per-day section headers (Bengali date + visit/device/৳ subtotal),
  newest day first, on both the desktop table and the mobile cards. The API
  serves `?from&to` / `?all=1` with a SQL `count()` aggregate and the client
  renders at most 300 rows per page behind a **মোট X টি** notice with an
  **আরও দেখুন** append button — day mode's `{date, services}` response is
  unchanged for every existing caller.
- Entry form — all fields, **বাকি auto-calculates live**, Bengali digits
  accepted (`১৬০০` → 1600). Shop expense accepts a number or a keypad code
  (`*J#` → 1500). A plain number is converted to the canonical code on save
  (`1500` → `*J#`, `1234` → `*ADG`), while a typed code stays as typed. The live
  badge previews the code and decoded amount (`গোপন কোড: *J# ➔ ৳১৫০০`). There is
  also a free-text **পার্টস কেনার দোকান** field with previous-name suggestions.
  Edit reuses the same form (incl. date correction — no delete+recreate).
- **👥 এক কাস্টমারের একাধিক ডিভাইস** — a new visit can carry up to **8
  devices**, added one at a time from the inline control under the first card
  (cards are numbered ডিভাইস ১, ডিভাইস ২, …; a blank extra card is ignored).
  Entered **once for the visit**: customer, phone, technician, status, service
  date, **মোট বিল** and **জমা**. Each device card keeps only model, problem and
  an optional bill, plus its optional IMEI and its own expected delivery day.
  Filled device bills auto-sum into the visit total (otherwise ডিভাইস ১ holds
  the typed total), and জমা is waterfall-allocated across devices so no row
  overpays. Shop cost and parts shop live on ডিভাইস ১ only, so a grouped visit
  can never multiply the shop's expense. A grouped save is one transaction with
  a shared `groupId`, and each row carries a **👥 গ্রুপ** badge (`sr-only`).
  Opening the bill or PDF from any row renders **one combined receipt** with
  every device, per-device money and grand totals. Editing remains per-device.
- **ডেলিভারির সম্ভাব্য তারিখ (v1.2.0)** — an optional date on the entry form
  (one per device in a grouped visit; a single shared date still works for
  older API callers). The list shows `ডেলিভারি: YYYY-MM-DD` and turns
  it red with ⚠️ once the day has passed. The moment status becomes
  **ডেলিভারি**, the server stamps the actual `deliveredAt` and the list/receipt
  shows `✅ ডেলিভারি: YYYY-MM-DD`; reopening the job or returning it clears
  that stamp, so a stale handover date can never print.
- **IMEI (optional, post-v1.2.0)** — every device row can carry an IMEI
  (max 32 chars, stored exactly as typed). It is internal: the list and the
  customer receipt never show it, but it is included in the backup export
  (Excel audit sheet and CSV). The
  former device-lock fields are gone from the form entirely — unlock
  credentials are not stored anywhere, and lock fields posted by an API client
  are ignored (`laneG.js` pins both rules).
- **Counter Ledger look (post-v1.2.0)** — the whole app is a calm accounting
  desk: graphite-navy chrome `#223D57` on flat surfaces (no gloss sweep), a
  neutral paper page `#F3F5F7`, white cards, ink `#1F2A36` headings, `#5E6B78`
  secondary text, `#D9E0E7` hairlines, 12–16px card radii and 150–200ms
  transitions; meaning colours are muted forest `#2E7D5C`, bronze `#8A5A12`
  and brick `#B23A3A` (ochre `#9A6714` for warnings).
  `scripts/service-list-design.js` (19 checks) pins the service-list half of
  that contract.
- **স্টক page (`/products`)** — eyebrow “স্টক রুম”, title “প্রোডাক্ট ও
  ইনভেন্টরি” with a live count badge; the two page actions sit on the right
  (**＋ নতুন প্রোডাক্ট**, **⚙️ ক্যাটাগরি ব্যবস্থাপনা**). Four summary cards carry
  corner micro-icons (blue `Package`, emerald `Boxes`, amber `AlertTriangle`,
  slate `Wallet`); the amber low-stock card is a button that activates the
  **⚠️ কম স্টক** chip, and the wallet card's eye reveals the internal valuation
  for ten seconds with the tooltip
  “দোকানের ক্রয়মূল্য ও ইনভেন্টরি মূল্য দেখুন (১০ সেকেন্ড)”. The search field
  (`id="product-search"`) and category select share one filter bar directly
  above the stock-status chips, so the counter laptop never scrolls sideways.
  A true zero-product shop gets an onboarding box pointing at the category
  manager; a filtered zero gets **ফিল্টার রিসেট করুন** instead. Everything is
  served from the live `ProductCategory` / `Product` tables (creating a product
  logs its opening stock as a `StockMovement`). The `SaleItem` sale-line table
  and the `saleRef` idempotency key already exist in the schema as the foundation
  for linking product sales to stock, but app code does not write them yet.
- **🛍️ প্রোডাক্ট সেল** — a toggle at the top of the form switches between
  🛠️ সার্ভিসিং (default) and product sale. Product mode renames the fields to
  **প্রোডাক্টের নাম (যেমন: Charger, Cable)** and **বিবরণ (যেমন: 18W Type-C)**,
  forces অবস্থা to **ডেলিভারি** (select disabled), and keeps the expense-code
  field. Rows are stored in the existing `model`/`problem` columns, so there is
  no schema change. Create a `SALES`/`দোকান` technician via ⚙️; it sorts first
  in product mode. Editing such a row reopens in product mode.
- **Overpay is rejected.** জমা can never exceed মোট বিল — the save is blocked
  with “জমা মোট বিলের বেশি হতে পারে না”.
- **⚖️ ফেরত / ড্যামেজ ক্ষতি** on an active row (including **ডেলিভারি**) opens one
  dialog with two tabs. **ফেরত / রিফান্ড** closes the job as **ফেরত**, clears
  `deliveredAt`/বাকি and accepts an optional **চেকিং / সার্ভিস ফি (৳)** plus a
  custom **কাস্টমারকে ফেরত (৳)**; leaving both blank keeps the original
  full-advance refund. A grouped visit can instead choose **গ্রুপের অন্য ডিভাইসে
  জমা করুন** — the retained advance moves to an active sibling's জমা and reduces
  its বাকি, with no cash leaving the drawer. Attached parts are listed with
  one-click bulk resolution (**সব পার্টস মহাজনে ফেরত**, **সব পার্টস দোকানের স্টকে
  জমা**, **কাজের সময় নষ্ট হয়েছে**) in the same transaction as the return. When
  a parts cost has no bulk choice, the tab still asks whether it was
  **written off** (parts unused/returned) or **kept** as a shop loss; old API
  callers that omit the choice keep the cost, so nothing silently disappears.
  **ড্যামেজ ক্ষতি** records an internal technician-damage cost; it never alters
  the customer's bill. No supplier price, parts-shop name or damage loss is
  printed on a receipt/PDF.
- **A returned row stays safely editable (v1.2.0).** The pencil is available
  again for customer, phone, model, problem, technician, service date, shop
  expense/parts shop, delivery date and damage loss/note. Bill, জমা, বাকি and
  status remain locked (read-only in the form; the API rejects any attempt with
  400), and the refund amount/date never change. Correcting a typo no longer
  requires a full restore.
- A written-off parts cost stays on the row for audit (code + amount + a grey
  **বাতিল** badge) but is excluded from খরচ/profit; `damageLoss` is always
  reported and never written off.
- **💰 বাকি তালিকা** — the button itself shows the live count and total
  (`১টি • ৳৭০০`) and opens a dialog containing every active record with money
  outstanding, independent of the selected day. Desktop keeps
  `তারিখ | কাস্টমার | মডেল/অবস্থা | বিল/জমা/বাকি | যোগাযোগ | অ্যাকশন`; below
  1024px the same records become cards with call + WhatsApp buttons per record.
  Rows are grouped into **date sections** (newest first), each with its own
  “Nটি বাকি • ৳মোট” subtotal, and বিল/জমা/বাকি align in one column while the
  exact `বিল: ৳X` text is preserved; every icon action carries an
  `aria-label` + tooltip. The **মোট বাকি** headline is a SQL aggregate over
  *all* matching rows, so it stays 100% accurate even when the rendered list
  is capped. Close with X or Escape.
- **Responsive dashboard** — navbar → report/dues buttons → technician cards →
  today's cards → form + service list → footer. Below 1280px the form and list
  stack; at 1280px+ they sit side by side (340px form + the rest; 380px form
  from 1536px), and the shared page container steps up 1280px → 1600px (xl) →
  1840px (2xl) — header, cards, list and footer always share that width. At
  1920×1080 the complete entry form and its save button fit without scrolling
  the page.
- **⚙️ টেকনিশিয়ান** (header) → **টেকনিশিয়ান ব্যবস্থাপনা** dialog: add, rename and
  deactivate technicians. Renaming asks first when it would rewrite history;
  deleting is a soft-delete that keeps every old record intact.
- Service list — a table at 1024px+ and touch-friendly cards below 1024px, so
  every action is reachable without sideways scrolling. On desktop the list
  column never needs a sideways scroll of its own: the grid track is
  `minmax(0, 1fr)`, so the table compresses to its content floor instead of
  pushing the page wide (floor ≈ 678px, comfortable from 1280px up). The
  table's action column stays pinned to the right when the table scrolls.
  Client-side filter
  within the selected day (name / ID / phone / model / problem), status chips
  with counts — **সব / পেন্ডিং / চলছে / সম্পন্ন / ডেলিভারি / ফেরত / বাকি**. The
  last chip is a money filter, not a seventh status: it keeps only visits whose
  device still has `বাকি > 0` and isn't Returned (the same rule as
  `/api/services/dues`), so the dues list is reachable without leaving the list.
  The **খরচ** column is always visible and shows the stored code.
  A header **খরচ দেখান** button reveals every row at once (and **খরচ লুকান**
  hides them again; the pressed button keeps its navy fill, so it never fades
  into the white toolbar), while each row's own eye reveals **only that row's**
  amount for 10 seconds. A legacy plain-number value is masked as `৳••••` until
  it is converted, and a written-off cost carries a grey **বাতিল** badge. The
  parts-shop name sits under the code. Grouped devices show a **👥 গ্রুপ** badge
  (and a visit shows “Nটি ডিভাইস”); both sit in an `sr-only` wrapper, so screen
  readers still announce them while the visible ID column stays narrow. The
  expected/actual delivery date sits under the status badge.
  **1-click status advance**
  (badge click → next stage; ফেরত is terminal and skips this cycle),
  edit/delete(→archive), **⚖️ return/damage**, plus per-row **bill print**,
  **WhatsApp chat/call**, and **PDF Export & Share** buttons. WhatsApp opens the
  customer's chat; inside WhatsApp the normal **Start call** action is available.
  PDF Export & Share renders the same receipt locally and hands a real PDF to the
  Windows share sheet, with a download + customer-specific `wa.me` fallback.

**Safety:**
- Delete = archive (soft). Archive view (all dates) + 1-click restore.
- **Backup button = a 4-format picker**, not an immediate download. Choose
  **সম্পূর্ণ সিস্টেম রিকভারি ব্যাকআপ** (`MAHER_SYSTEM_BACKUP_YYYY-MM-DD_HH-mm.db`,
  a SQLite snapshot with the local `ShopSettings` row removed), **এক্সেল
  স্প্রেডশিট**, **পিডিএফ সামারি রিপোর্ট** or **সিএসভি ডাটা ফাইল**. Server
  snapshots (`backups/maher-*.db`, newest **30** kept) still happen with the
  scheduled/auto path and the “সর্বশেষ ব্যাকআপ” label updates on every export.
  The Excel workbook has Bengali headers, frozen/filterable
  headers, date/currency formats and totals. It has
  **সারসংক্ষেপ / সার্ভিস খাতা / সম্পূর্ণ ডেটা (অডিট)** sheets;
  the ledger is one flat 12-column table, oldest date first with a running
  **ক্রম** (তারিখ / কাস্টমার / ফোন / মডেল / সমস্যা / টেকনিশিয়ান / অবস্থা /
  বিল / জমা / বাকি / ডেলিভারি), and the audit sheet plus `GET /api/backup`
  CSV carry every column, including cost, return/refund/damage, inspection fee
  and reason, write-off, group, delivery, IMEI and `saleRef`.
- The Service desk keeps **ব্যাকআপ** one click away in the compact strip beside
  the stamp; **রিফ্রেশ** and **ব্যাকআপ থেকে রিস্টোর…** live behind **⋯ → ডেটা ও
  ব্যাকআপ**, and the strip says **ডেটা এই PC-তে** instead of an online/offline
  badge. Restore still uses its own 2-step confirmation dialog.
- Auto snapshot on first load of the day (staff can forget safely).
- Restore dialog = upload a `.db` / `.sql` / `.maherbackup` file **or** pick an
  older snapshot, then confirm twice. The exact warning is
  `সতর্কতা: ব্যাকআপ ফাইলটি রিস্টোর করলে বর্তমানের অসংরক্ষিত ডাটা প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?`
  and success shows `ডাটা সফলভাবে রিস্টোর করা হয়েছে!`. Uploads are checked for
  extension, SQLite magic bytes (or a safe `Service`-creating SQL dump) and the
  expected schema *before* a safety copy is made. A restore first writes
  `backups/safety-*.db` (newest **5** kept) holding your *current* data, so a
  wrong restore is itself restorable. The swap is atomic and
  snapshot-column-validated — a bad snapshot is rejected *before* anything is
  touched. `ShopSettings` id 1 is never read or replaced, and a successful
  restore refreshes the global shop-settings context. Older snapshots without
  the optional columns still restore; those fields default to
  `NULL`/`0`/`false` (including `groupId`, `deliveryDate`, `deliveredAt` and
  `expenseWrittenOff`). A restored pre-v1.1.3 numeric shop expense
  is converted to a code immediately; the same repair also runs on every start.
- Archiving a returned job warns that its refund, expense and damage loss also
  leave every report and the profit calculation.
- Print guard blocks blank prints; paper gets receipt-only or clean dashboard.

**Customer bill (print/PDF):**
- Preview dialog → print. Shop header (name/slogan/address/phone/terms from the
  live `ShopSettings` profile, never a hardcoded store), `বিল নং` (= row id),
  date, status, customer + job + technician, বিল / জমা / **বাকি**, the customer's
  name in the signature area, and “ধন্যবাদ, আবার আসবেন”. Before setup the name
  reads `আপনার দোকানের নাম`; empty address/phone lines are omitted. The old
  “Chandra Rd.” text was removed in v1.0.3.
- A navy **PAID** seal is printed only when `due = 0` and `totalBill > 0`
  (fully paid). Unpaid and partial bills never show it, and a returned job
  never shows it.
- A returned job's customer copy explains that the work was not completed and
  the full জমা was refunded, and prints the refund line. It never prints the
  damage loss or its internal note.
- **Grouped visit → one combined customer copy (v1.2.0).** Opening the bill/PDF
  from any device in a group loads every non-archived row for that `groupId`
  and prints one slip: all devices on separate lines, per-device bill/জমা/বাকি,
  a grand total, one PAID seal only when the whole visit is paid, and the
  expected (or actual) delivery date. A single row keeps the classic receipt.
- The receipt prints `ডেলিভারির সম্ভাব্য তারিখ` when only an expected date
  exists, and switches to `ডেলিভারি সম্পন্ন` once the actual handover is stamped.
- The daily-row **PDF শেয়ার** button captures this same receipt into an A4 PDF
  (`jspdf` + `html2canvas`, both lazy-loaded) and opens the OS share sheet.
  WhatsApp is a share target; the user picks the customer and presses **Send**.
  Where file sharing is unavailable, the PDF downloads and the customer's
  `wa.me` chat opens for a manual attachment. A `wa.me` link cannot attach a
  file itself, and the Windows share sheet cannot be forced to preselect one
  contact; true zero-click auto-send would require the online WhatsApp
  Business Cloud API, which is intentionally not part of this offline app.
- **Shop cost, the parts-shop name and the damage loss never appear on the
  customer copy** — enforced in `Receipt.tsx` and covered by laneA/laneBC/laneE/
  laneF regression checks.

---

## 5. Business rules (locked)

- `due = max(0, totalBill − advance)` — always derived, never typed. A
  **Returned** row is the one exception: it keeps its original bill/advance for
  audit but stores `due = 0`, so it can never reappear in বাকি তালিকা.
- **Overpay is invalid data, not a discount.** `advance ≤ totalBill` is enforced
  in the shared validator, so both the form and `POST`/`PUT /api/services`
  reject it with 400. A bill paid in full (`advance = totalBill`) is fine and
  simply leaves `due = 0`, which is what removes it from বাকি তালিকা.
- Repair status and payment are **independent**: setting `Completed` or
  `Delivered` does not clear বাকি. A row leaves বাকি তালিকা only when its money
  is actually collected.
- `shopExpense` stores a **canonical keypad code**. A typed number is converted
  on save (`1500` → `*J#`); a typed code stays as typed. Both are decoded by the
  shared server decoder into `expenseAmount` (1500). Both count in খরচ/profit
  unless the row is returned with `expenseWrittenOff = true`.
- **Secret-code mapping:** `*`=1, `+`=0, `#`=00, ABC=2, DEF=3, GHI=4,
  JKL=5, MNO=6, PQRS=7, TUV=8, WXYZ=9; digits stay as typed and lowercase is
  accepted. Canonical encoding uses the first letter of each group:
  `0→+`, `1→*`, `2→A`, `3→D`, … `9→W`, with `00→#`.
  Examples: `*J#`=1500, `T#`=800, `GJ+`=450, `*M#`=1600, `*B#`=1200
  (`B`/`C` remain valid aliases for `2`; only newly encoded numbers use `A`).
- `partsShop` is internal-only free text (≤100 chars) and never printed.
- `damageLoss` is a separate internal shop cost for technician-caused damage
  (≤ ৳ scope is the same numeric rules as a bill). It is **not** `shopExpense`
  and never touches the customer's bill or receipt.
- **Return/refund is bounded by the recorded জমা — full, custom or fee-less.**
  `POST /api/services/[id]/refund` sets `status = Returned`, `returnedAt`,
  `due = 0`, `deliveredAt = null` and `refundAmount` to the cash actually handed
  back. With no body it still returns the whole জমা and keeps the original bill/
  advance for audit. `inspectionFee` retains a diagnostic charge: the default
  cash back is `advance − fee`, and a **fee return** promotes the retained
  amount to the row's final `totalBill`/`advance` (due 0) so it reports as pure
  labour income. `refundAmount` allows a smaller/custom cash refund; without a
  fee the original bill/advance stay untouched for audit. `fee ≤ advance` and
  `refund + fee ≤ advance` are enforced (400), as is overpay. Delivered jobs may
  be reversed as warranty returns; archived and already-returned rows may not.
  Only that endpoint may set `Returned`; the normal create/edit form cannot.
- **Grouped partial return: cash or transfer, never both.** A grouped device can
  send `advanceAction: "transfer"` with `transferToId` pointing at another
  active, non-archived, non-`Returned`, non-`PRODUCT` device in the same
  `groupId`. The retained advance is added to that sibling's `advance`, its
  `due` is recomputed as `max(0, totalBill − advance)`, no cash is refunded and
  no inspection fee may be charged. The cash button keeps the older behaviour.
- **Bulk part resolution on return.** `partResolution` accepts `RETURNED`,
  `MOVED_TO_STOCK` or `DAMAGED` and resolves every attached `ServicePart` inside
  the same SQLite transaction as the status close. The first two write the
  repair cost off (`expenseWrittenOff = true`); `DAMAGED` carries it via
  `Service.damageLoss` and skips the separate expense question. Stock moves,
  supplier balances and damage loss follow the same rules as the `/parts`
  ledger. When the row has a cost and no bulk choice, the body may send
  `expenseAction: "writeoff"` (parts unused/returned) or `"keep"` (shop keeps
  the loss); omitting it preserves the previous behaviour (keep).
- **Returned rows accept safe edits, not ledger edits.** `PUT /api/services/[id]`
  allows customer/phone/model/problem/technician/service date/expense/parts
  shop/delivery date/damage fields, but rejects any `totalBill`, `advance` or
  `status` change with 400. The bill/advance/due/status fields are read-only in
  the form, and `refundAmount`/`returnedAt` are never rewritten by an edit.
- **Refund is a cash memo, not a second profit deduction.** Returned rows are
  excluded from count, bill, due, revenue and technician performance, so their
  original bill never becomes profit. The one exception is a retained inspection
  fee: its amount is added to daily/monthly `bill` and `profit` as labour
  income; the cash refunded is never added or subtracted twice. Their
  `damageLoss` always remains a shop loss; their `expenseAmount` remains a loss
  unless it was explicitly written off. Refund reports group by the job's
  **service date**, not the later `returnedAt` timestamp, so the cash memo stays
  with the day the job belonged to.
- `profit = active bill − expenseAmount (all non-archived rows not written off)
  − damageLoss (all non-archived rows)`. Returned bills contribute zero; refunds
  are not subtracted again and a written-off cost is not subtracted either.
  Shop overhead like rent is NOT in the system — “লাভ” is gross margin.
- **Worked examples:** completed bill ৳1500 with ৳500 technician damage →
  customer pays ৳1500, profit ৳1000. Unfinished job → return/refund, customer
  pays ৳0; a kept ৳800 parts cost plus ৳500 damage remains a shop loss (profit
  −৳1300 for that job), while writing the same ৳800 cost off leaves only the
  ৳500 damage (profit −৳500). A returned job with জমা ৳500 and a ৳100 checking
  fee refunds ৳400 and reports ৳100 labour profit; a custom refund of ৳250 with
  no fee keeps the original bill/advance for audit but only ৳250 leaves the
  drawer.
- **Grouped visits are an audit convenience, not a new ledger.** `POST
  /api/services/batch` creates up to **8** device rows in one transaction with a
  shared opaque `groupId`. Each row still owns its bill, advance, due, status,
  cost and technician performance, so daily/monthly totals remain per device.
  The form enters the visit money once and allocates it down (device bills
  auto-sum into the total, জমা is waterfall-allocated so no row overpays, and
  shop cost/parts shop stay on ডিভাইস ১ so expenses are not multiplied); the
  API and schema stay one-row-per-device.
  `groupId` is nullable free text (no foreign key), which keeps old snapshots
  restorable; `GET /api/services?groupId=` powers the combined receipt and never
  returns archived rows.
- **Delivery dates:** `deliveryDate` is a Dhaka calendar key stored at ~midday,
  so it buckets and prints unambiguously. `deliveredAt` is a real timestamp set
  only when status becomes `Delivered` (cleared on reopen/return), so reports
  never confuse an expected date with an actual handover.
- **IMEI is internal; lock data does not exist.** `imei` is optional per device
  (≤ 32 chars, stored exactly as typed), travels in the backup export (Excel
  audit sheet and CSV) but never in
  the service list or a receipt, and a blank edit clears it. Device-unlock
  credentials are not stored anywhere — no column, no export, no log — and lock
  fields posted by an API client are ignored (`laneG.js` pins both rules).
- Dates are Asia/Dhaka day boundaries; new entries stored ~midday +06:00.
- Archived rows are excluded from every list/stat. Returned rows are not
  archived: they stay visible with a ফেরত badge, but are excluded from
  count/bill/due/technician performance.
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
- Statuses: `Pending → In-Progress → Completed → Delivered` (badge click order),
  plus the terminal **Returned** set only by the refund endpoint. A returned row
  cannot be advanced or moved back to another status, but safe non-ledger fields
  stay editable. New entries default to **In-Progress (চলমান)**; editing a row
  keeps that row's existing status until it is changed.
- **Delivery dates follow the status.** Moving a row into `Delivered` stamps
  `deliveredAt` once on the server; moving it back to any flow status clears it.
  The expected `deliveryDate` is independent and stays editable (including after
  delivery, for the record). In a grouped visit every device carries its own
  expected date from create time (the API still accepts one shared date as a
  fallback for older callers), and each device's status/actual date moves
  independently.
- **Later payments are receipts, and the oldest slip settles first.**
  `POST /api/payments` records one customer receipt (`amount`, method
  (`CASH`/`BKASH`/`OTHER`), optional note) and allocates it across that
  customer's unpaid, non-returned slips **oldest first** (`serviceDate`, then
  `id`), writing one `PaymentAllocation` per touched slip. A customer is keyed
  by the normalized `phone` digits; when no phone is recorded, the exact trimmed
  name is used. The amount may never exceed the outstanding total (400), and no
  slip's `due` can go below ৳0, so a receipt can never create a negative বাকি.
- **Paid is derived; a paid slip's advance may only rise together with its
  bill.** A row is **পরিশোধিত** exactly when `due === 0` — there is no sixth
  status, no `paid` column and no `FLOW_STATUSES` change. Once a slip is paid,
  `PUT /api/services/[id]` refuses a lower `totalBill`, a lower `advance`, or an
  `advance` change on its own (400), while descriptive edits
  (customer/phone/model/problem/solution/condition/IMEI/technician/delivery
  date) still save. The bill may always rise. When a new part is added to an
  already paid job, the customer can pay that extra charge at the counter: the
  edit raises `totalBill` and `advance` together (e.g. 6000 → 6500), leaving
  `due` at 0 — no silent rewrite of settled money, and an advance above the new
  bill is still an overpay (400). Raising the bill alone instead leaves a fresh
  বাকি the customer can pay through **টাকা নিন**.
- **The যাচাই tick is retired.** The manual "checked by hand" tick never
  changed money, and both its row button and `POST /api/services/[id]/verify`
  are gone. The `verified`/`verifiedAt` columns stay in the database, the raw
  audit sheet and the backup JSON so older snapshots still restore — nothing in
  the UI writes them any more.
- **Purchases sit outside the service ledger.** A `Purchase` (supplier,
  optional invoice, date, line items, optional now-payment) is a stock document:
  receiving it writes `STOCK_IN` movements and updates `Product.stock` /
  `purchasePrice`. Supplier payments (`POST /api/purchases/payments`) settle the
  oldest open bill first and refuse overpay the same way. Purchase totals are
  **never** a service expense, never reduce লাভ, and no purchase price,
  supplier name or profit figure reaches a customer receipt/PDF.
- **Cost-code privacy lives only in the service table.** The খরচ column is
  always visible and shows only the stored code (e.g. `*B#`); a legacy
  plain-number cost is rendered as `৳••••`. The header's **খরচ দেখান** button
  reveals every row at once (no timer; the pressed state is a navy fill, never
  white-on-white), and each row's own eye reveals only that
  row's decoded amount for 10 seconds. A parts-only row shows each part's stored
  price code next to the same eye — the parts total stays masked (`পার্টস ••••`,
  or `পার্টস (3) ••••` when a device carries several parts, which get one readable
  name/quantity/code line each) until revealed, and the header toggle uncovers
  it too. A legacy parts row with
  no stored `priceCode` shows the code derived from its unit cost (`2000` →
  `A+#`), never the raw taka. The parts-shop name sits under the code; the
  decoded total never appears on a customer copy.
- Everything else stays open: the entry form shows the decoded amount, the
  daily খরচ card shows the real total (including damage loss), and the monthly
  report shows real খরচ/লাভ. The customer receipt/PDF never prints cost, code,
  parts shop, damage loss, damage note or profit.

### Data model (`prisma/schema.prisma`)

One table, `Service`, 35 columns (grouped below by role):

| Column | Type | Meaning |
|---|---|---|
| `id` | Int | primary key, **auto-increment** — printed as `বিল নং` |
| `customerName`, `phone` | String | customer; `phone` drives the call/WhatsApp buttons |
| `model`, `problem` | String | handset + reported fault |
| `solution` | String? | internal per-device work note (≤500); never printed, never matched by a text search — shown only when a mobile-number search lists the customer's history |
| `condition` | String? | customer terms for the visit (≤500); copied to every row, printed as the শর্ত block |
| `technician` | String | roster name (plain text so old snapshots stay valid) |
| `totalBill`, `advance`, `due` | Int | the money triple (`due` is derived; Returned stores 0) |
| `status` | String | `Pending`/`In-Progress`/`Completed`/`Delivered`/`Returned` |
| `shopExpense` | String? | canonical keypad code (`*J#`); legacy numeric/code aliases still decode, free text |
| `expenseAmount` | Int | decoded numeric cost for profit (1500 for `*J#`) |
| `partsShop` | String? | internal parts-buying shop name, never printed |
| `returnedAt` | DateTime? | when the job was closed as returned (full, custom or fee return) |
| `refundAmount` | Int | cash handed back (`advance` by default; 0 for a group transfer) |
| `inspectionFee` | Int | retained checking/service fee; final bill for a fee return, counted as labour income |
| `returnReason` | String? | internal reason the customer returned the device; never printed |
| `refundNote` | String? | internal return note; never printed for the customer |
| `damageLoss` | Int | internal technician-damage cost; never printed |
| `damageNote` | String? | internal damage description; never printed |
| `expenseWrittenOff` | Boolean | returned job's parts cost cancelled from reports; code/amount stay for audit |
| `imei` | String? | optional handset IMEI, ≤32 chars, stored exactly as typed; never in the list or a receipt |
| `saleRef` | String? | unique client idempotency key for a product sale (schema foundation — app code does not write it yet) |
| `groupId` | String? | opaque id shared by every device row of one customer visit |
| `deliveryDate` | DateTime? | expected handover day (Dhaka key at ~midday) |
| `deliveredAt` | DateTime? | actual handover timestamp, server-owned from the `Delivered` status |
| `verified` | Boolean | **legacy/dormant** manual tick — its UI and API were retired; the column is kept only so older snapshots still restore and the raw audit sheet keeps its history |
| `verifiedAt` | DateTime? | legacy timestamp of the retired tick (kept for old snapshots/audit only) |
| `serviceDate` | DateTime | stored ~midday +06:00 so day bucketing is unambiguous |
| `archived` | Boolean | soft-delete flag; hides the row from every list and stat |
| `createdAt`, `updatedAt` | DateTime | audit trail (used by the backup export) |

**Payments are receipts, not a `paid` column.** `advance` is still the single
figure recorded on the slip at entry, and `due` stays derived
(`max(0, bill − advance)`). A later customer payment is a **`Payment`** row plus
**`PaymentAllocation`** rows that settle that customer's unpaid, non-returned
slips **oldest first**; a slip is “পরিশোধিত” only when `due` reaches `0`, so
there is no sixth status and no duplicated paid flag. An overpay (more than the
outstanding total) is refused with `400` and `due` can never go negative. A
customer is keyed by the normalized `phone` digits (falling back to the exact
name when no phone is recorded) — no `Customer` table. `refundAmount` stays the
cash memo; custom refunds, retained inspection fees and same-group advance
transfers are all bounded by the recorded জমা and never reallocate a `Payment`.

A second, tiny table holds the roster (v1.1):

| Column | Type | Meaning |
|---|---|---|
| `id` | Int | primary key, auto-increment |
| `name` | String | unique, stored trimmed + UPPERCASE |
| `isActive` | Boolean | `false` = left the shop (soft-delete) |
| `createdAt` | DateTime | when they were added |

`Service.technician` intentionally stays TEXT rather than a foreign key to this
table, so restore's column validation is unaffected.

Four more tables form the **inventory foundation** (added together with IMEI
support):

| Table | Role |
|---|---|
| `ProductCategory` | category with a unique normalized `nameKey` |
| `Product` | name, unique `sku`/`barcode` (uppercased on write), category (`onDelete: Restrict`), brand/supplier, `sellingPrice` + internal `purchasePrice`, `stock` (never negative), `lowStockThreshold` (default 3), soft-delete `archived` |
| `SaleItem` | one line of a product sale: `nameSnapshot`/`skuSnapshot` survive later renames; `serviceId` deliberately has **no** foreign key so a restore can swap the `Service` table |
| `StockMovement` | append-only stock ledger (`OPENING`/`STOCK_IN`/`STOCK_OUT`/`ADJUSTMENT`/`SALE`/`RETURN`) with signed delta + previous/new stock, and one dedupe row per sale per product |

Today the app writes `Product`, `ProductCategory` and the `OPENING` movement
(creating a product); `SaleItem`, `SALE`/`RETURN` movements and `Service.saleRef`
exist in the schema but are not yet driven by app code.

Six tables carry **Phase 2 money** — customer receipts and shop purchases. The
repair-parts ledger adds `ServicePart` plus a type/link on `Purchase`; these
remain internal bookkeeping and never alter customer money.
are a bookkeeping layer only: they never change `totalBill`, and a purchase is
never a service expense or a profit line.

| Table | Role |
|---|---|
| `Payment` | one customer receipt: normalized `phone` (or exact name fallback), amount, method (`CASH`/`BKASH`/`OTHER`), `paidAt`; its allocations must add up to the amount |
| `PaymentAllocation` | links one receipt to one `Service` slip (`serviceId` with **no** foreign key, so a restore can swap the `Service` table) with the settled amount; oldest unpaid slip first, never more than that slip's due |
| `Purchase` | supplier bill: `supplier` + normalized `supplierKey`, `purchaseType` (`STOCK`/`SERVICE_PART`), optional linked `serviceId`, `invoiceNo`, `purchaseDate`, `total`, `paid` (`due` is derived at read time) |
| `PurchaseItem` | one line of a purchase: product (or free-text name), `quantity`, `unitCost`; receiving it writes `STOCK_IN` movements and updates `Product.stock` / `purchasePrice` |
| `PurchasePayment` | one supplier payment with method + `paidAt` |
| `PurchasePaymentAllocation` | links one supplier payment to one `Purchase`, oldest open bill first, never overpaid |

`npm test` always starts these six tables empty. A snapshot that contains them
replaces the live copies (they are part of the backup); an older snapshot without
them leaves them empty and the restore answer carries a warning, so a stale
allocation can never point at a service id from another shop.

`SERVICE_PART` bills contain free-text wholesale items for one repair device.
They never write `STOCK_IN`; their item totals become that device's internal
repair cost. A device cannot carry both manual `ServicePart` lines and a linked
service-part bill: creating either one is refused with `409` while the other
exists, so the same purchase is never counted twice. With neither, the device
keeps using its `shopExpense` lump.

Each `ServicePart` line is also its own purchase record: optional `supplier` +
normalized `supplierKey`, the stored `priceCode` (a plain amount is canonically
encoded, a typed code is kept exactly),
`purchaseDate` (required for new lines, `NULL` only on pre-ledger rows), and a
whole-line `paidAt`/`paidNote` marker. That marker is deliberately **not** a
`PurchasePayment`: it never allocates money, never changes supplier due and
never touches `Service.due`. Supplier payments still settle all open bills
oldest-first.

---

## 6. Offline & data-safety notes

- App needs **zero internet** (font/CSS/JS/DB all local after build). The only
  outward links are the per-row **কল** (`tel:`) and **WhatsApp** buttons, which
  the user taps deliberately — nothing phones home on its own.
- SQLite is crash-safe: committed (Saved) rows survive power cuts; only an
  unsaved open form is lost.
- A restore never leaves you without a way back: it writes a `safety-*.db` copy
  of your current data first, then swaps atomically, and a snapshot that does
  not match the expected schema is refused before any row is touched. Uploaded
  files pass extension + magic-byte/schema checks, SQL dumps are imported into
  a fresh local file with `ATTACH`/`DETACH`/`VACUUM`/`LOAD_EXTENSION` rejected,
  and `ShopSettings` id 1 is never swapped. The
  return/refund/damage/write-off/group/delivery/inspection-fee/return-reason
  columns are optional on restore, so pre-v1.1.2 and pre-v1.2.0 snapshots still
  work and those fields become `NULL`/`0`/`false`.
- Same-disk backup does NOT protect against disk death/theft — copy the Excel
  backup (or `backups/`) to a pen drive periodically. Browser code cannot write
  to pen drives automatically (security rule) — this one step stays manual.
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

`npm test` runs the full regression (46 suites, 921 checks) entirely on
**throwaway databases** — it never starts the app against `prisma/dev.db`.

For a by-hand walkthrough of the whole app — paper printouts, real WhatsApp and
dialer, Excel opening the CSV, touch on a phone, two tabs at once — see
**[`MANUAL-TEST.md`](MANUAL-TEST.md)** (278 steps, each marked safe or risky).

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
- Current full run (post-v1.2.0 + MSS white-label): **46/46 suites, 921/921
  checks** — Launcher decide 14 · Portable keep 13 · User data dir 9 · Electron
  env 9 · Desktop package 26 · Expense upgrade 10 · E2E 9+11 · Lane A 26 ·
  Lanes B+C 24 · Lane D 19 · Lane E 18 · Lane F 22 · Lane G 18 · Lane H 14 ·
  Lane I 20 · Lane J 5 · Lane K 7 · Lane L 36 · Lane Landing 10 · Product
  dashboard 18 · Service-part resolution 27 · Parts date/shop filter 20 ·
  Service return workflow 25 · Form field order 11 · API 67 · Technician 27 ·
  Responsive 74 · Date nav flicker 5 · Header calendar 5 · Real viewport 9 ·
  Customer address/warranty 13 · White-label 10 · Dashboard premium 28 ·
  Clean-slate fresh install 10 · MSS rebrand contract 28 · MSS update contract 9
  · MSS installer contract 18 · Cipher sync 12 ·
  Settings save pipeline 12 · Backup/restore overhaul 37 · Power-failure
  resilience 9 · Custom DB path 9 · Secret code 17 · Dashboard cipher QC 15 ·
  Offline licensing 86, 0 FAIL, 0 JS errors; the live shop DB hash stayed
  unchanged.
- **Windows harness note:** two plain PowerShell-piped full runs died with a
  native `0xC0000409` at different suites (once at Lane E, once at Lane H),
  while isolated suites stayed green. The clean run above used
  `NODE_OPTIONS=--max-old-space-size=4096` with plain `cmd` redirection. No
  suite reported a product failure in either crashed run.
- The Counter Ledger design contract runs **separately** (it is deliberately
  not in the default 921): `MAHER_TEST_SUITES=scripts/service-list-design.js
  npm test` → **19/19 checks**.
- v1.2.0 release run (historical): **13/13 suites, 312/312 checks** — Launcher
  14 · Expense upgrade 10 · E2E 9+13 · Lane A 26 · Lanes B+C 24 · Lane D 28 ·
  Lane E 18 · Lane F 8 · API 59 · Technician 25 · Responsive 74 · Date-nav 4,
  0 FAIL, 0 JS errors; the live shop DB hash stayed unchanged. Since then:
  portable-keep, Lane G, Lane Landing, header-calendar and real-viewport were
  added, Lane H (সমাধান/শর্ত) and Lane I (পেমেন্ট/ক্রয়) followed, API grew
  59→67, Lane J added 5 service-part checks, Lane K added 7 customer-history
  checks and Lane L added 36 optional-part/ledger checks; the unreleased work
  added user-data-dir (9), electron-env (9), desktop-package (24),
  service-part-resolution (27), parts-date-shop-filter (20),
  service-return-workflow (25), form-field-order (11), white-label (10),
  cipher-sync (12), settings-save-pipeline (12), backup-restore-overhaul (37)
  and power-failure-resilience (9), grew portable-keep 10→13,
  expense-upgrade 10→12 and product-dashboard 13→17, added custom-db-path (9)
  and kept customer-address-warranty (13) — **749 at that point**; later
  unreleased work grew technician 25→27, dashboard-premium 17→23 and
  dashboard-cipher-qc 11→15, licensing grew to 86, clean-slate added 10 and
  the MSS rebrand contract added 24 and grew to 28, the update contract added
  9 and the installer contract added 15 and grew to 18 — **921 today**.
- v1.1.4 historical run: **11/11 suites, 298/298 checks** — same suites before
  Lane F and the date-nav regression were added.
- v1.1.3 historical run: **11/11 suites, 230/230 checks** — same suites with
  Responsive 6, before the phone/tablet card views and breakpoint expansion.
- v1.1.2 historical run: **10/10 suites, 215/215 checks** — Lane E 15 · API 56 ·
  Technician 24; the new expense-upgrade suite did not exist yet.
- **The by-hand checklist is the final acceptance pass.** `MANUAL-TEST.md` has
  278 steps, including a real PDF print/read-back; run it on the target PC after
  any UI change. The automated suite mirrors its critical paths, including the
  code-only cost column, the return/refund/damage ledger and the payment/purchase
  rules.
- Desktop + 360–1920px responsive widths + print-emulation verified; the shop
  DB stayed byte-identical (hash-checked).

---

## 8. Hardening notes (recent work)

- **Expense codes are canonical, old rows are upgraded.** v1.1.3 converts a
  plain-number shop expense into a keypad code at every entry path (form, API,
  first-run, backfill, restore) and keeps a typed code unchanged. A code and its
  `expenseAmount` can no longer drift apart silently. Old snapshots with numeric
  expenses are normalized **after** the atomic restore, and `first-run.mjs`
  repeats the same repair on every start, so a power cut during post-processing
  cannot leave the shop with a permanently exposed number.
- **Money audit instead of guesswork.** `scripts/audit-money.ts` checks every
  row's due, returned refund, expense code/amount and invalid values. It is
  dry-run by default; `--confirm` applies only due/expense/returned-refund
  repairs. Overpay, invalid codes, stale `returnedAt`, and negative/oversized
  amount-only expenses are reported for a human and left untouched.
- **Cost reveal has two scopes.** The service table always shows the cost
  column, but only the saved code. The header **খরচ দেখান** button reveals every
  row at once; each row's own eye reveals that row's amount alone for 10
  seconds. Bill, joma, due and every report still show their real totals.
  Receipt/PDF privacy is unchanged.
- **Reports agree on dates and advances.** Daily/monthly `advance` is summed
  only from active rows; refunds are grouped by the job's service date. The
  dashboard hints (জমা, ফেরত, লাভ = বিল − খরচ − ক্ষতি) now match the API math.
- **Restore is atomic and column-validated.** `POST /api/backup/restore`
  checks the snapshot's `Service` columns *before* touching anything, then
  swaps rows inside a single `BEGIN IMMEDIATE … COMMIT` transaction. Old or
  incomplete snapshots get a 400 naming the missing columns; a bad snapshot or
  a power cut can no longer empty the live database. The return/refund/damage,
  write-off, group, delivery, inspection-fee and return-reason columns are
  optional on restore, with `NULL`/`0`/`false` defaults.
- **Returned is terminal and accounting-safe.** Only the refund endpoint can set
  it; the generic validator rejects bill/advance/status edits on a returned row,
  so a later form save cannot silently resurrect an old bill. Safe descriptive
  edits remain allowed. Revenue, count, dues and technician performance exclude
  returned rows; damage loss always remains a shop cost, and a parts cost remains
  one unless the refund explicitly wrote it off.
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
- **Overpay rejected.** `lib/service-validation.ts` refuses `advance > totalBill`
  on create *and* partial update (400, nothing written). The Cash Received
  calculator added in v1.0.1 was removed again in v1.0.2 at the client's request.
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
- **The service list cannot scroll sideways.** The list column is
  `minmax(0, 1fr)` and `ServiceTable`'s measured grid emits `minmax(0, Npx)`
  tracks, so a spanning visit row can no longer pin the table to its
  first-measured width: the table shrinks with its container (intrinsic floor
  866px → **678px**, 188px of slack at a 1280px viewport, overflow 0 at every
  tested width from 1265px to 1920px). The form column is 340px at 1280px
  (380px from 1536px) and the shared container steps 1280 → 1600 → 1840px.
- **List inspection pass (alignment + filter leaks).** Single-row cells now all
  hang from the top edge (they used to mix middle/top alignment and drift on
  multi-line rows), the archived view no longer applies a leftover status
  filter that could silently hide archived rows, grouped-row action buttons are
  sticky like single-row ones, and the status pill is `whitespace-nowrap` so it
  cannot fold at a hyphen. The masthead shows a live “showing X of Y visits”
  count while filtered.
- **A portable rebuild keeps the shop database.** `build:portable` used to
  delete `out/MAHER` wholesale — `data/shop.db` went with it. `data/` and
  `logs/` are now held outside the package during the delete and restored
  after the no-shop-data assertion (so the leak check still sees a clean
  package); if the delete fails because MAHER is running, the data goes
  straight back and the message says to run `MAHER STOP.bat`. Pinned by
  `scripts/portable-keep.test.js` (PK-01…PK-10).
- **No device-lock state anywhere.** The PIN/Pattern/Password picker was
  removed from the form together with its component state and eye toggle — it
  was never saved. `laneG.js` pins the field's absence, that a client posting
  `lockType`/`lockValue` is ignored, and that no credential column exists.
  `imei` is the only per-device identifier, capped at 32 chars.
- **Landing and header regressions are pinned.** `/` redirects to the service
  desk while forwarding `date`/`edit`/`receipt`/`status`/`mode`, the navbar
  keeps exactly two destinations (`laneLanding.js`), and the header calendar
  closes on a second click (`header-calendar.js`, 5 checks).

---

## 9. Changelog

### Unreleased — NOTUN (v1.2.0-er por)

> Everything below shipped after the v1.2.0 release; `package.json` still says
> `1.2.0` until the next tagged release.

**Added**
- **100% offline, hardware-locked licensing (Ed25519)** — the app now derives a
  stable `MHR-XXXX-XXXX-XXXX-XXXX` fingerprint from motherboard/CPU/disk/BIOS
  identifiers (`lib/licensing/machine-id.ts`) and verifies signed keys with a
  public key only (`lib/licensing/{crypto,public-key}.ts`). A signed payload
  carries `machineId`, `shopName`, `type`, `issuedAt` and `expiresAt`; the token
  is `MHR-KEY-<base64url payload>.<base64url signature>`. `GET
  /api/license/status` and `POST /api/license/activate` do every check on
  localhost. A monotonic high-water mark detects a >1-hour clock rollback and
  locks the app with the exact
  **কম্পিউটারের তারিখ ও সময় পরিবর্তন শনাক্ত হয়েছে। অনুগ্রহ করে সঠিক সময় ঠিক করুন।** warning.
  Fresh installs get a **30-day trial** (`DEFAULT_TRIAL_DAYS = 30`, overridable
  with `MAHER_TRIAL_DAYS`); the state file lives beside the shop DB (or
  `MAHER_USER_DATA_DIR`) so a DB restore cannot reset it. Tiers are `TRIAL`
  (30 days), `1_YEAR` (365), `2_YEARS` (730), `3_YEARS` (1095) and `LIFETIME`
  (`expiresAt: null`); `ANNUAL` remains a verified legacy alias for 1_YEAR and
  the admin-only `30_DAYS` alias canonicalises to a fresh 30-day `TRIAL`.
  An active, unclaimed trial persisted by a pre-30-day build is upgraded once
  on read to `installedAt + 30 days` (expired trials, claimed licences and an
  explicit `MAHER_TRIAL_DAYS` override are never rewritten), so an old install
  shows the same Bengali expiry as a fresh one.
  `GET /api/license/status` also exposes explicit `isExpired`/`unlimited`
  flags, `totalDays` and `progressPercent`; a lifetime key is never expired and
  uses an in-process `Infinity` days sentinel (serialised as `null` on the wire,
  so no JSON client can misread it). A full-screen `LicenseProvider`/
  `LicenseGate` covers `/dashboard`, `/service`, `/products` and `/parts` when
  locked. The dashboard hub is a crisp white/light card
  (`bg-white border-slate-200/80 rounded-2xl shadow-sm`) that matches the other
  dashboard cards, titled **🛡️ লাইসেন্স ও সাবস্ক্রিপশন হাব**
  (**অফলাইন সিকিউরড অ্যাক্টিভেশন সিস্টেম**) with the exact 3-step banner
  **১. মেশিন আইডি কপি করুন ➔ ২. হোয়াটসঅ্যাপে কি সংগ্রহ করুন ➔ ৩. সফটওয়ার
  সক্রিয় করুন**, soft-pill dynamic badges (no duplicate inner trial strip) (`● ফ্রি ট্রায়াল: N দিন বাকি` amber,
  `● সক্রিয় (N বছর মেয়াদী)` blue, `● সক্রিয় (লাইফটাইম আনলিমিটেড)` emerald,
  `● মেয়াদ উত্তীর্ণ (লকড)` rose), the four Bengali grid labels with the real
  Asia/Dhaka expiry date, an emerald/teal progress bar hidden for lifetime
  (replaced by **💎 আজীবন ব্যবহারের নিশ্চয়তা**), a monospace machine ID with
  `✓ কপি হয়েছে!` feedback for 2.5 seconds and a company WhatsApp support link
  (`01533315357`) that prefills the machine ID. The light-themed, downtime-free
  renewal modal (**সফটওয়ার লাইসেন্স সক্রিয় / রিনিউ করুন**) uses a scoped
  `bg-slate-900/40 backdrop-blur-sm` overlay (the shared Dialog primitive is
  untouched) and shows a green `✓ সঠিক কি: … • …`, amber
  `⚠️ এই কি-টি অন্য পিসির জন্য তৈরি করা হয়েছে` or red
  `✕ অকার্যকর বা ভুল লাইসেন্স কি` chip from `POST /api/license/preview` before
  activation. `tools/keygen-crm/` is the standalone admin CLI + localhost GUI
  (dark/light mode, all six tier choices, customer search, renewal alerts) with
  the private key, a SQLite customer ledger and one-click WhatsApp messages.
  The isolated `scripts/offline-licensing.test.js` suite pins machine binding,
  signature/expiry rejection, exact tier durations, clock tampering, all four
  locked routes, activation, renewal, CRM isolation and GUI endpoints; every
  legacy suite gets its own license file and an explicit unlocked-trial bypass,
  so no test touches shop licensing state.
- **Tier-aware license actions** — the hub's bottom action area now follows the
  tier, not just the paid/unpaid verdict. LIFETIME shows a non-clickable emerald
  pill (**💎 লাইসেন্স সক্রিয় — আজীবন ব্যবহারের নিশ্চয়তা**), the no-fee assurance
  and a high-affordance secondary button
  (**⚙️ লাইসেন্স কি পরিবর্তন / আপডেট করুন**, `data-testid="license-change-key-btn"`)
  that opens the light activation modal without changing the machine ID — no
  renewal button at all. 1/2/3-year licences get **🔄 মেয়াদের সময় বাড়ান / এক্সটেন্ড
  করুন** with the automatic-extension hint, trials get **🚀 ফুল ভার্সনে আপগ্রেড
  করুন / লাইসেন্স কি দিন** plus a separate vendor-hotline 01533315357 purchase
  link, and expired/locked installs get the high-contrast **🚨 সফটওয়ার আনলক
  করতে লাইসেন্স কি দিন** CTA. The vendor/licensing hotline is fixed at
  `01533315357` / `https://wa.me/8801533315357` across every licensing surface
  (`LicenseCard`, `LicenseGate`, `license-support-link`); the shop owner's
  configurable business number lives only in Shop Profile and never overrides
  it. The `btn-open-license-modal`, `license-renew-btn` and original support-link
  testids/href are preserved wherever those states still expose them.
- **Real hardware machine ID (CIM lock)** — Windows fingerprints now come from
  a single batched `powershell.exe` CIM query reading motherboard UUID,
  baseboard serial, CPU ProcessorId and BIOS serial, parsed with the
  `__MAHER_CIM__` marker and hashed as `sha256(parts.join("|"))`. The old `wmic`
  path and its invalid `(try { ... } catch { '' })` PowerShell calls always
  failed, so the previous ID was hostname-derived: **keys signed for that ID
  must be re-issued**. Empty or placeholder fields are filtered, and the
  hostname/platform seed is used only when no hardware value is readable. The
  ID is cached in memory (~0ms warm, ~400ms cold on this PC).
- **First-time shop profile onboarding banner** — an untouched install (no
  `ShopSettings` row, so `updatedAt === null`) gets a soft amber banner between
  Dashboard Overview and Quick Actions with the exact Bengali welcome copy
  (**🏬 স্বাগতম! আপনার দোকানের নাম ও প্রাথমিক তথ্য সেটআপ করে নিন**), a
  `✏️ শপ প্রোফাইল সেটআপ করুন` action that smooth-scrolls to and focuses
  `দোকানের নাম` with a brief highlight pulse, and a `পরে করব ✕` link that hides
  it for the current tab only (`sessionStorage`). A successful save from
  `সব সেটিংস সংরক্ষণ ও পুরো সিস্টেমে সিঙ্ক করুন` stores both
  `shop_onboarding_completed = true` and `shop_profile_configured = true` in
  `localStorage`; a shop with an existing saved profile never sees the banner,
  so old snapshots stay backward compatible.
- **Hardened backup export & safe restore pipeline** — `GET /api/backup` now
  checkpoints the active WAL with `PRAGMA wal_checkpoint(TRUNCATE)` before every
  format, and audits all six backup models (`Service`, `Product`,
  `CustomerPayment` → `Payment`, `SupplierExpense` → `Purchase`, `Technician`,
  reserved `AuditLog`) in a UTF-8 BOM CSV footer, an `X-Backup-Models` header and
  the Excel summary sheet. `POST /api/backup/restore` now writes every upload to
  a unique `temp-restore-*.db`, runs read-only `PRAGMA quick_check` (exact
  failure: **ব্যাকআপ ফাইলটি নষ্ট বা ক্ষতিগ্রস্ত (Corrupted SQLite file)**),
  reports essential tables/counts as metadata, keeps the transactional
  ATTACH/swap (so no Windows file-lock `EBUSY` and the local pointer survives),
  writes `shop.db.pre-restore.bak` beside the active DB, cleans `-wal`/`-shm`
  temp sidecars and returns `servicesCount`/`productsCount`. Uploads accept
  `.db`, `.sqlite`, `.sql` and `.maherbackup`.
  `POST /api/backup/inspect` powers the new read-only metadata preview.
  The Dashboard button (`btn-restore-backup`) opens the
  `modal-restore-backup` dropzone; after choosing a file the card shows name,
  size and detected record count, then the high-contrast amber/rose warning
  **সতর্কতা: ব্যাকআপ রিস্টোর করলে বর্তমান ডাটাবেজ প্রতিস্থাপিত হবে। নিশ্চিত করুন?**
  and `btn-confirm-restore` (**⚠️ রিস্টোর শুরু করুন**). The loading state shows
  **ডাটাবেজ রিস্টোর করা হচ্ছে... অনুগ্রহ করে অপেক্ষা করুন।**, success shows
  **ডাটাবেজ সফলভাবে রিস্টোর করা হয়েছে!**, then the window reloads to clear
  stale cache. Old snapshots and the legacy test IDs/warning/toast still work.
- **Custom database location engine (D:/E: drive support)** — the Dashboard
  **ডাটা নিরাপত্তা** card now shows `বর্তমান ডাটাবেজ লোকেশন: …` and a
  **📂 ডাটাবেজ লোকেশন পরিবর্তন করুন** button (`btn-change-db-path`). The dialog
  takes a full folder path (or a `.db` file), shows the exact
  **সতর্কতা: ডাটাবেজটি নতুন লোকেশনে স্থানান্তর করা হবে। নিশ্চিত করুন?** warning,
  a **ডাটাবেজ স্থানান্তর করা হচ্ছে...** loading state and the exact
  **ডাটাবেজ লোকেশন সফলভাবে পরিবর্তিত হয়েছে!** toast. `POST
  /api/backup/change-db-path` checkpoints with `PRAGMA wal_checkpoint(TRUNCATE)`,
  copies to a temp file in the target folder, runs `PRAGMA quick_check` on the
  copy (and compares schema/row count/byte size with the source), atomically
  renames it, then writes the local pointer config **only after** verification.
  The original file is never deleted — it stays as the emergency fallback.
  The dialog now also offers **ফোল্ডার নির্বাচন করুন / ব্রাউজ**
  (`btn-browse-db-folder`): a native Windows folder dialog in the Electron
  desktop app (`dialog:select-directory` with `openDirectory` +
  `createDirectory`) and a browser File System Access / hidden directory-input
  fallback. One-click `D:\MAHER_DATA` / `E:\MAHER_DATA` / `C:\MAHER_DATA`
  presets fill the path, and the live **👉 চূড়ান্ত ডাটাবেজ ফাইল: …** preview
  appends the active `.db` filename to a folder. Missing target folders are
  created recursively and write-tested before copying, temporary WAL sidecars
  are cleaned up, and the success toast reports the migrated record count
  beside the green **● সক্রিয়** badge.

  `GET /api/db-location` reports `activePath`, `defaultPath`, `configuredPath`,
  `source` (`default`/`custom`/`fallback`) and the fallback reason; `DELETE
  /api/backup/change-db-path` drops the pointer and returns to the launcher
  default. A missing drive/DB makes the resolver fall back to `%AppData%` (or the
  throwaway dev path) with an on-card `role="alert"` instead of a crash. Live
  Prisma connections follow the pointer on their next access with the WAL/NORMAL/
  5000 PRAGMAs re-applied; no business calculation, receipt rule or existing
  `data-testid` changed.
- **Power-failure resilience & crash recovery** — the shared Prisma adapter
  connection now applies `journal_mode = WAL`, `synchronous = NORMAL` and
  `busy_timeout = 5000` before its first query, then schedules a lightweight
  `quick_check` off the startup path; stale WAL journals are left to SQLite to
  replay/checkpoint, never deleted by hand. `/api/health` reports the live
  connection's `sqlite` diagnostics. New visits debounce-save typed state to
  `localStorage:maher_service_entry_draft_v1`; after a crash/reload the form
  shows the exact **⚡ অসম্পূর্ণ ড্রাফট উদ্ধার করা হয়েছে — 🔄 রিস্টোর করুন ✕ বাতিল**
  banner and applies or clears the draft only on an explicit click (a
  successful **সেভ করুন** also clears it). Editing an existing row never runs
  this engine; the old navigation-only session draft is untouched.
- **Four-format backup picker & safe offline restore** — the Dashboard
  **এখন ব্যাকআপ নিন** action opens `BackupExportDialog` with the system
  recovery `.db`, Excel, PDF and CSV options (each with its exact Bengali
  subtext); a single click downloads only the chosen file. System backups are
  consistent SQLite snapshots named `MAHER_SYSTEM_BACKUP_YYYY-MM-DD_HH-mm.db`
  with the local `ShopSettings` table removed. `RestoreDialog` now accepts an
  uploaded `.db` / `.sql` / `.maherbackup` file as well as the old snapshot
  list, validates magic bytes and schema, keeps a `safety-*.db` copy, never
  swaps `ShopSettings` id 1, and refreshes `ShopSettingsProvider` after a
  successful restore. Extract/report/accounting rules are untouched.
- **White-label shop profile & Dashboard Home** — one optional singleton
  `ShopSettings` row (`id = 1`, migration `20261122120000_add_shop_settings`)
  holds `shopName`, `slogan`, `address`, `phone`, `whatsapp`, `terms`, `logoPath`
  and the `secretCipher` config. `GET/PUT /api/shop-settings` is the only write
  path; a missing or unreadable row falls back to the built-in MAHER branding,
  so a fresh install, an old backup or a build-time render always works.
  `ShopSettingsProvider` mirrors the row into the client and the masthead,
  footer, Dashboard brand preview (name, tagline, mobile, WhatsApp and address
  with a map pin) and both receipt layouts (`receipt-terms`) read it live — no
  reload, no CDN, no cloud. The table is deliberately **excluded from backup/restore**,
  so branding survives a data restore.
- **Dashboard is the landing page** — `/dashboard` (`components/dashboard/
  DashboardView.tsx`) opens by default and groups five panels behind one shared
  container: **Overview** (today's activity, financial health, low stock < 5),
  **Quick actions**, **Technician management**, **Shop settings** (branding +
  cipher tester) and **Data safety** (last backup, backup, restore). Reports,
  dues and the receipt dialog were relocated to the Dashboard as
  `components/dashboard/ReportDock.tsx`, so no money-reporting feature was
  lost. `/` redirects to `/dashboard` unless a bookmarked Service deep-link
  (`date`/`edit`/`receipt`/`status`/`mode`) is present, in which case those
  params still forward to `/service`. The navbar is now
  **ড্যাশবোর্ড → সার্ভিস → প্রোডাক্ট → পার্টস** (`lib/nav-links.ts`).
- **Configurable secret expense-code cipher** — `lib/secret-code.ts` supports
  two interchangeable ciphers. The default `keypad` map preserves every
  historical code byte-for-byte (`*J#` = 1500, `T#` = 800, `GJ+` = 450, `1000`
  = `*+#`; `1→*`, `2→ABC` … `9→WXYZ`, single `0` = `+`, `00` = `#`). Custom mode
  stores an **eleven-digit character map** (`CipherConfig.groups`) where every
  digit `1`–`9`, `0` and `00` owns a **list** of characters: encoding uses the
  **first** character of each list, decoding accepts **any** character from it.
  Fields accept `A, B, C` or `ABC`; the Dashboard grid has all eleven Bengali
  digit fields (including `০০`), a **কীপ্যাড প্রিসেট লোড করুন** preset and a
  **ক্লিয়ার** button. A character may belong to exactly one digit — a collision
  is rejected live with an inline `'B' অক্ষরটি একাধিক ঘরে ব্যবহার করা হয়েছে।`
  error, both fields turn red with `aria-invalid`, and Save/Sync stay disabled.
  The old 10-character `word` is still accepted and mirrored via
  `wordFromGroups`, so `ABCDEFGHIJ` still encodes `1500 → AEJJ`. The Dashboard
  has a live amount→code→amount tester (`*J#` ↔ `৳১,৫০০`) whose inputs start
  empty and show a clean `—` until typed; switching to a fully empty custom
  grid seeds a unique `1=A … 9=I, 0=J, 00=K` map without overwriting partial
  edits. A one-click **🔄 কোড সংরক্ষণ ও পুরো সিস্টেমে সিঙ্ক করুন** button PUTs the map and
  immediately broadcasts it through `ShopSettingsProvider` — `/service` price
  previews and `/parts` ledger amounts update without a reload. Explicit PUTs
  validate strictly (HTTP 400 on collision or empty required digits) while
  stored/legacy values are read leniently: runtime normalisation only parses
   the persisted map and never re-runs the strict validator on the money path.
   The active config is threaded
  through `decodeShopExpense`, parts cost decoding, service validation and the
  Service/Payment/Parts APIs, so the decode is consistent everywhere and
  receipts/reports still hide the amount. Stored services are never re-encoded.
- **Windows desktop EXE (Electron, Option A)** — `npm run build:desktop`
  (`npm run dist`) stages the verified standalone server plus the pinned Node
  22.14.0/ABI 127 runtime under `resources/app` and `resources/runtime` and
  produces `out/MAHER-Electron/dist/MSS-Setup-1.2.0.exe` (assisted NSIS wizard,
  x64) and `dist/win-unpacked/MSS.exe`. Product/shortcut/taskbar name is **MSS**;
  the native window title is `${shopName — }MSS (Mobile Service System)` and the
  renderer pushes profile changes to it through `window:set-title`. The shell
  keeps the child API on `127.0.0.1`, waits for a health response that names the
  expected database, and owns a single-instance lock. Production data lives in
  the installer-chosen non-C folder (`D:\MSS-Data\data\shop.db` by default),
  recorded beside `MSS.exe` in `mss-data-root.txt` and in the registry for the
  next update. A packaged C: env override fails instead of bypassing the wizard;
  a rebuild ships no `data/` folder, so a stale portable database can never
  overwrite the installed ledger
  (`scripts/portable-keep.test.js` PK-11…PK-13). The preload exposes
  `maherDesktop.isElectron/setWindowTitle/printReceipt/getPrinters`; receipt
  printing uses silent IPC in Electron and keeps `window.print()` in the browser.
  `npm run electron:dev` runs an isolated loopback dev instance;
  `npm run test:desktop` launches a packaged EXE against a throwaway user-data root
  (migration, bridge/IPC, single-instance, zero page errors). The builder
  config is `packaging/electron-builder.json`.
- **পেমেন্ট (customer payments) & ক্রয় (shop purchases)** — money that arrives
  after the job is booked is now a receipt, not an edit. **টাকা নিন** on a row
  (or on a visit) opens a dialog for amount + method (নগদ / বিকাশ / অন্য); the
  amount settles that customer's unpaid, non-returned slips **oldest first**,
  and a slip turns **পরিশোধিত** only when its বাকি reaches ৳0 — `due` stays
  derived, there is no sixth status and no `paid` column. Overpay is refused
  (`400`) and `due` never goes negative. Once a slip is paid its জমা may only
  rise together with its বিল; a lower bill, a lower জমা, or a জমা change on its
  own is `400`. The new balance is payable through **টাকা নিন**, while
  descriptive edits still work.
  The old **যাচাই** tick was retired (no button, no endpoint); the
  stored `verified` column survives only so older backups keep restoring.
  The **স্টক** page gained a **দোকান ও ক্রয়** tab:
  purchase documents with line items (receiving them writes `STOCK_IN` and
  updates `stock` / `purchasePrice`), supplier bills settled oldest-first, one
  method per payment. A purchase is bookkeeping only — never a service expense,
  never a profit line — and no receipt or PDF shows a purchase price or supplier
  name. Customers are keyed by normalized `phone` digits (exact-name fallback)
  — no `Customer` table. Migration `20261113120000_add_payments_purchases`;
  routes `/api/payments`, `/api/services/[id]/verify`, `/api/purchases`,
  `/api/purchases/payments`. `laneI.js` (20 checks) pins the rules, and
  `api-check.js` R2b proves a pre-Phase-2 snapshot clears these six tables and
   answers with a warning instead of leaving dangling allocations.
- **A paid slip can absorb an extra charge.** If a fault is found after a fully
  paid job was booked, a new part means the bill must rise. The pencil's
  **ডিভাইস বিল (৳)** field raises the bill; if the customer pays the extra
  amount at the counter, the save raises জমা by the same edit (e.g. 6000 → 6500
  on both) and the slip stays পরিশোধিত. Leaving জমা unchanged instead creates a
  fresh বাকি payable through **টাকা নিন**. A lower bill, a lower জমা, a জমা
  change without a bill rise, or an advance above the new bill is still `400`;
  returned rows keep their money frozen. `laneI.js` I8 pins the
  rise/decrease/together/overpay split.
- **পার্টস কেনা খাতা (service-part supplier bills)** — `SERVICE_PART` supplier
  bills record multiple free-text parts, wholesale supplier, buying price,
  linked service/device and immediate or later supplier payment. They never
  increase product stock, and their line total becomes the device's internal
  repair cost exactly once; supplier due remains separate from the customer's
  bill. The former edit-form **পার্টস কেনার বিল যোগ করুন** action is retired
  (see Unreleased) — part money is entered once with the visit's
  **পার্টস** rows. Migration
  `20261113160000_add_service_part_purchases`; `laneJ.js` pins the linked-bill,
  partial-payment and cost-isolation rules.
- **পার্টস per-device purchase ledger** — each device (including every
  device of a grouped visit) may add up to eight optional part lines: name,
  quantity, **one price field** that accepts a plain amount or a keypad code
  (a plain amount is encoded to a code on save: `1200` → `*A#`), buying
  shop/supplier and a purchase date. A line is saved only when all four
  are present (price `0` is valid, blank is not); fully blank rows are ignored,
  partial rows are refused with a Bengali message, and a device with no lines
  writes no `ServicePart` row and keeps the দোকান খরচ lump exactly as before.
  A new line's purchase date defaults to **today** (editable, never derived
  from the service date). Editing a saved line with a blank supplier/date keeps
  the stored values, and a legacy `NULL` date is never silently filled or
  cleared. The server decodes the price, saves its canonical code in `priceCode`
  (plain amount → code, typed code unchanged), and always derives
  `quantity × unitCost`. The **স্টক → দোকান ও
  ক্রয়** tab now embeds an internal **সার্ভিস পার্টস খাতা**: date-range +
  supplier filters, সব / Unpaid / Paid / তারিখহীন tabs, and summary cards that
  depend only on date + supplier (switching the tab never hides another
  status's money; unknown-date lines are listed but never totalled). Paid is a
  whole-line flag with an append-only timestamped history — not a payment:
  supplier balances, `PurchasePayment` allocation and `Service.due` stay
  untouched. Paid/history lines cannot be repriced or deleted until they are
  Unpaid with a reason; unknown-date lines need an explicit date/confirmation
  (Paid) or reason + confirmation (delete); a returned job freezes its parts
  (`409`) but still allows the Paid toggle. Supplier-wide bulk Paid/Unpaid is
  atomic with a 100-id / 500-row cap, and a device with part lines and a linked
  `SERVICE_PART` bill cannot coexist (`409` both directions). The Excel backup
  gains a separate internal **সার্ভিস পার্টস** sheet (price code, supplier,
  paid history, known-date totals) that never feeds the summary sheet, receipt
  or PDF. Migration `20261116090000_service_part_purchase_fields` adds five
  nullable columns + three indexes; `laneL.js` (36 checks) pins every rule.
- **পার্টস খাতার তারিখ মোড ও দোকান ফিল্টার** — the internal ledger now uses the
  service desk's exact switcher, **একদিন | তারিখ রেঞ্জ | সব তারিখ**, instead of
  two raw date boxes. It opens on **একদিন** (today) with `আগের দিন` / `পরের দিন`
  / `📅 আজ`; **তারিখ রেঞ্জ** shows `শুরুর তারিখ` – `শেষের তারিখ`, and **সব তারিখ**
  hides the pickers and shows the full history. The **পার্টসের দোকান** dropdown
  lists every saved shop *and* every shop seen on a past part line, defaulting
  to **সব দোকান**. Date scope and shop travel together to `/api/service-parts`,
  so the table and all four cards (চিহ্ন নেই / Paid চিহ্ন / মোট (তারিখ আছে) /
  তারিখহীন) recalculate as one; bulk Paid/Unpaid follows the same scope. No
  column, badge, action or other page moved — `parts-date-shop-filter.js`
  (20 checks) pins the modes, combined filters, legacy money, the always-visible
  `কোড:` with its taka hidden behind the row eye or the toolbar's **দাম দেখান /
  দাম লুকান** reveal-all button, emerald/rose payment badges, the one-line
  toolbar and 1280/1366 overflow-free layout. Shop names are managed from the
  masthead's right-aligned **🏪 দোকান ব্যবস্থাপনা (Nটি)** button, not a top card.
- **Shop manager is now an accounting dashboard** — `/parts` no longer opens with
  a tall shop card: the **সার্ভিস পার্টস খাতা** starts right under the page lead.
  `PartsShopManagerDialog` keeps the compact `দোকানের নাম` add form and lists
  every saved / ledger-known shop with colour-coded tags: neutral slate
  **মোট: ৳…**, emerald **পরিশোধ: ৳…** and either a rose **⚠️ বাকি: ৳…** badge or a
  quiet green **✅ পরিশোধিত** tag. Paid is a whole-line marker, not a payment
  record. The footer is a three-part ledger summary — **মোট বিল: ৳… |
  পরিশোধিত: ৳… | মোট বাকি দেনা: ৳…** — with the total due in bold rose. Each row
  also has a **🔍** button titled **এই দোকানের খাতা দেখুন**: it sets the ledger's
  `পার্টসের দোকান` filter to that shop and closes the dialog without touching the
  chosen date scope. A shop with transactions keeps its name but its trash button
  is disabled with the tooltip **লেনদেন থাকায় দোকানটি ডিলিট করা যাবে না**.
  `part-shop-row`, `part-shop-delete` and `part-shops-total` keep their testids;
  R21 still proves a ledger write refreshes those parent figures. No API, schema
  or ledger column changed.
- **ড্যামেজ marked on the entry form, in the same save** — each optional part
  row now carries a small **ড্যামেজ** checkbox. Ticking it writes
  `partStatus = "DAMAGED"` on the new line, stamps a resolution note and moves
  the full line cost into `Service.damageLoss` in the same transaction, so a
  broken part no longer needs a second trip to `/parts`. The line keeps its full
  audit record (name, price, supplier, date) and never enters the device's parts
  cost or a customer receipt/PDF. Only `DAMAGED` is accepted from the form —
  every other value is coerced to `USED`, so stock/return states still require
  the audited **নিষ্পত্তি** dialog. A saved damaged line is frozen in the form;
  later changes stay in `/parts`. `service-part-resolution.js` R22–R24 pin the
  once-only loss, the re-save guard and the coercion rule.
- **Stock page without the inventory dashboards** — the product page no longer
  shows the six summary cards, the stock-status filter, the sort dropdown, the
  ক্রয় eye toggle/column, visible SKU/barcode or the inventory-value card. It
  keeps search, the category filter + manager, stock, selling price, add/edit/
  archive and every purchase flow; the product dialog still takes the purchase
  price, and an update that omits SKU/barcode keeps the stored values.
- **সমাধান + শর্ত (per device / per visit)** — the work-done note is internal
  only (max 500 chars: never on a receipt, never matched by a name/model/text
  search, included in the CSV/Excel audit and in an old-snapshot-safe
  restore). It is written from a small **সমাধান** button on each device line in
  the service list — usually at handover — via `ServiceSolutionDialog`; the
  same button edits a stored note. In a grouped visit every device gets **its
  own** button, numbered **সমাধান 1 / সমাধান 2 / …** so they cannot be confused
  (a single-device row stays plain **সমাধান**). শর্ত is one per visit: an
  optional **কাস্টমারের শর্ত** section in the form (collapsed, so the bill +
  জমা stay clear of the sticky save bar on a 585px-tall laptop screen) with
  quick-insert chips; the same text is copied onto every device row *and* the
  product anchor of a grouped visit, and its list marker opens a read-only
  `ServiceConditionDialog`. There is no solution field in the form and no
  separate সমাধান খাতা — the header search is the single history entry point
  (see the গ্রাহকের ইতিহাস bullet). The condition prints as a **শর্ত** block on
  the single receipt, the combined group slip and its PDF; the solution never
  prints. Migration `20261113090000_add_solution_condition` (both columns
  nullable); `laneH.js` (14 checks) pins the rules.
- **গ্রাহকের ইতিহাস (customer history by mobile number)** — typing a customer's
  phone number into the **header search** lists every earlier job for any date
  and each result carries the full detail a technician needs: date, model,
  problem, technician, বিল / জমা / বাকি, delivery date, status, and the stored
  **সমাধান** + **শর্ত** notes. For a grouped visit the matching rows are folded
  together and listed **device-wise** — **ডিভাইস 1 / 2 / …** with that device's
  own model, problem and solution — instead of N near-identical results. A
  local `01…` or `+880…` number both match
  (digit-normalized), archived rows stay hidden, and name/model/problem queries
  still never reveal the internal solution note. There is no extra history
  button in the form — the search bar already does the job. Receipts/PDFs are
  untouched; `GET /api/services/history?phone=` stays available as a read-only
  API, and `laneK.js` (7 checks) pins the search API, the full-detail result
  list and the privacy rule.
- **IMEI per device** — optional field on every device card (max 32 chars,
  stored exactly as typed), carried in the Excel audit sheet and CSV backup,
  never shown in
  the service list or on a receipt. `20261026140000_add_inventory` added the
  column; `laneG.js` (18 checks) pins its rules.
- **Inventory foundation** — models `ProductCategory`, `Product`, `SaleItem`
  and `StockMovement` plus new routes `GET/POST /api/products`,
  `PUT/DELETE /api/products/[id]`, `/api/product-categories` (+`[id]`) and
  `/api/parts-shops`. The new **স্টক** page (`/products`) lists products with
  search, price/stock, summary cards, low-stock warnings and a category
  manager dialog; creating a product logs an `OPENING` `StockMovement`.
  `SaleItem` and `Service.saleRef` exist in the schema but app code does not
  write them yet (foundation for sale-to-stock).
- **Organised Excel backup** — the **ব্যাকআপ** button now downloads a real
  `.xlsx` workbook instead of a flat CSV, in the shopkeeper's reading order:
  **সারসংক্ষেপ / সার্ভিস খাতা / সম্পূর্ণ ডেটা (অডিট)**. The খাতা sheet is a
  simple flat ledger — **ক্রম / তারিখ / কাস্টমার / ফোন / মডেল / সমস্যা /
  টেকনিশিয়ান / অবস্থা / বিল / জমা / বাকি / ডেলিভারি** — sorted oldest date
  first, serial `1..N`, with a frozen/filterable header, date and currency
  formats, and a bottom **মোট (সক্রিয়)** row. Returned rows stay visible but
  are excluded from totals; internal cost, damage, parts shop, IMEI and group
  data live only in the audit sheet. Built server-side with ExcelJS
  (`lib/backup-workbook.ts`); the `.db` snapshot stays the real backup, and
  `GET /api/backup` keeps the full CSV for scripts (now with `saleRef`).
- **Service desk became the landing page (superseded in this same Unreleased
  cycle)** — `/` redirected to `/service` and forwarded bookmarked
  `date`/`edit`/`receipt`/`status`/`mode` params; the navbar had exactly two
  destinations (সার্ভিস / স্টক), with a compact backup strip on the desk and
  refresh/restore behind the **⋯ ডেটা ও ব্যাকআপ** dialog. The deep-link
  forwarding survives today; the landing target, navbar, backup strip and
  dashboard widgets have since been replaced by the white-label Dashboard
  described at the top of this section (`laneLanding.js`).
- **One-click new entry (masthead button since removed)** — **নতুন সার্ভিস
  এন্ট্রি** at the front of the service masthead used to scroll to the form and
  focus কাস্টমারের নাম (on a phone it switched to the form tab first). The label
  now belongs to the form section itself; deep links and the header CTA still
  jump to the form through `ServiceWorkspace`'s `newEntry`.
- **Dues status chips** — **সব / পেন্ডিং / চলছে / সম্পন্ন / ডেলিভারি / ফেরত**
  with live visit counts and the service list's pill styling. Chips filter the
  visit rows, the row scrolls inside itself on narrow screens, and the **ফেরত**
  empty state explains that a returned job never carries due (with **সব দেখান**
  reset).
- **Report date modes + customer detail** — the report dialog switches between
  **একদিন / তারিখ রেঞ্জ / সব তারিখ** (রেঞ্জ default) and gains a paged
  **কাস্টমার ডিটেইল রিপোর্ট** table below the summary cards (তারিখ / বিল নং /
  কাস্টমার / ফোন / মডেল / সমস্যা / টেকনিশিয়ান / অবস্থা / বিল / জমা / বাকি /
  ফেরত), including refund + return date for returned rows;
  `/api/stats/monthly` gained an additive `?all=1` window. The print copy keeps
  the old preset UI and never renders the mode switch.
- **Counter Ledger palette** — every design value lives in `app/globals.css`:
  graphite navy `#223D57` chrome/primary, steel blue `#35648C`/`#2F5F88`
  accents, `#7C96AD` quiet highlight, `#F3F5F7` page, white cards,
  `#1F2A36`/`#5E6B78` text, `#D9E0E7` hairlines, `#2E7D5C`/`#9A6714`/`#B23A3A`
  meaning colours, the 12–16 / 9–11 / 8–10px radius ladder, soft neutral
  shadows, and flat `.gloss-chrome` / `.sheen` / `.gloss-primary` hooks (kept
  for compatibility, no gradients). The row action rail is neutral at rest
  instead of a six-colour rainbow. DOM, testids and Bengali labels were
  deliberately left untouched; `scripts/service-list-design.js` (19 checks)
  guards the service-list half of the contract.
- **List date modes** — the service list masthead gains a segmented switch:
  **একদিন** (default, untouched legacy view + day nav + `←`/`→`),
  **তারিখ রেঞ্জ** (শুরু/শেষ pickers, starting at one day and widenable) and
  **সব তারিখ**. `GET /api/services` grew an additive `?from&to` / `?all=1`
  branch with `limit`/`offset`, a SQL `count()` aggregate and
  `{mode, total, offset, shown, hasMore}` metadata (capped at 300 rendered rows
  per page, append via **আরও দেখুন**); `GET /api/stats` gained the matching
  `?from&to` / `?all=1` window on the same aggregation path. Day mode's
  responses are byte-identical, and multi-date rows render under per-day
  section headers (table + cards), newest day first.
- **Report export (PDF / CSV / Excel)** — the report dialog's new
  “এই হিসাবের এক্সপোর্ট:” row follows the chosen window (একদিন / তারিখ রেঞ্জ /
  সব তারিখ) and builds every file locally from a single shared layout:
  `lib/export.ts` (sorted rows, daily roll-up, BOM/CRLF CSV + ExcelJS `.xlsx`
  with titled, width-set, frozen-header সারাংশ/দৈনিক ভাঙতি/সার্ভিস sheets) and
  `lib/report-pdf.ts` + `components/report/ReportDocument.tsx` (one PDF page
  per pre-laid-out Bengali A4 section page, headings repeated, page n/N).
  Detail rows now carry **ফেরত / ফেরত তারিখ**, files are stamped
  `MSS-Report-all.*` for সব তারিখ, and the PDF caps its detail table at 1000
  rows with a visible notice (CSV/Excel carry up to 5000); expense amounts,
  write-off flags, IMEI and damage/refund notes never enter a file (only the
  aggregate খরচ does). CSV/Excel now depend on `exceljs` (write-only, bundled,
  never parses untrusted input); the old `xlsx` dependency is no longer used
  by report export. New `scripts/report-layout.test.ts` pins the layout
  contract (`npx tsx --test scripts/report-layout.test.ts`).

**Changed**
- **Dashboard copy harmonised with the rest of the shop** — the Overview cards
  now read **আজকের জমা ও সার্ভিস / নতুন সার্ভিস N · আজ জমা**,
  **কাস্টমার বাকি / মোট কাস্টমার বকেয়া**, **সাপ্লায়ার দেনা / মোট সাপ্লায়ার
  বকেয়া** and **স্বল্প স্টক প্রোডাক্ট / স্টক শেষ হওয়ার পথে**; the stock link is
  **প্রোডাক্ট স্টক ↗**. Quick actions say **সার্ভিস এন্ট্রি ↗** and
  **স্টক থেকে প্রোডাক্ট বিক্রি করুন**, the header CTA is **সার্ভিস পেজে যান ↗**,
  and the admin jump is **ওভারভিউতে ফিরুন ↑**. The cipher helper is
  **টাকা ↔ কোড কনভার্টার** and its tab is **কাস্টম কোড** (legacy sr-only label
  updated too). Testids, bindings, dues/backup triggers and calculations are
  unchanged; `dashboard-premium.js` pins the new copy.
- **High-end counter/POS finish for `/service`** — the form and list now share
  one quiet slate rhythm: `border-slate-200/80` cards, `shadow-sm`, uniform
  `h-9`/`h-10` toolbar controls, `font-medium text-slate-700` labels and a
  consistent `focus-visible:ring-2 focus-visible:ring-slate-900/10 focus:border-slate-800`
  focus treatment. The duplicated accordion header is gone — the numbered
  **ডিভাইস #১** card is the single visible collapse control while the old
  **ডিভাইসের তথ্য** `<summary>` stays `sr-only` for the shared
  `<details>`/`<summary>` test helper. Delivery shortcuts stay on one
  clipped-free row of full-width cells (**আজ / কাল / ৩ দিন / ৭ দিন**), warranty
  chips use Bengali digits while the stored values remain ASCII, and the money
  row ends in a compact colored **বাকি: ৳…** strip. Status chips got smoother active transitions and subtle
  count badges; the empty list now shows one quiet hint line instead of a
  second button. Every testid, id, binding, calculation and Bengali receipt
  string is unchanged; the pinned copy checks were updated with the labels.
- **Service is a front-desk workspace; Dashboard is Home** — the Service page
  keeps the new-job form, the local search and the date/status filters, and
  nothing else. The masthead **নতুন সার্ভিস এন্ট্রি** and **ড্যাশবোর্ড** buttons
  were removed along with the technician manager, report and dues pills, the
  backup strip and the `আজকের হিসাব` tally (with its clickable technician
  cards), which moved to the Dashboard or were retired from the front desk.
  `DailySummary`, `TodayStats` and `TechnicianStats` are intentionally
  unmounted; the Dashboard Overview carries the day's headline numbers instead.
  No ledger calculation, route or API was changed — the pinned suites were
  updated to read the relocated UI, and the white-label suite asserts the
  removed controls never return.
- **Manual পার্টস is now a purchase line, not a loose repeater** — the
  in-form parts area is still optional (zero rows keeps the old দোকান খরচ lump
  and writes nothing), but every line now records the buying shop, purchase
  date and a Paid marker, and the internal ledger can price it from a code.
  A linked `SERVICE_PART` supplier bill cannot live on a device that has part
  lines (409 both directions), so the same purchase is never typed twice. The
  old edit-form action for creating that bill is retired in Unreleased; new
  part money goes into the **পার্টস** rows. Grouped multi-device
  entry, সমাধান, শর্ত and the `ServicePart` API stay unchanged.
- **Multi-part devices read cleanly in the service list** — a device with more
  than one part no longer spills out as a bare run of price codes. The খরচ cell
  now shows a **পার্টস (N)** chip and one aligned line per part — name,
  `×quantity` when greater than one, and that part's safe price code on the
  right — inside a compact bordered list. The taka (parts total and each line's
  cost) stays behind the existing row eye / header **খরচ দেখান** toggle; the chip
  reads `পার্টস (3) ••••` until revealed. A single-part device keeps its old
  compact inline code, so no existing testid or layout changes. Every render
  path (single row, grouped device line, mobile card) uses the same renderer.
- **Seven row actions, still one tidy palette** — the service row gained the
  **টাকা নিন** wallet next to print / WhatsApp / PDF / damage / edit / delete.
  Below 1400px they tile in a 4-column grid (4 across, then 3 — 0px table
  overflow at 1280), and from 1400px they sit on one line of seven; the design
  contract's D8/D8b pins both widths plus the unbroken device badge.
- **Compact backup strip** — the old full-width রিফ্রেশ/ব্যাকআপ/রিস্টোর rail
  became a slim strip under the service actions. **ব্যাকআপ** stays one click
  away next to **সর্বশেষ ব্যাকআপ**; **রিফ্রেশ** and **ব্যাকআপ থেকে রিস্টোর…**
  moved into the **⋯ → ডেটা ও ব্যাকআপ** dialog, so restore still asks for its
  second confirmation click. The misleading online/offline badge is gone — the
  strip states **ডেটা এই PC-তে**. Testids, snapshot/CSV backup and every API
  stayed unchanged.
- **Numbered, self-contained device cards, one shared visit money block** —
  the first card is always ডিভাইস #১ and each card is that device's COMPLETE
  information block: মোবাইলের মডেল → সমস্যা → ডিভাইস বিল (৳) →
  ডেলিভারি তারিখ → IMEI → পার্টস, all together. A card starts open; it can
  collapse to a one-line summary (model • problem • bill • parts count), and a
  newly added device opens immediately without collapsing or clearing earlier
  cards. Only **after** the last full card comes **আরেকটি ডিভাইস যোগ করুন**
  (up to eight devices), so the shopkeeper finishes one device's details before
  deciding to add another — the add option is never tucked above a separate
  pile of "extra" fields. Customer/phone/
  technician/status/service date/মোট বিল/জমা are entered once for the visit.
  Device bills auto-sum into the visit total, জমা is waterfall-allocated so no
  row overpays, and shop cost + parts shop stay on ডিভাইস ১ so a grouped visit
  cannot multiply expenses. In the list each device line carries its own
  **সমাধান** button, numbered **সমাধান 1 / 2 / …** in a grouped visit. Batch
  API and schema unchanged.
- **Focused entry-form pass** — the shared money block now reads **মোট বিল →
  জমা → বাকি**, with **বাকি** rendered as a quiet amber/emerald status strip
  (read-only input kept for the contracts) and no bare `৳0` totals. The
  optional **পার্টস** area starts collapsed with no empty-state helper text
  and shows a labeled total only once lines exist; delivery shortcuts use one
  row of full-width cells so no Bengali label is clipped. Validation messages appear under their own
  control with `aria-invalid` / `aria-describedby` and move focus there —
  including part **দাম** vs purchase **তারিখ** and the right device in a grouped
  visit — while the sticky save bar stays clear of the focused field. Payloads,
  business rules and all field IDs/testids are unchanged.
- **Decluttered entry-form copy** — the repetitive `(ঐচ্ছিক)` suffixes are gone
  from **কাস্টমারের ঠিকানা**, **কাস্টমারের শর্ত**, **ওয়ারেন্টির মেয়াদ**,
  **পার্টস** and the IMEI field; the device bill label now reads
  **ডিভাইস বিল (৳)**. Every input and textarea inside the form now uses
  `placeholder=""` — no gray dummy preview text anywhere (phone, address,
  model, problem, IMEI, warranty, device/summary money, condition note, part
  name/price/shop or the overridden-price note). Each box already has a clear
  top label, so it stays pristine and ready for typing. The collapsed parts
  card no longer prints the redundant `এখনো কোনো পার্টস যোগ করা হয়নি।`
  helper. No calculation, validation rule, state hook or `data-testid` changed;
  `form-field-order.js` O9 pins the copy and a broad no-non-empty-placeholder
  contract, while `customer-address-warranty.js` AW5 and `laneG.js` G8 pin the
  address and IMEI boxes.
- **Wider service list, no horizontal scroll** — the shared container caps
  moved 1440/1600 → **1600/1840** (header, cards, list and footer stay aligned),
  the form column is **340px** at 1280px (380px from 1536px), grid tracks are
  `minmax(0, …)` so the table floor dropped **866 → 678px** (188px slack at
  1280, overflow 0 from 1265px to 1920px), and the device-count / group badges
  are `sr-only` (screen readers still announce them, the ID column stays 55px).
- **Device lock field removed** — the PIN/Pattern/Password picker, its form
  state and eye toggle are gone; API clients posting `lockType`/`lockValue` are
  ignored and no credential column exists.
- **Stage/overdue summary line dropped** from the desk — the daily cards and
  list already carry the figures; `GET /api/services/overdue` still exists but
  the UI no longer calls it.
- **Search scopes are explicit** — the header search keeps its exact
  placeholder and `data-scope="global"` (searches every day), while the list
  search now reads **এই তালিকায় খুঁজুন...** with `data-scope="local"` (filters
  only rendered rows) and the searchable fields in `aria-label`/`title`. The
  redundant scope tag was removed; neither search moved or merged.
- **বাকি তালিকা grouped by date** — visits are folded into per-day sections
  with a per-day due subtotal (newest first) on desktop and mobile; বিল/জমা/
  বাকি align in one column while keeping the exact `বিল: ৳X` text, density is
  tighter, and every icon button gained an `aria-label` + tooltip. Header line,
  6 `<th>` labels and all `due-visit-*` testids unchanged.
- **Daily cards label the shown window** — in range/all mode the cards say
  “নির্বাচিত সময়ের মোট …” with the range in the header; day mode still says
  আজকের/নির্বাচিত দিনের exactly as before.
- **Compact counter layout for real laptop windows** — the service desk now
  fits a 1280×585 window (a 1080p screen with Windows chrome): the backup strip
  and page actions share one row, main spacing is `space-y-2`/`py-2`, the daily
  summary bar and footer are slimmer, and device model/problem sit side by side.
  The form starts at y207 (was 265) and the bill/auto-due row ends at y480,
  clear of the sticky save bar at y532; the empty-state CTA stays at y499–531;
  1920×1080 still has no vertical scrollbar. Container edges stay aligned at
  1280/1366/1536/1920, the form column remains 340px (380px from 1536), and the
  service list still never scrolls sideways. `scripts/real-viewport.js` pins
  these rules across the five shop viewports.
- **Empty-state hint focuses the name field** — a quiet line,
  **কোন সার্ভিস এন্ট্রি পাওয়া যায়নি — বাম পাশের ফর্ম থেকে নতুন সার্ভিস এন্ট্রি
  করুন।**, carries `data-testid="empty-new-entry"` and puts the cursor in
  কাস্টমারের নাম immediately on desktop; phones keep the 350ms tab-swap delay.
  The old duplicated `+ নতুন এন্ট্রি` button is gone.
- **Products page reads like the counter** — search moved into the page header
  (same `#product-search`), the separate filter toolbar merged into the
  product-list header, and a truncated product name carries its full text in
  `title`. At 1280px the list starts at y264 (was 343); mobile cards start at
  y589 (was 740) and the desktop footer drops to 96/80px. The inventory
  summary cards were later removed entirely (see the ledger/products bullet
  above).
- **Product purchase price stays internal to the dialog** — the list no longer
  shows a ক্রয় column, its eye toggle or an aggregate ইনভেন্টরি মূল্য card; the
  buying price is visible only while adding/editing a product, so shop prices
  cannot be read over the counter.
- **Stock-sync note** — a dismissible note above the product list says product
  sales do not decrement stock yet; dismissal persists in
  `localStorage:maher:stock-note-dismissed` and never flashes on load.
- **On-screen digits are Latin; print stays Bengali** — money, visit/device
  counts and on-screen dates use Latin digits (`৳1,200`, `8টি ভিজিট`,
  `শুক্রবার, 6 নভেম্বর 2026`) through `lib/format.ts:latinDateLabel`, while
  receipts, reports, monthly print and exported files keep Bengali digits
  (`bengaliDateLabel` is unchanged). Inputs still accept Bengali digits.
- **One visible bill, explicit dues scope** — a new entry shows only the visit
  **মোট বিল (৳)**; per-device bill splitting moved inside **আরও তথ্য**
  (`data-testid="form-more"`), whose visible summary is now the numbered device
  card itself (the old **ডিভাইসের তথ্য** summary is `sr-only`). The auto field
  is labelled **বাকি (স্বয়ংক্রিয়)** for screen readers and shown as a colored
  **বাকি: ৳…** strip beside the two inputs at 1536px+. The dues toolbar states
  its scope in the button: **সব তারিখের বাকি (Nটি ডিভাইস • ৳X)**.
- **Delivery-date shortcuts** — the date starts empty with **আজ · কাল · ৩ দিন ·
  ৭ দিন** chips on one row of full-width cells and a clear (×); every label is
  fully legible in the 340px column without adding form height, and any typed
  date is still accepted. The saved value and chip dates are unchanged.
- **Category-aware product empty state** — with no categories the CTA reads
  **প্রথম ক্যাটাগরি যোগ করুন** and opens the category dialog.
- **Compact form mode switch** — the service/product buttons read **সার্ভিস /
  প্রোডাক্ট** without emoji, fitting the 340px sidebar.

**Fixed**
- **Secret-code engine keeps modes separate and codes unambiguous** — the
  Dashboard converter now uses only the active **valid** cipher: an incomplete
  or duplicate custom word shows `সবগুলো ঘরে সঠিক অক্ষর দিন` instead of a
  keypad `*J#`, both conflicting slots are highlighted with
  `এই অক্ষরটি ইতোমধ্যে অন্য ঘরে ব্যবহার করা হয়েছে।`, and **সব সেটিংস সংরক্ষণ
  করুন** stays disabled until all ten slots are filled with unique characters.
  One save reaches the `/service` price preview and the `/parts` cost-code
  tooltip instantly via `ShopSettingsProvider`; stored numeric part costs and
  historical codes are never rewritten.
- **Edit form is built like the visit that was entered** — opening **এডিট** no
  longer swaps in a second, flat layout (model/technician, problem, IMEI,
  bill/advance/due, status) with an empty device card and the parts section
  parked at the very bottom. The edit view now uses the *same* device section
  and numbered **ডিভাইস #১** card as a new entry, with the same labels
  (`ডিভাইস বিল (৳)`), the parts editor inside that card, no duplicate
  `svc-*` ids, and the shared bill/advance/due summary below. Both money inputs
  write the same saved bill: `ডিভাইস বিল (৳)` and the মোট বিল summary stay
  in sync, so editing either one updates the saved amount and বাকি. Saved parts
  keep their entry order. No submit logic changed;
  `form-field-order.js` (11 checks) pins the order, the structure, the two-way
  bill sync, the unique ids, the saved part lines' entry order and the new split
  action.
- **No second way to add part money in Edit** — the
  **পার্টস কেনার বিল যোগ করুন** action is gone from the edit form, matching new
  entry: parts are typed once with the visit, and **আরেকটি পার্টস যোগ করুন**
  inside **পার্টস** adds more rows. The `SERVICE_PART` API and any
  existing linked bills are untouched; `laneI.js` I18 now pins both the stock
  page and the edit form as having no purchase-bill action.
- **One damaged unit out of many** — a part line with **পরিমাণ 2+** now offers
  **১টি আলাদা লাইন — একটিকে ড্যামেজ দিন**. One click peels one unit into a new,
  otherwise identical line placed first (new supplier/date, no saved id); the
  remaining units stay on the original line. `quantity × price` is preserved, so
  the parts total never changes — only the line the shopkeeper marks **ড্যামেজ**
  moves to `Service.damageLoss`, exactly one unit's price. A saved line's own
  damage toggle is locked (its status belongs to the parts ledger's
  **নিষ্পত্তি**); the split gives the form a new line it may flag.
  `form-field-order.js` O7–O8 pin the split, the unchanged total, the one-unit
  loss and the locked saved toggle.
- **Smooth /service ↔ /products navigation** — `html` now reserves the
  scrollbar track with `scrollbar-gutter: stable`, so the taller service desk
  and the shorter inventory view no longer shift the whole page sideways as
  the scrollbar appears and disappears. The brand-blue masthead moved out of
  the routed `<main>` into the root layout (`components/AppChrome.tsx`), where
  it persists across client-side navigation instead of unmounting and
  flickering; each page only lends it its global-search handlers through
  `useAppHeader`. Both pages now use the same `max-w-7xl` container with
  `space-y-2 px-3 py-2`, so the header sits at the same y-offset and the list
  never scrolls horizontally at 390px or at shop-counter widths.
- **বাকি chip in the service list** — the status strip gained a final **বাকি**
  chip next to ফেরত. It filters the current date/list scope down to visits that
  still owe money (`due > 0`, Returned excluded), reusing the dues API's exact
  rule, so the shopkeeper no longer has to open the separate বাকি তালিকা dialog
  just to spot unpaid slips. The dues dialog itself keeps its original six chips
  (everything there is unpaid already). `?status=Due` also deep-links to it.
- **খরচ reveal works for parts rows again** — a device with parts but no legacy
  দোকান খরচ code now shows its part price codes plus the per-row eye, and the
  parts total stays masked until that eye or the header **খরচ দেখান** reveals
  it. Previously the eye was trapped inside the `shopExpense` block, so a
  parts-only row had no eye and printed its cost in the clear. Legacy parts rows
  with a null `priceCode` now derive the same code from the stored unit cost, so
  the column always shows a code instead of a `৳••••` placeholder.
- **Part prices become expense codes automatically** — a plain amount typed in
  a part's **পার্টসের দাম (৳ বা কোড)** field is now saved as a canonical keypad
  code (`1500` → `*J#`, `1200` → `*A#`) exactly like the old দোকান খরচ field; a
  typed code still stays exactly as typed. The form's live preview shows the
  generated code next to its decoded amount, and backfills/ledger/reports read
  the same stored code. Money math is unchanged (`quantity × decoded amount`).
- **Service-list inspection pass** — single-row cells all hang from the top
  edge (mixed alignment drifted columns on multi-line rows), the archived view
  no longer applies a leftover status filter that hid archived rows silently,
  grouped-row actions are sticky like single-row ones, the status pill cannot
  fold at a hyphen, the search placeholder advertises problem search, the empty
  state announces an active filter and offers clear-filters, and the masthead
  shows a live “showing X of Y visits, X of Y devices” count.
- **Portable rebuild keeps the shop database** — `data/` and `logs/` are held
  outside the package while `build:portable` deletes `out/MAHER`, then put
  back (after the no-shop-data leak assertion); a running MAHER now yields a
  “run MAHER STOP.bat” message instead of an EPERM dump. Pinned by
  `scripts/portable-keep.test.js` (PK-01…PK-10).
- **Header calendar toggles closed** on a second click of its button.
- **Parts-only refunds now ask about the cost** — a device whose repair cost
  lives entirely in itemized parts (`expenseAmount === 0`) was refunded without
  the **খরচ বাদ / ক্ষতি হিসেবে রাখুন** choice, and an explicit
  `expenseAction:"writeoff"` was ignored. The return dialog and
  `POST /api/services/[id]/refund` now check `partsCost` as well as the lump, so
  unused/returned parts can be written off while used/damaged parts stay a loss.
  `scripts/refund-cost-choice.test.ts` pins the shared rule.
- **পার্টসের দোকান list is now managed and priced** — the **সার্ভিস পার্টস →
  পার্টসের দোকান** card adds *and* removes saved shop names, and each shop now
  shows its all-time parts bill from the service-part ledger beside its name,
  with one **সব সময়ের পার্টস লাইন মোট** total (all line costs, regardless of the Paid marker — not a payment record). Names that only exist in saved part rows are
  marked **খাতা থেকে** and have no delete button: deleting a name drops it from
  the form's suggestion list only, never a past bill or part line, and Radix's
  confirmation says so. `scripts/part-shops-billing.test.ts` pins the per-shop
  roll-up, sorting and case-insensitive removal.
  In a new service entry the **পার্টসের দোকান** field is now a single styled
  combobox: clicking it opens the saved names as a list to pick from (arrow keys
  and Enter work too); only a partial typed name narrows the list, while typing
  a brand-new name is still allowed. This replaces the browser datalist — one
  control, fed by the same shared list from `/parts`.
- **Service-part resolution (পাঁচ প্রকার নিষ্পত্তি)** — an internal part line now
  has a whole-line status. **ব্যবহৃত** (default) counts toward the device's
  repair cost; **স্টকে যুক্ত** creates/reuses a product (buying price = the
  part's `unitCost`, default selling price = +20%), increments its stock and
  writes a `STOCK_IN` movement with the note `সার্ভিস #ID থেকে স্টকে যুক্ত`;
  **ফেরত** removes the device cost, adds no stock, clears the Paid marker,
  appends `ফেরতকৃত — …` to the history and drops the line from supplier balance
  totals; **ড্যামেজ ক্ষতি** removes the device cost and adds the full
  `unitCost × quantity` to `Service.damageLoss` exactly once while the supplier
  stays payable; **খাতায় রাখা** (`KEPT_IN_LEDGER`) removes the device cost but
  keeps the line in `/parts` with its supplier balance, adding no stock and no
  damage charge — parts bought from another shop never enter our own Product
  stock when a job is cancelled. Reversing
  a stock move writes `STOCK_OUT` and is refused (`409`) if stock is short, so
  stock and money never disagree. The `/parts` ledger gained a second chip
  group (**সব | ব্যবহৃত | স্টকে যুক্ত | ফেরত | ড্যামেজ | খাতায় রাখা**) beside the unchanged
  Paid tabs, a status badge on every row and a **নিষ্পত্তি / অবস্থা পরিবর্তন**
  dialog; returned rows show **ফেরতকৃত** and can neither be marked Paid nor
  deleted. `ServicePart.partStatus`, `resolutionNote`, `targetProductId` and
  `resolvedAt` arrive in migration
  `20261119120000_add_service_part_status_and_resolution`; old rows default to
  `USED`, so no historical figure changes. Every transition is one SQLite
  transaction, and receipts/PDFs still hide supplier prices, damage loss and
  parts-shop names. `scripts/service-part-resolution.js` pins the rules.
- **Return, warranty refund & inspection fee** — the ⚖️ dialog now handles real
  customer returns. An optional **চেকিং / সার্ভিস ফি (৳)** is retained from the
  advance: with জমা ৳500 and fee ৳100 the customer gets ৳400 cash, the row closes
  as `Returned` with `totalBill`/`advance` = ৳100, `due` = 0, and daily/monthly
  reports count that ৳100 as labour profit (not as a refund). A job may also be
  returned after **ডেলিভারি** (warranty reversal): `deliveredAt` is cleared, a
  full or custom **কাস্টমারকে ফেরত (৳)** is accepted, and the original
  bill/advance stay on the row for audit when no fee is charged. In a grouped
  visit, **কাস্টমারকে ক্যাশ ফেরত দিন** or **গ্রুপের অন্য ডিভাইসে জমা করুন** chooses
  between cash and moving the retained advance to one active same-group sibling
  (whose `due` drops, with no cash out). Attached `ServicePart` rows are listed
  with four one-click bulk actions — **সব পার্টস মহাজনে ফেরত**, **সব পার্টস
  দোকানের স্টকে জমা**, **কাজের সময় নষ্ট হয়েছে**, **সব পার্টস খাতায় রাখি
  (স্টকে যাবে না)** — committed atomically with the
  return; the refund note also becomes the internal `returnReason`. New columns
  `inspectionFee`/`returnReason` arrive in migration
  `20261119130000_add_service_return_workflow`; CSV, restore and the Excel audit
  sheet carry them and old snapshots default to `0`/`NULL`. The amount stays
  bounded by জমা (`fee ≤ advance`, `refund + fee ≤ advance`), and receipts/PDFs
  still hide every supplier price, damage loss and parts-shop name.
  `scripts/service-return-workflow.js` (25 checks) pins all four scenarios.
- **Top-level destinations, one page per job** — the navbar grew from
  **সার্ভিস / প্রোডাক্ট / পার্টস** to **ড্যাশবোর্ড / সার্ভিস / প্রোডাক্ট /
  পার্টস** (four equal buttons on a 4-column rail at 390px, no overflow);
  `AppNavLinks` and `scripts/nav-links.test.ts` pin the order. The old
  **প্রোডাক্ট ও স্টক** and **সার্ভিস পার্টস** tabs were lifted out of `/products`
  into dedicated pages: `/products` is inventory/search only, and `/parts`
  owns the **পার্টসের দোকান** manager (add/delete with confirmation, per-shop
  all-time bill, **খাতা থেকে** names without a delete button) plus the
  **সার্ভিস পার্টস** ledger. `laneLanding.js` L1/L8 and `responsive-check.js`
  were updated first from two links to three, then to four for the Dashboard;
  the moved flow was re-verified end-to-end (add → reload → delete → bill) on
  `/parts`. Service keeps all its testids; only the destination moved.
- **Parts page copy says what the marker and money mean** — the shop helper no
  longer claims the bills are "ডানে"; it now says saved names are selectable in
  the service form and the amounts come from all past part lines. The ledger's
  filter/summary/badges use **চিহ্ন নেই / Paid চিহ্ন** instead of bare
  Unpaid/Paid, the "paid" marker is now an emerald badge while unpaid is rose, and
  append-only system stamps render as Bengali dates/times while the user's note
  text stays verbatim (the raw stamp remains in the tooltip). A small
  **↔ অ্যাকশন দেখতে টেবিল স্ক্রল করুন** hint appears below 640px so the inner
  table scroll and both row actions are discoverable. No field, testid,
  calculation, endpoint or stored value changed.
- **Navbar blast radius shrunk instead of waived** — GitNexus marked
  `AppNavLinks` **HIGH** because two archived, unimported shells (`Header.tsx`,
  `ProductsHeader.tsx`) also called it. Those shells no longer import the live
  navbar (their files stay; a comment points to `AppHeader`), and the destination
  list moved to `lib/nav-links.ts`, which `AppNavLinks` renders. `scripts/nav-links.test.ts`
  pins the config (three unique keys/routes/labels) and the browser checks pin
  the rendered links. After reindexing, `gitnexus impact AppNavLinks --upstream`
  is **LOW** (1 direct caller, 2 processes) in both the CLI and the MCP index —
  future button changes edit the pure-data module instead.

- **Inventory dashboard reads at a glance** — the `/products` header now puts
  the count badge beside the title and both actions on the right, while the
  search field and category select share one toolbar above the status chips
  (no horizontal scroll at 1280px). The four summary cards gained quiet corner
  micro-icons; the amber low-stock card jumps straight to the **⚠️ কম স্টক**
  chip, and the wallet eye explains its ten-second reveal with the exact
  tooltip “দোকানের ক্রয়মূল্য ও ইনভেন্টরি মূল্য দেখুন (১০ সেকেন্ড)”. Empty views
  now tell the truth: an untouched shop gets onboarding that still opens the
  category manager, and a no-match search offers **ফিল্টার রিসেট করুন**. No
  DB/schema, API or testid changed; `scripts/product-dashboard.js` grew 13→17.

- **Optional customer address and per-device warranty** — every service row now
  carries `customerAddress` (visit-level, up to 200 chars) and `warranty`
  (per-device, up to 100 chars), both nullable so old rows, snapshots and
  restores stay unchanged. The new-entry form puts **কাস্টমারের ঠিকানা** under the mobile number (empty placeholder)
  and **ওয়ারেন্টির মেয়াদ** under IMEI with chips **নেই / ৭ দিন /
  ১৫ দিন / ১ মাস / ৩ মাস / ৬ মাস** (saved values remain ASCII, e.g. `7 দিন`);
  a grouped visit shares one address while
  each device keeps its own warranty, and a product-sale anchor copies only the
  address. Both search scopes — the header search and the in-list `svc-search` —
  match the new text. Receipts print **ঠিকানা: …** / **ওয়ারেন্টি: …** only when
  present; the group slip prints the address once in the header and each device
  warranty in its itemized block. No shop cost, canonical expense code or IMEI
  leaks into a customer copy. Migration
  `20261121130000_add_customer_address_warranty` adds the two columns;
  `scripts/customer-address-warranty.js` pins all 13 rules.

**Tests** — default suites 13 → **41** and 312 → **749** checks across the
unreleased work (+portable-keep, +laneG, +laneLanding, +header-calendar,
+real-viewport, +service-part-resolution, +parts-date-shop-filter,
+service-return-workflow, +form-field-order, +product-dashboard,
+customer-address-warranty, +user-data-dir, +electron-env, +desktop-package,
+white-label, +cipher-sync, +settings-save-pipeline, +backup-restore-overhaul,
++power-failure-resilience, +custom-db-path, Lane D 28→29, Lane F 8→22, the
+intermediate regressions and the backup-ledger check), design suite runs
+separately (19 checks). Full `npm test`: **41/41, 749/749, 0 FAIL**, live DB hash
+unchanged;
`MANUAL-TEST.md` grew to **278** steps (new O11–O13, P1–P10, V1–V8, W1–W5,
X1–X5, Y1–Y12 and Z1–Z9).

### v1.2.0 — grouped visits, delivery dates & safer returns

**Added**
- **One visit, many devices.** The entry form can add up to 7 extra rows (8
  devices total). Customer, phone, technician, service date and expected
  delivery date are shared; each device keeps its own model, problem, bill,
  advance, status, shop expense and parts shop. The set is saved in one
  transaction with a shared `groupId`, marked **👥 গ্রুপ** in the list, and the
  bill/PDF from any row prints one combined customer slip with per-device money
  and grand totals.
- **Expected and actual delivery dates.** `deliveryDate` is an optional form
  field (shared by a group); the list shows it and marks an overdue day in red.
  Moving a row to **ডেলিভারি** stamps the server-owned `deliveredAt`; reopening
  or returning clears it. The receipt prints the expected date or the actual
  handover, and the CSV exports both.
- **Returned rows stay editable.** The pencil now opens a returned row for safe
  descriptive edits (customer/phone/model/problem/technician/service date,
  expense/parts shop, delivery date, damage loss/note). Bill, জমা, বাকি and
  status are locked in the form and rejected by `PUT /api/services/[id]` with
  400; refund amount/date never change.
- **Parts-cost decision on refund.** When the row has a shop cost, the refund
  dialog asks whether that cost was **written off** (parts unused/returned) or
  **kept** as a loss. Written-off rows keep the code and amount plus a grey
  **বাতিল** badge for audit but are excluded from খরচ/profit; `damageLoss` is
  never written off. Old API callers that omit the choice keep the cost.
- **Header cost reveal.** A new **খরচ দেখান / খরচ লুকান** button shows or hides
  every row's decoded cost at once; the per-row eye still reveals only its own
  amount for 10 seconds.
- Schema `Service` grew to **26 columns** via
  `20261025130000_add_group_delivery_expense_flag` (`expenseWrittenOff`,
  `groupId`, `deliveryDate`, `deliveredAt`, plus a `groupId` index). All four are
  optional on restore, so old snapshots still work.
- `POST /api/services/batch` for grouped creation and
  `GET /api/services?groupId=` for the combined slip.

**Fixed**
- The service-list header no longer overflows its section at 640px; the title
  and action buttons wrap with `sm:flex-wrap`.
- A returned product row keeps its **ফেরত** status visible while the automatic
  delivery hint stays hidden.

**Verified**
- New `scripts/laneF.js` covers grouped API/UI saves, group fetch, delivery-date
  stamping/clearing, returned-row safe edits and locked ledger fields, combined
  receipt privacy, and the editable returned row (8 checks).
- laneE gained write-off keep/cancel checks (18 checks); a new
  `date-nav-flicker.js` pins the no-skeleton day change (4 checks).
- Full v1.2.0 run: **13/13 suites, 312/312 checks**, 0 FAIL, 0 JS errors; the
  live shop DB hash stayed unchanged until the release migration.

### v1.1.4 — responsive phone, tablet & desktop dashboard

**Changed**
- The sticky navbar is now a compact ladder: 3 rows on phones/tablets, 2 rows
  from 1280px. All six actions (Sync, Backup, Restore, টেকনিশিয়ান, Print, আজ)
  stay visible at every width; the search input moves into the title row at
  1280px and a 🔍 sheet opens below that. `Ctrl+K` follows the same breakpoint.
- The dashboard form and service list stack below 1280px and sit side by side
  at 1280px+ (`380px` form + remaining width). The container widens at 1440px
  and 1600px instead of leaving unused desktop space.
- The daily service list and বাকি তালিকা render as cards below 1024px and as
  tables at 1024px+. The service table's action column is sticky, so the six
  row actions cannot be hidden behind horizontal scrolling.
- Receipt, report, dues, technician and adjustment dialogs use phone-safe
  padding and wrap/stack their date controls, cards and contact rows.
- Daily/technician/monthly cards reflow at phone and tablet widths; form inputs
  keep 36px touch heights until 1280px.

**Verified**
- `scripts/responsive-check.js` expanded from 6 checks at 3 widths to **74
  checks at 10 widths** (360, 390, 640, 768, 960, 1024, 1280, 1366, 1440,
  1920): page overflow, header height/actions, search mode, card/table view,
  sticky action visibility, dashboard grid, phone/tablet dialogs and JS errors.
- Full v1.1.4 run: **11/11 suites, 298/298 checks**, 0 FAIL, 0 JS errors; the
  live shop DB hash stayed unchanged.

### v1.1.3 — automatic expense codes & money audit

**Added**
- A typed **number** in দোকান খরচ is now saved as a canonical keypad code
  (`1500` → `*J#`, `1234` → `*ADG`); a typed code remains exactly as typed.
  `expenseAmount` is decoded for both, so খরচ/লাভ stay correct.
- The **খরচ** column is always visible, shows only the code, and each row has
  its own eye that reveals only that row's amount. The old global toggle is
  gone; the cost column and parts-shop name remain internal.
- Existing numeric rows are converted automatically by `first-run.mjs` on every
  start, after restoring an old snapshot, and by
  `npm run backfill:expense-codes`. A row with an empty code but a non-zero
  amount gets its code rebuilt rather than losing the expense.
- `npm run audit:money` — dry-run ledger audit for due/refund/expense drift,
  with conservative `--confirm` repairs. It reports invalid codes, overpay and
  other inconsistencies without touching them.
- `advance` (জমা) is now included in daily and monthly stats and shown as a hint
  under বিল. Refund reporting is grouped by the job's service date, not the
  later refund timestamp.
- Archiving a returned job now warns that its refund, expense and damage loss
  also leave the reports/profit.
- A deactivated technician's own historical row can be edited without being
  silently reassigned.

**Verified**
- New `scripts/expense-upgrade.test.js` covers first-run normalization, the
  backfill script and audit dry-run/confirm on a throwaway database.
- laneE simulates an old snapshot with a numeric expense and verifies restore
  converts it; laneA pins the per-row eye isolation; api-check pins numeric
  conversion and legacy `*B#` preservation.
- Full v1.1.3 run: **11/11 suites, 230/230 checks**, 0 FAIL, 0 JS errors; the
  live shop DB hash stayed unchanged.

### v1.1.2 — return/refund & technician damage loss

**Added**
- Terminal **ফেরত (Returned)** status and `returnedAt`, `refundAmount`,
  `refundNote`, `damageLoss`, `damageNote` fields + migration
  `20261022120000_add_return_refund_damage_loss`.
- `POST /api/services/[id]/refund` returns the **full recorded advance**,
  clears `due`, and closes an unfinished job. No partial refunds.
- **⚖️ ফেরত / ড্যামেজ ক্ষতি** dialog on each active row: a refund tab and an
  internal damage-loss tab. Returned rows cannot be edited through the normal
  form, but their damage loss can still be recorded/corrected.
- Daily/monthly stats now separate `refund`, `returnedCount` and `damageLoss`.
  Profit is `active bill − normal expense − damageLoss`; refunds are not
  deducted a second time.
- Customer receipt explains the return/refund, prints the refund line and never
  shows damage loss/notes; the PAID seal is suppressed on returned jobs.
- CSV backup carries the five new columns; restore accepts old snapshots
  without them (defaults `NULL`/`0`).
- `scripts/laneE.js` (15 checks) covers completed-damage, return/refund,
  duplicate refund rejection, locked returned rows, stats, receipt privacy,
  UI flow, CSV/restore round-trip and 390px overflow. Full run: **10/10 suites,
  215/215 checks**, live DB hash unchanged.

### v1.0.7 — dashboard redesign & product sales

- Global search moved into the navbar (right side), with the exact placeholder
  `🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)`, a live result dropdown,
  receipt/edit/contact actions, `Ctrl+K` focus, and a mobile 🔍 sheet.
- **📊 ওভারঅল রিপোর্ট** and **💰 বাকি তালিকা** are dialogs now, so the daily
  form and table stay above the fold. The dues button shows a live Bengali
  count/total (`১টি • ৳৭০০`); both dialogs close with X or Escape. Dashboard
  printing keeps the monthly report through a hidden print-only copy.
- **🛍️ প্রোডাক্ট সেল** toggle in the entry form: product-specific labels,
  automatic **ডেলিভারি** status, unchanged expense code, and storage in the
  existing `model`/`problem` columns (no schema change). A `SALES`/`দোকান`
  technician can be created through ⚙️ and sorts first in product mode.
- Compact layout: one-row 5-column technician cards, tighter cards/form,
  4/12 form + 8/12 table. At 1920×1080 the whole entry form and save button fit
  with zero page scroll.
- New `scripts/laneD.js` (28 checks) pins the layout order, both dialogs,
  desktop/mobile search, product-sale mode and the zero-scroll target.

### v1.0.6 — cost-code privacy scoped to the service table

- Corrected v1.0.5's over-masking: the daily খরচ card and the monthly
  খরচ/লাভ cards show their real amounts again, and profit is no longer hidden.
- The service table's খরচ column keeps codes private: it starts hidden, the eye
  opens it for the session, and it shows the code only. Plain-number costs are
  shown as `৳••••`, and the parts-shop name stays under the code.
- The entry form shows the decoded amount directly again. The 5-second peek
  helper (`lib/use-temporary-reveal.ts`) and its reset handlers were removed.
- laneA/laneBC now pin the corrected scope and the code-only cost column.

### v1.0.5 — shop cost/profit privacy peek

**Privacy**
- The entry-form code badge now shows the decoded amount as `৳••••` by default
  (`গোপন কোড: *J# ➔ ৳••••`); **দেখুন** reveals it for 5 seconds.
- The খরচ table column, daily খরচ card, and monthly report খরচ/লাভ are masked by
  default with the same 5-second peek.
- Reveals reset immediately on input/date/filter changes, save, Escape, tab
  hide, or window blur.
- Customer receipts/PDFs are unchanged: they never show cost, code, parts shop,
  or profit. Internal dashboard/report printouts keep full totals through
  print-only spans.
- New shared `lib/use-temporary-reveal.ts`; laneA/laneBC now pin the masking and
  auto-hide behaviour.

### v1.0.4 — secret expense codes & parts shop

**Added**
- Shared `lib/expense-code.ts` decoder used by the form, API validation and
  seed script. `*`=1, `+`=0, `#`=00, keypad letters map to 2–9; digits pass
  through and lowercase is accepted. `*J#` → 1500, `T#` → 800, `GJ+` → 450.
- Live Bengali badge in the entry form (`গোপন কোড: *J# ➔ ৳১৫০০`) while the raw
  code stays visible and is stored unchanged. Invalid characters block save
  with a Bengali message; the server re-decodes authoritatively.
- **পার্টস কেনার দোকান** free-text field (max 100 chars) with suggestions from
  previously used names (`GET /api/parts-shops`).
- `Service.partsShop` nullable column + migration
  `20261021010100_add_parts_shop`. Old snapshots without this optional column
  still restore; it becomes NULL.
- CSV export now carries both `expenseAmount` and `partsShop`.
- `scripts/backfill-expense-codes.ts`: dry-run by default, `--confirm` to apply;
  repairs old code rows that were saved with `expenseAmount = 0`.

**Privacy**
- Receipt/PDF code does not render `shopExpense`, `expenseAmount` or
  `partsShop`; laneA/laneBC assert the customer copy has no cost or shop name.
- The খরচ / পার্টস দোকান table column stays behind the existing eye-toggle.

### v1.1 — dynamic technicians & clickable cards

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
- `Service` now has 22 columns. Restore validation still rejects a snapshot
  missing a required column, while the optional `partsShop` and v1.1.2
  return/refund/damage columns may be absent and become `NULL`/`0`.
  Restore only swaps `Service` rows, which means **the roster survives a
  restore** — and restoring an old v1.0 snapshot (which has no `Technician`
  table) cannot wipe the current one.
- The CSV export still contains services only; the `.db` snapshot is what
  captures the roster.

---

## 10. Windows delivery changelog

The app was originally developed on Linux, so nothing here could be assumed to
work on a client's PC — every Windows-specific claim was verified against the
real Windows binaries instead. The current package is now built natively on
Windows as well; the run that proved it is at the end of this section.

**Added**
- `npm run build:portable` → `out/MAHER/`: a self-contained folder with a bundled
  Node 22 runtime and a Windows `better-sqlite3` (ABI 127). About **122 MB**
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
- All **370** automated checks passed at that run (564 today, see §7), and the
  live database is byte-identical.

**Native Windows run (20 Oct 2026).** The package has now been built *and*
executed on Windows — `buildHost: win32-x64`, bundled Node 22.14.0,
better-sqlite3 ABI 127 — not only cross-inspected. Launching it from a clean
temp copy succeeded (health, roster, stats), and the first real shop test found
two user-facing bugs that neither the earlier Linux pass nor the automated suite
had caught; both are fixed:

- **The cash-change box compared against the bill.** Bill 1500 / জমা 500 /
  cash 1000 printed “আরও দরকার ৫০০” instead of “ফেরত দিন ৫০০”. The calculator
  now subtracts the **জমা (advance)** — the amount actually kept — and the laneA
  regression pins both the change and the shortfall case.
- **New jobs defaulted to `Pending`.** The shop starts every job as
  **চলমান (In-Progress)**; the entry form and the create API now default there.

The Windows test harness needed three fixes of its own before it could run
natively: `npm.cmd`/`npx.cmd` need `shell: true` on Node 20+ (`Spawn EINVAL`),
screenshots were written to a literal `/tmp` (which is `D:\tmp` on Windows), and
the backup/restore routes normalize `\` to `/` before `VACUUM INTO`/`ATTACH`.
The launchers URL-escape spaces in the database path (`%20`) as well. That first
Windows run was **9/9 suites, 200/200 checks, 0 JS errors**, with the live
`prisma/dev.db` byte-identical. The current run (post-v1.2.0 + unreleased) is **41/41
suites, 749/749 checks** plus the separately-run design contract (19 checks);
the earlier v1.1.2 packaged window was also driven by hand for the shop test
above. Since v1.2.0 the package was rebuilt on Windows with the shop database
preserved across rebuilds (`portable-keep` suite): `out/MAHER/` is 122.3 MB and
served health/roster/stats when relaunched. Note `build:portable` only builds
the folder — zipping `out/MAHER` is a separate step, so refresh the zip before
handover. `PREPARE-WINDOWS.md` remains the first-run checklist for the client PC.
