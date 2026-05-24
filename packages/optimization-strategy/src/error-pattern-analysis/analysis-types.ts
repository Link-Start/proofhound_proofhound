export interface AnalysisPattern {
  patternId?: string;
  source?: 'confusion' | 'regression';
  bucketKey?: string;
  affectedCount?: number;
  label: string;
  count: number;
  reason: string;
  exampleSampleIds: string[];
}

export interface SuggestedChange {
  changeId?: string;
  section: string;
  change: string;
  rationale: string;
  addressesPatternIds?: string[];
  evidenceSampleIds?: string[];
  affectedCount?: number;
  priority?: 'high' | 'medium' | 'low';
  conflictGroup?: string;
  resolutionReason?: string;
}

export interface SummarizeConflict {
  conflictGroup: string;
  patternIds: string[];
  changeIds: string[];
  resolution: string;
  reason: string;
}

export interface AnalysisEvidenceBundle {
  evidenceBundleVersion: 1;
  summary: string;
  errorPatterns: Array<AnalysisPattern & { source?: 'confusion' | 'regression' }>;
  suggestedChanges: SuggestedChange[];
  conflicts: SummarizeConflict[];
  sourceStats: {
    batchCount: number;
    totalConfusionFailures: number;
    totalRegressionSamples: number;
    truncated: boolean;
  };
}
