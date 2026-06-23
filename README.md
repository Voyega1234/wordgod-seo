# WordGod — AI Keyword Research Platform

ระบบวิจัย keyword อัจฉริยะ ใช้ Gemini AI + Google Keyword Planner

---

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS v4)
- **Gemini AI** (keyword expansion + title generation + clustering)
- **Google Ads API v21** (Keyword Planner — real search volume)
- **Port:** 3030 (local development)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

แก้ไขค่าใน `.env.local` ให้ครบ:

| Variable | ได้จากไหน |
|---|---|
| `AUTH_USERNAME` | กำหนดเองได้ |
| `AUTH_PASSWORD` | กำหนดเองได้ |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| `GEMINI_MODEL` | ชื่อ Gemini model เช่น `gemini-3-flash-preview` (ไม่ใส่จะใช้ค่า default) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads → Tools → API Center |
| `GOOGLE_ADS_CLIENT_ID` | Google Cloud Console → OAuth2 |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Cloud Console → OAuth2 |
| `GOOGLE_ADS_REFRESH_TOKEN` | รัน script ด้านล่าง |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads account ID (ตัวเลขเท่านั้น) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | MCC Manager account ID (ตัวเลขเท่านั้น) |

### 3. Generate Refresh Token (ครั้งแรกครั้งเดียว)

```bash
npx ts-node scripts/generate-refresh-token.ts
```

เปิด URL ที่แสดง → login Google Ads account → copy code → วางใน terminal
จะได้ `GOOGLE_ADS_REFRESH_TOKEN` ให้ใส่ใน `.env.local`

### 4. Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

เปิด http://localhost:3030

---

## Deploy to Vercel

โปรเจกต์ใช้ Vercel แบบ zero-config สำหรับ Next.js:

1. Push โปรเจกต์ขึ้น GitHub/GitLab/Bitbucket
2. Import repository ใน Vercel
3. เพิ่ม Environment Variables จาก `.env.example` ใน Project Settings
4. Deploy โดยใช้ค่าเริ่มต้น:
   - Framework Preset: Next.js
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Node.js: 20.9 ขึ้นไป

Environment Variables ขั้นต่ำ:

```text
AUTH_USERNAME
AUTH_PASSWORD
GEMINI_API_KEY
```

Optional Gemini model override:

```text
GEMINI_MODEL=gemini-3-flash-preview
```

ถ้าต้องการ volume จริงจาก Keyword Planner ให้เพิ่ม `GOOGLE_ADS_*` ทุกตัวตาม `.env.example`

ข้อจำกัดของ Vercel deployment นี้:

- Pipeline API ใช้ Node.js runtime และกำหนดเวลาทำงานสูงสุด 300 วินาที
- จำกัดการสร้างครั้งละไม่เกิน 3,000 keywords; งานขนาดใหญ่มีโอกาสชน Vercel timeout ตามปริมาณ API call จริง
- Keyword Planner cache บน Vercel อยู่ใน temporary filesystem และอาจหายเมื่อ function instance ถูกสร้างใหม่
- หากต้องการงานเกิน 3,000 keywords หรือเก็บประวัติ ควรเปลี่ยนเป็น background job + database/queue

ตรวจสอบก่อน deploy:

```bash
npm run test:all
npm run lint
npm run build
```

---

## Features

- **Keyword Research** — Gemini AI expand keyword จาก seed พร้อม Google Search grounding
- **Real Volume** — Google Keyword Planner ดึง search volume จริง
- **Intent Mix** — ปรับ ratio ของ Informational / Commercial / Transactional / Navigational / Update
- **6 Presets** — Balanced / New Website / Lead Gen / Affiliate / Knowledge / Manual
- **Topic Clusters** — จัดกลุ่ม keyword เป็น pillar + supporting พร้อม English slug
- **Sitemap** — Export CSV + XML พร้อม URL structure
- **AI Titles** — Gemini เขียน H1 title สำหรับแต่ละ keyword
- **Snake Game** — เล่นระหว่างรอ generate

---

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/pipeline` | POST | Main keyword research pipeline (SSE streaming) |
| `/api/export` | POST | Export keywords เป็น CSV |
| `/api/sitemap-export` | POST | Export sitemap เป็น CSV หรือ XML |

---

## Google Ads API Setup

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com)
2. สร้าง project ใหม่ หรือใช้ project เดิม
3. Enable **Google Ads API**
4. สร้าง **OAuth 2.0 Client ID** ประเภท Desktop App
5. ดาวน์โหลด credentials (client_id, client_secret)
6. ไปที่ Google Ads → Tools → API Center → ขอ Developer Token
7. รัน `scripts/generate-refresh-token.ts` เพื่อ generate refresh token

> **MCC Account:** ถ้าใช้ Manager Account (MCC) ให้ใส่ MCC ID ใน `GOOGLE_ADS_LOGIN_CUSTOMER_ID` และ client account ID ใน `GOOGLE_ADS_CUSTOMER_ID` — จำเป็นสำหรับการดึง historical keyword volume

---

## Notes

- ระบบใช้ชื่อ **WordGod** เท่านั้น
- Credentials ทั้งหมดอยู่ server-side เท่านั้น ไม่มี expose ฝั่ง frontend
- Basic Auth จะเปิดเมื่อกำหนด `AUTH_PASSWORD`; production ควรกำหนดทั้ง username และ password
