import { redirect } from 'next/navigation';

export default function LegacyNewCanaryReleaseRoute() {
  redirect('/releases/new?mode=canary');
}
