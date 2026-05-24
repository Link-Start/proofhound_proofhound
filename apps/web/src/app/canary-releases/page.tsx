import { redirect } from 'next/navigation';

export default function LegacyCanaryReleasesRoute() {
  redirect('/releases');
}
