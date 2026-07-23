# Prompt สำหรับส่งให้ Claude ตรวจ WordGod ก่อน Deploy

ให้นำข้อความด้านล่างไปส่ง Claude พร้อมแนบไฟล์ `WordGod_Dev_Handoff_2026-07-22.zip`

---

คุณเป็น Senior Software Engineer, Security Reviewer, SEO Data Pipeline Reviewer และ Release Engineer กรุณาตรวจระบบ **WordGod** จาก ZIP ที่แนบมาอย่างละเอียด เพื่อสรุปว่าพร้อม Deploy หรือยัง มีจุดผิดพลาดหรือความเสี่ยงตรงไหน และผลลัพธ์ Keyword/Content Plan มีนโยบายข้อมูลที่ถูกต้องหรือไม่

## ขอบเขตและกฎความปลอดภัย

1. งานนี้เป็น **Review-only** ห้าม Deploy, Push, Commit, ส่งข้อความ, เปลี่ยน Domain หรือแก้ระบบภายนอก
2. ห้ามใช้หรือแก้ไข Supabase Project ชื่อ **`kanokphonthbb-web's Project`** เด็ดขาด เพราะเป็นคนละระบบกับ WordGod ห้ามอ่าน/คัดลอก URL หรือ Key และห้ามแก้ Auth, Database, Redirect URL, Provider หรือ Setting ใด ๆ
3. หากต้องทดสอบ Supabase ให้ใช้ Mock/Local test เท่านั้น หรือรายงานว่าเป็น Manual external setup ที่ยังต้องทำ
4. ห้ามขอ แสดง หรือทดลองใช้ Secret จริง ห้ามใส่ Credential ลง Client, Log, Git หรือรายงาน
5. ห้ามเปลี่ยนวิธีอ่าน API credentials เดิมของ `GOOGLE_ADS_*`, `DATAFORSEO_*` และ `GCP_*`
6. Gemini/Vertex AI ต้องใช้ Vercel OIDC ตาม flow เดิม ห้ามเสนอ `GEMINI_API_KEY` เป็นทางลัด
7. อย่าเชื่อ `DEV_HANDOFF.md` เพียงอย่างเดียว ให้ตรวจยืนยันจาก implementation และ tests จริง
8. อย่าเดาผลจาก API ที่ไม่มี credentials ให้แยกชัดเจนระหว่าง “ยืนยันจากโค้ด/เทสต์แล้ว” กับ “ต้องทดสอบด้วยบัญชีจริง”
9. รักษาไฟล์ต้นฉบับ ห้ามแก้โค้ดในรอบ Review นี้ หากพบปัญหาให้เสนอ smallest-safe-fix พร้อมระบุไฟล์และบรรทัด

## เริ่มตรวจจากไฟล์เหล่านี้

1. แตก ZIP ในโฟลเดอร์ชั่วคราว
2. อ่าน `wordgod-seo-updated/DEV_HANDOFF.md`
3. อ่าน `README.md`, `DEPLOYMENT.md`, `.env.example`, `package.json`, `next.config.ts` และ `proxy.ts`
4. ใช้ `LINE_BK_Keyword_Research_Content_Plan.xlsx` เป็น Reference สำหรับโครงสร้างและคุณภาพ Output
5. ตรวจ source ที่เกี่ยวข้องจริง ไม่ต้องอ่าน `node_modules` หรือ generated files

## สิ่งที่ต้อง Audit

### A. Keyword และ Metric Provenance

- เลือกจำนวน Keyword ได้จริงและ validate ขอบเขต `20–3,000`
- Candidate pool ประมาณ 3 เท่าของเป้าหมายและไม่เกิน 3,000
- Candidate ส่วนใหญ่เป็นคำสั้น/กลางที่มีโอกาสพบ Volume
- Query Google Keyword Planner ก่อน แล้ว DataForSEO สำหรับช่องว่าง
- `api_only` คืนเฉพาะ Keyword ที่มี Direct Provider Metric และยอมคืนไม่ครบพร้อม Shortfall
- `api_first` เติมคำแนะนำได้ แต่ Volume/CPC ของคำที่ไม่มี Direct Metric ต้องว่าง
- `keyword_planner` และ `dataforseo` เท่านั้นที่นับเป็น Direct Metric
- ห้าม Close Variant 30%, Proxy Volume, Borrowed Volume/CPC หรือ Gemini estimate ในคอลัมน์ข้อมูลจริง
- Long-tail ที่ไม่มี Verified Volume ต้องเป็น Supporting/Secondary Keyword ไม่ใช่ Primary Calendar Keyword
- Requested, Candidate, API-backed, Derived, Estimated และ Shortfall count ต้องสอดคล้องกันใน API, UI, CSV และ Excel
- ตรวจ cache ว่าไม่มีข้อมูลรุ่นเก่าหรือคนละ Currency หลุดกลับมา

