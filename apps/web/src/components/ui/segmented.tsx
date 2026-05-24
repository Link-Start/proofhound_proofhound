'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<TValue extends string> {
  value: TValue;
  label: ReactNode;
  icon?: ReactNode;
}

// N-option segmented control（设计稿"近 1 小时 / 近 24 小时 / 近 7 天 / 近 30 天 / 自定义"
// 以及排行表头部"调用量 / 成本 / 命中率 / 失败率"切换都用这个）
export function Segmented<TValue extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  size = 'md',
  className,
}: {
  value: TValue;
  options: ReadonlyArray<SegmentedOption<TValue>>;
  ariaLabel: string;
  onChange: (value: TValue) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const padX = size === 'sm' ? 'px-2.5' : 'px-3';
  const padY = size === 'sm' ? 'py-1' : 'py-1.5';
  const text = size === 'sm' ? 'text-[12px]' : 'text-[12.5px]';

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-0.5 rounded-lg border bg-muted p-0.5', className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors cursor-pointer',
              text,
              padX,
              padY,
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.icon ? <span className="inline-flex shrink-0 items-center" aria-hidden>{opt.icon}</span> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
