import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';

export function PlatformPageLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
