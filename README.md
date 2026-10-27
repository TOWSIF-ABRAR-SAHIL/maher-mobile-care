# MAHER MOBILE CARE — দৈনিক সার্ভিস ট্র্যাকার

Single-page, **100% offline** service tracker for a mobile repair shop.
Bengali UI, local SQLite database, no cloud, no login, no internet needed
(except WhatsApp/phone itself, which lives outside the app).

```
http://localhost:3000   →   /service — the service desk (the landing page)
http://localhost:3000/products → the stock page (প্রোডাক্ট ও ইনভেন্টরি)
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
(build, lint and typecheck pass on it). The current 370-check regression (and
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
    services/route.ts      → GET ?date= / ?archived=true / ?groupId=, POST create
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
    parts-shops/route.ts   → GET ?all=true parts-shop names for the form datalist
    stats/route.ts         → GET ?date= daily + per-technician totals
    stats/monthly/route.ts → GET ?date= (rolling 30d) or ?from=&to= range
    backup/route.ts        → GET = CSV download, POST = DB snapshot + prune
    backup/list/route.ts   → GET = snapshot list
    backup/restore/route.ts→ POST = restore snapshot (atomic + column-validated)
components/
  AppHeader.tsx            → the live header: sticky navbar, date nav, আজ,
                             Sync, Backup, Restore, ⚙️ technician, Print,
                             search (Ctrl+K) + nav links
  AppNavLinks.tsx          → সার্ভিস / স্টক nav links (service desk is landing)
  Header.tsx, ProductsHeader.tsx → legacy headers, currently unimported
  HeaderSearch.tsx         → navbar search: live dropdown; mobile 🔍 sheet
  HeaderDatePicker.tsx     → calendar popover in the header (opens once,
                             toggles closed on the second click)
  PageLead.tsx             → page lead block under the header (title + sub)
  BrandMark.tsx            → logo mark used by the header
  DailySummary.tsx         → daily cards row (wraps TodayStats + TechnicianStats)
  TechnicianStats.tsx      → one card per roster technician (5-col desktop grid)
  TodayStats.tsx           → 4 daily cards (কাজ/বিল/বাকি/খরচ) + refund/damage hints
  MonthlySummary.tsx       → range report cards/presets (dialog + hidden print copy)
  ServiceForm.tsx          → entry form (4/12): service/product toggle, live due,
                             numbered multi-device rows with one shared visit
                             money block, optional IMEI per device, expected
                             delivery date (no device-lock field)
  ServiceTable.tsx         → service list (8/12): search, chips, universal/row eye,
                             1-click status, group/device badges (sr-only for
                             screen readers), delivery dates, sticky actions
  ServiceAdjustDialog.tsx  → ⚖️ return/refund + parts-cost write-off + damage ledger
  OutstandingDues.tsx      → বাকি table rendered inside the dues dialog
  ContactButtons.tsx       → phone / WhatsApp links (message text from lib/contact.ts)
  StatusBadge.tsx          → colored Bengali status badges
  Receipt.tsx              → customer bill (single + combined group slip, print/PDF)
                             + PaidStamp (জমা paid marker)
  RestoreDialog.tsx        → snapshot list + 2-step restore confirm
  TechnicianManager.tsx    → roster dialog: add / rename / deactivate / reactivate
  ProductDialog.tsx        → product create/edit dialog (products page)
  CategoryManagerDialog.tsx→ category add/rename/delete dialog (products page)
  AutoBackup.tsx           → client-side backup nudge (mounted in app/layout)
  ui/                      → shadcn primitives (button, input, table, dialog…)
lib/
  prisma.ts                → cached Prisma client + local SQLite adapter
  db-path.ts               → single source of truth for the DB file + backup dir
  technicians.ts           → roster rules: normalize, duplicate guard, cascade rename,
                             card list (active ∪ worked-today), last-active guard
  service-validation.ts    → shared create/update rules (UI and API can't drift)
  dhaka.ts                 → Asia/Dhaka day bounds, real calendar-date validation
  utils.ts                 → statuses (incl. Returned), Bengali-digit parse, due,
                             ৳ format (+ FALLBACK_TECHNICIANS, only used if the
                             roster request fails)
  types.ts                 → shared DTOs (ServiceDTO, stats, RangeMode,
                             product/stock DTOs…)
  inventory.ts             → stock rules: Bengali status labels, low-stock
                             threshold, movement validation
  inventory-data.ts        → product/category/stock read-write helpers used by
                             the products API routes
  expense-code.ts          → shop-expense keypad code (*J# ⇄ 1500) encode/decode,
                             mirrored on server and form
  contact.ts               → WhatsApp/phone message text
  shop.ts                  → shop name/address/phone (receipt + footer source)
  receipt-pdf.ts           → client-side receipt PDF file name + download
  backup.ts                → shared localStorage keys/stamps for auto-backup
  use-last-backup.ts       → hook: last-backup stamp (AutoBackup + utilities rail)
  use-media-query.ts       → hook: CSS media query, SSR-safe (defaultValue first)
  generated/               → Prisma client output (generated, do not edit)
prisma/
  schema.prisma            → Service model (28 columns, incl. return/refund/damage,
                              write-off, grouped visits, delivery dates, optional
                              IMEI + archived soft-delete) + Technician model
                              (v1.1 roster) + inventory models: ProductCategory,
                              Product, SaleItem, StockMovement
  dev.db                   → THE database (all shop records — back this up!)
  migrations/              → init + add_archived + add_technician + add_parts_shop
                              + add_return_refund_damage_loss
                              + add_group_delivery_expense_flag
                              + add_service_imei + add_inventory
backups/                   → snapshots: maher-*.db (keeps 30) + safety-*.db (keeps 5)
scripts/
  run-tests.js             → npm test: one fresh throwaway DB per suite + live-DB guard
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
  e2e-maher.js             → core flow E2E (9 checks)
  e2e-p0.js                → P0 features E2E (13 checks)
  laneA.js                 → Lane A audit (26 checks)
  laneBC.js                → Lanes B+C audit (24 checks)
  laneD.js                 → redesign/search/product-sale audit (29 checks)
  laneE.js                 → return/refund + damage-loss/write-off audit (18 checks)
  laneF.js                 → v1.2.0 grouped visits, delivery dates, returned-row
                             edit + write-off audit (22 checks)
  laneG.js                 → optional IMEI, posted lock fields ignored,
                             multi-device independence (18 checks)
  laneLanding.js           → `/` redirect, exactly two nav links, refresh +
                             backup + restore on the Service page (10 checks)
  api-check.js             → API contract + validation + restore-guard + roster (59)
  technician-mgmt.js       → v1.1 roster dialog + card filtering (25 checks)
  responsive-check.js      → 10 widths, 360–1920px: header, search, card/table,
                             grid, sticky actions + dialogs (74 checks)
  date-nav-flicker.js      → changing day keeps the list on screen, no skeletons (4)
  header-calendar.js       → the navbar calendar closes on the 2nd click (5)
  launcher-decide.test.js  → launcher reuse / takeover / refuse rules (14 checks)
  portable-keep.test.js    → a portable rebuild keeps the shop DB intact (10 checks)
  service-list-design.js   → Premium Glossy design contract (19 checks) — kept OUT
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
  (not while typing).
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
- **📊 ওভারঅল রিপোর্ট** opens the range report in a dialog: presets
  (বিগত ৩০ দিন / এই মাস / গত মাস) + custom থেকে–পর্যন্ত, then cards কাজ / বিল /
  খরচ / **বাকি** / লাভ + date-range label. বিল shows **জমা** as a hint.
  লাভ = বিল − খরচ − ড্যামেজ ক্ষতি. Returned refunds are grouped by the job's
  service date (not the later refund timestamp).
  Presets follow the navbar date;
  custom stays fixed. Close with X or Escape. Dashboard printing still carries
  the same report via a hidden print-only copy.
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
  customer receipt never show it, but it is included in the CSV backup. The
  former device-lock fields are gone from the form entirely — unlock
  credentials are not stored anywhere, and lock fields posted by an API client
  are ignored (`laneG.js` pins both rules).
- **Premium Glossy look (post-v1.2.0)** — the whole app is a blue-and-white
  dashboard: brand blues `#1748D8`/`#2863F5`/`#568BFF` on white, ink `#17233D`
  headings, `#71819B` secondary text, `#E0E8F5` hairlines, 12–16px card radii
  and 150–200ms transitions; status tones stay green `#16A36A`, amber `#E89A16`
  and red `#E5484D`. `scripts/service-list-design.js` (19 checks) pins the
  service-list half of that contract.
