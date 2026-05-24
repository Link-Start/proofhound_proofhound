'use client';

import { ProofHoundMarkTile } from '@/components/brand/proofhound-logo';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type PlatformLoaderSize = 'sm' | 'md' | 'lg';

interface PlatformLoaderProps {
  className?: string;
  size?: PlatformLoaderSize;
}

const loaderLogoSize: Record<PlatformLoaderSize, 'md' | 'lg' | 'xl'> = {
  sm: 'md',
  md: 'lg',
  lg: 'xl',
};

const labelSizeClass: Record<PlatformLoaderSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
};

export function PlatformLoader({ className, size = 'lg' }: PlatformLoaderProps) {
  const { t } = useI18n();
  const label = t('common.loadingEffort');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="platform-loader"
      className={cn('flex flex-col items-center justify-center gap-4 text-center', className)}
    >
      <ProofHoundMarkTile size={loaderLogoSize[size]} className="shadow-sm" />
      <span className={cn('font-medium text-muted-foreground', labelSizeClass[size])}>{label}</span>
    </div>
  );
}

export function PlatformLoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <PlatformLoader />
    </main>
  );
}
