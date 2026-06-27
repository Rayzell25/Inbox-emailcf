# Cloudflare Single Email Viewer

Aplikasi web berdesain **3D premium** dengan satu tujuan: menampilkan **1 pesan
masuk (inbox) paling baru** dari alamat email domain kustom Cloudflare Anda.
Cepat, fokus, dan aman — kredensial Cloudflare hanya hidup di server (VPS),
tidak pernah dikirim ke browser.

- **Zero dependency runtime** — server hanya pakai modul bawaan Node.js (≥18).
- **Latar belakang 3D interaktif** (Three.js dari CDN) dengan fallback halus
  bila WebGL/CDN tidak tersedia.
- **Glassmorphism UI**, transisi mulus tanpa reload halaman.
- **Konfigurasi via `nano .env`** di VPS untuk branding + secret Cloudflare.
- **Mode demo otomatis** bila kredensial belum diisi (UI tetap bisa dicoba).

---

## 1. Arsitektur singkat

Cloudflare Email Routing **tidak** menyediakan API untuk membaca isi email yang
masuk. Jadi alurnya begini:

```
Email masuk ──> Cloudflare Email Routing ──> Email Worker (worker/)
                                                  │  parse + simpan
                                                  ▼
                                          Cloudflare KV
                                          ├─ latest:<alamat>          (pointer)
                                          └─ inbox:<alamat>:<epoch>   (riwayat)
                                                  ▲
                                                  │ baca via KV REST API
                            VPS Node server (server.js) ──> Browser (UI 3D)
```

1. **Email Worker** menangkap email, mem-parsing pengirim/subjek/isi/waktu, lalu
   menyimpannya ke **KV**.
2. **Server Node** di VPS membaca entri KV terbaru memakai API Token + Account ID
   dan menampilkannya.

---

## 2. Coba cepat (mode demo, tanpa Cloudflare)

```bash
npm start
# buka http://localhost:3000
```

Tanpa kredensial Cloudflare, aplikasi otomatis masuk **mode demo** dan
menampilkan email contoh sehingga seluruh animasi & transisi bisa dicoba.

Menjalankan test:

```bash
npm run check   # cek sintaks semua file JS
npm run smoke   # jalankan server + uji endpoint (offline, mode demo)
npm test        # keduanya
```

---

## 3. Konfigurasi (`.env`)

Salin contoh lalu edit:

```bash
cp .env.example .env
nano .env
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_SITE_NAME` | – | Judul besar di tengah halaman. |
| `NEXT_PUBLIC_THEME_COLOR` | – | Warna aksen UI (hex), mis. `#8b5cf6`. |
| `CLOUDFLARE_API_TOKEN` | ya* | Token dengan izin **Workers KV Storage: Read**. |
| `CLOUDFLARE_ACCOUNT_ID` | ya* | Account ID Cloudflare. |
| `CLOUDFLARE_KV_NAMESPACE_ID` | ya* | ID KV namespace tempat email disimpan. |
| `PORT` | – | Port HTTP (default `3000`). |
| `ALLOWED_DOMAINS` | – | Batasi domain yang boleh dicek, pisah koma. |
| `DEMO_MODE` | – | `true`/`false`. Kosong = auto (demo bila creds kosong). |

\* Bila salah satu dari ketiga kredensial Cloudflare kosong/masih placeholder,
aplikasi tetap jalan di **mode demo**.

---

## 4. Setup Cloudflare (KV + Email Worker)

### 4a. Buat API Token (untuk server)
Cloudflare Dashboard → **My Profile → API Tokens → Create Token → Custom token**:
- Permissions: **Account → Workers KV Storage → Read**
- Account Resources: pilih akun Anda
- Salin token → isi `CLOUDFLARE_API_TOKEN`.

> Bila membaca gagal **401/403** padahal token ada, biasanya izinnya kurang
> (harus minimal *Read* pada Workers KV Storage), atau `CLOUDFLARE_ACCOUNT_ID` /
> `CLOUDFLARE_KV_NAMESPACE_ID` salah.

### 4b. Buat KV namespace & deploy Email Worker