- **স্টক page (`/products`)** — eyebrow “স্টক রুম”, title “প্রোডাক্ট ও
  ইনভেন্টরি”: product list with search, price/stock, the category manager
  dialog and low-stock warnings, all served from the live `ProductCategory` /
  `Product` tables (creating a product logs its opening stock as a
  `StockMovement`). The `SaleItem` sale-line table and the `saleRef` idempotency
  key already exist in the schema as the foundation for linking product sales to
  stock, but app code does not write them yet.
- **🛍️ প্রোডাক্ট সেল** — a toggle at the top of the form switches between
  🛠️ সার্ভিসিং (default) and product sale. Product mode renames the fields to
  **প্রোডাক্টের নাম (যেমন: Charger, Cable)** and **বিবরণ (যেমন: 18W Type-C)**,
  forces অবস্থা to **ডেলিভারি** (select disabled), and keeps the expense-code
  field. Rows are stored in the existing `model`/`problem` columns, so there is
  no schema change. Create a `SALES`/`দোকান` technician via ⚙️; it sorts first
  in product mode. Editing such a row reopens in product mode.
- **Overpay is rejected.** জমা can never exceed মোট বিল — the save is blocked
  with “জমা মোট বিলের বেশি হতে পারে না”.
- **⚖️ ফেরত / ড্যামেজ ক্ষতি** on an active row opens one dialog with two tabs.
  **ফেরত / রিফান্ড** closes an unfinished job as **ফেরত**, returns the full
  recorded জমা and clears বাকি. When the row has a parts cost, the tab asks
  whether that cost was **written off** (parts unused/returned) or **kept** as a
  shop loss; old API callers that omit the choice keep the cost, so nothing
  silently disappears. **ড্যামেজ ক্ষতি** records an internal technician-damage
  cost; it never alters the customer's bill.
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
  The **মোট বাকি** headline is a SQL aggregate over *all* matching rows, so it
  stays 100% accurate even when the rendered list is capped. Close with X or
  Escape.
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
  with counts. The **খরচ** column is always visible and shows the stored code.
  A header **খরচ দেখান** button reveals every row at once (and **খরচ লুকান**
  hides them again), while each row's own eye reveals **only that row's** amount
  for 10 seconds. A legacy plain-number value is masked as `৳••••` until it is
  converted, and a written-off cost carries a grey **বাতিল** badge. The
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
- Backup button = server snapshot (`backups/maher-*.db`, newest **30** kept) +
  full CSV download (Excel-safe Bengali) + “সর্বশেষ ব্যাকআপ” label. The CSV and
  snapshots carry the return/refund/damage, write-off, group and delivery
  columns.
