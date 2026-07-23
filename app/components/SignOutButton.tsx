'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={loading}
      className="grid h-9 w-9 place-items-center rounded-full border border-[#d9e2f0] bg-white text-xs font-black text-[#155eef] transition hover:border-[#9db9ef] hover:bg-[#eef4ff] disabled:opacity-50"
      aria-label="ออกจากระบบ"
      title="ออกจากระบบ"
    >
      {loading ? '…' : '↗'}
    </button>
  );
}
