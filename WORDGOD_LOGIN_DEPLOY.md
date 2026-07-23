# WordGod — คู่มือ Setup Login + Redeploy (ส่งให้ dev)

โดเมน production: **https://wordgod-seo.vercel.app**
ระบบล็อกอิน: **Supabase Auth** — กติกา: อนุญาตเฉพาะอีเมล **@convertcake.com**

> ⚠️ ทำบน Supabase project ของ WordGod เท่านั้น — **ห้ามใช้/แก้ `kanokphonthbb-web's Project`** (คนละระบบ)

---

## ขั้นที่ 1 — รัน SQL ใน Supabase

Supabase (project WordGod) → **SQL Editor** → วางไฟล์ `wordgod_supabase_auth_setup.sql` → **Run**
(สร้างตาราง `public.profiles` + trigger คัดลอกผู้ใช้ + กติกา @convertcake.com + RLS; รันซ้ำได้)

---

## ขั้นที่ 2 — ตั้งค่า Supabase Auth

**Authentication → Providers**
- เปิด **Email provider**
- ตรวจว่า Magic Link email template ใช้ `{{ .ConfirmationURL }}`

**Authentication → URL Configuration**
- Site URL: `https://wordgod-seo.vercel.app`
- Redirect URLs:
  ```
  https://wordgod-seo.vercel.app/auth/callback
  http://localhost:3030/auth/callback
  ```

## ขั้นที่ 3 — ตั้ง Environment Variables บน Vercel

Vercel → project **wordgod-seo** → Settings → Environment Variables (Production)

```
NEXT_PUBLIC_SUPABASE_URL=https://<SUPABASE_PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key จาก Supabase → Project Settings → API>
```

- ถ้าไม่ตั้ง 2 ตัวนี้ ระบบจะถอยไปใช้ Basic Auth และ production จะ fail-closed 503 (เข้าไม่ได้)
- คง `AUTH_PASSWORD` ไว้เป็น fallback
- **ห้ามใส่ `GEMINI_API_KEY`** — Gemini ใช้ Vercel OIDC (`GCP_*`) ตามเดิม ห้ามแก้

---

## ขั้นที่ 4 — Redeploy

env บน Vercel เปลี่ยนแล้วต้อง redeploy ให้ค่ามีผล เลือกวิธีใดวิธีหนึ่ง:

**A. ผ่าน Vercel Dashboard**
Deployments → เลือก deployment ล่าสุด → เมนู `⋯` → **Redeploy**

**B. ผ่าน CLI**
```bash
vercel --prod
```

**C. ผ่าน Git**
push commit ใหม่ขึ้น branch production → Vercel auto-deploy

---

## ขั้นที่ 5 — ตรวจหลัง deploy

- [ ] เข้าเว็บ → login ด้วยบัญชี `@convertcake.com` → เข้าได้
- [ ] ลอง login ด้วยโดเมนอื่น → ถูกปฏิเสธ (redirect /unauthorized)
- [ ] เปิด Supabase → Table Editor → `public.profiles` → มี record ผู้ใช้ที่เพิ่ง login
- [ ] เรียก API เส้นใดเส้นหนึ่งโดยไม่ login → ได้ 401/403

---

## ไฟล์ที่ต้องมี
- `wordgod_supabase_auth_setup.sql` — รันใน Supabase (ขั้นที่ 1)
- คู่มือนี้ — ขั้นตอน config + redeploy
