'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function signInWithGoogle() {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            hd: 'convertcake.com',
            prompt: 'select_account',
          },
        },
      });
      if (authError) throw authError;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ไม่สามารถเข้าสู่ระบบได้');
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={loading}
        className="group flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#155eef] px-5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(21,94,239,0.24)] transition hover:-translate-y-0.5 hover:bg-[#0d4fd8] hover:shadow-[0_16px_36px_rgba(21,94,239,0.30)] disabled:cursor-wait disabled:opacity-65"
      >
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-white shadow-sm">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5">
            <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z" />
            <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9.2L6.5 14Z" />
            <path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.5l2.7-2.7A9 9 0 0 0 12 2a10 10 0 0 0-8.8 5.5l3.3 2.6A5.8 5.8 0 0 1 12 6Z" />
          </svg>
        </span>
        <span>{loading ? 'กำลังเชื่อมต่อ Google…' : 'เข้าสู่ระบบด้วย Google'}</span>
      </button>
      {error ? <p role="alert" className="mt-3 text-center text-xs leading-5 text-red-600">{error}</p> : null}
    </div>
  );
}
