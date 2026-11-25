# Manual A-to-Z Test Checklist - MSS v1.2.0 + NOTUN (post-v1.2.0)

A human walkthrough of the whole shop app, for when you want to confirm by hand
that nothing is broken before a busy day.

- **Automated coverage:** `npm test` → 46 suites, 914 checks (see README §7);
  the design contract runs separately → `MAHER_TEST_SUITES=scripts/service-list-design.js
  npm test` → 19 checks. E13-E20 below cover the return/refund and damage-loss
  ledger; B7/B7b, E1 and L2 pin the automatic expense codes and the two
  cost-reveal scopes; K1-K10 cover the responsive header, cards/table and
  dialogs; **M1-M12 cover the v1.2.0 grouped visits, delivery dates,
  returned-row edits and write-off**; **N1-N10 cover the post-v1.2.0 look,
  landing page, IMEI/no-lock, numbered device cards, the stock page and the
  scroll-free service list**; **O1-O13 cover the date modes (একদিন/তারিখ
  রেঞ্জ/সব তারিখ), the two search scopes, the new-entry shortcut, the dues
  status chips, the report date modes + customer detail table and the
  PDF/CSV/Excel export**; **P1-P10 cover the laptop-height layout, Latin
  on-screen digits, delivery chips, the single visible bill, the dues scope
  label, product search/empty state, the simplified stock list and the stock
  note**; **Q1-Q7 cover the per-device সমাধান note, the per-visit শর্ত, the
  mobile-number customer history, the receipt/PDF শর্ত block and the old-backup restore**;
  **R1-R8 cover customer payments (oldest slip first, no overpay, paid-slip
  lock, the retired verify tick) and shop purchases (stock intake, supplier
  dues, restore warning)**; **T1-T13 cover the optional per-device parts
  purchase line, the internal সার্ভিস পার্টস খাতা (filters, Paid history,
  locks), the bill/parts 409 rule, the returned-job freeze and the four-sheet
  Excel backup**; **U1-U5 cover the focused entry-form pass — money order,
  collapsed parts/devices, inline errors and sticky-save reach**; **V1-V8 cover
  inspection-fee returns, warranty/post-delivery and custom refunds, grouped
  cash-vs-transfer, one-click bulk part resolution, old-snapshot restore and
  receipt/audit privacy**; **W1-W5 cover the `/parts` three-mode date switcher,
  the saved+past shop dropdown and the shared table/card scope**; **X1-X5 cover
  the inventory search/filter toolbar, the card micro-icons and eye tooltip,
  and the onboarding vs no-match empty states**.
- **This file:** the things a script cannot judge — paper printouts, real
  WhatsApp/dialer, Excel opening the CSV, touch on a phone, two tabs open at once.

**How to use:** tick each box. Where a step says *ঝুঁকি* (risk) it is marked —
`নেই` (safe), `মাঝারি` or `সবচেয়ে বেশি`.

**Rule for test data:** start customer names with **`ZTEST`** (e.g. `ZTEST01`) so
you can find and archive them later. Your real record (`#1 Sahil`) must come out
of this checklist **byte-identical** — see step L3.

---

## 🛑 Pre-test — do not skip

- [ ] **0.1** Press **ব্যাকআপ** in the compact strip next to **সর্বশেষ ব্যাকআপ**. Expect: toast "ব্যাকআপ হয়েছে — Excel কপি নামছে", an `.xlsx` file downloads, the strip's stamp updates — *risk: নেই*
- [ ] **0.2** Open the `backups/` folder. Expect: a new `maher-*.db` file — *risk: নেই*
- [ ] **0.3** Count the files in `backups/`. Expect: 36 → 37 — *risk: নেই*
- [ ] **0.4** Open `http://127.0.0.1:3000`. Expect: the **ড্যাশবোর্ড** opens with the heading "ড্যাশবোর্ড", the four-tab navbar starting with ড্যাশবোর্ড, and the Overview / Quick actions / Technician / Shop settings / Data safety panels — *risk: নেই*
- [ ] **0.5** On the Dashboard, press **ব্যাকআপ নিন**. Expect: a toast, an `.xlsx` download and **শেষ ব্যাকআপ** in the Data safety panel updated to a real timestamp. Press **রিস্টোর** there and expect the column-validated restore dialog with **ডেটা এই PC-তে**; no অনলাইন/অফলাইন badge remains. Close it — *risk: নেই*

---

## A. Dashboard & date navigation — *risk: নেই*

- [ ] **A1** Press `←` then `→` (no mouse). Expect: the day changes both ways — *risk: নেই*
- [ ] **A2** While typing in any text box, press `←`. Expect: **the day does NOT change** (typing guard works) — *risk: নেই*
- [ ] **A3** **◄ আগের দিন** then **পরের দিন ►**. Expect: returns to the same day — *risk: নেই*
- [ ] **A4** Use the date picker to jump 3–4 days back. Expect: the table title and its `data-date` show that date, and only that day's rows are listed — *risk: নেই*
- [ ] **A5** Press **আজ**. Expect: back to today with today's rows — *risk: নেই*
- [ ] **A6** Find the search box at the top-right of the navbar with the exact placeholder **🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)**. Click elsewhere, press **Ctrl+K**, and expect the box to get focus. Type 2+ characters of a known customer; expect a live dropdown. Click a result; expect that customer's receipt/details opens — *risk: নেই*
- [ ] **A7** Close it with Escape. At **1920×1080** (100% zoom, page scrolled to top) expect no vertical page scrollbar and the form's **সেভ করুন** button visible without scrolling — *risk: নেই*

> ⚠️ After A4 remember to come back to today's date — the rest of the list is date-dependent.

---

## B. New service entry & money maths — *risk: মাঝারি (adds rows)*

- [ ] **B1** Fill: customer `ZTEST01`, phone `01700000001`, model `Redmi Note 10`, problem `ডিসপ্লে`, technician **NURUL**, shop cost code `*J#`, parts shop `ZTEST Parts` — *risk: নেই*
- [ ] **B1b** Look under the shop-cost box. Expect **গোপন কোড: *J# ➔ ৳১৫০০** — the form shows the decoded amount directly. Type `AB$`: expect a red Bengali error and save blocked; restore `*J#` — *risk: নেই*
- [ ] **B2** Type total bill `১৬০০` (Bengali digits). Expect: বাকি = `1,600` — *risk: নেই*
- [ ] **B3** Type advance `৫০০`. Expect: বাকি = `1,100` — *risk: নেই*
- [ ] **B4** Confirm the form has **no** “কাস্টমারের কাছ থেকে পাওয়া টাকা” or “ফেরত দেওয়ার টাকা” field — the cash/change calculator was removed at the client's request — *risk: নেই*
- [ ] **B5** Press **সেভ করুন**. Expect: toast "সেভ হয়েছে", form clears, new row appears, and কাজের অবস্থা resets to **চলমান** (the new-entry default) — *risk: মাঝারি*
- [ ] **B6** Read the daily cards. Expect: কাজ ১ · বিল 1,600 · বাকি 1,100 · খরচ **৳1,500** with a **“+ 1টি কোড”** hint. No eye/mask on this card (digits are always shown Western, even though Bengali input is accepted) — *risk: নেই*
- [ ] **B7** ✏️ edit the row, change shop cost to `১২০০` (a number), save. Expect: a live preview `সেভ করলে কোড হবে: *A# ➔ ৳১২০০`; after save the খরচ card still shows `৳1,200`, the **+ 1টি কোড** hint stays, and the table stores **`*A#`** (not a plain number); `ZTEST Parts` is still saved — *risk: মাঝারি*
- [ ] **B7b** Look at the **খরচ** column. Expect: it is always visible and shows codes only (`*A#`, `*J#`, …). The header **খরচ দেখান** button reveals every row at once and then says **খরচ লুকান** with a **navy background** — move the mouse away: the button must stay visible (it must not blank out); click it again to hide. Each row also has its **own eye**. Click one row's eye: only that row's amount appears (`৳1,200`) for 10 seconds, the other rows stay hidden. The customer receipt must not show the amount, code or parts shop — *risk: নেই*
- [ ] **B7c** Press the new **বাকি** chip at the end of the status strip. Expect: the list keeps only visits that still owe money (`বাকি > 0`, Returned rows excluded), the chip turns navy and its count matches the unpaid visits in the current date scope; **ফিল্টার সরান** or **সব** restores everything. The separate **সব তারিখের বাকি** dialog is unchanged — *risk: নেই*
- [ ] **B8** Set bill `1000`, advance `1500`, press save. Expect: toast **"জমা মোট বিলের বেশি হতে পারে না"** and **no row is added** — *risk: মাঝারি*
- [ ] **B9** Set bill `1000`, advance `1000`, save. Expect: saved, বাকি = **0** — *risk: মাঝারি*
- [ ] **B10** Press save on an empty form. Expect: toast "কাস্টমারের নাম দিন" — *risk: নেই*
- [ ] **B11** Type `abc` in the bill box and save. Expect: toast "মোট বিলে সঠিক সংখ্যা দিন" — *risk: নেই*
- [ ] **B12** Use phone `০১৭১১২২৩৪৪৫` and bill `1,600`. Expect: accepted (Bengali digits + comma) — *risk: মাঝারি*
- [ ] **B13** Confirm **🛠️ সার্ভিসিং** is selected at the top of the entry form. Click **🛍️ প্রোডাক্ট সেল**. Expect the model label to become **প্রোডাক্টের নাম (যেমন: Charger, Cable)**, the problem label to become **বিবরণ (যেমন: 18W Type-C)**, and কাজের অবস্থা to become **ডেলিভারি** (disabled). The shop-cost code still decodes — *risk: নেই*
- [ ] **B14** If no **SALES** technician exists, open **⚙️ টেকনিশিয়ান**, add `sales`, and close the dialog. Expect **SALES** in the form dropdown and sorted first in product mode — *risk: মাঝারি*
- [ ] **B15** Enter a product sale (customer `ZTEST02`, product `18W Charger`, details `Type-C 1m`, bill `800`, advance `500`, technician SALES, code `*J#`) and save. Expect toast "সেভ হয়েছে", status **ডেলিভারি**, বাকি **300**, and the row shows the product name/details — *risk: মাঝারি*
- [ ] **B16** Click the toggle back to **🛠️ সার্ভিসিং**. Expect service labels and the previous service status to return — *risk: নেই*
- [ ] **B17** ✏️ edit the product row. Expect the form reopens in **প্রোডাক্ট সেল** mode with **ডেলিভারি** — *risk: নেই*

---

## C. Technician management (v1.1) — *risk: মাঝারি*

