# VIDDEY Upload Service

Standalone Fastify microservice untuk menangani chunked upload video ukuran besar tanpa batasan Vercel.

## Arsitektur

```
Browser (Vercel/VIDDEY)                Upload Service (Railway)
─────────────────────                  ──────────────────────────
POST /sessions              →          Buat session + temp dir
PUT  /sessions/:id/chunks/0 →          Stream chunk → disk (zero copy)
PUT  /sessions/:id/chunks/1 →          Stream chunk → disk
...                                    ...
POST /sessions/:id/complete →          Trigger: assemble → Telegram
GET  /sessions/:id          →          Poll: progress/state/result
                            ←          { slug, url, deleteToken }
```

## Batasan Telegram

| Mode | Batas |
|---|---|
| Cloud API (default) | 50 MB |
| Local Bot API Server | 2 GB |

Untuk file > 50 MB, jalankan [Telegram Bot API Local Server](https://github.com/tdlib/telegram-bot-api) dan set:
```
TELEGRAM_API_BASE=http://localhost:8081
```

## Setup

```bash
cp .env.example .env
# Edit .env dengan semua credentials

npm install
npm run dev        # development
npm run build && npm start  # production
```

## Deploy ke Railway

1. Push repo ke GitHub
2. New Project → Deploy from repo
3. Set environment variables
4. Railway otomatis detect `railway.toml` dan build Docker image

## Deploy ke VPS (Ubuntu 22.04)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Build dan jalankan
docker build -t viddey-upload .
docker run -d \
  --name viddey-upload \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /data/viddey-uploads:/tmp/viddey-uploads \
  --env-file .env \
  viddey-upload
```

## API Endpoints

### POST /sessions
Membuat upload session baru.

**Headers:** `X-Upload-Key: <key>`, `Content-Type: application/json`

**Body:**
```json
{
  "fileName": "video.mp4",
  "mimeType": "video/mp4",
  "fileSize": 524288000
}
```

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "sessionId": "AbCdEfGhIjKlMnOpQrStUvWx",
    "totalChunks": 50,
    "chunkSize": 10485760
  }
}
```

### PUT /sessions/:id/chunks/:index
Upload satu chunk. Body adalah raw binary (application/octet-stream).

**Headers:** `X-Upload-Key: <key>`, `Content-Type: application/octet-stream`

Idempoten: upload ulang chunk yang sama tidak menghasilkan error.

### POST /sessions/:id/complete
Trigger finalisasi: validasi semua chunk → stream ke Telegram → simpan ke Supabase.
Response 202 (async). Poll `/sessions/:id` untuk hasil.

### GET /sessions/:id
Status polling endpoint.

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "...",
    "state": "uploading_telegram",
    "telegramProgress": { "loaded": 104857600, "total": 524288000 },
    "result": null,
    "error": null
  }
}
```

**State values:** `created` → `receiving` → `received` → `uploading_telegram` → `completed` | `failed`

### DELETE /sessions/:id
Cancel dan cleanup session.

### GET /health
Health check dan status aktif session.

## Environment Variables

| Variable | Required | Default | Keterangan |
|---|---|---|---|
| `UPLOAD_API_KEY` | ✓ | — | Shared secret dengan VIDDEY frontend |
| `TELEGRAM_BOT_TOKEN` | ✓ | — | Token dari @BotFather |
| `TELEGRAM_CHANNEL_ID` | ✓ | — | Channel ID (format: -100xxx) |
| `TELEGRAM_API_BASE` | — | `https://api.telegram.org` | Override untuk local Bot API |
| `SUPABASE_URL` | ✓ | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | — | Service role key |
| `NEXT_PUBLIC_SITE_URL` | ✓ | — | Frontend URL untuk generate video links |
| `UPLOAD_TEMP_DIR` | — | `/tmp/viddey-uploads` | Direktori temp untuk chunks |
| `CHUNK_SIZE_BYTES` | — | `10485760` | 10 MB per chunk |
| `MAX_FILE_SIZE_BYTES` | — | `2147483648` | 2 GB |
| `MAX_CONCURRENT_UPLOADS` | — | `20` | Batas sesi aktif serentak |
| `SESSION_TTL_MS` | — | `86400000` | 24 jam TTL sesi |
| `CORS_ORIGINS` | — | `http://localhost:3000` | Allowed origins (comma-separated) |
| `PORT` | — | `3001` | Port server |
