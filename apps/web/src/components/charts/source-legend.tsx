'use client';

import type { SourceBucket } from '@proofhound/shared';
import { cn } from '@/lib/utils';

const ORDER: ReadonlyArray<SourceBucket> = ['prod', 'canary', 'iter', 'exp'];

const LABELS: Record<SourceBucket, string> = {
  prod: '正式',
  canary: '灰度',
  iter: '优化',
  exp: '实验',
};

// 设计稿的 4 个 legend 项（每张图卡 footer 一组：色块 + 标签 + 数值）
export function SourceLegend({
  values,
  format,
  labels = LABELS,
  sourceKeys = ORDER,
  ariaLabel = '来源分布',
  className,
}: {
  values: Record<SourceBucket, number>;
  format: (value: number) => string;
  labels?: Record<SourceBucket, string>;
  sourceKeys?: ReadonlyArray<SourceBucket>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-2 border-t pt-3',
        sourceKeys.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
      role="list"
      aria-label={ariaLabel}
    >
      {sourceKeys.map((src) => (
        <div key={src} className="flex items-center gap-1.5 text-[11.5px]" role="listitem">
          <span className="size-2 rounded-sm" style={{ background: `var(--src-${src})` }} aria-hidden />
          <span className="text-muted-foreground">{labels[src]}</span>
          <span className="ml-auto font-mono font-semibold text-foreground">{format(values[src])}</span>
        </div>
      ))}
    </div>
  );
}