- [ ] **C1** Click **⚙️ টেকনিশিয়ান** in the header. Expect: the "টেকনিশিয়ান ব্যবস্থাপনা" dialog opens — *risk: নেই*
- [ ] **C2** Type `ztest tech` → **➕ যোগ করুন**. Expect: added, and the list shows **`ZTEST TECH`** (upper-cased) — *risk: মাঝারি*
- [ ] **C3** Try adding `ZTEST TECH` again. Expect: toast "এই নামে ইতিমধ্যে একজন টেকনিশিয়ান আছে।" — *risk: নেই*
- [ ] **C4** Open the technician dropdown in the entry form. Expect: `ZTEST TECH` is there — *risk: নেই*
- [ ] **C5** Look at the dashboard cards. Expect: **5 cards** (4 + the new one) — *risk: নেই*
- [ ] **C5b** Create one entry assigned to **ZTEST TECH** first. Expect: it saves — *risk: মাঝারি*
- [ ] **C6** ✏️ edit → type `ZTEST RENAMED` → **সেভ**. Expect: a confirm dialog naming the row count (only appears because that technician owns a job) — *risk: নেই*
- [ ] **C7** Click **বাতিল**. Expect: nothing changes, the old name stays — *risk: নেই*
- [ ] **C8** ✏️ → **সেভ** → **হ্যাঁ, বদলান**. Expect: toast "(1টি পুরনো রেকর্ড সহ)", and the new name is in both the dropdown and the card — *risk: মাঝারি*
- [ ] **C9** ✏️ edit the old `ZTEST01` row. Expect: technician shows **`ZTEST RENAMED`** (history was rewritten) — *risk: নেই*
- [ ] **C10** 🗑️ ডিলিট → **বাতিল**. Expect: nothing happens — *risk: নেই*
- [ ] **C11** 🗑️ ডিলিট → **ডিলিট**. Expect: toast "নিষ্ক্রিয় করা হয়েছে", and it moves into "নিষ্ক্রিয় (1)" — *risk: মাঝারি*
- [ ] **C12** Open the dropdown again. Expect: `ZTEST RENAMED` is **gone** — *risk: নেই*
- [ ] **C13** Look at the cards. Expect: a greyed card with a **"নিষ্ক্রিয়"** tag that is still clickable — *risk: নেই*
- [ ] **C13b** ✏️ edit the job you created for `ZTEST TECH` in C5b, change the problem, and save. Expect: it saves without asking you to re-pick the inactive technician; the row still shows **ZTEST RENAMED** — *risk: মাঝারি*
- [ ] **C14** Check 🗑️ on the last active technician (NURUL). Expect: the button is **disabled** — *risk: নেই*
- [ ] **C15** Click **ফিরিয়ে আনুন** under "নিষ্ক্রিয়". Expect: active again and back in the dropdown — *risk: মাঝারি*
- [ ] **C16** Deactivate down to the last one. Expect: toast "কমপক্ষে ১ জন টেকনিশিয়ান থাকতে হবে।" — *risk: নেই*

---

## D. Clickable cards & filtering (v1.1) — *risk: নেই*

- [ ] **D1** Click the NURUL card. Expect: a ring on the card, "✓ নির্বাচিত", and the notice "🔍 শুধু **NURUL** এর কাজ দেখানো হচ্ছে" — *risk: নেই*
- [ ] **D2** Read the status chips. Expect: the counts describe **only NURUL's** work — *risk: নেই*
- [ ] **D3** Type in the search box. Expect: it searches **within** the filtered rows — *risk: নেই*
- [ ] **D4** Click the NURUL card again. Expect: filter clears, every row is back — *risk: নেই*
- [ ] **D5** Click the RONI card. Expect: the filter switches to RONI — *risk: নেই*
- [ ] **D6** Click **✕ ফিল্টার সরান** in the notice. Expect: filter clears — *risk: নেই*
- [ ] **D7** Turn the filter on, then change the date. Expect: the filter **resets by itself** — *risk: নেই*
- [ ] **D8** Click a card with no work today (e.g. ASRAFUL). Expect: **"আজ ASRAFUL এর কোনো কাজ নেই।"** — *risk: নেই*
- [ ] **D9** Open **আর্কাইভ দেখুন** while a filter is on. Expect: the filter stays; with nothing archived it says **"[NAME] এর কোনো আর্কাইভ করা কাজ নেই।"** — *risk: নেই*
- [ ] **D10** Click a greyed "নিষ্ক্রিয়" card. Expect: it filters and shows that person's old work — *risk: নেই*

> **Acceptance rule:** the sum of every card's "কাজ করেছে" must equal আজকের মোট কাজ. Check this again at L1.

---

## E. Service table — *risk: মাঝারি*

- [ ] **E1** Look at the **খরচ** column. Expect: it is always visible and shows codes only (`*J#`, `*A#`, …), never the decoded amount. The header **খরচ দেখান** button reveals all rows and stays visible as a navy **খরচ লুকান** button after the pointer leaves it; each row's own eye reveals only that row's amount for 10 seconds. A legacy plain-number value (only before upgrade/repair) is masked as `৳••••` — *risk: নেই*
- [ ] **E2** Click a status badge 3 times. Expect: পেন্ডিং → চলছে → সম্পন্ন → ডেলিভারি — *risk: মাঝারি*
- [ ] **E3** Click once more on ডেলিভারি. Expect: toast "এটা ডেলিভারি হয়ে গেছে" — *risk: নেই*
- [ ] **E4** Search by name / phone / model. Expect: each filters to one row. Note: the box is a **substring** match, so a bare ID like `1` also matches `10`, `11`, `12` — use a longer, unambiguous term — *risk: নেই*
- [ ] **E5** Search for something impossible. Expect: "কোন সার্ভিস এন্ট্রি নেই। নতুন এন্ট্রি যোগ করুন।" — *risk: নেই*
- [ ] **E6** On a Delivered row with বাকি > 0. Expect: **"⚠️ টাকা বাকি"** — *risk: নেই*
- [ ] **E7** 🗑️ ডিলিট → **বাতিল**. Expect: nothing happens — *risk: নেই*
- [ ] **E8** 🗑️ ডিলিট → **আর্কাইভ**. Expect: the dialog says "আর্কাইভ করবেন?" and "তালিকা ও হিসাব থেকে বাদ যাবে"; the row disappears from the list, the daily cards and বাকি/লাভ — *risk: মাঝারি*
- [ ] **E9** Click **আর্কাইভ দেখুন**. Expect: the archived row with a **তারিখ** column — *risk: নেই*
- [ ] **E10** Click **ফিরিয়ে আনুন**. Expect: it comes back everywhere — *risk: মাঝারি*
- [ ] **E11** Click **তালিকায় ফিরুন**. Expect: archive view closes, the day's list returns — *risk: নেই*
- [ ] **E12** ✏️ edit a row and change **তারিখ**, save. Expect: the row moves to that day; navigate there to confirm — *risk: মাঝারি*
- [ ] **E13** Create an unfinished `ZTEST` row: bill `1500`, advance `500`, status **চলছে**, save. Click **⚖️ ফেরত / ড্যামেজ ক্ষতি** on it. Expect: a dialog with **ফেরত / রিফান্ড** and **ড্যামেজ ক্ষতি** tabs; the refund tab says the job will be closed and the full **৳500** returned — *risk: মাঝারি*
- [ ] **E14** Type a short refund note and click **ফেরত দিন (৳500)**. Expect: toast, status **ফেরত**, বাকি **৳0**, row money shows **ফেরত: ৳500**; daily কাজ ও বিল no longer include it, a **+1টি ফেরত** hint appears under কাজ, and its technician card count excludes it. If the row has a shop cost, the dialog asks **লেখা বাদ** vs **খরচ রাখুন** first; no cost means no extra question — *risk: মাঝারি*
- [ ] **E15** Open **⚖️** again on the returned row. Expect: the refund tab says it is already returned (with amount/date/note) and the button is gone. Switch to **ড্যামেজ ক্ষতি**, enter `500`, note `ZTEST damage`, save. Expect: the row shows **⚠️ ড্যামেজ ক্ষতি**, the খরচ column shows **ক্ষতি: ৳500**, the daily খরচ card includes ৳500, and the customer receipt still never shows it — *risk: মাঝারি*
- [ ] **E15b** Press 🗑️ **ডিলিট** on that returned row. Expect: the confirmation adds a red warning: its **রিফান্ড, খরচ ও ড্যামেজ ক্ষতিও** will leave every report/profit until restored. Press **বাতিল**; the row must stay — *risk: নেই*
- [ ] **E16** Create a completed `ZTEST` row: bill `1500`, advance `1500`; add damage loss `500` through ⚖️. Expect: its customer bill still shows ৳1500 / ৳1500 / ৳0 with the **PAID** seal; the damage loss appears only in the internal খরচ/লাভ report — *risk: মাঝারি*
- [ ] **E17** Open 🧾 **বিল প্রিন্ট** on the returned row. Expect: the amber banner **“কাজটি সম্পন্ন হয়নি — মোবাইল ফেরত দেওয়া হয়েছে”**, a **ফেরত দেওয়া হয়েছে** line for ৳500, and **no PAID seal**. Search the paper for the damage note/amount: neither appears — *risk: নেই*
- [ ] **E18** Click ✏️ on the returned row. Expect: the form opens, but **বিল / জমা / বাকি / অবস্থা** are read-only. Change the model or problem and save; expect a success toast while the bill, জমা, status **ফেরত** and refund stay unchanged. The ⚖️ damage tab still saves a correction — *risk: নেই*
- [ ] **E19** Press **ব্যাকআপ**, open the `.xlsx` in Excel, and open the **সম্পূর্ণ ডেটা (অডিট)** sheet. Expect: `damageLoss`, `damageNote`, `returnedAt`, `refundAmount`, `refundNote`, `expenseWrittenOff`, `groupId`, `deliveryDate` and `deliveredAt` are present, and the returned row has its refund/damage/write-off values — *risk: মাঝারি*
- [ ] **E20** Restore the snapshot from E19. Expect: the returned status, refund amount and damage loss all come back; a pre-v1.1.2 snapshot (if available) still restores, with those fields `0`/blank. If the snapshot has a **plain-number** shop expense, the restored row must show a code and keep the same amount; restore must never expose or erase the number. *risk: সবচেয়ে বেশি*

---

## F. Reports & totals — *risk: নেই*

> Report and dues controls live on the **Dashboard** (Quick actions → ReportDock),
> not on the Service desk. Go Home first with the **ড্যাশবোর্ড** link.

