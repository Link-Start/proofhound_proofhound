import { z } from 'zod';

export const datasetRawImportJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  importId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  requestId: z.string().optional(),
});

export type DatasetRawImportJobPayload = z.infer<typeof datasetRawImportJobPayloadSchema>;
