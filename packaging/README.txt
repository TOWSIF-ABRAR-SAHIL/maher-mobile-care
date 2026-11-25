MSS - Chalano Niyom
===================

Eta apnar dokaner hisab rakhar app. Install kora lage na,
internet lage na. Shudhu ei folder-ta PC-te rekhe chalan.

CHALANO
-------
1. "MAHER MOBILE CARE.bat" file-e double-click korun.
2. 1-2 second-e dokaner window khulbe (browser-er moto dekhte,
   kintu address bar chara).
3. Prothombar kono demo data thakbe na. Shop profile setup-er banner dekhabe;
   technician, service, product ar dues sob khali thakbe.

DESKTOP EXE (notun)
-------------------
1. "MSS-Setup-1.2.0.exe" chalye install korun. Wizard-e prothome app-er
   install path, tar por data folder chon hoy. Data default: D:\MSS-Data.
   C: drive kono bhabe-i chalbe na — onno drive chon korun.
2. Age theke MSS thakle "Update / Cancel" dialog ashbe. Cancel korle kichu
   hoy na; Update korle purono bill/technician/product sob thake.
3. Purono one-click version-er %AppData%\MSS\data\shop.db ba
   %AppData%\MAHER-MOBILE-CARE\data\shop.db thakle notun version oita
   D:\MSS-Data-e niye jay. Kothao install folder-e database thake na.
4. Install-er por shortcut-e double-click korlei window khulbe. Address bar
   dekha jabe na; kintu kaj portable version-er motoi. Shortcut name "MSS".
5. "MSS.exe" window ekbar-i khulbe — second shortcut chaple
   age-r window-i samne chole asbe.
5. Customer bill-e "প্রিন্ট" chaple chup-chap print hoy — kono print dialog
   thame na. Default printer set kore rakhte hobe.

NOTUN (v1.2.0-er por)
---------------------
- **ব্যাকআপ** button ekhon ekta gochano Excel (.xlsx) file dey — age chilo
  ekta lamba CSV. File khulle tin-ti sheet: **সারসংক্ষেপ** (mot bill/joma/
  baki/khoroch/labh), **সার্ভিস খাতা** ar **সম্পূর্ণ ডেটা (অডিট)**. খাতা
  sheet-ta ekta soro table — **ক্রম / তারিখ / কাস্টমার / ফোন / মডেল / সমস্যা /
  টেকনিশিয়ান / অবস্থা / বিল / জমা / বাকি / ডেলিভারি** — purono tarikh age,
  serial 1 theke suru, niche **মোট (সক্রিয়)** row. Header atke thake (scroll
  korleo dekha jay), date/taka thik format-e. Ferot deya service-o list-e
  thake, kintu mot-e jog hoy na; dokaner khoroch/parts/IMEI shudhu audit
  sheet-e. Asol backup tobuo `data\backups` folder-er `maher-*.db` file —
  Excel file-ta shudhu pore dekhar jonno; oita diye restore hoy na.
- Puro app-e notun rokom design: royal blue header/button, sada card
  fakeska blue page-e. Bangla label sob age-r motoi — kichu badolini
  hoyni.
- App khullei **ড্যাশবোর্ড** (Home) ashbe. Upor-e char ta link:
  "ড্যাশবোর্ড", "সার্ভিস", "প্রোডাক্ট", "পার্টস". Purono bookmark-e
  date/edit/receipt/status/mode thakle oita abar service desk-ei chole jay.
- Dashboard-e panch ta bhag: ওভারভিউ (today/finance/low stock), কুইক অ্যাকশন
  (নতুন সার্ভিস এন্ট্রি, প্রোডাক্ট বিক্রি, ব্যাকআপ, ওভারঅল রিপোর্ট ar বাকি
  তালিকা), টেকনিশিয়ান ম্যানেজমেন্ট, দোকানের সেটিংস ar ডাটা নিরাপত্তা
  (শেষ ব্যাকআপ + রিস্টোর). Report ar বাকি talaika r jonno age service-e
  khujte hobe na — Dashboard-ei ache.
