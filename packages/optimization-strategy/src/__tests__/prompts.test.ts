// Tests the rendering, injection position and token-budget degradation of the cross-round history section (SPEC 25 §11.3)
import { describe, expect, it } from 'vitest';
import {
  buildAnalyzeConfusionMessages,
  buildAnalyzeRegressionMessages,
  buildGenerateMessages,
  buildSummarizeMessages,
  fitRoundHistoryToBudget,
  formatRoundHistory,
  formatToolboxSwitchHint,
  OPTIMIZATION_TIP_NAMES,
} from '../error-pattern-analysis/prompts';
import type { ConfusionPair, RegressionGroup, SampleView } from '../error-pattern-analysis/confusion-pairs';
import type { OptimizationGoal, RoundHistoryEntry } from '../loop/types';

const goals: OptimizationGoal[] = [
  { metric: 'accuracy', op: '>=', value: 0.8, scope: { kind: 'overall' } },
];

const baseHistory: RoundHistoryEntry[] = [
  {
    roundIndex: 1,
    metrics: { overall: { accuracy: 0.65 } },
    deltaFromPrev: null,
    changeSummary: '加 strict ordering 硬约束',
    appliedChanges: [{ changeId: 'c1', patternIds: ['p1'], rationale: '原因 1' }],
    appliedTips: ['输出约束硬性化'],
    isBest: false,
    generatedFromBaseVersionId: 'v0',
  },
  {
    roundIndex: 2,
    metrics: { overall: { accuracy: 0.72 } },
    deltaFromPrev: 0.07,
    changeSummary: '扩 few-shot 到 4 条',
    appliedChanges: [{ changeId: 'c2', patternIds: ['p2'], rationale: '原因 2' }],
    appliedTips: ['Few-shot 示例'],
    isBest: true,
    generatedFromBaseVersionId: 'v1',
  },
];

const baseSample: SampleView = {
  sampleId: 's1',
  inputForAnalysis: { text: 'hi' },
  expected: 'A',
  predicted: 'B',
};

describe('formatRoundHistory', () => {
  it('returns empty string for empty history', () => {
    expect(formatRoundHistory([], goals)).toBe('');
  });

  it('renders history with delta, best mark, changeSummary, changeId list', () => {
    const out = formatRoundHistory(baseHistory, goals);
    expect(out).toContain('## 历史优化轨迹');
    expect(out).toContain('共 2 轮');
    expect(out).toContain('第 1 轮');
    expect(out).toContain('第 2 轮');
    expect(out).toContain('Δ -- '); // round 1 has no prev
    expect(out).toContain('Δ +0.0700'); // round 2 delta
    expect(out).toContain('★'); // best mark on round 2
    expect(out).toContain('加 strict ordering 硬约束');
    expect(out).toContain('扩 few-shot 到 4 条');
    expect(out).toContain('[c1]');
    expect(out).toContain('[c2]');
  });

  it('uses goals[0].metric name in header', () => {
    const f1Goals: OptimizationGoal[] = [
      { metric: 'f1', op: '>=', value: 0.7, scope: { kind: 'overall' } },
    ];
    const out = formatRoundHistory(baseHistory, f1Goals);
    expect(out).toContain('(f1)');
    // Test data omits the f1 field → renders the localized "(missing)" placeholder
    expect(out).toContain('（缺失）');
  });

  it('falls back to accuracy when goals is empty', () => {
    const out = formatRoundHistory(baseHistory, []);
    expect(out).toContain('(accuracy)');
    expect(out).toContain('0.6500');
    expect(out).toContain('0.7200');
  });

  it('shows empty-changes placeholder when appliedChanges is empty', () => {
    const empty: RoundHistoryEntry[] = [
      { ...baseHistory[0], appliedChanges: [], changeSummary: '' },
    ];
    const out = formatRoundHistory(empty, goals);
    expect(out).toContain('（未提供）'); // changeSummary empty
    expect(out).toContain('（无）'); // appliedChanges empty
  });

  it('renders appliedTips per round (SPEC 25 §11.3 「工具箱轮换提示」)', () => {
    const out = formatRoundHistory(baseHistory, goals);
    expect(out).toContain('appliedTips: [输出约束硬性化]');
    expect(out).toContain('appliedTips: [Few-shot 示例]');
  });

  it('shows "（未声明）" when appliedTips is empty', () => {
    const noTips: RoundHistoryEntry[] = [{ ...baseHistory[0]!, appliedTips: [] }];
    const out = formatRoundHistory(noTips, goals);
    expect(out).toContain('appliedTips: （未声明）');
  });
});

