import LoginButton from './LoginButton';
import { isSupabaseConfigured } from '@/lib/supabase/server';

function WordGodMark() {
  return (
    <div className="relative grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-[#155eef] text-lg font-black tracking-[-0.08em] text-white shadow-[0_12px_26px_rgba(21,94,239,0.26)]">
      WG
      <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full border-[5px] border-white/30" />
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const supabaseEnabled = isSupabaseConfigured();
  const { error, next } = await searchParams;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f3f7ff] px-4 py-7 sm:px-6">
      <div className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full bg-[#dbe9ff]/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 -right-24 h-[30rem] w-[30rem] rounded-full bg-[#dcdcff]/60 blur-3xl" />

      <section className="relative z-10 grid min-w-0 w-[calc(100vw_-_2rem)] max-w-[1040px] overflow-hidden rounded-[32px] border border-[#d6e1f3] bg-white shadow-[0_32px_90px_rgba(35,61,112,0.16)] sm:w-[calc(100vw_-_3rem)] lg:min-h-[620px] lg:grid-cols-[1.08fr_0.92fr]">
        <div className="relative flex min-h-[300px] min-w-0 flex-col justify-center overflow-hidden bg-gradient-to-br from-white via-[#f1f6ff] to-[#e7efff] p-8 sm:p-12 lg:p-14">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border-[52px] border-[#155eef]/8" />
          <div className="pointer-events-none absolute bottom-10 left-10 h-16 w-64 -rotate-3 rounded-full bg-[#8cb4ff]/24 blur-sm" />

          <div className="relative z-10 inline-flex w-fit items-center gap-2 rounded-full border border-[#bcd2fa] bg-white/80 px-3.5 py-2 text-[10px] font-black tracking-[0.14em] text-[#164aa8] shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-[#3478f6] shadow-[0_0_0_4px_rgba(52,120,246,0.12)]" />
            WORDGOD · SEO PLANNING ENGINE
          </div>

          <h1 className="relative z-10 mt-8 max-w-[560px] break-words text-[clamp(2.45rem,5.6vw,4.65rem)] font-semibold leading-[0.98] tracking-[-0.065em] text-[#14213d]">
            เปลี่ยน Keyword
            <span className="mt-2 block text-[#155eef]">ให้เป็นแผนที่ใช้ได้จริง</span>
          </h1>
          <p className="relative z-10 mt-6 max-w-md text-sm leading-7 text-[#667793] sm:text-[15px]">
            วิจัยคีย์เวิร์ด จัดกลุ่ม Pillar วาง Content Calendar 1–12 เดือน และส่งออก Excel พร้อมใช้งานในระบบเดียว
          </p>

          <div className="relative z-10 mt-8 grid min-w-0 max-w-md grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[
              ['3,000', 'Keywords'],
              ['12', 'Months'],
              ['6', 'Excel Sheets'],
            ].map(([value, label]) => (
              <div key={label} className="min-w-0 rounded-2xl border border-white/90 bg-white/70 px-3 py-3 shadow-[0_8px_24px_rgba(49,88,155,0.08)] backdrop-blur last:col-span-2 sm:last:col-span-1">
                <strong className="block text-xl tracking-tight text-[#155eef]">{value}</strong>
                <span className="mt-0.5 block text-[10px] font-semibold text-[#71809a]">{label}</span>
              </div>
            ))}
          </div>

        </div>

        <div className="flex min-w-0 items-center border-t border-[#e4eaf4] bg-white p-8 sm:p-12 lg:border-l lg:border-t-0 lg:p-12">
          <div className="mx-auto min-w-0 w-full max-w-[360px]">
            <WordGodMark />
            <p className="mt-7 text-[10px] font-black tracking-[0.16em] text-[#155eef]">WELCOME TO WORDGOD</p>
            <h2 className="mt-2 text-3xl font-bold tracking-[-0.045em] text-[#17233d]">เข้าสู่ระบบ</h2>
            <p className="mt-3 text-sm leading-6 text-[#71809a]">เข้าสู่พื้นที่ทำงาน Keyword Research และ Content Planning ของทีม Convert Cake</p>

            <div className="mt-7 rounded-2xl border border-[#dbe6f8] bg-[#f6f9ff] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#e4edff] text-sm">✦</span>
                <div>
                  <p className="text-xs font-bold text-[#273858]">Corporate access only</p>
                  <p className="mt-0.5 text-[11px] text-[#71809a]">อนุญาตเฉพาะบัญชี @convertcake.com</p>
                </div>
              </div>
            </div>

            <div className="mt-5">
              {supabaseEnabled ? (
                <LoginButton nextPath={next} />
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
                  Supabase Auth ยังไม่ได้ตั้งค่า กรุณาเพิ่ม URL และ Publishable Key ก่อนเข้าสู่ระบบ
                </div>
              )}
            </div>

            {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p> : null}
            <p className="mt-6 text-center text-[10px] leading-5 text-[#96a2b5]">ไม่ต้องใช้รหัสผ่าน ระบบจะส่งลิงก์ยืนยันไปยังอีเมลของคุณ</p>
          </div>
        </div>
      </section>
    </main>
  );
}
