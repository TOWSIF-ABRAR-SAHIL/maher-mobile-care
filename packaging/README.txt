MAHER MOBILE CARE - Chalano Niyom
==================================

Eta apnar dokaner hisab rakhar app. Install kora lage na,
internet lage na. Shudhu ei folder-ta PC-te rekhe chalan.

CHALANO
-------
1. "MAHER MOBILE CARE.bat" file-e double-click korun.
2. 1-2 second-e dokaner window khulbe (browser-er moto dekhte,
   kintu address bar chara).
3. Prothombar 4 jon technician dekhabe:
   ASRAFUL, NAYEM, NURUL, RONI.

NOTUN (v1.2.0-er por)
---------------------
- Puro app-e notun rokom design: royal blue header/button, sada card
  fakeska blue page-e. Bangla label sob age-r motoi — kichu badolini
  hoyni.
- App khullei service desk-e ashbe; upor-e duitai link: "সার্ভিস" ar
  "স্টক". "স্টক"-e notun product/inventory page: product list, search,
  stock ar kom-stock-er hisab.
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
  ETA list ba customer bill-e kokhono dekhay na, shudhu CSV backup-e thake.
  Age chilo "Device Lock" (PIN/Pattern/Password) — oita purotai fela
  diyeche: kono lock field ekhon na, API-te lock pathaleo ignore hoy.

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
- "📊 ওভারঅল রিপোর্ট" button chaple report dialog khule.
- "💰 বাকি তালিকা (১টি • ৳৭০০)" button-e live count; chaple
  baki list dialog khule.
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

BONDHO KORA
-----------
App window bondho korlei hobe. Puro server bondho korte chaile
"MAHER STOP.bat" chalan.

SOTORKOTA (data haraben na)
---------------------------
- "data" folder KKHONO delete korben na. Oita-i apnar
  dokaner shob record (shop.db) ar backup.
- Update ashle shudhu "app" ar "runtime" folder bodlabe,
  "data" folder-e haat diben na.
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
