import { z } from 'zod';
import { datasetCreateResponseSchema, datasetFieldMappingSchema } from './dataset.dto';

export const datasetImportSourceFormatSchema = z.enum(['jsonl', 'csv', 'tsv']);
export type DatasetImportSourceFormat = z.infer<typeof datasetImportSourceFormatSchema>;

export const datasetImportStatusSchema = z.enum(['importing', 'ready']);
export type DatasetImportStatus = z.infer<typeof datasetImportStatusSchema>;

export const datasetImportSourceFileSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  fileSizeBytes: z.number().int().nonnegative(),
  contentType: z.string().trim().max(120).optional(),
});
export type DatasetImportSourceFileDto = z.infer<typeof datasetImportSourceFileSchema>;

export const createDatasetImportSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional().nullable(),
    fieldMappings: z.array(datasetFieldMappingSchema).min(1).max(200),
    sourceFile: datasetImportSourceFileSchema,
    sourceFormat: datasetImportSourceFormatSchema,
    declaredTotalRows: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    const expectedFields = value.fieldMappings.filter((field) => field.role === 'expected');
    if (expectedFields.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['fieldMappings'], message: 'dataset_expected_field_unique' });
    }
  });
export type CreateDatasetImportDto = z.infer<typeof createDatasetImportSchema>;

// One streamed batch. samples 上限沿用同步路径的每请求兜底；导入总量不设上限。
export const datasetImportBatchSchema = z.object({
  batchStartIndex: z.number().int().nonnegative(),
  samples: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});
export type DatasetImportBatchDto = z.infer<typeof datasetImportBatchSchema>;

export const datasetImportItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  datasetId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  sourceFormat: datasetImportSourceFormatSchema,
  declaredTotalRows: z.number().int().nonnegative().nullable(),
  receivedRows: z.number().int().nonnegative(),
  status: datasetImportStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DatasetImportItemDto = z.infer<typeof datasetImportItemSchema>;

export const datasetImportBatchResponseSchema = z.object({
  importId: z.string().uuid(),
  receivedRows: z.number().int().nonnegative(),
});
export type DatasetImportBatchResponseDto = z.infer<typeof datasetImportBatchResponseSchema>;

export const completeDatasetImportResponseSchema = datasetCreateResponseSchema;
export type CompleteDatasetImportResponseDto = z.infer<typeof completeDatasetImportResponseSchema>;
