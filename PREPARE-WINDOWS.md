# Windows-e MAHER MOBILE CARE Chalanor Bidhway

Ei guide shudhu tumi Windows-e ekbar test korar jonne.
Kono kichu install korte hobe na. Internet o lagbe na.

---

## Tumi Ja Pabe

Ekta zip file: `MAHER-Windows-Client.zip` — local build
`out\MAHER-Windows-Client.zip` (v1.1.4). Eta GitHub release `v1.1.4-windows`-e
publish korte hobe. Entry form-e code (`*J#`) likhle raw code ar decoded taka
(`৳১৫০০`) duitai dekha jay; shudhu number (`1500`) likhleo save-er shomoy seta
**canonical code** (`*J#`) hoye jay. Privacy shudhu **service talika-r খরচ
column**-e: column-ta **shob shomoy dekha jay** ar shudhu code dekhay; protyek
row-er nijer eye click korle **oi row-er** decoded taka dekhay, onno row lukiye
thake. Daily khoroch card ar monthly khoroch/labh age-r motoi khola. Customer
receipt ba PDF-e cost, code, parts-shop ba profit kokhono jay na. Cash/change
calculator, receipt address, PAID stamp, WhatsApp + **PDF শেয়ার** sob age-r
motoi ache.

Notun v1.1.4:
- phone/tablet-e puro app responsive: header chhoto (phone-e 3 row, 1280px+
  theke 2 row), sob action button dekha jay;
- 1024px-er niche service talika ar **বাকি তালিকা** card hoy; 1024px+ theke
  table, ar table scroll korleo action column dan dike atke thake;
- 1280px-er niche form ar list niche-upor; 1280px+ theke pasapashi;
- receipt/report/dues/technician dialog phone-e fit hoy, date control gulo
  wrap/stack hoy.

Ager notun (v1.1.3):
- number likhle auto code; code likhle jemon likhben temoni thake;
- purono numeric cost upgrade/restore-e automatic code hoye jay — taka
  kokhono hariye jay na ba plain number hisebe expose hoy na;
- table-er protyek row-e alada eye, global eye nei;
- **বিল** card-er niche **জমা** hint, ar report-e-o joma;
- returned kaj archive korar age warning: refund/expense/damage report theke
  bad jabe;
- inactive technician-er purono row edit korle oi technician-i thake, auto
  reassign hoy na.

Ager notun (v1.1.2): service talika-r protyek row-e **⚖️ ফেরত / ড্যামেজ ক্ষতি**
button. Ekti kaj na hoye thakle **ফেরত / রিফান্ড** tab theke puro joma ferot
dite parben — status **ফেরত** hobe, বাকি 0 hobe, ar oi kajের bill/count/technician
performance theke bad jabe. **ড্যামেজ ক্ষতি** tab-e technician-er kharap kore
bhanga parts-er internal loss likhben; eta customer-er bill ba receipt-e
kokhono jabe na, shudhu dokaner khata/লাভ calculation-e bad jabe. Completed
kaj-e customer puro bill dey, damage loss alada dokaner loss. Returned row
form diye edit kora jabe na, kintu damage loss add/correct kora jabe.

Ager notun (v1.0.7): navbar-er dan dike search box (placeholder
`🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)`, live result, mobile-e 🔍 icon),
**📊 ওভারঅল রিপোর্ট** ar **💰 বাকি তালিকা** dialog-e khole (button-e live count
`১টি • ৳৭০০`), ar form-e **🛠️ সার্ভিসিং / 🛍️ প্রোডাক্ট সেল** toggle. Product
sell-e status auto **ডেলিভারি** hoy ar name/details existing `model`/`problem`
field-e save hoy. 1920×1080 screen-e puro form + **সেভ করুন** button ek scroll
chara dekha jay.

> **Repo ta PRIVATE.** Tai GitHub-er link client-ke dile o kaj korbe
> na (login chara download hobe na)। Client-ke file ta **nije** pathate
> hobe — pen-drive, WhatsApp ba email attachment।

Eta ekta puro shop app. Ekhon theke client-keo eita-i pathaobe.
(Purono `MAHER-Windows-Test.zip` test-er jonno chilo — client-ke dibe na.)

