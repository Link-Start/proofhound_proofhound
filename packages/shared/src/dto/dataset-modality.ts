import { z } from 'zod';
import type { DatasetFieldSchemaDto } from './dataset.dto';

export const datasetModalitySchema = z.enum(['text', 'image']);
export type DatasetModalityDto = z.infer<typeof datasetModalitySchema>;

export function deriveDatasetModalities(fieldSchema: DatasetFieldSchemaDto[]): DatasetModalityDto[] {
  const hasText = fieldSchema.some((field) => field.role === 'text');
  const hasImage = fieldSchema.some((field) =>
    field.role === 'image' || field.role === 'image_url' || field.role === 'image_base64',
  );
  const modalities: DatasetModalityDto[] = [];
  if (hasText) modalities.push('text');
  if (hasImage) modalities.push('image');
  return modalities.length === 0 ? ['text'] : modalities;
}