- [ ] **F1** Click **📊 ওভারঅল রিপোর্ট**. Expect: a dialog with the three presets **বিগত ৩০ দিন / এই মাস / গত মাস** and five cards কাজ / বিল / খরচ / **বাকি** / **লাভ (Profit)** plus the date-range label. The বিল card shows a **জমা** hint. খরচ and লাভ are always visible (there is no peek button) — *risk: নেই*
- [ ] **F2** Click each preset inside the dialog. Expect: the cards and the date-range label change — *risk: নেই*
- [ ] **F3** Set a custom range with the two date inputs. Expect: the label follows — *risk: নেই*
- [ ] **F4** Set শুরু later than শেষ. Expect: toast "শুরুর তারিখ শেষের তারিখের পরে" and the range is unchanged — *risk: নেই*
- [ ] **F5** Close the dialog with **X**, reopen it and press **Escape**. Expect: both close cleanly — *risk: নেই*
- [ ] **F6** With a preset active, close the dialog, change the navbar date, and reopen the report. Expect: the preset follows that date — *risk: নেই*
- [ ] **F7** Check লাভ by hand. Expect: `লাভ = বিল − খরচ − ড্যামেজ ক্ষতি`, visible immediately. Returned bills are excluded; the refund is a memo and is not subtracted again. A **written-off** parts cost is excluded too, while damage loss is always subtracted — *risk: নেই*
- [ ] **F8** On a day containing a part code (`*M#`). Expect: daily খরচ shows the decoded **৳1,600** directly and the hint shows **+ 1টি কোড** — *risk: নেই*

---

## G. বাকি তালিকা & all-dates search — *risk: নেই*

> The **💰 বাকি তালিকা** button is on the Dashboard next to the report button.

- [ ] **G1** Look at the **💰 বাকি তালিকা** button. Expect the live Bengali count and total, e.g. `💰 বাকি তালিকা (১টি • ৳৭০০)`. Click it; expect a dialog with columns `তারিখ | কাস্টমার | মডেল/অবস্থা | বিল/জমা/বাকি | যোগাযোগ | অ্যাকশন` and the unpaid row — *risk: নেই*
- [ ] **G2** Click **কল**. Expect: the dialer opens (number normalised to +880…) — *risk: নেই*
- [ ] **G3** Click **WhatsApp**. Expect: WhatsApp opens with bill no, model and the due amount in the text — *risk: নেই*
- [ ] **G4** Fully pay an entry. Expect: it **leaves** বাকি তালিকা — *risk: মাঝারি*
- [ ] **G5** Mark a job সম্পন্ন while বাকি > 0. Expect: it **stays** in বাকি তালিকা — this is correct: work finished ≠ money received — *risk: মাঝারি*
- [ ] **G6** Focus the navbar search and type a single character. Expect: "কমপক্ষে ২ অক্ষর লিখুন।" — *risk: নেই*
- [ ] **G7** Search an old customer from a past date. Expect: found without changing the date; click it and expect the receipt — *risk: নেই*
- [ ] **G8** Close the dues dialog with **X**; reopen and press **Escape**. Expect: both close — *risk: নেই*
- [ ] **G9** Click the green **WhatsApp** icon in a daily service row. Expect: that customer's WhatsApp chat opens; inside WhatsApp the **Start call** action is available — *risk: নেই*
- [ ] **G10** Click the **PDF শেয়ার** icon in a daily service row. Expect: a PDF is generated; the Windows share sheet opens with the PDF attached. Choose WhatsApp → select the customer → confirm the PDF is attached → press **Send** — *risk: মাঝারি*
- [ ] **G11** If the share sheet/file sharing is unavailable, click **PDF শেয়ার** again. Expect: the PDF downloads and that customer's specific `wa.me` chat opens; attach the downloaded PDF and send manually — *risk: মাঝারি*

---

## H. Printing — *risk: নেই (but check the paper)*

- [ ] **H1** Press **প্রিন্ট** without changing day. Expect: a clean black-and-white dashboard print. The paper shows the same খরচ/লাভ totals as the screen (they are no longer masked) **and the monthly report cards** (they live in a dialog on screen but are included through a print-only copy). This dashboard paper is internal; the customer receipt checks are H3–H6 — *risk: নেই*
- [ ] **H2** Try to print before the page finishes loading. Expect: toast "পুরো পেজ লোড হওয়ার পর প্রিন্ট করুন" — *risk: নেই*
- [ ] **H3** Click 🧾 **বিল প্রিন্ট** on a row. Expect: the "বিল প্রিভিউ (কাস্টমার কপি)" dialog — *risk: নেই*
- [ ] **H4** Print from that dialog. Expect: **only the receipt** on paper, never the dashboard — *risk: নেই*
- [ ] **H5** Read the paper. Expect: বিল নং, তারিখ, অবস্থা, গ্রাহক / মোবাইল / মডেল / সমস্যা / **টেকনিশিয়ান**, মোট বিল / জমা / **বাকি**, the **customer's name in the signature area**, two signature lines, "ধন্যবাদ, আবার আসবেন", and the configured shop address + phone from the live profile. Before setup the name reads `আপনার দোকানের নাম` and empty address/phone lines are omitted — never a hardcoded store address or "Chandra Rd." — *risk: নেই*
- [ ] **H5b** Print/PDF a **fully paid** row (বাকি ৳০). Expect: the navy **PAID** stamp appears. Print an unpaid or partly paid row and a **returned** row: expect **no** PAID stamp — *risk: নেই*
- [ ] **H6** 🔴 Search the customer paper for "খরচ", "লাভ", "ড্যামেজ", a damage note, a part code (`*J#`), or the parts-shop name. Expect: **none of them appear at all** — *risk: নেই*
- [ ] **H7** Check that Bengali renders correctly in print (no boxes/tofu) — *risk: নেই*
- [ ] **H8** Press **PDF শেয়ার** on a row and save/inspect the PDF. Expect: the same updated address, customer name and correct PAID-stamp state as the paper receipt — *risk: মাঝারি*

---

## I. Backup & restore — *risk: সবচেয়ে বেশি (careful)*

> Run this only after 0.1–0.3 succeeded. You are about to replace live data.

- [ ] **I1** Press **ব্যাকআপ** in the strip. Expect: server snapshot + Excel workbook download + toast — *risk: মাঝারি*
- [ ] **I2** Open the `.xlsx` in Excel. Expect: Bengali correct; exactly four sheets **সারসংক্ষেপ / সার্ভিস খাতা / সার্ভিস পার্টস / সম্পূর্ণ ডেটা (অডিট)**; the খাতা is one flat table with the 12 columns **ক্রম / তারিখ / কাস্টমার / ফোন / মডেল / সমস্যা / টেকনিশিয়ান / অবস্থা / বিল / জমা / বাকি / ডেলিভারি**, serial `1..N`, oldest date first; frozen, filterable navy header; date/currency columns formatted; returned rows visible but left out of the bottom **মোট (সক্রিয়)** row; the internal পার্টস sheet carries **মূল্য কোড / কেনার তারিখ / Paid? / Paid সময় / Paid নোট** and only known-date totals, and the summary sheet never lists a part or supplier; the audit sheet has every column (including `damageLoss`, `returnedAt`, `refundAmount`, `expenseWrittenOff`, `groupId`, `deliveryDate`, `deliveredAt`, `imei`, `saleRef`), and no cell starting with `=1+1` executes as a formula — *risk: নেই*
- [ ] **I3** Open **⋯ → ব্যাকআপ থেকে রিস্টোর…**. Expect: the list shows each snapshot with a `safety` tag, size and record count — *risk: নেই*
- [ ] **I4** Click Restore once. Expect: the button turns into **"নিশ্চিত?"** — *risk: নেই*
- [ ] **I5** Close the dialog instead of clicking **নিশ্চিত?** again (there is no cancel button — the second click is what executes). Expect: nothing changes — *risk: নেই*
- [ ] **I6** Add a fresh `ZTEST99` entry, then Restore an older snapshot. Expect: `ZTEST99` **disappears** and the earlier data returns — *risk: সবচেয়ে বেশি*
- [ ] **I7** Read the toast. Expect: "ফিরিয়ে আনা হয়েছে" and that a safety copy was kept — *risk: নেই*
- [ ] **I8** Open **⚙️ টেকনিশিয়ান** after the restore. Expect: the **roster is intact** — restore only swaps `Service` rows — *risk: নেই*
- [ ] **I9** Create a new entry after restoring. Expect: its **বিল নং is larger** than before (IDs are never reused) — *risk: মাঝারি*
- [ ] **I10** Confirm `backups/` now holds roughly 37 files — *risk: নেই*

---

## J. Tabs, speed, long text, offline — *risk: নেই*

- [ ] **J1** Open two tabs, add an entry in one, press **Sync** in the other. Expect: the new row appears — *risk: মাঝারি*
- [ ] **J2** Click **সেভ করুন** three times very fast. Expect: **one** row is created (not three) and the button disables — *risk: মাঝারি*
- [ ] **J2b** Save one entry, then immediately start another **without touching the technician dropdown**. Expect: the dropdown is still pre-filled and the second save succeeds — *risk: মাঝারি*
- [ ] **J3** Enter a 50+ character customer name and a long problem. Expect: the table does not break and the page does not scroll sideways — *risk: মাঝারি*
- [ ] **J4** Use shop cost `*M#` and `২৪০০` on different rows. Expect: each is costed correctly (`*M#` = ৳1,600, numeric `২৪০০` becomes a code and = ৳2,400); the numeric row never stays as a plain number — *risk: মাঝারি*
- [ ] **J5** Turn off the internet and refresh the page. Expect: everything still works (fully offline) — *risk: নেই*

---

## K. Mobile — *risk: নেই*

- [ ] **K1** Open at 360px width (or a real phone). Expect: nothing is cut off left or right — *risk: নেই*
- [ ] **K2** Look at the header buttons. Expect: they wrap into a tidy 2-column grid and every one is tappable — *risk: নেই*
- [ ] **K3** Open the technician dialog. Expect: a long list scrolls and nothing is clipped — *risk: নেই*
- [ ] **K4** Fill the entry form by touch. Expect: no zoom or mis-tap problems — *risk: মাঝারি*
- [ ] **K5** Tap **✕ ফিল্টার সরান**. Expect: it responds on touch — *risk: নেই*
- [ ] **K6** At 360px, expect the desktop search input to be hidden and a **🔍** icon visible. Tap it; expect a top search sheet with the same placeholder, autofocus, and live results; close it — *risk: নেই*
- [ ] **K7** Open **📊 ওভারঅল রিপোর্ট** and **💰 বাকি তালিকা** at 360px. Expect: each dialog fits the screen with no sideways page scroll — *risk: নেই*
- [ ] **K8** At 360px, scroll to the service list. Expect: each record is a card (not a sideways table), with customer, model/problem, bill/জমা/বাকি and all six action buttons visible — *risk: নেই*
- [ ] **K9** Widen the window to 768px, then 1024px. Expect: the header stays compact; the list is cards at 768px and becomes a table at 1024px; at 1024px the action buttons stay pinned to the right even if the table scrolls — *risk: নেই*
- [ ] **K10** Widen to 1280px. Expect: the header drops to two rows, the search box reappears in the title row, and the form sits beside the service list — *risk: নেই*

