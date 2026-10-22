# Manual A-to-Z Test Checklist - MAHER MOBILE CARE v1.1.3

A human walkthrough of the whole shop app, for when you want to confirm by hand
that nothing is broken before a busy day.

- **Automated coverage:** `npm test` → 11 suites, 230 checks (see README §7).
  E13–E20 below cover the v1.1.2 return/refund and damage-loss ledger; B7/B7b,
  E1, E14b and L2 pin the v1.1.3 automatic expense codes and per-row eye.
- **This file:** the things a script cannot judge — paper printouts, real
  WhatsApp/dialer, Excel opening the CSV, touch on a phone, two tabs open at once.

**How to use:** tick each box. Where a step says *ঝুঁকি* (risk) it is marked —
`নেই` (safe), `মাঝারি` or `সবচেয়ে বেশি`.

**Rule for test data:** start customer names with **`ZTEST`** (e.g. `ZTEST01`) so
you can find and archive them later. Your real record (`#1 Sahil`) must come out
of this checklist **byte-identical** — see step L3.

---

## 🛑 Pre-test — do not skip

- [ ] **0.1** Press **ব্যাকআপ**. Expect: toast "ব্যাকআপ হয়েছে", a CSV downloads, header shows "সর্বশেষ ব্যাকআপ" — *risk: নেই*
- [ ] **0.2** Open the `backups/` folder. Expect: a new `maher-*.db` file — *risk: নেই*
- [ ] **0.3** Count the files in `backups/`. Expect: 36 → 37 — *risk: নেই*
- [ ] **0.4** Open `http://127.0.0.1:3000`. Expect: dashboard loads and "টেকনিশিয়ান অনুযায়ী" is visible — *risk: নেই*

---

## A. Dashboard & date navigation — *risk: নেই*

- [ ] **A1** Press `←` then `→` (no mouse). Expect: the day changes both ways — *risk: নেই*
- [ ] **A2** While typing in any text box, press `←`. Expect: **the day does NOT change** (typing guard works) — *risk: নেই*
- [ ] **A3** **◄ আগের দিন** then **পরের দিন ►**. Expect: returns to the same day — *risk: নেই*
- [ ] **A4** Use the date picker to jump 3–4 days back. Expect: the table title shows that date, and the daily cards switch to the **"নির্বাচিত দিনের"** prefix — *risk: নেই*
- [ ] **A5** Press **আজ**. Expect: back to today, prefix returns to **"আজকের"** — *risk: নেই*
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
- [ ] **B7b** Look at the **খরচ** column. Expect: it is always visible and shows codes only (`*A#`, `*J#`, …); each row has its **own eye**. Click one row's eye: only that row's amount appears (`৳1,200`), the other rows stay hidden. There is no global eye toggle. The customer receipt must not show the amount, code or parts shop — *risk: নেই*
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

- [ ] **E1** Look at the **খরচ** column. Expect: it is always visible and shows codes only (`*J#`, `*A#`, …), never the decoded amount. Each row's eye reveals only that row's amount; the eye does not affect any other row. A legacy plain-number value (only before upgrade/repair) is masked as `৳••••` — *risk: নেই*
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
- [ ] **E14** Type a short refund note and click **ফেরত দিন (৳500)**. Expect: toast, status **ফেরত**, বাকি **৳0**, row money shows **ফেরত: ৳500**; daily কাজ ও বিল no longer include it, a **+1টি ফেরত** hint appears under কাজ, and its technician card count excludes it — *risk: মাঝারি*
- [ ] **E15** Open **⚖️** again on the returned row. Expect: the refund tab says it is already returned (with amount/date/note) and the button is gone. Switch to **ড্যামেজ ক্ষতি**, enter `500`, note `ZTEST damage`, save. Expect: the row shows **⚠️ ড্যামেজ ক্ষতি**, the খরচ column shows **ক্ষতি: ৳500**, the daily খরচ card includes ৳500, and the customer receipt still never shows it — *risk: মাঝারি*
- [ ] **E15b** Press 🗑️ **ডিলিট** on that returned row. Expect: the confirmation adds a red warning: its **রিফান্ড, খরচ ও ড্যামেজ ক্ষতিও** will leave every report/profit until restored. Press **বাতিল**; the row must stay — *risk: নেই*
- [ ] **E16** Create a completed `ZTEST` row: bill `1500`, advance `1500`; add damage loss `500` through ⚖️. Expect: its customer bill still shows ৳1500 / ৳1500 / ৳0 with the **PAID** seal; the damage loss appears only in the internal খরচ/লাভ report — *risk: মাঝারি*
- [ ] **E17** Open 🧾 **বিল প্রিন্ট** on the returned row. Expect: the amber banner **“কাজটি সম্পন্ন হয়নি — মোবাইল ফেরত দেওয়া হয়েছে”**, a **ফেরত দেওয়া হয়েছে** line for ৳500, and **no PAID seal**. Search the paper for the damage note/amount: neither appears — *risk: নেই*
- [ ] **E18** Try to edit the returned row. Expect: its ✏️ pencil is gone; using the navbar search's edit action shows an info toast and does **not** load it into the form. The ⚖️ damage tab still saves a correction — *risk: নেই*
- [ ] **E19** Press **ব্যাকআপ**, open the CSV in Excel, and check the header. Expect: `damageLoss`, `damageNote`, `returnedAt`, `refundAmount`, `refundNote` are present and the returned row has its refund/damage values — *risk: মাঝারি*
- [ ] **E20** Restore the snapshot from E19. Expect: the returned status, refund amount and damage loss all come back; a pre-v1.1.2 snapshot (if available) still restores, with those fields `0`/blank. If the snapshot has a **plain-number** shop expense, the restored row must show a code and keep the same amount; restore must never expose or erase the number. *risk: সবচেয়ে বেশি*

