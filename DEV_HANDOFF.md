# WordGod — Dev Handoff & Pre-deploy Checklist

เอกสารนี้เป็นจุดเริ่มต้นสำหรับ Dev หลังได้รับไฟล์ ZIP ให้ทำตามลำดับด้านล่างได้เลย

> [!CAUTION]
> **ห้ามใช้หรือแก้ไข Supabase Project ชื่อ `kanokphonthbb-web's Project` เด็ดขาด** โปรเจกต์ดังกล่าวเป็นคนละระบบกับ WordGod ห้ามนำ URL/Key มาใช้ ห้ามแก้ Auth, Database, Redirect URL, Provider หรือ Setting ใด ๆ ของโปรเจกต์นั้น WordGod ต้องสร้าง/ใช้ Supabase Project แยกที่เจ้าของยืนยันว่าเป็นของ WordGod เท่านั้น

## สถานะส่งมอบ

- โค้ดระบบ Keyword Research, Content Plan, Excel Export และ Supabase Auth ปรับเสร็จแล้ว
- เลือกจำนวน Keyword ได้ `20–3,000` รายการ
- เลือกระยะเวลา Plan ได้ `1–12` เดือน และจำนวนบทความต่อเดือนได้ `1–50`
- เลือก Metric Mode ได้ 2 แบบ:
  - **API เท่านั้น (`api_only`)** — ใช้เฉพาะ Keyword ที่มี Metric ตรงจาก Google Keyword Planner หรือ DataForSEO; หากข้อมูลจริงไม่ครบ ระบบคืนจำนวนน้อยกว่าเป้าหมายพร้อมคำเตือน
  - **API + คำแนะนำ (`api_first`)** — เติม Keyword ให้ใกล้จำนวนเป้าหมาย แต่คำที่ไม่มี Metric ตรงจะเว้น Volume/CPC ว่าง
- Login ใช้ Supabase Email Magic Link และอนุญาตเฉพาะอีเมลที่ลงท้ายตรงกับ `@convertcake.com`
- หน้าและ API ที่ป้องกันไว้ตรวจ JWT claims ฝั่ง Server ไม่ได้เชื่อ `hd` จากหน้า Login เป็นตัวตัดสินสิทธิ์
- Production จะปิดการเข้าใช้ (HTTP 503) หากยังตั้ง Supabase variables ไม่ครบ
- Reference output ที่ผู้ใช้ต้องการอยู่ใน ZIP ชื่อ `LINE_BK_Keyword_Research_Content_Plan.xlsx`
- CPC ถูกบังคับเป็น THB ทั้งระบบ ไม่มีตัวเลือกเปลี่ยนสกุลเงิน

## สิ่งที่แก้แล้ว

1. สร้าง Candidate Pool ประมาณ 3 เท่าของจำนวนที่ขอ (สูงสุด 3,000) เพื่อเพิ่มโอกาสเจอคำสั้นที่มีข้อมูลจริง
2. Prompt กำหนดให้ Candidate อย่างน้อย 75% เป็นคำสั้น/กลางที่มีโอกาสพบ Volume
3. เอาเพดานเดิมที่จำกัดคำจาก API จริงไว้ 60% ออก
4. เอาการยืม Volume/CPC จากคำอื่นและการใส่ค่า 30% ให้ Close Variant ออก
5. ไม่ให้ Long-tail ยืม Metric ของคำสั้น
6. แยก `estimated_volume` ออกจาก Provider Volume; ค่า AI ไม่ถูกแสดงเป็นข้อมูลจริง
7. คำแนะนำที่ไม่มี Metric ตรงไม่ถูกนำไปวางเป็น Primary Keyword ของบทความ
8. เพิ่มตัวเลขสรุป API-backed / Suggestions / Shortfall และคำเตือนใน UI
9. Excel ยังคง 6 ชีต และเพิ่ม `AI Estimate (Reference)` แยกจาก Volume/CPC
10. เปลี่ยน UI เป็นพื้นขาว อ่านง่าย และทำหน้า Login โทนน้ำเงินสำหรับ WordGod
11. เพิ่ม Supabase Email Magic Link พร้อมตรวจโดเมนฝั่ง Server ทุก Protected Page/API
12. ล็อก CPC เป็น THB: Google Ads บัญชี THB ใช้ค่าเดิม; DataForSEO แปลง USD เป็น THB ด้วยอัตราอ้างอิงที่มีวันที่กำกับ

