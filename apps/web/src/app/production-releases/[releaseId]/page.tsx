import { redirect } from 'next/navigation';

export default function LegacyProductionReleaseDetailRoute() {
  redirect('/releases');
}