---

## L. Final reconciliation — *risk: নেই*

- [ ] **L1** Add up every card's "কাজ করেছে". Expect: it **equals** আজকের মোট কাজ — *risk: নেই*
- [ ] **L2** For each active row check `বিল − জমা`. Expect: it **equals** বাকি (and বাকি is 0 when জমা ≥ বিল). A returned row shows **ফেরত** instead and its বাকি is 0 — *risk: নেই*
- [ ] **L3** Open entry **#1 Sahil**. Expect: **ডেলিভারি · বিল ৳১,৭০০ · জমা ৳১,৭০০ · বাকি ৳০ — unchanged** — *risk: নেই*
- [ ] **L4** Compare বাকি for the selected day against বাকি তালিকা. Expect: both count only genuinely unpaid money and **never** a returned job — *risk: নেই*
- [ ] **L5** Look for any red error on the page, and open the browser console (F12). Expect: no errors — *risk: নেই*
- [ ] **L6** Archive any `ZTEST…` rows you no longer want. Expect: your real records untouched — *risk: মাঝারি*

---

## M. Grouped visits, delivery dates & returned edits (v1.2.0) — *risk: মাঝারি*

- [ ] **M1** In a new entry, find the numbered card headed **ডিভাইস ১**. It must start open with that device's FULL information in one place — মোবাইলের মডেল → সমস্যা → ডিভাইস বিল (৳) → ডেলিভারি তারিখ → IMEI → পার্টস — without touching any collapse toggle. Its header can collapse the card to a one-line summary (model • problem • bill • parts count). Only **after** the last full card do you find **আরেকটি ডিভাইস যোগ করুন**. Press it: card **ডিভাইস ২** opens above the button with the same full set of boxes, while card ১ keeps whatever text you typed and its own open/collapsed state. Customer, phone, technician, মোট বিল, জমা, কাজের অবস্থা and দোকান খরচ are entered **once for the visit**, not per device. Add 6 more; at 8 devices the button reads **সর্বোচ্চ ৮টি ডিভাইস** and is disabled — *risk: নেই*
- [ ] **M2** Create a visit with two devices — ডিভাইস ১: model `ZTEST Group A`, bill `1500`; ডিভাইস ২: model `ZTEST Group B`, bill `800` — plus **one** জমা `500` and an expected delivery date in the shared block. Save. Expect: toast names **2টি ডিভাইস**, two rows appear on the same day with their own bills (1,500 / 800), the জমা is split across them so no row overpays, the shop cost lands only on the first row's খরচ column, and the **👥 গ্রুপ** / device-count text is **not visible** in the ID column (screen-reader only) — *risk: মাঝারি*
- [ ] **M3** Open 🧾 on either grouped row. Expect: one dialog headed **একসাথে সব ডিভাইসের বিল** with both models on separate lines, per-device বিল/জমা/বাকি, a grand total, and the expected delivery date. No shop cost, code, parts shop or damage amount appears — *risk: নেই*
- [ ] **M4** Press **PDF শেয়ার** on one grouped row. Expect: the generated PDF is the same combined slip with both devices and totals (not just that one row) — *risk: মাঝারি*
- [ ] **M5** Look at the service list after setting a delivery date. Expect: `ডেলিভারি: YYYY-MM-DD` under the status. Set a past date on an unfinished row: expect **⚠️** and red text; open its receipt and expect the expected date to print — *risk: নেই*
- [ ] **M6** Advance one grouped device to **ডেলিভারি**. Expect: `✅ ডেলিভারি: YYYY-MM-DD` replaces the expected hint in the list and the receipt prints **ডেলিভারি সম্পন্ন**. Reopen the job (set it back to **চলছে**): the actual date disappears, while the expected date stays — *risk: মাঝারি*
- [ ] **M7** Click ✏️ on a **ফেরত** row. Expect: the form opens; বিল, জমা, বাকি and অবস্থা are read-only. Change the model and save; expect success with the bill/refund/status unchanged. (The API also rejects a ledger change with 400.) — *risk: মাঝারি*
- [ ] **M8** Refund an unfinished row that has a shop cost and damage loss. Expect: the refund tab asks **খরচ হয়নি — বাদ দিন** vs **খরচ হয়েছে — ক্ষতি হিসেবে রাখুন**, and **ফেরত দিন** stays disabled until you choose. Choose **খরচ হয়নি — বাদ দিন** — *risk: মাঝারি*
- [ ] **M9** Inspect that returned row and the daily/monthly খরচ/লাভ. Expect: the code and amount are still on the row with a grey **বাতিল** badge, but the parts cost is excluded from reports/profit; the damage loss is still included. Switching the choice back to **রাখুন** (or refunding another row that way) keeps the cost as a loss — *risk: মাঝারি*
- [ ] **M10** Press the header **খরচ দেখান**. Expect: every row's decoded amount appears at once and the button becomes **খরচ লুকান** on a navy fill — move the mouse off it and the button must stay readable, not vanish. Hide them, then click one row's own eye: only that row appears, for about 10 seconds. Customer bill/PDF still shows none of it — *risk: নেই*
- [ ] **M11** Press **ব্যাকআপ** and open the **সম্পূর্ণ ডেটা (অডিট)** sheet. Expect: `expenseWrittenOff`, `groupId`, `deliveryDate` and `deliveredAt` columns exist; the grouped rows share a `groupId`, the delivered row has a `deliveredAt`, and the written-off row says `YES` — *risk: মাঝারি*
- [ ] **M12** Restore that snapshot and reopen the grouped/returned rows. Expect: group badge, expected/actual dates and write-off badge all return; an older pre-v1.2.0 snapshot still restores, with those fields blank/`0`/`false` — *risk: সবচেয়ে বেশি*

---

## N. NOTUN (post-v1.2.0) — look, landing, IMEI & stock — *risk: নেই*

- [ ] **N1** Open `http://127.0.0.1:3000/`. Expect: it lands on the service desk
  (a bookmarked `?date=` / `?edit=` still applies), and the header shows exactly
  two destination links: **সার্ভিস** and **স্টক** — *risk: নেই*
- [ ] **N2** Look over the whole page — header, cards, form panel, list panel,
  footer. Expect: the Counter Ledger theme (graphite navy chrome and primary
  buttons, white cards on a neutral paper page, quiet steel-blue accents, muted
  forest/ochre/brick meaning colours, flat surfaces with soft neutral shadows,
  rounded corners) with **every Bengali label unchanged** — *risk: নেই*
- [ ] **N3** At 1920×1080 with 150% Windows zoom (1280×720 CSS), try to scroll
  the service list sideways. Expect: **no horizontal scrollbar anywhere** — all
  columns fit, and header, daily cards, list and footer share one container
  width — *risk: নেই*
- [ ] **N4** Look at the ID column of a grouped visit row. Expect: **no visible
  badge** (the “👥 গ্রুপ” / “Nটি ডিভাইস” text is screen-reader-only now), the
  column stays narrow, row actions still work, and the combined receipt from
  the same row is unchanged — *risk: নেই*
- [ ] **N5** In a new entry, find **IMEI Number** (form + every device card).
  Expect: optional, up to 32 chars, and **no Device Lock / PIN / Pattern /
  Password block anywhere**. Save with an IMEI, then check: it appears in
  neither the service list nor the customer receipt, but is present in the CSV
  export — *risk: মাঝারি (adds a row)*
- [ ] **N6** Click **স্টক** in the header. Expect: the “প্রোডাক্ট ও ইনভেন্টরি”
  page with product list, search, summary cards and the category dialog; add
  `ZTEST Cable` with a stock number and confirm it shows the count —
  *risk: মাঝারি (adds stock data)*
- [ ] **N6b** Toggle **সার্ভিস ↔ স্টক** a few times with the nav links. Expect:
  the navy masthead never blinks, flickers or jumps — it stays at the same spot;
  neither page shoves the content sideways when the taller service list makes
  the scrollbar appear; the left/right edges of the header, cards and footer
  stay aligned. On the stock page, the top global search must still find a
  service and, when picked, return to `/service?edit=…` with that row loaded —
  *risk: নেই*
- [ ] **N7** With the service desk open, click the header calendar button twice.
  Expect: first click opens it, the second closes it — *risk: নেই*
- [ ] **N8** Filter the list into the empty state (search text with no match).
  Expect: the empty state says a filter is active, offers a working
  **নতুন এন্ট্রি** button that jumps to the form, and the masthead shows
  “showing X of Y visits” — *risk: নেই*
- [ ] **N9** If you rebuild the package (`npm run build:portable`), look at
  `out\MAHER\data\shop.db` afterwards. Expect: it still exists with the shop's
  rows — a rebuild no longer deletes the database — *risk: নেই*
- [ ] **N10** Press **Ctrl+K**, then Escape, then `←`/`→` to change day, then
  Tab through the new-entry form. Expect: everything is still reachable in the
  new layout and the day changes only when focus is not in a text box —
  *risk: নেই*

---

## O. NOTUN (post-v1.2.0) — date modes, search scope, report export & বাকি sections

*O1–O8, O11–O12 risk: নেই • O9–O10, O13 risk: মাঝারি (downloads a file / adds a row)*

- [ ] **O1** On the service list masthead find the date-mode switch:
  **একদিন | তারিখ রেঞ্জ | সব তারিখ**. Expect: **একদিন** is pressed by default and
  the day nav (আগের দিন / date picker / পরের দিন / আজ) is exactly as before;
  `←`/`→` still change the day — *risk: নেই*
- [ ] **O2** Click **তারিখ রেঞ্জ**. Expect: the day nav is replaced by two date
  pickers (শুরু/শেষ, both the same day at first), the masthead shows the Bengali
  range plus “মোট X টি”, the daily cards switch to “নির্বাচিত সময়ের মোট …”, and
  the report range/presets have **not** moved — *risk: নেই*
- [ ] **O3** Widen the range over several days that have rows. Expect: rows are
  grouped under **date section headers** (Bengali date + visit/device/৳ subtotal),
  newest day first, and the same grouping appears between the mobile cards —
  *risk: নেই*
- [ ] **O4** Click **সব তারিখ**. Expect: masthead says “সব তারিখ”, every day gets a
  section, `←`/`→` do nothing, and a `মোট X টি এন্ট্রি — দেখানো Y টি` notice with
  **আরও দেখুন** appears when the list is capped (appends, never refetches) —
  *risk: নেই*
- [ ] **O5** In a range/all view use the status chips, technician card filter and
  the list search. Expect: counts, filters, edit/receipt/advance/archive and the
  খরচ reveal all still work on grouped rows; switching back to **একদিন** restores
  the old single-day list byte-for-byte — *risk: নেই*
