'use client';

import { type FormEvent, useState } from 'react';
import { ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail, normalizeEmail } from '@/lib/auth/domain';
import { createClient } from '@/lib/supabase/client';

export default function LoginButton({ nextPath = '/' }: { nextPath?: string }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSent(false);

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !isAllowedCorporateEmail(normalizedEmail)) {
      setError(`กรุณาใช้อีเมล @${ALLOWED_EMAIL_DOMAIN}`);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      if (nextPath !== '/') callbackUrl.searchParams.set('next', nextPath);

      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: callbackUrl.toString(),
          shouldCreateUser: true,
        },
      });
      if (authError) throw authError;
      setEmail(normalizedEmail);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ไม่สามารถส่งลิงก์เข้าสู่ระบบได้');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={sendMagicLink}>
      <label htmlFor="login-email" className="mb-2 block text-xs font-bold text-[#273858]">
        อีเมลบริษัท
      </label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
        className="min-h-14 w-full rounded-2xl border border-[#cbd8ec] bg-white px-4 text-sm text-[#17233d] outline-none transition placeholder:text-[#a4afbf] focus:border-[#4b83ee] focus:ring-4 focus:ring-[#155eef]/10"
      />
      <button
        type="submit"
        disabled={loading}
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#155eef] px-5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(21,94,239,0.24)] transition hover:-translate-y-0.5 hover:bg-[#0d4fd8] hover:shadow-[0_16px_36px_rgba(21,94,239,0.30)] disabled:cursor-wait disabled:opacity-65"
      >
        {loading ? 'กำลังส่งลิงก์…' : sent ? 'ส่งลิงก์อีกครั้ง' : 'ส่งลิงก์เข้าสู่ระบบ'}
      </button>
      {sent ? (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-xs leading-5 text-emerald-700">
          ส่งลิงก์แล้ว กรุณาเปิดอีเมลและกดลิงก์เพื่อเข้าสู่ระบบ หากไม่พบให้ตรวจโฟลเดอร์ Spam หรือ Junk
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-center text-xs leading-5 text-red-600">{error}</p> : null}
    </form>
  );
}
