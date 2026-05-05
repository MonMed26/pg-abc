# BCA Merchant QRIS — Mini Payment Gateway (Unofficial)

> **Disclaimer**: Project ini **tidak resmi**, tidak berafiliasi dengan PT Bank Central Asia Tbk. Bekerja dengan otomasi browser (Playwright) terhadap portal merchant `https://qr.klikbca.com/` menggunakan kredensial yang **kamu sendiri miliki**, plus QRIS statis milikmu sendiri. Gunakan dengan risiko sendiri & patuhi Syarat & Ketentuan BCA. Bisa berhenti bekerja kapan saja kalau BCA mengubah portal-nya.

Mini payment gateway lengkap berbasis QRIS BCA:

- 🔐 Login ke portal & scrape mutasi (DOM scraping, response API portal terenkripsi)
- 🧾 **Buat dynamic QRIS** dari static QRIS milikmu, dengan amount + kode unik
- 🎯 **Matching otomatis** transaksi masuk ke pending payment via total amount unik
- 🔔 **Webhook** ke URL kamu saat status berubah (HMAC SHA256 signature)
- 🌐 REST API + halaman demo HTML untuk testing
- ⏰ Auto-expire pending, anti-double-pay (RRN tracking)

---

## Cara Kerja

```
┌─────────┐    POST /api/payments     ┌─────────────────┐
│ Client  │──────────────────────────▶│ Payment Gateway │
└─────────┘  { amount: 10000 }        │  (this app)     │
     ▲                                └────────┬────────┘
     │                                         │
     │  webhook on paid                        │ 1. Generate uniqueCode (e.g. 364)
     │  (HMAC signed)                          │ 2. totalAmount = 10000 + 364 = 10364
     │                                         │ 3. Build dynamic QRIS dengan tag 54=10364
     │                                         │ 4. Insert ke SQLite, return QR + meta
     │                                         ▼
     │                                ┌─────────────────┐
     │                                │ Customer scan QR│ 
     │                                │ & bayar via DANA│
     │                                │ /OVO/dst Rp10364│
     │                                └────────┬────────┘
     │                                         │
     │                                         ▼
     │                          ┌────────────────────────────┐
     │  poller (every 5-15s)    │ qr.klikbca.com /home       │
     │◀─────── match ──────────│ scrape mutasi hari ini      │
     │  webhook fired          │ → ketemu Rp10364 dari DANA  │
     │                          │ → match payment by total    │
     │                          │ → status = paid             │
     │                          └────────────────────────────┘
```

**Kunci:** Setiap payment dapat **kode unik random** (mis. `+364`) yang ditambahkan ke base amount. Kombinasi `(baseAmount + uniqueCode)` jadi pengenal pasti karena tidak akan ada 2 payment pending dengan total yang sama.

## Limitasi

- **Polling, bukan push.** Mutasi dibaca dari portal web (DOM scraping). Latency match = `POLL_INTERVAL_MS` (default 15 detik).
- **Hanya 7 hari mutasi.** Portal `qr.klikbca.com` cuma menampilkan 7 hari terakhir di `/home`. Untuk gateway ini OK (cukup hari ini).
- **Range kode unik = jumlah max pending serentak** untuk amount yang sama. Default `1..999` aman untuk volume kecil-menengah. Perluas via env kalau perlu.
- **`customerName` selalu masked** oleh portal (e.g. `MI******`).

## Setup

Butuh **Node.js 18+**, Windows/Linux/macOS.

```powershell
npm install
node node_modules/playwright/cli.js install chromium
copy .env.example .env
```

> Catatan Windows PowerShell: kalau script `npx`/`npm` error `running scripts is disabled`, panggil binary Node langsung seperti perintah di atas.

Edit `.env` minimal:

```env
BCA_QR_USERNAME=email_merchant_kamu@example.com
BCA_QR_PASSWORD=password_kamu
BCA_QRIS_STATIC=00020101021126650013ID.CO.BCA.WWW0118936000140004507515...6304XXXX
WEBHOOK_URL=https://your-app.example.com/webhook
WEBHOOK_SECRET=random_secret_minimal_32_char
API_TOKEN=                               # kosongkan untuk dev lokal
```

`BCA_QRIS_STATIC` = isi raw string QRIS statis kamu (decode QR code yang dicetak di kasir kamu — bisa pakai aplikasi scanner QR apapun).

## Menjalankan

```powershell
node src/server.js
```

- Demo page: <http://localhost:3000/>
- **API Docs (Swagger UI)**: <http://localhost:3000/docs>
- Raw OpenAPI spec: <http://localhost:3000/docs.json>

## REST API

Semua `/api/*` butuh `Authorization: Bearer <API_TOKEN>` kalau `API_TOKEN` ter-set.

### `POST /api/payments` — buat payment baru

```http
POST /api/payments
Content-Type: application/json

{
  "amount": 10000,
  "webhookUrl": "https://your-app.example.com/webhook",
  "expiresInSeconds": 900,
  "metadata": { "orderId": "ORD-001" }
}
```

Response `201`:

```json
{
  "id": "pay_mos2w898d760b616",
  "status": "pending",
  "baseAmount": 10000,
  "uniqueCode": 364,
  "totalAmount": 10364,
  "qrisString": "0002010102122665...6304EA0E",
  "qrImageDataUrl": "data:image/png;base64,iVBORw0...",
  "webhookUrl": "https://your-app.example.com/webhook",
  "metadata": { "orderId": "ORD-001" },
  "createdAt": "2026-05-05T03:38:22.029Z",
  "expiresAt": "2026-05-05T03:53:22.029Z"
}
```