- Service page ekhon shudhu front desk: form, talika, local search ar status
  chip. Tech/report/বাকি/ব্যাকআপ button ar "আজকের হিসাব" bar khan theke
  soriye nia gese; ahole por Dashboard-e jate hobe.
- দোকানের সেটিংস-e shop name, slogan, ঠিকানা, mobile, WhatsApp, terms ar logo
  badle nile header/footer/receipt-ei naye name chole jay — kothao code badlate
  hobe na. Backup restore korleo ei settings thik thake.
- Gopon khorch-er code-e ekhon kepad map (purono `*J#` = 1500 one-i thake) ba
  nijer 10-axorer word use korte parben. Dashboard-e "কোড টেস্টার" ache.
  Vul word likhle save hoy na — kichu chupchup bodol jay na.
- Service talika ekhon kono screen-e side-e scroll kore na — puro table
  fit dekhay. ID column-e "👥 গ্রুপ" / "২টি ডিভাইস" badge ar chokhe dekha
  jay na (screen-reader jonno thake), kintu combined bill-e sob device
  age-r motoi ashe.
- Notun entry-e device card gulo "ডিভাইস ১", "ডিভাইস ২" ... number pay,
  ar button "আরেকটি ডিভাইস যোগ করুন". Customer/phone/technician/মোট বিল/
  জমা/কাজের অবস্থা/দোকান খরচ ekbar-i likhen; protyek device-r moddhe
  shudhu model, problem, bill (ichche-moto), nijer delivery date ar IMEI.
  Device bill likhle total auto-jog hoy; joma device-e bhag kore diben —
  tai kono row-e joma, bill er beshi hobe na. Dokaner khoroch shudhu
  "ডিভাইস ১"-e likhen, baaki device-e na (nahole ek-i khoroch bar bar
  hisabe dhore nibe).
- Device card-e ekhon "IMEI Number" field (32 okkhor porjonto, optional).
  ETA list ba customer bill-e kokhono dekhay na, shudhu backup-er Excel
  **সম্পূর্ণ ডেটা (অডিট)** sheet ar CSV-e thake.
  Age chilo "Device Lock" (PIN/Pattern/Password) — oita purotai fela
  diyeche: kono lock field ekhon na, API-te lock pathaleo ignore hoy.
- Laptop-er choto window-eo (1280x585) form ar **মোট বিল / জমা / বাকি** save
  button-er upore-i dekha jay; action button-gulo ek line-e thake. Service
  talika ekhono kono screen-e side-e scroll kore na.
- Screen-e taka, count ar date English digit-e: **৳1,200**, **8টি ভিজিট**,
  **শুক্রবার, 6 নভেম্বর 2026** (mash-er nam Bangla-i). Input-e Bangla digit
  likhleo (jemon ১২০০) thik moto save hoy; receipt, report ar monthly print
  age-r motoi Bangla digit-e thake.
- Notun entry-e shudhu **মোট বিল (৳)**, **জমা (৳)** ar **বাকি (স্বয়ংক্রিয়)**
  dekha jay; per-device bill **আরও তথ্য**-r bhitor. Dues button-e scope lekha
  **সব তারিখের বাকি (Nটি ডিভাইস • ৳X)**; delivery date-e chip **আজ · কাল ·
  3 দিন · 7 দিন** ar × diye muchun.
- **স্টক** page-e protyek product-er **ক্রয়** dam default-e lukiye thake
  (`৳••••`) — **ক্রয় দেখান** eye button-e sob khule, **ক্রয় লুকান**-e abar
  lukiye jay. Sob product-er mot dam (**ইনভেন্টরি মূল্য**) shob shomoy dekha
  jay.
- স্টক list-er upore ekta note bole product sell ekhono stock theke kome na;
  note-ta × diye bondho korle reload-er por-o ar dekhay na (abar dekhte
  `localStorage` theke `maher:stock-note-dismissed` muchun).