---

## F. Reports & totals — *risk: নেই*

- [ ] **F1** Click **📊 ওভারঅল রিপোর্ট**. Expect: a dialog with the three presets **বিগত ৩০ দিন / এই মাস / গত মাস** and five cards কাজ / বিল / খরচ / **বাকি** / **লাভ (Profit)** plus the date-range label. The বিল card shows a **জমা** hint. খরচ and লাভ are always visible (there is no peek button) — *risk: নেই*
- [ ] **F2** Click each preset inside the dialog. Expect: the cards and the date-range label change — *risk: নেই*
- [ ] **F3** Set a custom range with the two date inputs. Expect: the label follows — *risk: নেই*
- [ ] **F4** Set শুরু later than শেষ. Expect: toast "শুরুর তারিখ শেষের তারিখের পরে" and the range is unchanged — *risk: নেই*
- [ ] **F5** Close the dialog with **X**, reopen it and press **Escape**. Expect: both close cleanly — *risk: নেই*
- [ ] **F6** With a preset active, close the dialog, change the navbar date, and reopen the report. Expect: the preset follows that date — *risk: নেই*
- [ ] **F7** Check লাভ by hand. Expect: `লাভ = বিল − খরচ − ড্যামেজ ক্ষতি`, visible immediately. Returned bills are excluded; the refund is a memo and is not subtracted again — *risk: নেই*
- [ ] **F8** On a day containing a part code (`*M#`). Expect: daily খরচ shows the decoded **৳1,600** directly and the hint shows **+ 1টি কোড** — *risk: নেই*

---

## G. বাকি তালিকা & all-dates search — *risk: নেই*

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
- [ ] **H5** Read the paper. Expect: বিল নং, তারিখ, অবস্থা, গ্রাহক / মোবাইল / মডেল / সমস্যা / **টেকনিশিয়ান**, মোট বিল / জমা / **বাকি**, the **customer's name in the signature area**, two signature lines, "ধন্যবাদ, আবার আসবেন", and the shop address + phone. The address must read `D107 (Level 3), Sena Shopping Complex, Nabinagar, Ashulia 1344` — **no "Chandra Rd."** — *risk: নেই*
- [ ] **H5b** Print/PDF a **fully paid** row (বাকি ৳০). Expect: the navy **PAID** stamp appears. Print an unpaid or partly paid row and a **returned** row: expect **no** PAID stamp — *risk: নেই*
- [ ] **H6** 🔴 Search the customer paper for "খরচ", "লাভ", "ড্যামেজ", a damage note, a part code (`*J#`), or the parts-shop name. Expect: **none of them appear at all** — *risk: নেই*
- [ ] **H7** Check that Bengali renders correctly in print (no boxes/tofu) — *risk: নেই*
- [ ] **H8** Press **PDF শেয়ার** on a row and save/inspect the PDF. Expect: the same updated address, customer name and correct PAID-stamp state as the paper receipt — *risk: মাঝারি*

---

## I. Backup & restore — *risk: সবচেয়ে বেশি (careful)*

> Run this only after 0.1–0.3 succeeded. You are about to replace live data.

- [ ] **I1** Press **ব্যাকআপ**. Expect: server snapshot + CSV download + toast — *risk: মাঝারি*
- [ ] **I2** Open the CSV in Excel. Expect: Bengali correct (BOM), all columns present (including `damageLoss`, `returnedAt`, `refundAmount`), and no cell starting with `=1+1` executes as a formula — *risk: নেই*
- [ ] **I3** Click **Restore**. Expect: the list shows each snapshot with a `safety` tag, size and record count — *risk: নেই*
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

---

## L. Final reconciliation — *risk: নেই*

- [ ] **L1** Add up every card's "কাজ করেছে". Expect: it **equals** আজকের মোট কাজ — *risk: নেই*
- [ ] **L2** For each active row check `বিল − জমা`. Expect: it **equals** বাকি (and বাকি is 0 when জমা ≥ বিল). A returned row shows **ফেরত** instead and its বাকি is 0 — *risk: নেই*
- [ ] **L3** Open entry **#1 Sahil**. Expect: **ডেলিভারি · বিল ৳১,৭০০ · জমা ৳১,৭০০ · বাকি ৳০ — unchanged** — *risk: নেই*
- [ ] **L4** Compare বাকি for the selected day against বাকি তালিকা. Expect: both count only genuinely unpaid money and **never** a returned job — *risk: নেই*
- [ ] **L5** Look for any red error on the page, and open the browser console (F12). Expect: no errors — *risk: নেই*
- [ ] **L6** Archive any `ZTEST…` rows you no longer want. Expect: your real records untouched — *risk: মাঝারি*

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
9. A dialog will not close
10. Text is clipped on mobile (K1)

---

## Baseline before you start

| What | Value |
|---|---|
| Service rows | 1 — `#1 Sahil · ডেলিভারি · বিল ৳১,৭০০ · জমা ৳১,৭০০ · বাকি ৳০` |
| Technicians | 4 — NURUL, RONI, ASRAFUL, NAYEM (all active) |
| `backups/` | 36 files |
| `ZTEST…` rows | none — clean start |

> If `ZTEST…` rows already exist when you begin, archive them first so L1/L2
> start from a known state.