### B. CPC Currency Policy

- CPC Output ต้องถูกล็อกเป็น **THB เท่านั้น** ไม่มีตัวเลือกเปลี่ยน Currency
- Google Ads ต้องอ่าน `customer.currency_code` จาก Client Account จริง
- ถ้า Google Ads Account เป็น THB ต้องใช้อัตรา identity = 1 และไม่แปลงซ้ำ
- ถ้า Google Ads เป็นสกุลอื่น ต้องแปลงเป็น THB
- DataForSEO CPC ต้นทางเป็น USD และต้องแปลง USD → THB ก่อน Merge/Ranking/UI/Export
- FX rate ต้องเป็นคู่ Currency ที่ถูกต้อง, มากกว่า 0, มีวันที่อ้างอิง และมี timeout/cache ที่สมเหตุผล
- ถ้า Currency/FX provider ใช้ไม่ได้ ต้องเก็บ Search Volume ต่อได้ แต่เว้น CPC ว่างและแจ้งเตือน ห้ามแสดง Local/USD เป็น THB
- ตรวจ `CPC (THB)`, Original Currency, Conversion Rate และ FX As Of ใน API/CSV/Excel
- ตรวจการปัดเศษว่าไม่ทำให้ CPC ต่ำกลายเป็นศูนย์ก่อนแปลง

### C. Content Plan และ Excel

- เลือก Plan ได้ `1–12` เดือนจริงและมี validation ฝั่ง Server
- จำนวนบทความต่อเดือนถูกจำกัดอย่างปลอดภัย
- ไม่สร้าง Primary Keyword ซ้ำเพื่อเติม Calendar
- Calendar เชื่อมกลับ Keyword Master ได้ทุกแถว
- Export ต้องมี 6 ชีต: Overview, Keyword Master, Content Plan, Pillar Map, Calendar และ Calendar Summary
- คำแนะนำที่ไม่มี Direct Metric ต้องมี Volume/CPC ว่าง และ AI Estimate ต้องอยู่คนละคอลัมน์
- ตรวจ Formula, AutoFilter, Freeze Pane, Column alignment/width และหัวข้อ `CPC (THB)`
- เปรียบเทียบกับไฟล์ Reference ว่าผลลัพธ์อ่านง่ายและใช้งานต่อได้จริง แม้ไม่จำเป็นต้องเหมือน Pixel-by-pixel

### D. Authentication และ Security

- Supabase Google OAuth จำกัดอีเมลแบบ exact match เฉพาะ `@convertcake.com`
- ต้องตรวจสิทธิ์ฝั่ง Server สำหรับทุก Protected Page และ Protected API ไม่พึ่ง `hd` หรือ Client-side check
- ตรวจ callback, cookies, logout, expired/missing session และ redirect safety
- Production ต้อง Fail Closed หากไม่มีทั้ง Supabase config และ `AUTH_PASSWORD`
- ไม่ต้องใช้ Supabase service-role/secret key สำหรับระบบ Login นี้
- ตรวจว่า `NEXT_PUBLIC_` มีเฉพาะค่าที่เปิดเผยต่อ Browser ได้
- ตรวจ secret leakage, logs, error messages, SSR/client boundaries, request validation และ rate/abuse risks
- ตรวจ dependencies และ lockfile เฉพาะประเด็นที่เป็น Release blocker จริง

### E. Deploy Readiness

- Node.js 22+ และ Next.js/Vercel configuration สอดคล้องกัน
- ตรวจว่า `maxDuration = 800` ใช้งานได้กับ Vercel plan/runtime ที่จะ Deploy จริง หากยืนยันไม่ได้ให้ระบุเป็น External blocker
- ตรวจ Vercel OIDC และ GCP Workload Identity assumptions
- ตรวจ Environment Variables จาก source เทียบกับ `.env.example` และ `DEPLOYMENT.md` ว่าครบและไม่มีชื่อตกหล่น
- ตรวจ Production domain กับ Supabase Site URL/Redirect URL
- ตรวจ outbound HTTPS requirement สำหรับ `api.frankfurter.dev`
- แยก Code blocker ออกจาก Manual external setup เช่น Supabase Project ใหม่, Google OAuth, Vercel/GCP/API credentials