- Auto snapshot on first load of the day (staff can forget safely).
- Restore dialog = snapshot list + 2-step confirm. A restore first writes
  `backups/safety-*.db` (newest **5** kept) holding your *current* data, so a
  wrong restore is itself restorable. The swap is atomic and
  snapshot-column-validated — a bad snapshot is rejected *before* anything is
  touched. Older snapshots without the optional columns still restore; those
  fields default to `NULL`/`0`/`false` (including `groupId`, `deliveryDate`,
  `deliveredAt` and `expenseWrittenOff`). A restored pre-v1.1.3 numeric shop expense
  is converted to a code immediately; the same repair also runs on every start.
- Archiving a returned job warns that its refund, expense and damage loss also
  leave every report and the profit calculation.
- Print guard blocks blank prints; paper gets receipt-only or clean dashboard.

**Customer bill (print/PDF):**
- Preview dialog → print. Shop header (name/address/phone from `lib/shop.ts`),
  `বিল নং` (= row id), date, status, customer + job + technician,
  বিল / জমা / **বাকি**, the customer's name in the signature area, and
  “ধন্যবাদ, আবার আসবেন”. The address is
  `D107 (Level 3), Sena Shopping Complex, Nabinagar, Ashulia 1344` — the old
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
- **Return/refund is full-advance only, never partial.** `POST
  /api/services/[id]/refund` sets `status = Returned`, `returnedAt`,
  `refundAmount = advance`, `due = 0`, `deliveredAt = null`, and keeps the
  original bill/advance for audit. When the row has a cost, the body may send
  `expenseAction: "writeoff"` (parts unused/returned) or `"keep"` (shop keeps
  the loss); omitting it preserves the previous behaviour (keep). Only that
  endpoint may set `Returned`; the normal create/edit form cannot.