---

## Sotti Boli (porer shathe pori jani)

Prothom package ta Linux-e banano hoyechilo. Ekhon package-ta **Windows-ei
build** hoyeche (`buildHost: win32-x64`) ar Windows-e chaliye puro automated
suite pass koreche — **11 suites, 298 checks**, live data er hash-o same ache.

Prothom asol shop-test e duita bug pawa gelo. Default status bug ta 1.0.1-e
fix hoyeche; cash/change calculator ta client-er request e 1.0.2-e **bad**:

| Bug / change | Ekhon ki |
|---|---|
| Bill 1500, জমা 500, cash 1000 calculator | **Bad** — form e cash/change field nei; shudhu বিল/জমা/বাকি |
| Notun entry default "Pending" hoye jeto | Ekhon default **চলমান (In-Progress)** |

Ei duita chara Windows-er jonne aro kichu fix ache (backup path, path-er space
`%20`, build script, test runner) — sob README §10 e lekha ache.

Windows-e onno jinis gulo agei thik chilo:

| Ki kora | Kemon verify |
|---|---|
| Node ar database binary | Windows binary kina - `PE32+ ... MS Windows` |
| App kaj kore | Bangla UI, CSS/JS, money rule, backup - shob test kora |
| Data upgrade-e thake | `app` folder delete kore rebuild - data bachi |
| Client er data leak hoy na | zip-e kono `.db` / `.env` nai |
| Package repo-r baire chole | temp folder e copy kore server chaliye API check |

### Windows-e ki pawa gelo (prothombar)

App window khulchilo, kintu **kono data-i load hoyni**. Karon: purano run er
server, jeta `detached` hoye background e chole gechilo ar **morteo pare ni**,
port 3000 e atke thakto. Notun `MAHER MOBILE CARE.bat` chalanor shomoy
launcher dekhlo "MAHER already running" bolo, **notun server chalan-i kore ni**,
ar purono server er (already delete kora) folder er database khulise.

Ei karone protita bar double-click e **puro e purono** server-i cholo.

Ekhon thik kora hoyeche, Windows-e chalanor age er moto:

| Ki chilo | Ekhon ki |
|---|---|
| `/api/health` shudhu `shop.db` naam dito | Ekhon **absolute path** (`dbPath`) ar `tables` report kore |
| "MAHER cholche" mane "thik MAHER cholche" | Apnar copy r DB path + table check kore, na milele **purono server bondho** kore notun ta chalu kore |
| Tables check shudhu notun start e chilo | Reuse korar shomoy-o chole |
| Server bondho korar niyam nai | Notun **`MAHER STOP.bat`** |

Ekta jinis mone rakhben: jodi apni *kono karan e* onno program port 3000 niye
rakhe, MAHER seta chay **na** - bondho kore apnar dey. Eta amader niom karon
port o jani amader.

### Windows-e verify hoye geche

Windows-e `.bat` chalanor por prothombar data load hoyni (baked-path bug),
kintu fix-er por **data thik load hocche** — 4 technician, stats, services
sob. Tumi nije Windows-e chaliye dekhecho. Erpor puro automated suite-o
Windows-e chaliye **298/298 pass** kora hoyeche (`npm test`).

Jodi Windows-e kichu na kaj kore: `logs\maher.log` file-ta amake pathao. Ekhon
server chalan shathe shathe seta likhe, tai problem houar shomoy-i log paowa
jay (agge ekta bhul chilo: log server band howar por shudhu likhto).

Kichu galat hole ghabaron kichu nai - `logs\maher.log` file-e sob likha thake,
niyegi amake dein.

---

## Step 1: Zip-ta oi PC-te niye ashun

