# WordGod — SEO Keyword Research & Content Planning

WordGod เปลี่ยนชุดคีย์เวิร์ดให้เป็น Keyword Master, Topic/Pillar Map, Content Plan และ Content Calendar ที่ตรวจสอบย้อนกลับได้ พร้อมส่งออก Excel 6 ชีต

## ความสามารถหลัก

- เลือกจำนวนคีย์เวิร์ดได้ 20–3,000 รายการ แยกจากจำนวนบทความในแผน
- เลือกได้ระหว่างเฉพาะ Volume/CPC จาก API จริง หรือ API-first พร้อมคำแนะนำที่เว้น Metric ว่าง
- เลือก Quick Keyword Research หรือ Full SEO Content Plan
- วางแผน 1–12 เดือน และกำหนดบทความต่อเดือนได้ 1–50 บทความ
- กำหนด Pillar, Seed, Money Page และ quota ต่อ Pillar เองได้ หรือให้ระบบสร้างอัตโนมัติ
- ใช้การตัดคำภาษาไทยในการจัดกลุ่มและประเมิน keyword depth
- ใช้ Search Volume/CPC จาก Google Keyword Planner และ Organic KD จาก DataForSEO เมื่อมี credentials
- บังคับ CPC เป็น THB ทั้งระบบ: Google Ads บัญชี THB ใช้ค่าเดิม ส่วน DataForSEO แปลงจาก USD พร้อมเก็บอัตรา/วันที่อ้างอิง
- จัด Funnel (TOFU/MOFU/BOFU), Priority (P1/P2/P3), Money Page และ Internal Links
- QA ตรวจ keyword/title ซ้ำ, metric ที่หาย และการเชื่อม Calendar กลับไป Keyword Master
- ส่งออก Excel 6 ชีต: Overview, Keyword Master, Content Plan, Pillar Map, Calendar และ Calendar Summary
- Supabase Google Auth จำกัดสิทธิ์แบบ server-side เฉพาะ `@convertcake.com`

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Supabase Auth + Google OAuth
- Vertex AI Gemini ผ่าน Vercel OIDC ตามระบบเดิม
- Google Ads API v21 และ DataForSEO
- ExcelJS สำหรับ XLSX export
- Node.js 22 ขึ้นไป

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env.local
npm run dev
```

เปิด `http://localhost:3030`

หากยังไม่กำหนด Supabase variables ระบบจะใช้ Basic Auth เดิมจาก `AUTH_USERNAME` / `AUTH_PASSWORD` โดยอัตโนมัติ ใน Production หากไม่มีทั้ง Supabase และ `AUTH_PASSWORD` ระบบจะตอบ 503 และไม่เปิดให้เข้าใช้งาน

## Supabase Auth + Google

> **คำเตือน:** WordGod ต้องใช้ Supabase Project แยกที่เจ้าของยืนยันแล้วเท่านั้น ห้ามใช้หรือแก้ไข `kanokphonthbb-web's Project` เพราะเป็นคนละระบบ

1. สร้างหรือเลือก Supabase project
2. เปิด Google provider ใน **Authentication → Sign In / Providers → Google**
3. นำ Google OAuth Client ID/Secret ใส่ในหน้า provider ของ Supabase
4. ใน Google Cloud OAuth client เพิ่ม Authorized redirect URI ตามที่ Supabase แสดง ซึ่งมีรูปแบบ `https://<project-ref>.supabase.co/auth/v1/callback`
5. ใน **Authentication → URL Configuration** ตั้ง Site URL ของ production และเพิ่ม Redirect URLs:
   - `http://localhost:3030/auth/callback`
   - `https://<your-production-domain>/auth/callback`
6. ใส่ค่าต่อไปนี้ใน `.env.local` และ Vercel Environment Variables:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

ไม่ต้องใช้ `SUPABASE_SERVICE_ROLE_KEY` หรือ secret key สำหรับระบบ Auth นี้ ปุ่ม Google ส่ง `hd=convertcake.com` เพื่อช่วยเลือกบัญชี แต่สิทธิ์จริงตรวจจาก JWT claims บนเซิร์ฟเวอร์ทุก protected page และ API โดยเทียบโดเมนแบบ exact match เท่านั้น

## API credentials เดิม

การเปลี่ยน Auth ไม่เปลี่ยนชื่อ environment variables หรือขั้นตอนอ่าน credentials ของระบบ SEO:

- Vertex AI/Gemini: ใช้ `GCP_*` + Vercel OIDC ตาม [DEPLOYMENT.md](./DEPLOYMENT.md)
- Google Keyword Planner: ใช้ `GOOGLE_ADS_*` ตามเดิม
- DataForSEO: ใช้ `DATAFORSEO_LOGIN` และ `DATAFORSEO_PASSWORD` ตามเดิม

ระบบสร้าง candidate มากกว่าเป้าหมายเพื่อเพิ่มโอกาสพบคำที่มีข้อมูลจริง แล้วใช้ Keyword Planner และ DataForSEO คัด Primary Keyword ก่อน ค่า AI estimate จะไม่ถูกใส่ในคอลัมน์ Volume/CPC และระบบจะไม่ยืม Volume จากคำสั้นไปใส่ให้ Long-tail

CPC ไม่มีตัวเลือกสกุลเงินและถูกล็อกเป็น THB ระบบอ่าน `customer.currency_code` ของ Google Ads; ถ้าบัญชีเป็น THB จะใช้ค่าเดิมโดยไม่แปลง หากเป็นสกุลอื่นจะแปลงเป็น THB ส่วน DataForSEO จะแปลงจาก USD เป็น THB ด้วยอัตราอ้างอิงแบบมีวันที่จาก Frankfurter (ไม่ต้องใช้ API key เพิ่ม) หากดึงอัตราไม่ได้ ระบบจะเว้น CPC ของ Provider นั้นและแจ้งเตือน โดยยังคงใช้ Search Volume ได้

## คำสั่งตรวจสอบ

```bash
npm run test:all
npm run lint
npm run build
```

## API routes

| Route | Method | หน้าที่ |
|---|---:|---|
| `/api/pipeline` | POST | Pipeline หลักแบบ SSE |
| `/api/crawl-site` | POST | อ่าน sitemap และหน้าสำคัญ |
| `/api/export-plan` | POST | Export Full Plan เป็น XLSX 6 ชีต |
| `/api/export` | POST | Export CSV |
| `/api/sitemap-export` | POST | Export sitemap |

ทุก API route ใช้ authorization boundary เดียวกันกับหน้าเว็บ

## Deploy

ใช้ Node.js 22+ และเพิ่ม environment variables ใน Vercel แยกตาม Production/Preview/Development จากนั้นรัน:

```bash
npm ci
npm run test:all
npm run build
```

รายละเอียด Vertex AI OIDC และ Supabase อยู่ใน [DEPLOYMENT.md](./DEPLOYMENT.md)
