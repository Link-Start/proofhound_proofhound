import { redirect } from 'next/navigation';

export default function LegacyCanaryAnnotationRoute() {
  redirect('/annotations');
}