- [ ] **O6** Compare the two search boxes. Expect: the header placeholder is
  exactly **🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)** and finds rows from
  *other* days; the list placeholder is **এই তালিকায় খুঁজুন...** and only
  filters what is already on screen, with the searchable fields in its
  title/aria-label; neither box moved and Ctrl+K still focuses the header one —
  *risk: নেই*
- [ ] **O7** Open **রিপোর্ট**. Expect: below the date-mode switch a row
  “এই হিসাবের এক্সপোর্ট:” with **PDF / CSV / Excel**; change the mode or preset
  and confirm the row's button titles show the new window; the print output
  never contains these buttons — *risk: নেই*
- [ ] **O8** Open **বাকি তালিকা**. Expect: rows are grouped under date sections
  with a per-day due subtotal, the header line is still
  “Xটি ডিভাইস বাকি • মোট ৳Y”, বিল/জমা/বাকি values line up in one column, and
  every icon button announces itself (এডিট / বিল প্রিন্ট) to screen readers —
  *risk: নেই*
- [ ] **O9** With a preset chosen, click **CSV** then **Excel** then **PDF**.
  Expect: three files named `MSS-Report-<from>_<to>.*`; CSV opens in Excel
  with correct Bengali and the totals matching the cards (কাজ/বিল/খরচ/বাকি/লাভ),
  Excel opens with 3 sheets (সারাংশ / দৈনিক ভাঙতি / সার্ভিস), the PDF is readable
  Bengali over multiple pages, and **no খরচের টাকা per row** appears in any file —
  *risk: মাঝারি (downloads files)*
- [ ] **O10** Add a `ZTEST` row inside the shown range and re-export. Expect: the
  new row is in the CSV/Excel row sheet and the daily breakdown; then archive it
  again — *risk: মাঝারি (adds a row)*
- [ ] **O11** Press **নতুন সার্ভিস এন্ট্রি** in the service masthead on desktop,
  then again on a phone. Expect: the page jumps to the entry form and the cursor
  lands in কাস্টমারের নাম; on the phone the tabs switch to **নতুন কাজ** first;
  রিপোর্ট / বাকি তালিকা / প্রিন্ট / টেকনিশিয়ান and the header did not move —
  *risk: নেই*
- [ ] **O12** Open **বাকি তালিকা**. Expect: a chip row **সব | পেন্ডিং | চলছে |
  সম্পন্ন | ডেলিভারি | ফেরত** at the top, each with a live visit count in
  parentheses and the same coloured dot as the service list; **সব** is pressed;
  pressing **পেন্ডিং** keeps only pending visits and its count does not change;
  **ফেরত** shows “এই অবস্থায় কোনো বাকি নেই।” with **সব দেখান**, because a
  returned job never carries বাকি; on a phone the row scrolls sideways without
  widening the dialog — *risk: নেই*
- [ ] **O13** Open **রিপোর্ট**. Expect: **একদিন | তারিখ রেঞ্জ | সব তারিখ** above
  the range; **একদিন** asks for one date, **তারিখ রেঞ্জ** keeps the old presets,
  **সব তারিখ** covers the whole ledger. Below the cards a **কাস্টমার ডিটেইল
  রিপোর্ট** table lists তারিখ / বিল নং / কাস্টমার / ফোন / মডেল / সমস্যা /
  টেকনিশিয়ান / অবস্থা / বিল / জমা / বাকি / ফেরত; a returned row shows its ফেরত
  amount and return date with বাকি ৳0, and no খরচ/IMEI/parts-shop ever appears.
  Export PDF/CSV/Excel and confirm the file name, totals and rows follow the
  selected mode (সব তারিখ → `MSS-Report-all.*`) — *risk: মাঝারি (downloads
  files)*

---

## P. NOTUN (post-v1.2.0) — laptop window, screen digits & product costs

*P1–P3, P7–P10 risk: নেই • P4–P6 risk: মাঝারি (adds rows)*

- [ ] **P1** Resize the browser to **1280×585** (or 150% zoom on 1920×1080).
  Expect: the form starts under the summary bar, **মোট বিল / জমা / বাকি
  (স্বয়ংক্রিয়)** stay visible without scrolling, the **সেভ করুন** bar does not
  cover them, and the empty-state hint line is fully on screen —
  *risk: নেই*
- [ ] **P2** In that short window with an empty day, click the empty-state
  hint line. Expect: the cursor lands in **কাস্টমারের নাম** immediately
  on desktop and the page did not jump somewhere else — *risk: নেই*
- [ ] **P3** Switch between 1280 and 1920 widths. Expect: header, summary,
  form/list and footer share one left/right edge; the form column is 340px
  below 1536 and 380px from 1536; there is **no horizontal scrollbar** and the
  service list never scrolls sideways — *risk: নেই*
- [ ] **P4** Read every money, count and date on screen. Expect: Latin digits
  (`৳1,200`, `8টি ভিজিট`, `শুক্রবার, 6 নভেম্বর 2026`) with Bengali month names;
  type a bill in Bengali digits (`১২০০`) and save — it stores and reads back
  correctly; open a receipt, report and monthly print and confirm those still
  use Bengali digits — *risk: মাঝারি (adds a row)*
- [ ] **P5** In a new entry press **আজ · কাল · ৩ দিন · ৭ দিন**, then **×**.
  Expect: the delivery date starts empty, fills and clears with the chips, a
  typed date still works, and a saved date shows on the row — *risk: মাঝারি
  (adds a row)*
- [ ] **P6** Look at the new-entry money block. Expect: only **মোট বিল (৳)**,
  **জমা (৳)** and the colored **বাকি: ৳…** strip are visible; open the first
  device card to find
  the per-device bill field; with two devices their bills sum into the visit
  total and জমা never overpays a row — *risk: মাঝারি (adds rows)*
- [ ] **P7** Look at the toolbar's dues button. Expect: it names its scope —
  **সব তারিখের বাকি (Nটি ডিভাইস • ৳X)** — and opens the same dues dialog —
  *risk: নেই*
- [ ] **P8** Open **স্টক**. Expect: the search box and category select share one
  toolbar above the stock-status chips, and a truncated long product name shows
  its full text on hover; at 1280×585 the list starts high on the page — *risk: নেই*
- [ ] **P9** On **স্টক**, confirm the list shows no sort dropdown, no **ক্রয়**
  column, no **ক্রয় দেখান** eye and no visible SKU/bar code. The four summary
  cards (value masked until the eye is clicked), the filter toolbar, category
  filter + manager, stock, selling price and add/edit/archive all still work;
  the buying price appears only inside the add/edit dialog — *risk: নেই*
- [ ] **P10** On **স্টক** read the amber note above the list, dismiss it with ×,
  then reload. Expect: it says product sales do not reduce stock yet,
  disappears, and stays hidden after reload (`localStorage`) until that key is
  cleared — *risk: নেই*

---

## Q. NOTUN — সমাধান (solution) & শর্ত (condition) - *risk: মাঝারি (adds rows)*

- [ ] **Q1** New entry: open the collapsed **কাস্টমারের শর্ত** section
  under the phone row and tap one or two শর্ত chips (they insert the shop's
  wording; you can still edit it). Save. Expect: the row appears with a **শর্ত
  আছে** marker and no সমাধান marker yet. Now press **+ সমাধান** on that device
  line: a dialog opens, type the work done and save. Expect the button now reads
  **সমাধান** — *risk: মাঝারি*
- [ ] **Q2** Add a second device to the same visit and save; press each device's
  **+ সমাধান** button and give it a different note. Expect: the two lines show
  **সমাধান 1** and **সমাধান 2**, each opening its own note, while the শর্ত text
  is the same for both (one visit, one set of terms) — *risk: মাঝারি*
- [ ] **Q3** Enter a new job with the **same model and same সমস্যা** as Q1, then
  open its **+ সমাধান** dialog. Expect: a normal text box with a few past-note
  suggestions, no সমাধান খাতা/history button; past notes appear only through the
  top header search (Q7) — *risk: নেই*
- [ ] **Q4** Press the pencil on Q1: the **কাস্টমারের শর্ত** section opens with
  its text and the device card shows মডেল / সমস্যা / বিল / ডেলিভারি / IMEI
  together, but there is **no** সমাধান field in the form (it lives only on the
  list button). Then press **সমাধান** on that row, clear the note and save.
  Expect: the marker returns to **+ সমাধান** and bill/জমা/বাকি do not change —
  *risk: মাঝারি*
- [ ] **Q5** Open the রিসিট of a row with both fields. Expect: a **শর্ত** block
  prints the customer terms; the internal সমাধান is **never** on the paper or
  in the PDF. For a grouped visit, the combined slip prints শর্ত once and each
  device's solution nowhere — *risk: নেই (but check the paper)*
- [ ] **Q6** Type only a unique সমাধান word into the top header search. Expect:
  nothing found (the header search never looks inside সমাধান); a 501-character
  note is rejected with a Bengali warning — *risk: নেই*
- [ ] **Q7** Type a customer's existing mobile number into the top header
  search (both `01…` and `+880…` formats). Expect the dropdown to list that
  customer's older jobs from every date with the **full detail** — date, model,
  problem, technician, বিল / জমা / বাকি, delivery date, status, and the stored
  **সমাধান:** + **শর্ত:** lines. For a grouped visit expect one result that lists
  **ডিভাইস 1 / 2 / …** with each device's own model, problem and সমাধান (not N
  identical cards). Then search the customer's **name** instead:
  the same rows appear but the সমাধান line must **not** show — *risk: মাঝারি*

---

## R. NOTUN — পেমেন্ট (customer payments) & ক্রয় (shop purchases) - *risk: মাঝারি (adds payments/stock)*

- [ ] **R1** Pick a row with বাকি and press the wallet (**টাকা নিন**). Expect:
  the dialog **টাকা নিন** shows মোট বাকি for that phone, a টাকার পরিমাণ box,
  **সব বাকি**, a মাধ্যম picker (**নগদ / বিকাশ / অন্য**), an optional নোট and the
  **কোন স্লিপে কত যাবে** list. Enter less than the বাকি and সেভ করুন. Expect: the
  row's বাকি drops by exactly that amount, it is **not** পরিশোধিত yet, and the
  money is not added to বিল — *risk: মাঝারি*
- [ ] **R2** Press **টাকা নিন** again on the same row, tap **সব বাকি** and save.
  Expect: বাকি becomes ৳০, a **পরিশোধিত** badge appears under the status, the
  WhatsApp message says the bill is fully paid, and the receipt prints the
  PAID stamp. The বিল / খরচ / লাভ cards and the report do not move — a payment
  is not a bill — *risk: মাঝারি*