`out\MAHER-Windows-Client.zip` ta pen-drive, network ba OneDrive — jekono
upay diye je PC-te boshaben (client PC ba tomar test PC) sekhane niye ashun.
Zip-er bhitore puro app: runtime, app ar khaali `data\` folder.

---

## Step 2: Extract korun

Zip-ta Windows-e niye ashar por:

1. Zip file-e right-click korun
2. "Extract All..." (ba "Extract Here") click korun
3. Jeta thobe seta jekono **local fixed disk** e rakhun —
   `C:\MAHER` ba `D:\MAHER`, duitai thik. (Client D: cheyeche:
   Windows abar install e shudhu C: format hole D: bache.)

Kharchi: `D:\MAHER\MAHER MOBILE CARE.bat` (ba jekhane rakhben) ei
file ta thakte hobe.

Check korar jonne Windows File Explorer-e oi folder ta open kore dekho.
Vitey thaka uchit:

```
MAHER\
├── MAHER MOBILE CARE.bat
├── MAHER STOP.bat
├── start-maher.bat
├── README.txt
├── runtime\
├── app\
└── data\
```

`README.txt` khulle Bangla chalano niyom pabe — client-ke oita-i
prothome porte bolo.

Ekta jinis khub important: `runtime`, `app`, `data` — ei tinta folder
ektathe move korben na. Poora MAHER folder copy korte hobe.

---

## Step 3: Chalan

`D:\MAHER\MAHER MOBILE CARE.bat` (ba jekhane rakhben) file-ta
double-click korun.

Ki hobe:

1. Ekta black window khabe. Oita bondho korben na
2. 2-3 second lagbe
3. `ready. Opening the shop ...` likha ashbe
4. Ekta window khule jabe - oi window-ta browser, kintu address bar
   thakbe na, software er moto lagbe

Bajkhon ekta backup database banay (prothom bar), tarpor app chalu hoy.
Notun PC te apnake kichu type korte hobe na - database, technician list
shob nij theke banabe.

Eta MAHER-i na kono onno program age-i port 3000 niye rakhe, tahole app
bolbe "Another program is already using port 3000" - oi onno program band
kore abar chalan.

---

## Problem hole ki korben

Black window-e ki red likha thake, ba window-i na khule, screenshot niye
amake dein. Bhabishay khub beshi ki dekhay:

| Problem | Ki korben |
|---|---|
| "runtime\node.exe was not found" | Poora MAHER folder copy hoi nai. Abar kore. |
| "The app did not start within 60 seconds" | Amake screenshot dein |
| Window khulei bondho hoye gelo | Amake screenshot dein |
| Antivirus warning ashlo | Amake janain, ami fix korbo |

Ekta jinis: Windows SmartScreen ba antivirus "unknown publisher"
warning dikhate pare. Eta Windows er kono Windows-signed na howa karon
amar app signed na. Eta apni apni bypass korte paren, kintu apni jani
niye amake janain — client ke jeno bhul kore onno software na install
kore.

---

## Verify korar jonne (recommended)

App chalu hoye ektu service add korun:

1. Naam: `Test`
2. Number: `01700000000`
3. Technician: `NURUL`
4. Total bill: `100`
5. Advance: `50`
6. Save korun

Tabel e ekta row asha uchit, ar `Baaki` (due) dekhachhe `50`.

Eitai bujha je app Windows-e thik kaj korche — database, money rules,
technician dropdown — sob.

---

## Shesh korar por

Windows theke app bondho korun. `data\` folder ektai jinis check korun
(jekhane rakhben sekhane — jemon `D:\MAHER\data\`):

```
D:\MAHER\data\
├── shop.db
└── backups\
```

Jodi eita thake, tahole sob kaj kora — ek shoptaner record, backup
nij folder e, app folder er baire. Eitai kaar holo shoptaner data
app folder er sathe kono nao.

Erokom kichu na koren:

- `data` folder delete korben na
- `data` folder-ke app folder theke alada kichu pathayen na
- Poora folder copy korar jay, kintu `app` ar `runtime` folder-r
  moddhe kichu delete korben na

---

## Windows abar install korle ki hobe

- Jodi MAHER `D:\MAHER` te thake ar Windows install korar shomoy
  **shudhu C: drive format** koren, tahole `D:\MAHER` er record,
  technician ar backup **shob bache**। Notun Windows-e shudhu
  `D:\MAHER\MAHER MOBILE CARE.bat` double-click korlei hobe.
- Desktop shortcut thakle seta hariye jabe — abar banate hobe.
- Kintu "delete all partitions" / "clean install" / "Reset this PC →
  Remove everything" korle D: o jete pare। Ar disk nosto hole to
  C: ba D: konoTai bache na.
- Tai **asol backup**: majhe majhe `data\backups` er notun `.db`
  file ekta pen-drive-e kopi rakha। Ei ekta obhyash-i shob
  poristhitite bachabe.

---

## Upgrade niyom (bhitre ar kichu)

Future-e update dile:

1. `<MAHER>\data` folder-ta sojiye rakho (copy kore ekta jaygay rakhun) —
   jemon `D:\MAHER\data`
2. `app` ar `runtime` folder delete korun
3. Notun version-er `app` ar `runtime` folder copy korun
4. `MAHER MOBILE CARE.bat` abar chalan

`data` folder chara KUCHU delete korben na. Oita-i shoptaner record.

Eita ami test korechi: `app` folder delete kore notun file diye chalale o
`data` folder-r record, technician ar backup sob bachi thake.

v1.1.2-te database-e return/refund/damage-er 5 ta notun column add hoy.
Prothom bar notun version chalanor shomoy migration **automatic** hoy; apni
shudhu `data` folder-ta niye chinta korben na. Purono snapshot restore korleo
notun column-gulo `0`/blank hoye safe thake.

v1.1.4-e kono notun database column nei — shudhu UI/layout change. Tai
v1.1.3 theke upgrade korle `data` folder same thake.

v1.1.3-e-o kono notun database column chilo na. Kintu purono **numeric shop cost**
thakle first run-e (ar purono snapshot restore korle) seta automatic code hoye
jay; `expenseAmount` same thake. Tai upgrade-er age backup nin, tarpor app
chalan — table-e number er bodole code dekhben.

---

## Client-ke dewar age checklist (tumi korbe)

Client zip-ta test zip theke alada: `out/MAHER-Windows-Client.zip`.

1. **Zip-ta test-data mukto ki na dekho (PowerShell):**
   ```powershell
   tar -tf out\MAHER-Windows-Client.zip | Select-String -Pattern '\.db$|\.env$'
   ```
   Kichu ashbe na (khaali). `data\` folder-e shudhu `KEEP-THIS-FOLDER.txt`
   thakbe — kono `shop.db` ba `backups\` thakbe na.

2. **Build thik commit theke ki na dekho (PowerShell):**
   ```powershell
   tar -xOf out\MAHER-Windows-Client.zip MAHER/build-info.json
   ```
   `version` hobe `1.1.4`, `sourceCommit` HEAD-er sathe milbe (release-er
   age sob change commit kore nio), `target` hobe `windows-x64`.

3. **Client package-ta notun (test zip na):** test-er jonno
   `MAHER-Windows-Test.zip`, client-er jonno **shudhu**
   `MAHER-Windows-Client.zip` pathabe.

4. Client-er PC-te prothom run-e 4 default technician ashbe
   (ASRAFUL, NAYEM, NURUL, RONI) — test-er kono record thakbe na.

5. Notun entry-e shop cost `*J#` likhe dekho: form-e `গোপন কোড: *J# ➔ ৳১৫০০`
   dekha jabe. Service talika-r **খরচ** column **shob shomoy** dekha jabe,
   sekhane shudhu `*J#` thakbe — taka na. Oi row-er **eye** click korle shudhu
   oi row-er `৳1,500` dekhbe; onno row na. Abar ekta row-e `1200` (number)
   likhe save koro: seta `*A#` hoye jabe ar eye-e `৳1,200` dekhbe. Customer
   bill/preview-e cost ba parts-shop name thakbe na.

6. Ekta test entry bill `1500`, joma `500`, status **চলছে** diye save koro.
   Oi row-er **⚖️** → **ফেরত / রিফান্ড** → confirm koro. Status **ফেরত**,
   বাকি **৳0**, daily কাজ/বিল theke bad, ar receipt-e PAID stamp nei — ei
   gulo dekho. Tarpor **⚖️** → **ড্যামেজ ক্ষতি**-te `500` likhe save koro;
   customer receipt/PDF-e “ড্যামেজ” ba 500-er kono mention thakbe na.

---