import { describe, expect, it } from 'vitest';
import type { DatasetFieldSchemaDto } from './dataset.dto';
import { deriveDatasetModalities } from './dataset-modality';

function fields(...defs: Array<Partial<DatasetFieldSchemaDto> & { role: DatasetFieldSchemaDto['role'] }>): DatasetFieldSchemaDto[] {
  return defs.map((def, idx) => ({ name: def.name ?? `f${idx}`, type: def.type ?? 'string', role: def.role }));
}

describe('deriveDatasetModalities', () => {
  it('returns ["text"] when only text role is present', () => {
    expect(deriveDatasetModalities(fields({ role: 'text' }))).toEqual(['text']);
  });

  it('returns ["image"] when only image role is present', () => {
    expect(deriveDatasetModalities(fields({ role: 'image' }))).toEqual(['image']);
  });

  it('returns ["text","image"] when both modalities are present', () => {
    expect(deriveDatasetModalities(fields({ role: 'text' }, { role: 'image' }))).toEqual(['text', 'image']);
  });

  it('falls back to ["text"] when fieldSchema is empty', () => {
    expect(deriveDatasetModalities([])).toEqual(['text']);
  });

  it('falls back to ["text"] when only metadata/expected_output roles are present', () => {
    expect(
      deriveDatasetModalities(fields({ role: 'metadata' }, { role: 'expected_output' })),
    ).toEqual(['text']);
  });

  it('recognises image_url and image_base64 as image modality', () => {
    expect(deriveDatasetModalities(fields({ role: 'image_url' }))).toEqual(['image']);
    expect(deriveDatasetModalities(fields({ role: 'image_base64' }))).toEqual(['image']);
  });

  it('keeps modality order text-before-image regardless of input order', () => {
    expect(deriveDatasetModalities(fields({ role: 'image' }, { role: 'text' }))).toEqual([
      'text',
      'image',
    ]);
  });
});