```bash
cd worker
npm install
npx wrangler kv namespace create INBOX_KV
#   -> salin "id" yang dicetak ke worker/wrangler.toml ([[kv_namespaces]].id)
#      dan ke .env VPS sebagai CLOUDFLARE_KV_NAMESPACE_ID
npx wrangler deploy
```

### 4c. Arahkan Email Routing ke Worker
Dashboard → domain Anda → **Email → Email Routing → Routing rules**:
- Buat rule (atau **Catch-all**) dengan action **Send to a Worker** →
  pilih `inbox-email-worker`.
- (Opsional) set `FORWARD_TO` di `worker/wrangler.toml` ke alamat tujuan
  terverifikasi agar email tetap diteruskan ke mailbox Anda.

Setelah ini, setiap email masuk akan tersimpan di KV dan muncul di aplikasi.

---

## 5. Deploy di VPS

### Opsi A — Otomatis dengan `install.sh` (paling mudah)

Untuk VPS Ubuntu/Debian yang masih kosong. Satu perintah, semuanya
diurus otomatis: update sistem, pasang dependensi dasar, pasang
**Docker + Docker Compose**, lalu build & jalankan container di background.

```bash
git clone <repo-url> inbox-emailcf && cd inbox-emailcf
bash install.sh
```

Yang dilakukan `install.sh`:
1. `apt update` & `apt upgrade`
2. pasang `curl`, `git`, `nano`, `ca-certificates`
3. pasang Docker Engine + Docker Compose plugin
4. buat `.env` dari `.env.example` (bila belum ada)
5. `docker compose up -d --build` (jalan di background)

Setelah selesai, app langsung jalan dalam **mode demo**. Lalu isi kredensial:

```bash
nano .env                                # isi token & branding
docker compose up -d --force-recreate    # muat ulang nilai .env
```

> Script aman dijalankan ulang (idempoten) dan otomatis pakai `sudo`
> bila Anda bukan root.

### Opsi B — Docker manual

```bash
git clone <repo-url> inbox-emailcf && cd inbox-emailcf
cp .env.example .env && nano .env        # isi kredensial
docker compose up -d --build
```

> **Penting:** setelah mengubah `.env`, reload dengan
> `docker compose up -d --force-recreate` — `restart` biasa **tidak**
> memuat ulang nilai `.env` yang berubah.

### Opsi C — Node langsung / PM2

```bash
nano .env
npm start
# atau dengan PM2:
pm2 start server.js --name inbox-emailcf && pm2 save
```

Letakkan di belakang Nginx/Caddy untuk HTTPS (reverse proxy ke `PORT`).

---

## 6. Endpoint API

| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | Frontend (UI 3D). |
| GET | `/api/config` | Branding publik: `siteName`, `themeColor`, `demo`. |
| GET | `/api/inbox?email=<alamat>` | 1 email terbaru untuk alamat itu. |
| GET | `/healthz` | Liveness probe. |

Token Cloudflare **tidak pernah** diekspos ke `/api/config` atau ke browser.

---

## 7. Keamanan

- Kredensial hanya dipakai server-side (KV REST API dipanggil dari Node).
- Isi email HTML dirender di dalam **iframe `sandbox`** (tanpa script,
  tanpa same-origin) → konten email tidak bisa menjalankan JavaScript.
- Validasi format email + opsi `ALLOWED_DOMAINS` untuk membatasi akses.
- `.env` ada di `.gitignore` — jangan commit token asli.

---

## 8. Struktur proyek

```
.
├── server.js              # HTTP server + API (zero-dep)
├── lib/
│   ├── env.js             # parser .env + config
│   ├── cloudflare.js      # klien KV REST (read-only)
│   └── demo.js            # data email contoh (mode demo)
├── public/
│   ├── index.html         # shell UI
│   ├── styles.css         # glassmorphism + transisi
│   ├── app.js             # logika form, fetch, transisi, render
│   └── background.js      # latar 3D Three.js (+fallback)
├── worker/
│   ├── email-worker.js    # Email Worker -> KV
│   ├── wrangler.toml
│   └── package.json
├── test/
│   ├── check.js           # cek sintaks
│   └── smoke.js           # uji alur penuh (offline)
├── install.sh             # installer otomatis VPS (Docker + run)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