- [ ] **R3** Open **টাকা নিন** on a due row and type more than মোট বাকি. Expect:
  the inline warning **বাকির চেয়ে বেশি টাকা নেওয়া যাবে না।** and a disabled
  **সেভ করুন** — nothing is saved (the API also answers 400) — *risk: নেই*
- [ ] **R4** Give one phone **two** due slips on two different days, then take
  money that covers only the older one. Expect: the preview list puts the older
  slip first, its share closes that slip (পরিশোধিত), and the newer slip keeps
  the remainder. No slip's বাকি ever goes below ৳০ — *risk: মাঝারি*
- [ ] **R5** Press the pencil on the fully-paid slip from R2. Expect: a lower
  বিল, a lower জমা, or a changed জমা without a bill rise answers a Bengali
  warning, while গ্রাহক / ফোন / মডেল / সমস্যা / সমাধান still save.
  - Raise **ডিভাইস বিল (৳)** alone by 500 and save: the bill increases and
    a fresh বাকি of 500 appears; **টাকা নিন** can settle it.
  - Reload a fully-paid slip, add a new part, then raise **ডিভাইস বিল (৳)**
    **and জমা** to the same new amount (e.g. both 6500) and save: both save,
    বাকি stays ৳০ and the slip remains পরিশোধিত — the extra part is paid.
    Entering a জমা above the new bill is still refused — *risk: মাঝারি*
- [ ] **R6** Look at a due row's status cell. Expect: **no যাচাই করুন link and
  no যাচাই badge anywhere in the list** (the tick was retired); বিল / জমা / বাকি
  and the পরিশোধিত badge behave exactly as before, and an old backup that
  still carries a `verified` value restores without error — *risk: নেই*
- [ ] **R7** Open **স্টক** → **দোকান ও ক্রয়**, then **নতুন ক্রয়**. Pick a
  tracked product, set পরিমাণ and ক্রয় মূল্য, set সাপ্লায়ারের নাম, leave
  **এখনই পরিশোধ** empty and save. Expect: the summary cards (মোট ক্রয় /
  পরিশোধিত / বাকি) and the bill row appear; the product's স্টক grows by the
  quantity and its ক্রয় price updates. The service daily cards, report খরচ and
  লাভ stay exactly as before — *risk: মাঝারি*
- [ ] **R8** Press **সাপ্লায়ারকে টাকা দিন** on that bill: a partial amount works,
  more than মোট বাকি is refused, and the bill's বাকি falls. Then restore an old
  snapshot taken **before** these features existed. Expect: the restore succeeds
  with a warning that পেমেন্ট/ক্রয় history was cleared, and both the payment
  list and **দোকান ও ক্রয়** are empty — no half-restored allocations remain
  — *risk: মাঝারি*

---

## S. NOTUN — সার্ভিস পার্টস কেনা খাতা - *risk: মাঝারি (adds supplier bills)*

- [ ] **S1** Open an existing device edit form. Confirm **পার্টস কেনার বিল যোগ করুন**
  is gone — the new-entry form has no such action either. Add more rows with
  **আরেকটি পার্টস যোগ করুন** inside **পার্টস** instead — *risk: নেই*
- [ ] **S2** For an existing service-part bill (API/legacy data), confirm a
  wholesale shop, two free-text lines, buying prices and **এখনই পরিশোধ** set to
  less than the total read as **সার্ভিস পার্টস**, show the linked service ID, and
  leave the remaining supplier **বাকি** — *risk: মাঝারি*
- [ ] **S3** Confirm the service-part bill does not increase product stock or
  write a `STOCK_IN` movement. It must not appear as a normal stock purchase —
  *risk: মাঝারি*
- [ ] **S4** Confirm the linked service's internal খরচ/লাভ uses the purchase
  line total once. Adding manual part lines to a device that already has a
  linked **সার্ভিস পার্টস** bill (or linking a bill to a device that already has
  part lines) must be refused with a coexistence error (409), so the same
  buying amount can never be counted twice — *risk: মাঝারি*
- [ ] **S5** Open **স্টক → দোকান ও ক্রয়**. Expect the row to identify itself as
  **সার্ভিস পার্টস** and show its linked service number — *risk: নেই*
- [ ] **S6** Press **সাপ্লায়ারকে টাকা দিন**, pay the remaining amount, and confirm
  the bill becomes **পরিশোধিত**. Paying more than the supplier due must be refused
  with no new allocation — *risk: নেই*
- [ ] **S7** Open the customer receipt/PDF and WhatsApp message. Expect no
  wholesale shop, buying price, supplier due or internal parts total — *risk: নেই*
- [ ] **S8** Restore a backup taken before service-part purchases existed. Expect
  service-part purchase history to clear with a warning while ordinary stock
  and existing service rows remain safe — *risk: মাঝারি*

---

## T. NOTUN — সার্ভিস পার্টস লাইন ও খাতা - *risk: মাঝারি (edits rows & ledger)*

- [ ] **T1** Open a new service, expand **আরও তথ্য** and add one part line (name,
  qty, plain price, supplier, purchase date). Expect the date defaults to today
  (editable, never derived from the service date), a plain price previews and
  saves as a canonical code (`1500` → `*J#`), a device with no lines writes
  nothing, and a fully blank row is ignored — *risk: নেই*
- [ ] **T2** Try saving a partial part row (e.g. name but no price/supplier/date)
  and a blank price. Expect a Bengali validation error, the internal section
  opens, and no row is saved — *risk: নেই*
- [ ] **T3** Enter a keypad code (e.g. `*J#`) as the line price. Expect the form
  shows the decoded amount preview, save succeeds, and the decoded amount never
  appears on the receipt/PDF. In the list, a parts-only row shows the part's code
  (`*J#`) with its own eye and a masked `পার্টস ••••`; that eye or the header
  **খরচ দেখান** reveals the parts total — *risk: মাঝারি*
- [ ] **T3b** Save one device with **three** differently named parts (one with
   quantity 2). In the service list (desktop row, grouped device line and mobile
   card) expect a **পার্টস (3) ••••** chip followed by three aligned lines — each
   part's name, `×2` where relevant, and its own safe price code on the right —
   not a bare run of codes. The taka stays masked until the row eye / header
   **খরচ দেখান** is pressed, and no part name, code or amount reaches the
   receipt/PDF — *risk: নেই*
- [ ] **T3c** On a new device add two parts of ৳4,000 each, tick **ড্যামেজ** on
  the first one, then save with bill ৳5,000 / জমা ৳5,000. Expect the damaged row
  keeps its name/price/supplier/date, shows the amber chip and hint, and its
  checkbox is disabled on a later edit. The daily **মোট খরচ** card must show
  ৳8,000 with the hint `এর মধ্যে ক্ষতি ৳4,000`, **লাভ** −৳3,000, বাকি ৳0, and no
  part name or amount on the receipt/PDF — *risk: মাঝারি*
- [ ] **T3c2** On an edit form with one part of **পরিমাণ 2** (৳1,000 each), press
  **১টি আলাদা লাইন — একটিকে ড্যামেজ দিন**. Expect two ৳1,000 lines with the same
  name/shop/date, **মোট** still ৳2,000, the new line first and selectable, the
  saved line's **ড্যামেজ** box locked. Tick the new line's **ড্যামেজ** and save:
  **ড্যামেজ ক্ষতি** rises by ৳1,000 only, the remaining line stays in খরচ, and
  the receipt/PDF shows neither — *risk: মাঝারি*
- [ ] **T3d** Enter a service with 2–3 differently named parts saved in that
  order, then open **এডিট**. Expect the *same structure* as the entry form:
  টেকনিশিয়ান, then the numbered **ডিভাইস #১** card (its old **ডিভাইসের তথ্য**
  summary is screen-reader-only) containing মডেল → সমস্যা → ডিভাইস বিল →
  ডেলিভারি → IMEI → পার্টস,
  then the মোট বিল/জমা/বাকি summary and অবস্থা. No second flat layout, no empty
  extra device card, no duplicate field ids (labels/tab order point at the right
  box), the parts still in entry order, and the মোট বিল editable and matching
  **ডিভাইস বিল (৳)** both ways — change either one and the other follows;
  saving a new amount from either box updates the saved bill and বাকি — *risk: নেই*
- [ ] **T4** Edit a saved line but leave supplier/purchase date blank, then save.
  Expect the stored supplier/date stay unchanged (a legacy `NULL` date is never
  filled or cleared) — *risk: মাঝারি*
- [ ] **T5** Open **স্টক → দোকান ও ক্রয় → সার্ভিস পার্টস খাতা**. Filter by date
  range and supplier, then switch tabs (সব / Unpaid / Paid / তারিখহীন). Expect the
  summary cards depend only on date + supplier and never change when switching
  tabs; unknown-date lines list under **তারিখহীন** but never enter Paid/Unpaid
  totals — *risk: নেই*
- [ ] **T6** Mark an unpaid known-date line **Paid** (with a note) then **Unpaid**
  (with a reason). Expect `paidNote` keeps an append-only timestamped history,
  Paid lines cannot be repriced or deleted, and a Paid/history line cannot be
  removed by saving `parts: []` until it is Unpaid with a reason — *risk: মাঝারি*
- [ ] **T7** For a legacy line with no purchase date, try **Paid** and **Delete**.
  Expect Paid requires setting a valid date with explicit confirmation, and
  Delete requires a reason + confirmation — *risk: মাঝারি*
- [ ] **T8** Use a supplier-wide bulk Paid/Unpaid action (≤100 selected ids; a
  supplier window larger than 500 rows must be refused atomically). Expect every
  eligible row updates together and ineligible rows are reported, not half-done —
  *risk: মাঝারি*
- [ ] **T9** Mark a service **Returned**, then try to edit/delete its part lines
  and try to toggle a part Paid. Expect part edits/deletes are refused with 409
  while the Paid toggle is still allowed, and customer dues/payments are
  unchanged — *risk: মাঝারি*
- [ ] **T10** Try to add manual part lines to a device that has a linked
  **সার্ভিস পার্টস** bill, and try to link such a bill to a device that already
  has part lines. Expect each is refused with a coexistence error (409) and the
  দোকান খরচ lump remains the fallback only when the device has neither — *risk: মাঝারি*
- [ ] **T11** In a grouped visit, give one device part lines and another none.
  Expect only the device with lines gets `ServicePart` rows/cost and the other
  keeps its normal shop-expense behavior — *risk: মাঝারি*
- [ ] **T12** Take an Excel backup and open it. Expect a separate internal
  **সার্ভিস পার্টস** sheet with **মূল্য কোড**, supplier, purchase date and paid
  history/known-date totals, while the summary sheet, receipt and PDF contain no
  part or supplier detail — *risk: নেই*
- [ ] **T13** Open **স্টক**. Expect no sort dropdown, no ক্রয় column/eye and no
  visible SKU/bar code; the summary cards, stock-status chips, shared search +
  category toolbar, category manager, stock, selling price and add/edit/archive
  still work, and the buying price appears only in the add/edit dialog — *risk: নেই*