- **Returned rows accept safe edits, not ledger edits.** `PUT /api/services/[id]`
  allows customer/phone/model/problem/technician/service date/expense/parts
  shop/delivery date/damage fields, but rejects any `totalBill`, `advance` or
  `status` change with 400. The bill/advance/due/status fields are read-only in
  the form, and `refundAmount`/`returnedAt` are never rewritten by an edit.
- **Refund is a cash memo, not a second profit deduction.** Returned rows are
  excluded from count, bill, due, revenue and technician performance, so their
  bill never becomes profit. Their `damageLoss` always remains a shop loss; their
  `expenseAmount` remains a loss unless it was explicitly written off. Refund
  reports group by the job's **service date**, not the later `returnedAt`
  timestamp, so the cash memo stays with the day the job belonged to.
- `profit = active bill − expenseAmount (all non-archived rows not written off)
  − damageLoss (all non-archived rows)`. Returned bills contribute zero; refunds
  are not subtracted again and a written-off cost is not subtracted either.
  Shop overhead like rent is NOT in the system — “লাভ” is gross margin.
- **Worked examples:** completed bill ৳1500 with ৳500 technician damage →
  customer pays ৳1500, profit ৳1000. Unfinished job → return/refund, customer
  pays ৳0; a kept ৳800 parts cost plus ৳500 damage remains a shop loss (profit
  −৳1300 for that job), while writing the same ৳800 cost off leaves only the
  ৳500 damage (profit −৳500).
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
  (≤ 32 chars, stored exactly as typed), travels in the CSV backup but never in
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
- **Cost-code privacy lives only in the service table.** The খরচ column is
  always visible and shows only the stored code (e.g. `*B#`); a legacy
  plain-number cost is rendered as `৳••••`. The header's **খরচ দেখান** button
  reveals every row at once (no timer), and each row's own eye reveals only that
  row's decoded amount for 10 seconds. The parts-shop name sits under the code;
  the decoded total never appears on a customer copy.
- Everything else stays open: the entry form shows the decoded amount, the
  daily খরচ card shows the real total (including damage loss), and the monthly
  report shows real খরচ/লাভ. The customer receipt/PDF never prints cost, code,
  parts shop, damage loss, damage note or profit.

### Data model (`prisma/schema.prisma`)

One table, `Service`, 28 columns (grouped below by role):

