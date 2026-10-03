# Windows-e MAHER MOBILE CARE Chalanor Bidhway

Ei guide shudhu tumi Windows-e ekbar test korar jonne.
Kono kichu install korte hobe na. Internet o lagbe na.

---

## Tumi Ja Pabe

Ekta zip file: `MAHER-Windows-Test.zip` (43 MB)

Eta ekta puro shop app. Ekhon theke client-keo eita-i pathaoge.

---

## Sotti Boli (porer shathe pori jani)

Package-ta banano hoyeche Linux-e, kintu Windows-e **ekhono chalanay ni** - karon
amar kache Windows machine ba CI nai. Ami ja korechi:

| Ki kora | Kemon verify |
|---|---|
| Node ar database binary | Windows binary kina - `PE32+ ... MS Windows` |
| App kaj kore | Bangla UI, CSS/JS, money rule, backup - shob test kora |
| Data upgrade-e thake | `app` folder delete kore rebuild - data bachi |
| Client er data leak hoy na | zip-e kono `.db` / `.env` nai |

Jeta verify **kora hoy ni**: Windows-e `.bat` file chalanor command gulo. Tai eta
amar shobcheye boro test. Tumi Windows chalanor prothombar-i jeno bujhte paren.

Kichu galat hole ghabaron kichu nai - `logs\maher.log` file-e sob likha thake,
niyegi amake dein.

---

## Step 1: Zip-ta Windows-e niye ashun

Ei zip-ta tumi amar laptop-er NTFS partition-e rakha achhe (`New Volume`).
Windows on same partition dekhte pare kintu Windows e oi folder ta
EXT4 na, tai direct kaj korbe na.

Simplest upay: zip-ta pen-drive-e copy kore Windows-e niye ashun.

Jodi zip-ta amar shared storage-e thaki, tai oi storage Windows-e
Windows Explorer diye khule `MAHER-Windows-Test.zip` ta pen-drive-e
copy kore nij laptop-e niye ashun.

---

## Step 2: Extract korun

Zip-ta Windows-e niye ashar por:

1. Zip file-e right-click korun
2. "Extract All..." (ba "Extract Here") click korun
3. Jeta thobe seta `C:\MAHER` folder-e dewa hobe

Kharchi: `C:\MAHER\MAHER MOBILE CARE.bat` ei file ta thakte hobe.

Check korar jonne Windows File Explorer-e `C:\MAHER` open kore dekho.
Vitey thaka uchit:

```
MAHER\
├── MAHER MOBILE CARE.bat
├── start-maher.bat
├── runtime\
├── app\
└── data\
```

Ekta jinis khub important: `runtime`, `app`, `data` — ei tinta folder
ektathe move korben na. Poora MAHER folder copy korte hobe.

---

## Step 3: Chalan

`C:\MAHER\MAHER MOBILE CARE.bat` file-ta double-click korun.

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

Windows theke app bondho korun. `data\` folder ektai jinis check korun:

```
C:\MAHER\data\
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

## Upgrade niyom (bhitre ar kichu)

Future-e update dile:

1. `C:\MAHER\data` folder-ta sojiye rakho (copy kore ekta jaygay rakhun)
2. `app` ar `runtime` folder delete korun
3. Notun version-er `app` ar `runtime` folder copy korun
4. `MAHER MOBILE CARE.bat` abar chalan

`data` folder chara KUCHU delete korben na. Oita-i shoptaner record.

Eita ami test korechi: `app` folder delete kore notun file diye chalale o
`data` folder-r record, technician ar backup sob bachi thake.

---