---

## U. NOTUN — focused entry-form pass — *risk: নেই to মাঝারি (UI only)*

- [ ] **U1** Open a new entry at 1440px, 768px and on a 390px phone (form tab). In the shared money block the labels must read **মোট বিল (৳) → জমা (৳) → বাকি: ৳…**, with **বাকি** shown as a colored read-only strip and no unexplained lone `৳0` anywhere. The four date shortcuts (**আজ / কাল / ৩ দিন / ৭ দিন**) sit on one tidy row of full-width cells under the date box with no clipped label — *risk: নেই*
- [ ] **U2** On a blank form, **পার্টস** is collapsed with no empty-state helper text and has one obvious **পার্টস যোগ করুন** action. Press it: the row stays inside the same card with name/price/qty/shop/date plus a labeled **মোট** only after a line exists. A line with no price fails with **পার্টসের দাম দিন** directly under the *price* box, not the date — *risk: নেই*
- [ ] **U3** Submit an empty form. Expect an inline error under **কাস্টমারের নাম** (not just a toast), the field marked invalid, and the cursor already in it. Repeat with a missing technician, status, problem or editing-row IMEI: each message lands under its own field — *risk: মাঝারি*
- [ ] **U4** In a two-device visit, type model/problem in ডিভাইস #১, collapse it, add ডিভাইস #২, then leave only ডিভাইস #২'s model empty and save. Expect the cursor and error on ডিভাইস #২'s model, that card reopens automatically, and ডিভাইস #১'s earlier text still there when you reopen it — *risk: মাঝারি*
- [ ] **U5** On the 390px form, force a validation error and confirm the focused field is fully above the sticky **সেভ করুন** bar (not hidden behind it). Finish a small entry and save; the row must still land in the daily list — *risk: নেই*

---

## V. NOTUN — ফেরত, ওয়ারেন্টি রিফান্ড ও চেকিং ফি — *risk: মাঝারি (adds rows, changes reports)*

- [ ] **V1** Create a `ZTEST` job with bill `1500`, জমা `500`, status **চলছে**. Press **⚖️ ফেরত / ড্যামেজ ক্ষতি**, type **চেকিং / সার্ভিস ফি (৳)** `100`, leave **কাস্টমারকে ফেরত** blank, note `ZTEST checking`, and confirm. Expect: status **ফেরত**, refund line **৳400**, বিল/জমা **৳100**, বাকি **৳0**; daily and monthly বিল/লাভ rise by exactly **৳100** as labour income while the refunded ৳400 never becomes a cost — *risk: মাঝারি*
- [ ] **V2** Create another job, move it to **ডেলিভারি**, and press ⚖️ again. Expect the banner **ওয়ারেন্টি ফেরত: ডেলিভারির পরও এই কাজটি ফেরত হিসাবে বন্ধ করা যাবে।** Confirm a full refund. Expect: status **ফেরত**, refund = the whole জমা, the actual delivery date is cleared, and the row stays out of বিল/বাকি — *risk: মাঝারি*
- [ ] **V3** Create a `ZTEST` job with জমা `800` and reopen ⚖️. Type **কাস্টমারকে ফেরত** `250`, no fee. Expect: refund **৳250**, বাকি **৳0**, and the original bill/advance still visible on the returned row for audit (only a fee return rewrites them). Try `900` instead: the save is refused because the refund exceeds the জমা — *risk: মাঝারি*
- [ ] **V4** Create a two-device visit with one shared জমা `500`, bills `1500`/`800`. Return the first device with **গ্রুপের অন্য ডিভাইসে জমা করুন**, pick the sibling from **ডিভাইস বেছে নিন**, and confirm. Expect: zero cash refund on the returned device, the sibling's জমা grows by the retained `500` and its বাকি drops by `500` — no other row or customer payment changes. Repeat with **কাস্টমারকে ক্যাশ ফেরত দিন** on a second group: cash is refunded and the sibling is untouched — *risk: মাঝারি (money moves)*
- [ ] **V5** Create a device with two optional parts, open ⚖️ and check the **সংযুক্ত পার্টস** list. Choose **সব পার্টস মহাজনে ফেরত** and confirm. Expect: both part lines show **ফেরতকৃত** in `/parts`, the device's parts cost is written off (grey **বাতিল**, excluded from খরচ/লাভ), both lines drop out of the supplier balance total, and the separate expense question is not asked — *risk: মাঝারি*
- [ ] **V6** Repeat with **সব পার্টস দোকানের স্টকে জমা**: expect a stock product/`STOCK_IN` movement and no shop cost. Then with **কাজের সময় নষ্ট হয়েছে**: expect no stock added, the full parts cost carried once as **ড্যামেজ ক্ষতি**, and supplier dues still payable — *risk: মাঝারি*
- [ ] **V6b** Create a device with two parts bought from another shop, open ⚖️ and choose **সব পার্টস খাতায় রাখি (স্টকে যাবে না)**, then confirm. Expect: status **ফেরত**, both lines show **খাতায় রাখা** under the new tab in `/parts`, both lines still count toward that supplier's **বাকি**, no product and no `STOCK_IN` movement appear in `/products`, no **ড্যামেজ ক্ষতি** is added, and the device's parts cost is written off — *risk: মাঝারি*
- [ ] **V6c** Open **নিষ্পত্তি / অবস্থা পরিবর্তন** on a live `/parts` row and pick **খাতায় রাখা** with the hint **খাতায় থাকবে, স্টকে যাবে না, বাকি থাকবে**. Expect a **খাতায় রাখা** badge, the supplier balance unchanged, no stock or damage change; changing an older **স্টকে যুক্ত** line here reverses its stock movement first — *risk: মাঝারি*
- [ ] **V7** Take a backup, restore an older snapshot that has neither `inspectionFee` nor `returnReason`, and reopen a returned row. Expect: restore succeeds, the fee reads **৳0** with no reason text, and every older bill/refund/damage value is unchanged. Restore today's snapshot afterwards — *risk: সবচেয়ে বেশি (careful)*
- [ ] **V8** Print the customer receipt/PDF for a fee return and open the Excel **সম্পূর্ণ ডেটা (অডিট)** sheet. Expect: the return banner and refund line are on the paper, but no inspection-fee note, supplier price, parts-shop name or damage loss appears there; the audit sheet does carry `inspectionFee` / `returnReason` for internal use. Reopen ⚖️ on the returned row: the dialog shows the refund, fee, reason and date with no confirm button — *risk: নেই*

- [ ] **W1** Open **স্টক → দোকান ও ক্রয় → সার্ভিস পার্টস খাতা**. Expect the old
  `শুরুর তারিখ` / `শেষ তারিখ` boxes are gone; in their place is the same
  **একদিন | তারিখ রেঞ্জ | সব তারিখ** switcher as `/service`, opening on **একদিন**
  with `আগের দিন`, the date picker, `পরের দিন` and `📅 আজ`. The rows and all four
  cards match only today — *risk: নেই*
- [ ] **W2** Click `আগের দিন` / `পরের দিন`, pick another date, then `📅 আজ`.
  Expect the list and every card (চিহ্ন নেই / Paid চিহ্ন / মোট (তারিখ আছে) /
  তারিখহীন) change together, and the table has no sideways scroll — *risk: নেই*
- [ ] **W3** Choose **তারিখ রেঞ্জ**. Expect the day arrows disappear and
  `শুরুর তারিখ – শেষের তারিখ` appear; set a two-day window with rows on both days
  and confirm the table plus cards cover exactly that window. Choose **সব তারিখ**
  next: both pickers vanish, the full history returns and the `তারিখহীন` card
  shows known legacy money without entering `মোট` — *risk: নেই*
- [ ] **W4** Open the **পার্টসের দোকান** dropdown. Expect `সব দোকান` first, then
  every shop saved on this PC *and* every shop used on an older part line, even
  if it was never saved. Pick one shop: only that shop's rows and card totals
  remain, in whichever date mode is active — *risk: নেই*
- [ ] **W5** In **সব দোকান + সব তারিখ**, mark some filtered lines Paid or Unpaid
  with the bulk buttons, then switch shops and date modes. Expect the bulk action
  obeyed the current scope, no other shop's line changed, and no table column,
  status badge or action icon was lost. Repeat at 1280px and 1366px: no
  horizontal scroll — *risk: মাঝারি*
- [ ] **W6** In the **দাম** column expect the real code (e.g. `কোড: *J#`) always
  visible, while the amount shows `৳••••` and `৳•••• × [qty]` by default. Click
  that row's 👁️: only that row's amount opens; click again to hide it. The
  **দোকান** column stays visible with clean shop names — *risk: নেই*
- [ ] **W7** On the same toolbar line as the **সব / ব্যবহৃত / মহাজনে ফেরত /
  ড্যামেজ** chips, expect **পেমেন্ট চিহ্ন** beside them with no extra blank row;
  a Paid line carries a green **Paid চিহ্ন** badge and an unpaid one a red
  **চিহ্ন নেই** badge, with the resolution badge spaced apart — *risk: নেই*
- [ ] **W8** On the right of the masthead, open **🏪 দোকান ব্যবস্থাপনা (Nটি)**.
  There is no bulky shop card above the ledger any more. Each shop shows a slate
  **মোট: ৳…**, an emerald **পরিশোধ: ৳…** and either a rose **⚠️ বাকি: ৳…** badge
  or a quiet green **✅ পরিশোধিত** tag when nothing is owing. The footer reads
  **মোট বিল: ৳… | পরিশোধিত: ৳… | মোট বাকি দেনা: ৳…**, with the last figure bold
  rose. Try to delete a saved name that already has part lines: the trash button
  is disabled with the tooltip **লেনদেন থাকায় দোকানটি ডিলিট করা যাবে না**; a saved
  name with no rows still deletes normally after confirmation — *risk: মাঝারি*
- [ ] **W8b** In the same dialog click the **🔍** button (title **এই দোকানের খাতা
  দেখুন**) on any shop. The dialog closes, the ledger's **পার্টসের দোকান** filter
  jumps to that shop, and the already-chosen date mode stays the same. Clicking
  the same shop again from the dialog re-applies the filter — *risk: নেই*
- [ ] **W9** In the ledger toolbar click **👁️ দাম দেখান**: every visible row's
  amount opens at once, the button turns navy and reads **দাম লুকান**, and the
  row eyes are disabled while it is pressed. Click again: all amounts return to
  `৳••••` and the button goes back to its neutral outline — *risk: নেই*

---

## X. NOTUN — inventory dashboard polish — *risk: নেই (UI only)*