## ห้ามเปลี่ยนระหว่างรับช่วงงาน

- ห้ามเปลี่ยนชื่อหรือลำดับการอ่าน credentials เดิมของ `GOOGLE_ADS_*`, `DATAFORSEO_*` และ `GCP_*`
- ห้ามเพิ่ม `GEMINI_API_KEY`; Gemini/Vertex AI ต้องใช้ Vercel OIDC ตาม flow เดิมใน `DEPLOYMENT.md`
- ห้ามนำ Google Ads secret, DataForSEO password, Supabase secret/service-role key หรือ credential ฝั่ง Server ไปใส่ Client Component หรือชื่อตัวแปรที่ขึ้นต้น `NEXT_PUBLIC_`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` เป็น Publishable Key สำหรับ Client และใช้ได้ตามปกติ; ระบบนี้ไม่ต้องใช้ Supabase secret/service-role key
- ห้ามนำกฎเดิมต่อไปนี้กลับมา: จำกัด API Keyword 60%, Close Variant Volume 30%, Proxy Volume/CPC หรือใส่ AI estimate ลงคอลัมน์ Provider Volume/CPC
- ห้าม Commit `.env.local`, `.vercel`, token, password หรือไฟล์ credential ใด ๆ

## Action ที่ Dev ต้องทำก่อน Deploy

### 1. เตรียมโปรเจกต์

- ใช้ Node.js 22 ขึ้นไป
- แตก ZIP แล้วเข้าโฟลเดอร์ `wordgod-seo-updated`
- ถ้าจะเก็บใน Git ให้สร้าง Private Repository และตรวจ secret ก่อน Commit แรก
- ติดตั้ง dependency แบบ lockfile:

```bash
npm ci
cp .env.example .env.local
```

ไฟล์ ZIP ไม่ใส่ `.env.local`, secret, `node_modules`, `.next`, `.vercel` หรือ output เก่าไว้ให้

### 2. ตั้ง Supabase Email Magic Link

ต้องสร้างหรือใช้ Supabase Project แยกสำหรับ WordGod ที่เจ้าของระบบยืนยันแล้วเท่านั้น **ห้ามใช้ `kanokphonthbb-web's Project` ไม่ว่ากรณีใด**

1. สร้าง/เลือก Supabase Project
2. ไปที่ **Authentication → Sign In / Providers → Email** แล้วเปิด Email Provider
3. ตรวจว่า Magic Link email template ใช้ `{{ .ConfirmationURL }}`
4. ที่ **Supabase → Authentication → URL Configuration** ตั้ง Production Site URL และเพิ่ม Redirect URLs:

```text
http://localhost:3030/auth/callback
https://YOUR_PRODUCTION_DOMAIN/auth/callback
```

5. ใส่ค่าต่อไปนี้ใน `.env.local` และ Vercel ทุก Environment ที่ใช้งาน:

```text
NEXT_PUBLIC_SUPABASE_URL=https://SUPABASE_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```


> อย่านำ Supabase Project อื่นมาใช้โดยอัตโนมัติ ต้องให้เจ้าของยืนยันชื่อและ Project Ref ของ WordGod ก่อน เพราะอาจเป็นฐานของระบบอื่น โดย `kanokphonthbb-web's Project` อยู่ในรายการห้ามแตะอย่างเด็ดขาด

### 3. ตั้ง Vertex AI ผ่าน Vercel OIDC — ใช้ flow เดิม

ทำตาม `DEPLOYMENT.md` โดยไม่เปลี่ยนวิธีดึง credential:

- เปิด Vertex AI API, Security Token Service API และ IAM Service Account Credentials API
- ตั้ง Workload Identity Pool/Provider สำหรับ Vercel OIDC
- ให้ Service Account มี `roles/aiplatform.user`
- ผูก Vercel principal ของ `production`; เพิ่ม `preview`/`development` เฉพาะ Environment ที่ต้องใช้จริง
- ใช้ Team issuer mode ใน Vercel ให้ตรงกับ issuer ใน GCP
- กำหนด `GCP_*` ตาม `.env.example`
- ไม่ต้องและห้ามใส่ `GEMINI_API_KEY`

