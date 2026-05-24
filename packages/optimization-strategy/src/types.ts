import type { z } from 'zod';

export type ProjectType = 'classification' | 'generative' | 'agent';

export interface OptimizationStrategy {
  key: string;
  displayName: string;
  description: string;
  projectTypes: ProjectType[];
  configSchema: z.ZodSchema;
  // TODO: analyze + generateNextVersion 详见 docs/specs/07-code-structure.md §12.2
}