- [ ] **X1** Open **স্টক**. Expect: the title “প্রোডাক্ট ও ইনভেন্টরি” and its
  count badge on the left, the **＋ নতুন প্রোডাক্ট** and **⚙️ ক্যাটাগরি
  ব্যবস্থাপনা** buttons on the right. At 1280px the search box and the
  **সব ক্যাটাগরি ⌵** select sit side by side in one bar right above the stock
  chips, with no sideways scrollbar — *risk: নেই*
- [ ] **X2** Look at the four summary cards. Expect a small icon in each top-right
  corner: a blue box on মোট প্রোডাক্ট, an emerald stack on মোট মজুদ স্টক, an
  amber warning on কম স্টক সতর্কতা (soft amber border) and a slate wallet on
  ইনভেন্টরি মোট মূল্য — *risk: নেই*
- [ ] **X3** Hover the eye on the last card. Expect the exact tooltip
  **দোকানের ক্রয়মূল্য ও ইনভেন্টরি মূল্য দেখুন (১০ সেকেন্ড)**; click it and the
  value shows for ten seconds, then masks back to `৳••••` — *risk: নেই*
- [ ] **X4** Click the amber **⚠️ কম স্টক সতর্কতা** card. Expect the
  **⚠️ কম স্টক** chip below to turn navy and the table to show only low-stock
  rows; the count badge still shows the whole inventory — *risk: নেই*
- [ ] **X5** Type text with no match in the toolbar search. Expect the box
  **কোনো প্রোডাক্ট খুঁজে পাওয়া যায়নি**; press **ফিল্টার রিসেট করুন** and all
  products come back. Then (on a clean shop with every product archived)
  reload: expect the onboarding headline **আপনার স্টকে এখনো কোনো প্রোডাক্ট
  যুক্ত করা হয়নি** with the subtitle about creating a category first, and the
  category manager still reachable — *risk: নেই*

---

## Y. NOTUN — কাস্টমারের ঠিকানা ও ওয়ারেন্টি — *risk: নেই to মাঝারি (adds fields/receipt text)*

- [ ] **Y1** Open `/service` at 1366×768 and start a new device entry. Expect:
  **কাস্টমারের ঠিকানা** directly under মোবাইল নম্বর with an empty placeholder,
  and **ওয়ারেন্টির মেয়াদ** directly under
  IMEI on the device card with chips **নেই / ৭ দিন / ১৫ দিন / ১ মাস / ৩ মাস /
  ৬ মাস** on a tidy line; the 340px form still has no sideways scroll. The
  saved values stay ASCII (`7 দিন`, `1 মাস`) — *risk: নেই*
- [ ] **Y2** Click the **৭ দিন** chip. Expect the warranty input to fill with
  **7 দিন** and the chip to turn navy; click **নেই** and expect an empty input —
  *risk: নেই*
- [ ] **Y3** Type an address and a custom warranty, then save a single job.
  Reopen it with **এডিট**. Expect both values restored in `svc-address` and
  `svc-warranty` — *risk: মাঝারি (adds a row)*
- [ ] **Y4** Clear both fields and save. Expect blank/NULL values, no validation
  error, and no empty **ঠিকানা** or **ওয়ারেন্টি** label on the receipt —
  *risk: মাঝারি (edits a row)*
- [ ] **Y5** Open the print/PDF receipt for the saved job. Expect **ঠিকানা: …**
  and **ওয়ারেন্টি: …** only when values exist; never any shop cost, code, parts
  supplier, damage or IMEI — *risk: নেই*
- [ ] **Y6** Type the saved address into the header search and into **এই
  তালিকায় খুঁজুন...**. Expect the job found in both; repeat with the warranty
  text — *risk: নেই*
- [ ] **Y7** Create a grouped visit with two devices, one shared address and
  different warranties. Expect every device row to store the same address and
  its own warranty; add product lines and expect the product anchor to carry
  the same address — *risk: মাঝারি (adds rows)*
- [ ] **Y8** Open the group receipt. Expect the address once in the header and
  **ওয়ারেন্টি: …** under each device that has one; no repeated address per
  device — *risk: নেই*
- [ ] **Y9** Try a 201-character address or a 101-character warranty through
  the API. Expect a Bengali `400` containing **বেশি** and no saved row —
  *risk: নেই*
- [ ] **Y10** Restore the oldest snapshot used in H12. Expect both new fields
  to come back empty/null and the old row to restore without a column error —
  *risk: মাঝারি (restores data)*
- [ ] **Y11** Check the service list at 1280/1366: the searchable-only text
  widens no column, there is no horizontal scroll, and the group/device badges
  stay screen-reader-only — *risk: নেই*
- [ ] **Y12** Check the CSV/Excel audit backup: both fields travel with the
  row, while no lock credentials or internal cost reaches a customer copy —
  *risk: নেই*

---

## Z. NOTUN — white-label Dashboard, branding & secret codes — *risk: মাঝারি (settings)*

- [ ] **Z1** Open `/`. Expect: the Dashboard opens (not `/service`), with four
  navbar tabs in this order — ড্যাশবোর্ড, সার্ভিস, প্রোডাক্ট, পার্টস — *risk: নেই*
- [ ] **Z2** Open an old bookmark like `/?date=2026-11-20&status=Pending`.
  Expect: it still forwards `date`, `edit`, `receipt`, `status` and `mode` to
  `/service` — *risk: নেই*
- [ ] **Z3** On the Dashboard, confirm all five panels are present: ওভারভিউ
  (আজকের কার্যকলাপ / আর্থিক অবস্থা / কম স্টক), কুইক অ্যাকশন, টেকনিশিয়ান
  ম্যানেজমেন্ট, দোকান সেটিংস and ডাটা নিরাপত্তা — *risk: নেই*
- [ ] **Z3b** Still on the Dashboard, confirm the harmonised copy: Overview cards
  read **আজকের জমা ও সার্ভিস / নতুন সার্ভিস N · আজ জমা**,
  **কাস্টমার বাকি / মোট কাস্টমার বকেয়া**, **সাপ্লায়ার দেনা / মোট সাপ্লায়ার
  বকেয়া** and **স্বল্প স্টক প্রোডাক্ট / স্টক শেষ হওয়ার পথে**, with the link
  **প্রোডাক্ট স্টক ↗**. Quick actions say **সার্ভিস এন্ট্রি ↗** and
  **স্টক থেকে প্রোডাক্ট বিক্রি করুন**, the header CTA is **সার্ভিস পেজে যান ↗**,
  the jump is **ওভারভিউতে ফিরুন ↑**, and the cipher panel reads
  **টাকা ↔ কোড কনভার্টার** with a **কাস্টম কোড** tab — *risk: নেই*
- [ ] **Z4** In দোকান সেটিংস, change the shop name, slogan, address, phone,
  WhatsApp, terms and logo path, then save. Expect: the header and footer change
  immediately on every page, and a customer receipt/PDF shows the new branding
  plus the **শর্ত** block — *risk: নেই*
- [ ] **Z5** Take a backup, change the branding again, then restore the older
  snapshot. Expect: ledger data returns to the snapshot but the shop branding
  and cipher stay as you last set them (settings are excluded from restore) —
  *risk: সবচেয়ে বেশি (careful)*
- [ ] **Z6** In the secret-code panel, keep the **কীপ্যাড** preset and test
  `1500`. Expect the code `*J#` (1=`*`, 5=first letter of JKL, `00`=`#`), and the
  tester decodes it straight back to ৳1,500 — the old ledger code is unchanged
  — *risk: নেই*
- [ ] **Z7** Switch to **কাস্টম ১০-অক্ষর**, enter `ABCDEFGHIJ` and test `1500`.
  Expect code `AEJJ` and a clean round-trip. Type only `ABC` and try to save:
  expect the save to be refused with a Bengali validation message, not a silent
  fallback to the keypad — *risk: নেই*
- [ ] **Z8** Save that custom cipher, then create a service with shop cost
  `AEJJ`. Expect the saved row's expense amount to be 1500 and the same decode
  in `/service`, `/parts` and the report. Put the cipher back to কীপ্যাড —
  *risk: মাঝারি (adds a row)*
- [ ] **Z9** On `/service`, confirm there is **no** technician button, report
  pill, dues pill, backup strip, `আজকের হিসাব` bar, **নতুন সার্ভিস এন্ট্রি**
  masthead button or **ড্যাশবোর্ড** masthead button. The form (still headed
  **নতুন সার্ভিস এন্ট্রি**), search and status chips must still be there —
  *risk: নেই*

---

## 🛑 Stop conditions

If you see **any** of these, stop immediately, take a backup and report it —
do not keep clicking:

1. Money does not add up (L1 or L2) — বাকি/লাভ wrong
2. Entry **#1 Sahil** changed (L3)
3. The technician roster disappeared after a restore (I8)
4. A new entry fails after restoring, or its বিল নং was reused (I9)
5. **খরচ / ড্যামেজ** appears on the customer receipt (H6)
6. An overpayment saved successfully (B8 added a row)
7. A returned job still appears in বিল, কাজ or বাকি তালিকা (E14)
8. A numeric shop expense lost its amount or stayed exposed after upgrade/restore (E20)
9. A written-off parts cost still reduces profit, or a damage loss disappears (M9)
10. A grouped customer copy omits a device or prints shop cost/code/parts/damage (M3)
11. A returned row's bill, জমা or status changes after an edit (M7)
12. A customer receipt/PDF prints the internal **সমাধান** text (Q5)
13. A payment drives বাকি below ৳০, a paid slip's জমা falls or changes without a matching bill rise, or a paid slip's বিল falls after an edit (R3/R5)
14. A purchase raises service খরচ/লাভ, or a supplier price reaches a receipt (R7)
15. A service-part bill increases product stock, is counted twice, or reaches a customer copy (S3/S4/S7)
16. The header search shows **সমাধান** for a name/model/text query instead of
    only for a mobile number (Q7)
17. A dialog will not close
18. Text is clipped on mobile (K1)
19. A retained inspection fee is missing from daily/monthly profit, or a group transfer hands out cash (V1/V4)
20. A parts-ledger card or row ignores the active date mode or selected shop, or the `তারিখহীন` amount leaks into `মোট` (W1–W5)

---

## Baseline before you start

> A fresh install starts with zero services, zero technicians, an empty shop
> profile and no backups. The values below describe the seeded local copy this
> by-hand checklist was written against — not what a new customer sees.

| What | Value |
|---|---|
| Service rows | 1 — `#1 Sahil · ডেলিভারি · বিল ৳১,৭০০ · জমা ৳১,৭০০ · বাকি ৳০` |
| Technicians | 4 — NURUL, RONI, ASRAFUL, NAYEM (all active) |
| `backups/` | 36 files |
| Payments / purchase bills | none — clean start |
| `ZTEST…` rows | none — clean start |

> If `ZTEST…` rows already exist when you begin, archive them first so L1/L2
> start from a known state.
