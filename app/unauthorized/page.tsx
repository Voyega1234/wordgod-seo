import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen bg-[#f3f7ff] px-6 py-12 flex items-center justify-center">
      <section className="w-full max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-[0_24px_80px_rgba(55,75,115,0.12)]">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-red-50 text-2xl">!</div>
        <h1 className="text-2xl font-bold text-[#17233d]">บัญชีนี้ไม่มีสิทธิ์ใช้งาน</h1>
        <p className="mt-3 text-sm leading-6 text-[#71809a]">WordGod อนุญาตเฉพาะบัญชี Google ที่ลงท้ายด้วย @convertcake.com</p>
        <Link href="/login" className="mt-6 inline-flex rounded-xl bg-[#155eef] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0d4fd8]">เลือกบัญชีอื่น</Link>
      </section>
    </main>
  );
}