| Column | Type | Meaning |
|---|---|---|
| `id` | Int | primary key, **auto-increment** — printed as `বিল নং` |
| `customerName`, `phone` | String | customer; `phone` drives the call/WhatsApp buttons |
| `model`, `problem` | String | handset + reported fault |
| `technician` | String | roster name (plain text so old snapshots stay valid) |
| `totalBill`, `advance`, `due` | Int | the money triple (`due` is derived; Returned stores 0) |
| `status` | String | `Pending`/`In-Progress`/`Completed`/`Delivered`/`Returned` |
| `shopExpense` | String? | canonical keypad code (`*J#`); legacy numeric/code aliases still decode, free text |
| `expenseAmount` | Int | decoded numeric cost for profit (1500 for `*J#`) |
| `partsShop` | String? | internal parts-buying shop name, never printed |
| `returnedAt` | DateTime? | when the full advance was returned |
| `refundAmount` | Int | cash returned (equals the recorded advance) |
| `refundNote` | String? | internal return note; never printed for the customer |
| `damageLoss` | Int | internal technician-damage cost; never printed |
| `damageNote` | String? | internal damage description; never printed |
| `expenseWrittenOff` | Boolean | returned job's parts cost cancelled from reports; code/amount stay for audit |
| `imei` | String? | optional handset IMEI, ≤32 chars, stored exactly as typed; never in the list or a receipt |
| `saleRef` | String? | unique client idempotency key for a product sale (schema foundation — app code does not write it yet) |
| `groupId` | String? | opaque id shared by every device row of one customer visit |
| `deliveryDate` | DateTime? | expected handover day (Dhaka key at ~midday) |
| `deliveredAt` | DateTime? | actual handover timestamp, server-owned from the `Delivered` status |
| `serviceDate` | DateTime | stored ~midday +06:00 so day bucketing is unambiguous |
| `archived` | Boolean | soft-delete flag; hides the row from every list and stat |
| `createdAt`, `updatedAt` | DateTime | audit trail (used by the CSV export) |

There is deliberately **no payment-history table** — `advance` is the single
payment figure the shop records, and `refundAmount` is its return memo. A
partial refund is not modelled because the shop only accepts full-advance
returns.

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

---

## 6. Offline & data-safety notes

- App needs **zero internet** (font/CSS/JS/DB all local after build). The only
  outward links are the per-row **কল** (`tel:`) and **WhatsApp** buttons, which
  the user taps deliberately — nothing phones home on its own.
- SQLite is crash-safe: committed (Saved) rows survive power cuts; only an
  unsaved open form is lost.
- A restore never leaves you without a way back: it writes a `safety-*.db` copy
  of your current data first, then swaps atomically, and a snapshot that does
  not match the expected schema is refused before any row is touched. The
  return/refund/damage/write-off/group/delivery columns are optional on restore,
  so pre-v1.1.2 snapshots still work and those fields become `NULL`/`0`/`false`.
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

`npm test` runs the full regression (17 suites, 370 checks) entirely on
**throwaway databases** — it never starts the app against `prisma/dev.db`.

For a by-hand walkthrough of the whole app — paper printouts, real WhatsApp and
dialer, Excel opening the CSV, touch on a phone, two tabs at once — see
**[`MANUAL-TEST.md`](MANUAL-TEST.md)** (161 steps, each marked safe or risky).

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
- Current full run (post-v1.2.0): **17/17 suites, 370/370 checks** — Launcher
  decide 14 · Portable keep 10 · Expense upgrade 10 · E2E 9+13 · Lane A 26 ·
  Lanes B+C 24 · Lane D 29 · Lane E 18 · Lane F 22 · Lane G 18 · Lane Landing
  10 · API 59 · Technician 25 · Responsive 74 · Date-nav 4 · Header calendar 5,
  0 FAIL, 0 JS errors; the live shop DB hash stayed unchanged.
- The Premium Glossy design contract runs **separately** (it is deliberately
  not in the default 370): `MAHER_TEST_SUITES=scripts/service-list-design.js
  npm test` → **19/19 checks**.
- v1.2.0 release run (historical): **13/13 suites, 312/312 checks** — Launcher
  14 · Expense upgrade 10 · E2E 9+13 · Lane A 26 · Lanes B+C 24 · Lane D 28 ·
  Lane E 18 · Lane F 8 · API 59 · Technician 25 · Responsive 74 · Date-nav 4,
  0 FAIL, 0 JS errors; the live shop DB hash stayed unchanged. Since then:
  portable-keep, Lane G, Lane Landing and header-calendar were added (+43
  checks) and Lane D/F grew (+15).
- v1.1.4 historical run: **11/11 suites, 298/298 checks** — same suites before
  Lane F and the date-nav regression were added.
- v1.1.3 historical run: **11/11 suites, 230/230 checks** — same suites with
  Responsive 6, before the phone/tablet card views and breakpoint expansion.
- v1.1.2 historical run: **10/10 suites, 215/215 checks** — Lane E 15 · API 56 ·
  Technician 24; the new expense-upgrade suite did not exist yet.