## คำสั่งที่ต้องรัน

ใช้ Node.js 22+ และรันอย่างน้อย:

```bash
npm ci
npx tsc --noEmit
npm run test:all
npm run lint
npm run build
```

ถ้า Build ต้องดาวน์โหลด Google Fonts ให้ระบุว่าเป็น Network requirement อย่าสรุปว่าโค้ดพังทันที หากคำสั่งใดล้มเหลวให้บันทึก command, exit code และ error ที่เกี่ยวข้อง

ให้เพิ่ม focused checks สำหรับกรณีเหล่านี้โดยไม่ใช้ Secret จริง:

1. Google Ads THB → THB identity rate
2. Google Ads USD/สกุลอื่น → THB
3. DataForSEO USD → THB
4. FX API ล้มเหลว → Volume ยังอยู่ แต่ CPC ว่างพร้อม warning
5. API-only มีข้อมูลไม่ครบ → Shortfall ไม่เติม Metric ปลอม
6. API-first suggestion → Volume/CPC ว่าง
7. Plan 1 เดือนและ 12 เดือน
8. Excel 6 ชีตและ FX audit columns
9. Email `user@convertcake.com` ผ่าน แต่ `user@convertcake.com.attacker.tld`, subdomain และโดเมนอื่นไม่ผ่าน

## รูปแบบรายงานที่ต้องส่งกลับ

ตอบเป็นภาษาไทยและใช้โครงสร้างนี้:

### 1. คำตัดสิน

เลือกเพียงหนึ่งสถานะ:

- `READY FOR DEPLOY`
- `READY AFTER EXTERNAL SETUP`
- `NOT READY`

อธิบายเหตุผลไม่เกิน 8 บรรทัด และแยกให้ชัดว่า Code พร้อมหรือยัง กับ External setup เหลืออะไร

### 2. Findings

เรียงตามความรุนแรง:

- `P0` — Security/data corruption/credential exposure หรือ Deploy ไม่ได้แน่นอน
- `P1` — ผลลัพธ์ผิด, Metric/Currency ผิด, Auth bypass, timeout หลัก หรือ Excel ใช้งานไม่ได้
- `P2` — ความทนทาน, UX, maintainability หรือ warning ที่ควรแก้แต่ไม่บล็อก Deploy

ทุก Finding ต้องมี:

- ชื่อปัญหา
- ระดับ P0/P1/P2
- ไฟล์และบรรทัด
- หลักฐานจากโค้ดหรือคำสั่งทดสอบ
- วิธี reproduce/confirm
- ผลกระทบ
- smallest-safe-fix
- verification หลังแก้

ห้ามสร้าง Finding ที่ไม่มีหลักฐาน หากไม่พบปัญหาในระดับใดให้เขียนว่า “ไม่พบ”

### 3. ผลการทดสอบ

ทำตาราง Command / Result / Evidence และรายงานจำนวน tests, lint errors/warnings, build status และ Excel QA

### 4. คุณภาพผลลัพธ์

ให้คะแนน 0–10 พร้อมเหตุผลสำหรับ:

- Keyword relevance
- Direct metric integrity
- CPC currency integrity
- Content-plan usefulness
- Excel usability
- Traceability/QA

ระบุด้วยว่าการยืนยันคุณภาพเชิงธุรกิจส่วนใดต้องใช้ Google Ads/DataForSEO credentials จริง

### 5. Pre-deploy Checklist

ทำรายการแยกเป็น:

- ทำเสร็จแล้วในโค้ด
- Dev ต้องทำก่อน Deploy
- ต้องทดสอบหลัง Deploy
- Blocker ที่ยังเปิดอยู่

### 6. Final Recommendation

สรุปสั้น ๆ ว่า “ส่ง Deploy ได้หรือยัง” และถ้ายังไม่ได้ ให้ระบุ Action ตามลำดับไม่เกิน 10 ข้อ

อย่า Deploy หรือแก้ระบบภายนอกด้วยตัวเอง ให้จบที่รายงาน Review เท่านั้น

---
