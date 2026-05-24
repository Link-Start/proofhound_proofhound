import { z } from 'zod';

export const probeJobPayloadSchema = z.object({
  modelId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type ProbeJobPayload = z.infer<typeof probeJobPayloadSchema>;
