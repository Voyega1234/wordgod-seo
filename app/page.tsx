import WordGodDashboard from '@/app/components/WordGodDashboard';
import { requirePageAccess } from '@/lib/auth/access';

export default async function HomePage() {
  const access = await requirePageAccess();
  return <WordGodDashboard authEnabled={access.authEnabled} email={access.email} />;
}