describe('formatToolboxSwitchHint', () => {
  it('lists recently used tips, full toolbox, and recommendation', () => {
    const out = formatToolboxSwitchHint(['输出约束硬性化', 'Few-shot 示例'], OPTIMIZATION_TIP_NAMES);
    expect(out).toContain('## 工具箱轮换提示');
    expect(out).toContain('原地转圈');
    expect(out).toContain('`输出约束硬性化`');
    expect(out).toContain('`Few-shot 示例`');
    // The full toolbox is listed
    for (const name of OPTIMIZATION_TIP_NAMES) {
      expect(out).toContain(`\`${name}\``);
    }
    expect(out).toContain('未使用过');
  });

  it('handles empty recentlyUsedTips gracefully', () => {
    const out = formatToolboxSwitchHint([], OPTIMIZATION_TIP_NAMES);
    expect(out).toContain('## 工具箱轮换提示');
    expect(out).toContain('无法识别历史技巧名');
  });

  it('deduplicates trimmed tips via caller (formatter trusts input)', () => {
    // formatToolboxSwitchHint internally dedupes with Set + filters by trim
    const out = formatToolboxSwitchHint(['思维链', '思维链', '  ', ''], OPTIMIZATION_TIP_NAMES);
    // Chain-of-thought appears only once in the "already tried" section (it is also in the full toolbox, so appears twice overall: once in "already tried" + once in the toolbox)
    const matches = out.match(/`思维链`/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

describe('fitRoundHistoryToBudget', () => {
  it('returns empty result for undefined history', () => {
    const r = fitRoundHistoryToBudget(undefined, 1000, goals);
    expect(r.level).toBe(0);
    expect(r.entryCount).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.estimatedTokens).toBe(0);
  });

  it('returns empty result for empty history', () => {
    const r = fitRoundHistoryToBudget([], 1000, goals);
    expect(r.level).toBe(0);
    expect(r.entryCount).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('L0: returns history unchanged when within budget', () => {
    const r = fitRoundHistoryToBudget(baseHistory, 10_000, goals);
    expect(r.level).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.fitted).toBe(baseHistory);
    expect(r.entryCount).toBe(2);
  });

  it('L1+: triggers truncation and removes rationale on early rounds when over budget', () => {
    const longHistory: RoundHistoryEntry[] = Array.from({ length: 6 }, (_, i) => ({
      roundIndex: i + 1,
      metrics: { overall: { accuracy: 0.5 + i * 0.01 } },
      deltaFromPrev: i === 0 ? null : 0.01,
      changeSummary: '这是一段非常非常长的 changeSummary 文字'.repeat(10),
      appliedChanges: [
        { changeId: `c${i}_a`, patternIds: ['p1', 'p2'], rationale: '原因'.repeat(20) },
        { changeId: `c${i}_b`, patternIds: ['p3'], rationale: '原因 b' },
      ],
      appliedTips: [],
      isBest: i === 5,
      generatedFromBaseVersionId: `v${i}`,
    }));
    // budget 200 is small enough that L0 must exceed → at least enters L1
    const r = fitRoundHistoryToBudget(longHistory, 200, goals);
    expect(r.truncated).toBe(true);
    expect(r.level).toBeGreaterThanOrEqual(1);
    expect(r.fitted).toBeDefined();
    expect(r.fitted!.length).toBe(6);
    // Early entries (index 0) have changeSummary compressed
    const earlyEntry = r.fitted![0]!;
    const originalChars = longHistory[0]!.changeSummary.length;
    expect(earlyEntry.changeSummary.length).toBeLessThan(originalChars);
    // Early appliedChanges' rationale is removed (L1/L2/L3 all do)
    if (earlyEntry.appliedChanges.length > 0) {
      expect(earlyEntry.appliedChanges[0]!.rationale).toBeUndefined();
    }
  });

  it('L3: extreme case keeps only last round with content', () => {
    const big: RoundHistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
      roundIndex: i + 1,
      metrics: { overall: { accuracy: 0.5 } },
      deltaFromPrev: null,
      changeSummary: '本轮 changeSummary 文字'.repeat(30),
      appliedChanges: [
        { changeId: `c${i}`, patternIds: ['p1', 'p2'], rationale: 'r'.repeat(50) },
      ],
      appliedTips: [],
      isBest: i === 5,
      generatedFromBaseVersionId: `v${i}`,
    }));
    const r = fitRoundHistoryToBudget(big, 200, goals);
    expect(r.level).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.fitted!.length).toBe(50);
    // Only the last entry retains the original changeSummary / appliedChanges
    expect(r.fitted![49]!.changeSummary).toBe(big[49]!.changeSummary);
    expect(r.fitted![49]!.appliedChanges.length).toBe(1);
    // The first 49 entries' changeSummary / appliedChanges are cleared (but metrics + delta are kept)
    for (let i = 0; i < 49; i++) {
      expect(r.fitted![i]!.changeSummary).toBe('');
      expect(r.fitted![i]!.appliedChanges).toEqual([]);
      expect(r.fitted![i]!.metrics).toEqual(big[i]!.metrics);
    }
  });
});

describe('buildGenerateMessages with roundHistory', () => {
  const baseArgs = {
    currentVersion: {
      id: 'v',
      promptId: 'p',
      versionNumber: 1,
      body: 'task: {{input}}',
    },
    errorAnalysisText: 'some errors',
    analysisEvidenceBundle: undefined,
    metrics: { overall: { accuracy: 0.5 } },
    goals,
    fieldWhitelist: { promptVariables: ['input'] },
  };

  it('does not render history section when roundHistory is undefined', () => {
    const { user } = buildGenerateMessages(baseArgs);
    expect(user).not.toContain('## 历史优化轨迹');
  });

  it('does not render history section when roundHistory is empty', () => {
    const { user } = buildGenerateMessages({ ...baseArgs, roundHistory: [] });
    expect(user).not.toContain('## 历史优化轨迹');
  });

  it('renders history section between goals and metrics segments', () => {
    const { user } = buildGenerateMessages({ ...baseArgs, roundHistory: baseHistory });
    expect(user).toContain('## 历史优化轨迹');
    expect(user).toContain('第 1 轮');
    expect(user).toContain('第 2 轮');
    const goalIdx = user.indexOf('## 优化目标 vs 当前实际');
    const historyIdx = user.indexOf('## 历史优化轨迹');
    const metricsIdx = user.indexOf('## 涉及范围的完整指标');
    expect(goalIdx).toBeGreaterThanOrEqual(0);
    expect(historyIdx).toBeGreaterThan(goalIdx);
    expect(metricsIdx).toBeGreaterThan(historyIdx);
  });

  it('does not render toolbox switch hint when undefined', () => {
    const { user } = buildGenerateMessages({ ...baseArgs, roundHistory: baseHistory });
    expect(user).not.toContain('## 工具箱轮换提示');
  });

  it('renders toolbox switch hint between history and metrics segments', () => {
    const { user } = buildGenerateMessages({
      ...baseArgs,
      roundHistory: baseHistory,
      toolboxSwitchHint: {
        recentlyUsedTips: ['输出约束硬性化', 'Few-shot 示例'],
        allTipNames: OPTIMIZATION_TIP_NAMES,
      },
    });
    expect(user).toContain('## 工具箱轮换提示');
    const historyIdx = user.indexOf('## 历史优化轨迹');
    const hintIdx = user.indexOf('## 工具箱轮换提示');
    const metricsIdx = user.indexOf('## 涉及范围的完整指标');
    expect(hintIdx).toBeGreaterThan(historyIdx);
    expect(metricsIdx).toBeGreaterThan(hintIdx);
  });

  it('renders toolbox switch hint even when roundHistory is empty (caller responsibility)', () => {
    // The caller constructs the hint only when streak >= 2; but the formatter does not depend on history, and empty history can also render
    const { user } = buildGenerateMessages({
      ...baseArgs,
      toolboxSwitchHint: {
        recentlyUsedTips: ['思维链'],
        allTipNames: OPTIMIZATION_TIP_NAMES,
      },
    });
    expect(user).toContain('## 工具箱轮换提示');
    expect(user).not.toContain('## 历史优化轨迹');
  });
});

describe('buildAnalyzeConfusionMessages with roundHistory', () => {
  const pair: ConfusionPair = {
    expected: 'A',
    predicted: 'B',
    count: 5,
    sampleIds: ['s1'],
    samples: [baseSample],
  };
  const baseArgs = {
    pair,
    currentVersion: {
      id: 'v',
      promptId: 'p',
      versionNumber: 1,
      body: 'task: {{input}}',
    },
    metrics: { overall: { accuracy: 0.5 } },
    goals,
    fieldWhitelist: { promptVariables: ['input'] },
  };

  it('does not render history section when undefined', () => {
    const { user } = buildAnalyzeConfusionMessages(baseArgs);
    expect(user).not.toContain('## 历史优化轨迹');
  });

  it('renders history section when provided', () => {
    const { user } = buildAnalyzeConfusionMessages({ ...baseArgs, roundHistory: baseHistory });
    expect(user).toContain('## 历史优化轨迹');
    expect(user).toContain('第 2 轮');
  });
});

describe('buildAnalyzeRegressionMessages with roundHistory', () => {
  const group: RegressionGroup = {
    predicted: 'A',
    count: 3,
    samples: [baseSample],
  };
  const baseArgs = {
    group,
    currentVersion: {
      id: 'v',
      promptId: 'p',
      versionNumber: 1,
      body: 'task: {{input}}',
    },
    previousVersion: null,
    metrics: { overall: { accuracy: 0.5 } },
    goals,
    fieldWhitelist: { promptVariables: ['input'] },
  };

  it('does not render history section when undefined', () => {
    const { user } = buildAnalyzeRegressionMessages(baseArgs);
    expect(user).not.toContain('## 历史优化轨迹');
  });

  it('renders history section when provided', () => {
    const { user } = buildAnalyzeRegressionMessages({ ...baseArgs, roundHistory: baseHistory });
    expect(user).toContain('## 历史优化轨迹');
  });
});

describe('buildSummarizeMessages with roundHistory', () => {
  const baseArgs = {
    goals,
    metrics: { overall: { accuracy: 0.5 } },
    collectedBatches: [
      { source: 'confusion' as const, title: 'A→B', payload: { errorPatterns: [], suggestedChanges: [] } },
    ],
  };

  it('does not render history section when undefined', () => {
    const { user } = buildSummarizeMessages(baseArgs);
    expect(user).not.toContain('## 历史优化轨迹');
  });

  it('renders history section when provided', () => {
    const { user } = buildSummarizeMessages({ ...baseArgs, roundHistory: baseHistory });
    expect(user).toContain('## 历史优化轨迹');
  });
});
