-- =============================================================================
-- WordGod — Supabase Auth companion setup
-- =============================================================================
-- อ่านก่อนรัน (สำคัญ):
--
--   ระบบ WordGod ใช้ "Supabase Auth (Email Magic Link)" ซึ่ง Supabase สร้างและดูแล
--   ตารางล็อกอินจริงให้เองอยู่แล้ว ได้แก่ auth.users, auth.sessions, auth.identities ฯลฯ
--   >> เราต้อง "ไม่" สร้าง/แก้ตารางในสคีมา auth เอง เพราะจะชนกับของ Supabase และทำ Auth พัง
--
--   ไฟล์นี้จึงทำเฉพาะสิ่งที่ปลอดภัยและเป็นมาตรฐานของ Supabase:
--     (1) ตาราง public.profiles  = ตาราง "คู่" ที่ mirror ผู้ใช้จาก auth.users
--     (2) Trigger คัดลอกผู้ใช้ใหม่ auth.users -> public.profiles อัตโนมัติ
--     (3) Domain guard: ปฏิเสธการสมัครที่อีเมลไม่ใช่ @convertcake.com ตั้งแต่ชั้น DB
--     (4) Row Level Security: ผู้ใช้เห็น/แก้ได้เฉพาะโปรไฟล์ตัวเอง
--
--   หมายเหตุตามจริง: โค้ดแอปตอนนี้ตัดสินการล็อกอินจาก JWT (getClaims) + โดเมนอีเมล
--   ยังไม่ได้อ่านตาราง public.profiles ดังนั้นไฟล์นี้ "ไม่ใช่" เงื่อนไขที่ทำให้ล็อกอินทำงาน
--   สิ่งที่ทำให้ล็อกอินทำงานจริงคือ config: เปิด Email provider + redirect URLs +
--   ตั้ง env NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY บน Vercel
--   ตาราง profiles มีไว้เก็บบันทึกผู้ใช้/ต่อยอดข้อมูลรายคนในอนาคต
--
-- ⚠️ รันบน Supabase project ที่อนุมัติสำหรับ WordGod เท่านั้น
--    ห้ามรันบน "kanokphonthbb-web's Project" (คนละระบบ)
--
-- วิธีรัน: Supabase Dashboard -> SQL Editor -> วางทั้งไฟล์ -> Run
-- ปลอดภัย: idempotent (รันซ้ำได้) + ย้อนกลับได้ (ดู ROLLBACK ท้ายไฟล์)
-- =============================================================================


-- (1) ตารางโปรไฟล์ (companion ของ auth.users) --------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- (2)+(3) รวม Domain guard + คัดลอกผู้ใช้ใหม่เข้า profiles --------------------

-- 3) กันอีเมลนอกโดเมน @convertcake.com ตั้งแต่ตอนสมัคร (ปฏิเสธ)
create or replace function public.wordgod_enforce_corporate_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or position('@' in new.email) = 0
     or lower(split_part(new.email, '@', 2)) <> 'convertcake.com' then
    raise exception 'WordGod: only @convertcake.com accounts are allowed (got %)', new.email
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists wordgod_enforce_corporate_domain on auth.users;
create trigger wordgod_enforce_corporate_domain
  before insert on auth.users
  for each row
  execute function public.wordgod_enforce_corporate_domain();

-- 2) คัดลอก/อัปเดตผู้ใช้ใหม่ลง public.profiles อัตโนมัติ
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- (4) Row Level Security: เห็น/แก้ได้เฉพาะของตัวเอง --------------------------
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by owner" on public.profiles;
create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ตรวจสอบผลลัพธ์ (ออปชัน)
-- select tgname from pg_trigger
--   where tgname in ('wordgod_enforce_corporate_domain','on_auth_user_created');
-- select * from public.profiles;


-- =============================================================================
-- ROLLBACK (ถอนทุกอย่างที่ไฟล์นี้สร้าง)
-- =============================================================================
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop trigger if exists wordgod_enforce_corporate_domain on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.wordgod_enforce_corporate_domain();
-- drop table if exists public.profiles;
