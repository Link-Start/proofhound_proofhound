import { redirect } from 'next/navigation';

export default function LegacyNewProductionReleaseRoute() {
  redirect('/releases/new');
}