NOTUN (v1.2.0)
--------------
- Ek kastomerer ekadhik device: ek visit-e 8 ta porjonto device ek sathe
  save. (Form-er bhag-ta poroborti update-e notun rokom hoyeche — dekhben
  uporer "NOTUN (v1.2.0-er por)".) Je kono row theke bill/PDF khulle sob
  device ek combined receipt-e ashe.
- Delivery date: form-e "ডেলিভারির সম্ভাব্য তারিখ" (optional). List/receipt-e
  expected date dekhay; status "ডেলিভারি" hole actual date automatic, abar
  "চলছে" ba ferot korle actual date muchhe jay.
- Ferot row pencil diye edit kora jay: customer/model/problem/technician/
  date/expense/parts/delivery/damage thik korun. Bill, joma, baki ar status
  lock thake — save korle o bad jabe na.
- Refund-e parts cost choice: "খরচ হয়নি — বাদ দিন" ba "খরচ হয়েছে — ক্ষতি
  হিসেবে রাখুন". Bade dile code/amount row-e thake ("বাতিল" badge) kintu
  report/labh theke bad; damage loss shob shomoy report-e thake.
- Header-e "খরচ দেখান" button: ekshathe sob row-er taka dekhay/lukay.
  Protyek row-er nijer eye age-r motoi 10 second oi row-er taka dekhay.

AGER NOTUN (v1.1.4)
-------------------
- Phone/tablet-e puro app chhoto hoy: header 3 row (1280px+ theke 2 row),
  ar Sync/Backup/Restore/Technician/Print/Aaj — shob button dekha jay.
- 1024px-er niche service talika ar "বাকি তালিকা" card hoy; 1024px+ theke
  table. Table scroll korleo action button-gulo dan dike atke thake.
- 1280px-er niche form ar list niche-upor; 1280px+ theke pasapashi.
- Receipt, report, baki list ar technician dialog phone-e fit hoy.