### `GET /api/payments/:id` — cek status

Tambah `?includeQr=1` untuk include `qrImageDataUrl`.

### `GET /api/payments/:id/qr.png` — render QR sebagai PNG

Pakai langsung di `<img src="/api/payments/<id>/qr.png">`. Param `?size=360`.

### `GET /api/payments?status=pending&limit=50&offset=0` — list

### `POST /api/payments/:id/cancel` — batalkan pending payment

### `GET /api/qris/mutasi?startDate=...&endDate=...` — raw mutasi (legacy endpoint)

## Webhook

Saat status berubah ke `paid` (atau `expired` / `canceled`), gateway akan POST ke `webhookUrl`:

```http
POST <your webhookUrl>
Content-Type: application/json
X-Signature: sha256=<hex>
X-Payment-Id: pay_mos2w898d760b616
X-Payment-Event: payment.paid
User-Agent: bca-merchant-qris-gateway/1.0

{
  "event": "payment.paid",
  "id": "pay_mos2w898d760b616",
  "status": "paid",
  "baseAmount": 10000,
  "uniqueCode": 364,
  "totalAmount": 10364,
  "createdAt": "2026-05-05T03:38:22.029Z",
  "expiresAt": "2026-05-05T03:53:22.029Z",
  "paidAt": "2026-05-05T03:39:14.812Z",
  "rrn": "1o3io6b33538",
  "issuer": "DANA",
  "customer": "MI******",
  "metadata": { "orderId": "ORD-001" }
}
```

Verifikasi signature di sisi penerima (Node.js example):

```js
const crypto = require('crypto');

function verify(req) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(req.headers['x-signature'] || '')
  );
}
```

Retry: max `WEBHOOK_MAX_ATTEMPTS` (default 5). Status delivery di-track per-payment (`webhookStatus`, `webhookAttempts`, `webhookLastError`).

## Konfigurasi `.env` lengkap

| Var | Default | Deskripsi |
|---|---|---|
| `BCA_QR_PORTAL_URL` | `https://qr.klikbca.com/` | Portal URL |
| `BCA_QR_USERNAME` | _wajib_ | Email login merchant |
| `BCA_QR_PASSWORD` | _wajib_ | Password merchant |
| `BCA_QRIS_STATIC` | _wajib_ | Raw QRIS string statis kamu |
| `UNIQUE_CODE_MIN` | `1` | Lower bound kode unik |
| `UNIQUE_CODE_MAX` | `999` | Upper bound kode unik (= max pending serentak per amount) |
| `PAYMENT_EXPIRES_SECONDS` | `900` | Default TTL pending (15 mnt) |
| `POLL_INTERVAL_MS` | `15000` | Interval poller cek mutasi |
| `POLL_MIN_INTERVAL_MS` | `8000` | Throttle minimum antar poll |
| `WEBHOOK_URL` | _kosong_ | Default webhook (per-payment bisa override) |
| `WEBHOOK_SECRET` | _kosong_ | Secret HMAC SHA256 |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Retry limit |
| `DB_PATH` | `./data/payments.db` | Path SQLite |
| `API_TOKEN` | _kosong_ | Bearer token proteksi `/api/*` |
| `HEADLESS` | `true` | Browser headless |
| `TIMEZONE` | `Asia/Jakarta` | TZ untuk "today" calculation |

## Struktur Project

```
src/
  config.js                 load .env
  server.js                 entry Express + boot poller
  db.js                     SQLite schema + CRUD
  payment.js                business logic (create, match, expire)
  webhook.js                HMAC signing + POST + retry
  poller.js                 background scrape + match
  browser.js                Playwright launcher + session
  middleware/auth.js        bearer token middleware
  qris/
    tlv.js                  EMVCo TLV parse/build + CRC16-CCITT
    dynamic.js              static QRIS → dynamic QRIS dengan amount
  routes/
    qris.js                 GET /api/qris/mutasi
    payments.js             POST /api/payments, GET, cancel, qr.png
  scraper/
    login.js                login flow ke /login -> /home?mid=...
    mutasi.js               klik tombol hari + scrape tabel
  scripts/
    scrape-once.js          CLI runner mutasi
public/
  index.html                demo page
  app.js                    demo page logic
  style.css                 styling
data/                       session.json + payments.db (gitignored)
tools/                      dev helpers (test-qris, test-payment, dst.)
```

## Tests

```powershell
# Unit test QRIS TLV + CRC + dynamic builder
node tools/test-qris.js

# Integration test create/match/expire/cancel/webhook signing
node tools/test-payment.js
```

## Catatan Keamanan

- **Jangan commit** `.env` atau `data/payments.db` — sudah di-gitignore.
- Set `API_TOKEN` panjang & random saat deploy.
- Set `WEBHOOK_SECRET` minimal 32 char random.
- Pertimbangkan VPN / IP whitelist kalau BCA membatasi origin.
- Rate-limit panggilan kamu sendiri: poller default 15 detik sudah aman, jangan terlalu agresif.
- Backup `data/payments.db` berkala (audit trail semua transaksi).

## Roadmap

- [ ] Multi-outlet support (loop antar `mid`)
- [ ] Persistent webhook queue dengan exponential backoff yg lebih cerdas
- [ ] Admin endpoint untuk manual re-match transaksi yg miss
- [ ] Optional: reverse-engineer dekripsi response API supaya tidak perlu DOM scraping
- [ ] Export laporan harian (CSV/Excel)
