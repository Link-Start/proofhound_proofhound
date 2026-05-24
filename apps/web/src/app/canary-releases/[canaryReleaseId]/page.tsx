import { redirect } from 'next/navigation';

export default function LegacyCanaryReleaseDetailRoute() {
  redirect('/releases');
}