AGER NOTUN (v1.1.3)
-------------------
- Shop khoroch-e shudhu number likhleo seta save-er shomoy gopon code
  hoye jay (jemon 1500 -> *J#). Code likhle jemon likhben temoni thake.
- Purono numeric khoroch app chalanor shomoy ba purono backup restore
  korar shomoy automatic code hoye jay — taka same thake.
- Service talika-r "খরচ" column shob shomoy dekha jay ar shudhu code
  dekhay. Protyek row-er nijer eye click korle shudhu oi row-er taka
  dekhay; onno row lukiye thake. (v1.2.0-e header-e sob row dekhano/lukano
  button eseche.)
- "বিল" card-er niche "জমা" hint, ar report-eo joma dekhay.
- Ferot kora kaj archive korar age warning dey: oi row-er refund,
  khoroch ar damage loss report/labh theke bad jabe.
- Inactive technician-er purono row edit korleo technician auto bad
  hoy na; oi nam-i thake.

AGER NOTUN (v1.1.2)
-------------------
- Service talika-r protyek row-e "⚖️ ফেরত / ড্যামেজ ক্ষতি" button.
- Kaj na hoye thakle "ফেরত / রিফান্ড" tab theke puro joma ferot din.
  Status "ফেরত" hobe, বাকি 0 hobe, ar oi kaj bill/count/technician
  hisab theke bad jabe. Puro joma ferot — partial refund nei.
- "ড্যামেজ ক্ষতি" tab-e technician-er kharap kore kichu bhangle sei
  internal khoroch likhun. Eta customer-er bill/receipt-e kokhono jabe
  na; shudhu dokaner khata/লাভ calculation-e bad jabe.
- Completed kaj-e customer puro bill dey; damage loss alada dokaner loss.
  Kaj unfinished hole ferot/refund hobe, kintu damage loss dokaner
  loss-i thake.
- Ferot deya row-er bill/joma/status lock thake; customer/model/problem/
  date/expense/damage erge safe edit kora jay (v1.2.0).

AGER NOTUN (v1.0.7)
-------------------
- Navbar-er dan dike search box. Ctrl+K chaple focus; 2+ okkhor
  likhle live result; result-e click korle bill/receipt khule.
  Mobile-e 🔍 icon chaple upor theke search sheet khule.
- "📊 ওভারঅল রিপোর্ট" button chaple report dialog khule (ekhon
  Dashboard-e thake; purono service link-e chole gese na).
- "💰 বাকি তালিকা (১টি • ৳৭০০)" button-e live count; chaple
  baki list dialog khule (ekhon Dashboard-e).
- Form-er upore "🛠️ সার্ভিসিং" / "🛍️ প্রোডাক্ট সেল" toggle. Product
  sell-e "প্রোডাক্টের নাম" ar "বিবরণ" likhun; status auto
  "ডেলিভারি". SALES/দোকান technician ⚙️ theke add korun.
- 1920x1080 screen-e puro form ar save button scroll chara dekha jay.

KOTHAY RAKHBEN
--------------
- PC-r jekono LOCAL disk e rakhun: C:\MAHER ba D:\MAHER.
- D: te rakhle Windows abar install korleo (jodi shudhu C: format
  hoy) apnar record bache. Network drive, pen-drive ba OneDrive
  folder-e rakhben na.
- Eta backup NA! Disk nosto hole C: ba D: konoTai thake na — tai
  majhe majhe "data\backups" folder-er notun .db file ekta
  pen-drive-e kopi rakhen.
- Desktop EXE-er hisab installer-e chon kora folder-e thake (default
  `D:\MSS-Data\data`). "Run" (Win+R) khule `D:\MSS-Data\data` likhle
  folder-ta khulbe. Installer abar challeo ei data bad jay na.

BONDHO KORA
-----------
App window bondho korlei hobe. Puro server bondho korte chaile
"MAHER STOP.bat" chalan.

SOTORKOTA (data haraben na)
---------------------------
- "data" folder KKHONO delete korben na. Oita-i apnar
  dokaner shob record (shop.db) ar backup.
- Update ashle shudhu "app" ar "runtime" folder bodlabe,
  "data" folder-e haat diben na. Desktop EXE-te update/history shudhu
  chon kora data root-e (default `D:\MSS-Data\data`) hoy; install folder-er
  kono old data installer-e oita overwrite kore na.
- "data\backups" folder-er notun .db file majhe majhe ekta
  pen-drive-e kopi rakhen — eta-i asol backup.

GOPON KHORCH (privacy)
----------------------
- Entry form-e code (`*J#`) ba number (`1500`) likhle raw/decode kora
  taka (`৳১৫০০`) form-e dekha jabe — form-e kichu lukiye nei.
- Service talika-r **খরচ** column shob shomoy dekha jay; sekhane shudhu
  code (`*J#`, `*A#`) dekhay, decoded taka na. Header-er **খরচ দেখান**
  button-e sob row-er taka ekshathe dekhay/lukay. Protyek row-er nijer
  **eye** click korle shudhu oi row-er taka 10 second dekhay; onno row
  lukiye thake.
- Purono plain-number cost (upgrade/restore-er age) `৳••••` dekha jay
  jodi kono karon e normalize na hoy; app chalanor shomoy seta
  automatic code hoye jay.
- Daily khoroch card ar monthly khoroch/labh age-r motoi khola thake.
- Customer bill ba PDF-e cost, code, parts-shop ba profit kokhono
  thake na. Ferot/refund er kotha thake, damage loss/note thake na.
  Ek visit-er ekadhik device hole sob device ek combined bill/PDF-e ashe,
  kintu cost/parts/damage tokhono thake na.

SOMOSSA HOLE
------------
1. "MAHER STOP.bat" chaliye abar "MAHER MOBILE CARE.bat" chalan.
2. Tao na hole "logs" folder-er "maher.log" file-ta support-ke pathan.

Vershon: 1.2.0 (Windows 64-bit, offline)
- Package version 1.2.0-i ache; v1.2.0-er porer notun kaj gulo uporer
  "NOTUN (v1.2.0-er por)" section-e lekha.
