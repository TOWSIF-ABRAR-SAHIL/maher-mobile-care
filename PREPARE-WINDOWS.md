# Windows-e MAHER MOBILE CARE Chalanor Bidhway

Ei guide shudhu tumi Windows-e ekbar test korar jonne.
Kono kichu install korte hobe na. Internet o lagbe na.

---

## Tumi Ja Pabe

Ekta zip file: `MAHER-Windows-Client.zip` — GitHub release
`v1.0.1-windows`-e ache. Ei version e tomar prothom Windows test e pawa
duita bug fix kora hoyeche.

Eta ekta puro shop app. Ekhon theke client-keo eita-i pathaobe.
(Purono `MAHER-Windows-Test.zip` test-er jonno chilo — client-ke dibe na.)

---

## Sotti Boli (porer shathe pori jani)

Prothom package ta Linux-e banano hoyechilo. Ekhon package-ta **Windows-ei
build** hoyeche (`buildHost: win32-x64`) ar Windows-e chaliye puro automated
suite pass koreche — **8 suites, 147 checks**, live data er hash-o same ache.

Prothom asol shop-test e duita bug pawa gelo, duitai 1.0.1-e fix:

| Bug | Ekhon ki |
|---|---|
| Bill 1500, জমা 500, cash 1000 dile "আরও দরকার 500" dekhato | Ekhon **"ফেরত দিন 500"** — হিসাব হয় **জমা**র সাথে, bill er sathe na |
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
Windows-e chaliye **147/147 pass** kora hoyeche (`npm test`).

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
   `version` hobe `1.0.1`, `sourceCommit` latest commit-er sathe milbe,
   `target` hobe `windows-x64`.

3. **Client package-ta notun (test zip na):** test-er jonno
   `MAHER-Windows-Test.zip`, client-er jonno **shudhu**
   `MAHER-Windows-Client.zip` pathabe.

4. Client-er PC-te prothom run-e 4 default technician ashbe
   (ASRAFUL, NAYEM, NURUL, RONI) — test-er kono record thakbe na.

---