- **The by-hand checklist is the final acceptance pass.** `MANUAL-TEST.md` has
  161 steps, including a real PDF print/read-back; run it on the target PC after
  any UI change. The automated suite mirrors its critical paths, including the
  code-only cost column and the return/refund/damage ledger.
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
  write-off, group and delivery columns are optional on restore, with
  `NULL`/`0`/`false` defaults.
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
- **IMEI per device** — optional field on every device card (max 32 chars,
  stored exactly as typed), carried in the CSV backup, never shown in the
  service list or on a receipt. `20261026140000_add_inventory` added the
  column; `laneG.js` (18 checks) pins its rules.
- **Inventory foundation** — models `ProductCategory`, `Product`, `SaleItem`
  and `StockMovement` plus new routes `GET/POST /api/products`,
  `PUT/DELETE /api/products/[id]`, `/api/product-categories` (+`[id]`) and
  `/api/parts-shops`. The new **স্টক** page (`/products`) lists products with
  search, price/stock, summary cards, low-stock warnings and a category
  manager dialog; creating a product logs an `OPENING` `StockMovement`.
  `SaleItem` and `Service.saleRef` exist in the schema but app code does not
  write them yet (foundation for sale-to-stock).
- **Service desk is the landing page** — `/` redirects to `/service` and
  forwards bookmarked `date`/`edit`/`receipt`/`status`/`mode` params; the
  navbar now has exactly two destinations (সার্ভিস / স্টক), with a slim
  refresh/backup/restore rail on the desk. The old Home dashboard widgets are
  retired; reports, dues, technicians and all data/backup behaviour are
  unchanged (`laneLanding.js`).
- **Premium Glossy blue-and-white redesign** — every briefed design value
  lives in `app/globals.css`: royal `#1748D8` primary, `#2863F5` secondary,
  `#568BFF` gloss, `#F3F7FD` page, white cards, `#17233D`/`#71819B` text,
  `#E0E8F5` hairlines, `#16A36A`/`#E89A16`/`#E5484D` meaning colours, the
  12–16 / 9–11 / 8–10px radius ladder, soft blue-tinted shadows, plus
  `.gloss-chrome` / `.sheen` / `.gloss-primary` component classes and a
  `prefers-reduced-motion` kill-switch. DOM, testids and Bengali labels were
  deliberately left untouched; `scripts/service-list-design.js` (19 checks)
  guards the service-list half of the contract.

**Changed**
- **Numbered device cards, one shared visit money block** — the first card is
  always ডিভাইস ১ (add up to eight one at a time from an inline control); each
  card keeps only model, problem and an optional bill (+ IMEI and its own
  expected delivery day), while customer/phone/technician/status/service date/
  মোট বিল/জমা are entered once. Device bills auto-sum into the visit total,
  জমা is waterfall-allocated so no row overpays, and shop cost + parts shop
  stay on ডিভাইস ১ so a grouped visit cannot multiply expenses. Batch API and
  schema unchanged.
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

**Fixed**
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

**Tests** — default suites 13 → **17** (312 → **370** checks: +portable-keep,
+laneG, +laneLanding, +header-calendar, Lane D 28→29, Lane F 8→22), design
suite runs separately (19 checks). Full `npm test`: **17/17, 370/370, 0 FAIL**,
live DB hash unchanged.

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
- All **370** automated checks pass (17 suites), and the live database is
  byte-identical.

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
`prisma/dev.db` byte-identical. The current run (post-v1.2.0) is **17/17
suites, 370/370 checks** plus the separately-run design contract (19 checks);
the earlier v1.1.2 packaged window was also driven by hand for the shop test
above. Since v1.2.0 the package was rebuilt on Windows with the shop database
preserved across rebuilds (`portable-keep` suite): `out/MAHER/` is 122.3 MB and
served health/roster/stats when relaunched. Note `build:portable` only builds
the folder — zipping `out/MAHER` is a separate step, so refresh the zip before
handover. `PREPARE-WINDOWS.md` remains the first-run checklist for the client PC.