### 4. ใส่ API credentials เดิม

ใช้ชื่อ environment variables เดิมทั้งหมด:

```text
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
GOOGLE_ADS_CUSTOMER_ID
GOOGLE_ADS_LOGIN_CUSTOMER_ID
GOOGLE_ADS_API_VERSION        # optional; default v21
DATAFORSEO_LOGIN
DATAFORSEO_PASSWORD
```

- ใส่ค่าใน Vercel แยก Production/Preview/Development ตามสิทธิ์ที่ต้องใช้
- อย่าใส่ค่าจริงลง `.env.example`
- ทดสอบกับ Account จริงว่า Google Ads Customer ID และ MCC/Login Customer ID จับคู่ถูกต้อง

### 5. ตรวจนโยบาย CPC แบบ THB ที่ทำไว้แล้ว

- Output ถูกล็อกเป็น `THB` และไม่มีตัวเลือกเปลี่ยนสกุลเงิน
- Google Ads อ่าน `customer.currency_code` จาก Client Account จริง; ถ้าเป็น THB ใช้ค่าเดิม ถ้าเป็นสกุลอื่นจึงแปลงเป็น THB
- DataForSEO CPC ต้นทางเป็น USD ตามเอกสาร Provider และระบบแปลง USD เป็น THB ด้วยอัตราอ้างอิงแบบมีวันที่จาก `api.frankfurter.dev`
- ไม่ต้องเพิ่ม API key สำหรับอัตราแลกเปลี่ยน และไม่ได้เปลี่ยนวิธีอ่าน Google Ads/DataForSEO keys เดิม
- UI ใช้หัวข้อ `CPC (THB)`; Excel/CSV ระบุ THB และเก็บ Original Currency, FX Rate และ FX As Of สำหรับตรวจสอบย้อนกลับ
- ถ้าอ่านสกุลเงินหรือ FX rate ที่ต้องใช้ไม่ได้ ระบบต้องเว้น CPC ของ Provider นั้นพร้อมคำเตือน โดย Search Volume ยังใช้ได้ ห้าม fallback ไปแสดงค่าที่ยังไม่แปลงเป็น THB
- Dev ต้องตรวจว่า Production ออก HTTPS ไป `https://api.frankfurter.dev` ได้ และทดสอบด้วย Google Ads account จริงอย่างน้อยหนึ่งครั้ง

### 6. ตั้ง Vercel

- Import Private Repository หรือ Link โปรเจกต์ด้วย Vercel CLI
- ตั้ง Node.js 22+
- ใส่ Environment Variables ตาม `.env.example` และข้อด้านบน
- ตรวจว่า Vercel plan/runtime รองรับ `maxDuration = 800` สำหรับ `/api/pipeline` และ `/api/research`; ถ้าไม่รองรับ ต้องปรับ pipeline เป็น background job/queue หรือจำกัดขนาดงาน ไม่ควรลด timeout โดยไม่ทดสอบงาน 3,000 Keyword
- Domain Production ต้องตรงกับ Supabase Site URL และ Redirect URL
- ยังไม่ควร Deploy Production ถ้าไม่มี Supabase vars เพราะระบบจะ Fail Closed

### 7. รัน Automated Checks

```bash
npm run test:all
npm run lint
npm run build
```

เกณฑ์ผ่าน: tests และ build ต้องสำเร็จ; lint ต้องไม่มี error ส่วน warning เดิมให้บันทึกไว้และทยอยเก็บได้

### 8. Manual Acceptance Test ก่อน Production

