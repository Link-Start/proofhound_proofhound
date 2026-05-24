export const optimizationTone = {
  positive: {
    pill: 'border-[var(--status-running-bd)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]',
    dot: 'bg-[var(--status-running-dot)]',
    fill: 'bg-[var(--status-running-dot)]',
    // `fg` token 是为深色 pill 背景配的浅色文字（dark 主题下接近白色），
    // 直接当纯文字色会失去区分度。这里改用 `dot`：四主题下都是高对比的纯色绿色（twilight 蓝），
    // 适合在普通背景上做"正向变化"等强调文字。
    text: 'text-[var(--status-running-dot)]',
    border: 'border-[var(--status-running-bd)]',
    bg: 'bg-[var(--status-running-bg)]',
  },
  info: {
    pill: 'border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]',
    dot: 'bg-[var(--status-canary-dot)]',
    fill: 'bg-[var(--status-canary-dot)]',
    text: 'text-[var(--status-canary-fg)]',
    border: 'border-[var(--status-canary-bd)]',
    bg: 'bg-[var(--status-canary-bg)]',
  },
  warning: {
    pill: 'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
    dot: 'bg-[var(--status-pending-dot)]',
    fill: 'bg-[var(--status-pending-dot)]',
    text: 'text-[var(--status-pending-fg)]',
    border: 'border-[var(--status-pending-bd)]',
    bg: 'bg-[var(--status-pending-bg)]',
  },
  muted: {
    pill: 'border-[var(--status-archived-bd)] bg-[var(--status-archived-bg)] text-[var(--status-archived-fg)]',
    dot: 'bg-[var(--status-archived-dot)]',
    fill: 'bg-[var(--status-archived-dot)]',
    text: 'text-[var(--status-archived-fg)]',
    border: 'border-[var(--status-archived-bd)]',
    bg: 'bg-[var(--status-archived-bg)]',
  },
  danger: {
    pill: 'border-destructive/40 bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
    fill: 'bg-destructive',
    text: 'text-destructive',
    border: 'border-destructive/40',
    bg: 'bg-destructive/10',
  },
} as const;