- Login ด้วยบัญชี `@convertcake.com` สำเร็จและกลับเข้าหน้า WordGod
- Login ด้วย Gmail/โดเมนอื่นถูกปฏิเสธ แม้รู้ URL โดยตรง
- เมื่อ Logout แล้ว Protected Page เข้าไม่ได้ และ Protected API ตอบ 401/403 ตามกรณี
- ทดสอบ Session หมดอายุ/ลบ cookie แล้วระบบไม่เปิดข้อมูลค้าง
- ขอ 20 Keyword แบบ `API เท่านั้น`: ทุกแถวต้องมี Source เป็น `keyword_planner` หรือ `dataforseo`; ถ้าข้อมูลจริงไม่ครบต้องแสดง Shortfall ไม่สร้าง Metric ปลอม
- ขอ 20 Keyword แบบ `API + คำแนะนำ`: คำที่เป็น suggestion ต้องแสดง Volume/CPC เป็น `—` หรือช่องว่าง
- ทดสอบจำนวน Keyword ขั้นต่ำและค่าสูงที่ระบบจริงรับไหว; ตรวจ requested/candidate/API-backed/derived/shortfall
- ทดสอบ Plan 1 เดือนและ 12 เดือน; จำนวนบทความและ Calendar ต้องไม่เกินค่าที่กำหนด
- Export Excel แล้วต้องได้ 6 ชีต: Overview, Keyword Master, Content Plan, Pillar Map, Calendar, Calendar Summary
- ใน Excel คำที่ไม่มี Direct Metric ต้องเว้น Volume/CPC ว่าง; AI Estimate อยู่คนละคอลัมน์
- CPC ที่มีค่าทุกแถวต้องเป็น THB; DataForSEO และ Google Ads ที่ไม่ใช่บัญชี THB ต้องมี Original Currency, FX Rate และ FX As Of
- เทียบโครงสร้างและความอ่านง่ายกับ `LINE_BK_Keyword_Research_Content_Plan.xlsx`
- ตรวจภาษาไทย, slug, duplicate Keyword/Title, Funnel, Priority, Money Page และ Internal Links
- ทดสอบ input ที่ไม่มี Google Ads/DataForSEO credentials: ระบบต้องเตือนและไม่แต่ง Volume/CPC
- ตรวจ Network/Server logs ว่าไม่มี token, password หรือ OAuth secret หลุดออกมา

### 9. Deploy และ Smoke Test

```bash
vercel --prod
```

หลัง Deploy ให้ทำ Manual Acceptance Test ซ้ำอย่างน้อยเรื่อง Login, 1 งาน Keyword จริง, Excel Export และการบล็อกบัญชีนอกโดเมน พร้อมตรวจ Vercel logs ว่าไม่มี 401/403/timeout ที่ผิดปกติ

## ผลตรวจล่าสุดก่อนทำ ZIP

- `npx tsc --noEmit` — ผ่าน
- `npm run test:all` — ผ่านทุกชุด
- `npm run lint` — 0 errors, 12 warnings เดิมเรื่อง unused variables
- `npm run build` — ผ่าน Production Build
- Excel QA แบบ in-memory — ผ่าน, ได้ 6 ชีต และแยก Direct Metric ออกจาก AI Estimate ถูกต้อง
- ยังไม่มี `.env.local` และยังไม่ได้ Link `.vercel` ในไฟล์ส่งมอบ
- External setup ที่ยังต้องทำ: เลือก Supabase Project, เปิด Email Magic Link, ใส่ Vercel/GCP/API credentials และทดสอบกับบัญชีจริง

## Definition of Done สำหรับ Dev

ถือว่าพร้อมใช้งานจริงเมื่อครบทุกข้อ:

- Automated Checks ผ่าน
- Supabase Email Magic Link ผ่านทั้ง Allowed และ Denied domain
- Vertex AI OIDC ใช้งานบน Production ได้โดยไม่มี long-lived Gemini key
- Google Keyword Planner และ DataForSEO คืนข้อมูลจริงด้วย credentials ของ Production
- CPC ทุกแหล่งเป็น THB และการแปลงตรวจสอบย้อนกลับได้; เมื่อ FX ใช้ไม่ได้ต้องเว้น CPC
- งาน 20 Keyword และขนาดงานเป้าหมายจริงจบโดยไม่ timeout
- Plan 1 และ 12 เดือนถูกต้อง
- Excel 6 ชีตผ่าน QA และไม่ใส่ Metric ปลอม
- ไม่มี secret ใน Repository, Client bundle หรือ logs
- Production smoke test ผ่านและมีผู้รับผิดชอบ rollback/domain/config
