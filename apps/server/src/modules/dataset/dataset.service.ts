import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateDatasetDto,
  DatasetCategoryDistributionDto,
  DatasetCreateResponseDto,
  DatasetExportFormatDto,
  DatasetFieldMappingDto,
  DatasetFieldSchemaDto,
  DatasetFieldSchemaRole,
  DatasetListItemDto,
  DatasetReferencesDto,
  DatasetSampleDto,
  DatasetSamplesListResponseDto,
  DeleteDatasetSamplesDto,
  DeleteDatasetSamplesResponseDto,
  UpdateDatasetMetadataDto,
} from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { accessControl } from '../../common/access-control';
import {
  DatasetRepository,
  type DatasetProjectAccessRow,
  type DatasetRow,
  type DatasetSampleRow,
} from './dataset.repository';

export interface DatasetExportFile {
  fileName: string;
  contentType: string;
  byteLength: number;
  buffer: Buffer;
  format: DatasetExportFormatDto;
}

@Injectable()
export class DatasetService {
  constructor(private readonly repo: DatasetRepository) {}

  async listDatasets(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: DatasetListItemDto[]; total: number }> {
    await this.getAccessibleProject(projectId, actor);

    const rows = await this.repo.listDatasets(projectId);
    const distributions = await this.getCategoryDistributions(rows);
    const references = await this.repo.countDatasetReferences(rows.map((row) => row.id));
    const data = rows.map((row) =>
      this.toDatasetListItem(row, distributions.get(row.id), references.get(row.id) ?? this.emptyReferences()),
    );
    return { data, total: data.length };
  }

  async getDataset(projectId: string, datasetId: string, actor: CurrentUserPayload): Promise<DatasetListItemDto> {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    const distribution = await this.getCategoryDistribution(row);
    const references = await this.repo.countDatasetReferences([row.id]);
    return this.toDatasetListItem(row, distribution, references.get(row.id) ?? this.emptyReferences());
  }

  async listDatasetSamples(
    projectId: string,
    datasetId: string,
    actor: CurrentUserPayload,
  ): Promise<DatasetSamplesListResponseDto> {
    await this.getDataset(projectId, datasetId, actor);

    const rows = await this.repo.listDatasetSamples(datasetId);
    const data = rows.map((row) => this.toDatasetSample(row));
    return { data, total: data.length };
  }

  async exportDataset(
    projectId: string,
    datasetId: string,
    format: DatasetExportFormatDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetExportFile> {
    const dataset = await this.getDataset(projectId, datasetId, actor);
    const rows = await this.repo.listDatasetSamples(datasetId);
    const samples = rows.map((row) => this.toDatasetSample(row));
    const content = format === 'csv' ? this.toCsv(dataset, samples) : this.toJsonl(samples);
    const buffer = Buffer.from(content, 'utf8');

    return {
      buffer,
      byteLength: buffer.byteLength,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      fileName: this.getExportFileName(dataset.name, format),
      format,
    };
  }

  async createDataset(
    projectId: string,
    dto: CreateDatasetDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetCreateResponseDto> {
    await this.getWritableProject(projectId, actor);
    this.assertConsistentMappings(dto);

    const existing = await this.repo.findDatasetByProjectAndName(projectId, dto.name);
    if (existing) {
      throw new ConflictException('dataset_name_taken');
    }

    const datasetId = randomUUID();
    const fieldSchema = this.buildFieldSchema(dto.fieldMappings, dto.samples);
    const externalIdFieldName = dto.fieldMappings.find((field) => field.role === 'id')?.name ?? null;
    const hasImages = fieldSchema.some((field) => ['image', 'image_url', 'image_base64'].includes(field.role));
    const storagePrefix = `datasets/${projectId}/raw/${datasetId}/${dto.uploadSource.fileName}`;

    const row = await this.repo.createDatasetWithSamples({
      datasetId,
      projectId,
      actorUserId: actor.sub,
      dto,
      fieldSchema,
      hasImages,
      storagePrefix,
      externalIdFieldName,
    });

    return {
      dataset: this.toDatasetListItem(
        row,
        this.buildCategoryDistribution(
          fieldSchema,
          dto.samples.map((sample) => ({ data: sample })),
        ),
        this.emptyReferences(),
      ),
      sampleCount: dto.samples.length,
    };
  }

  async deleteDatasetSamples(
    projectId: string,
    datasetId: string,
    dto: DeleteDatasetSamplesDto,
    actor: CurrentUserPayload,
  ): Promise<DeleteDatasetSamplesResponseDto> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    const referencesMap = await this.repo.countDatasetReferences([datasetId]);
    const references = referencesMap.get(datasetId) ?? this.emptyReferences();
    if (references.experiments + references.optimizations > 0) {
      throw new ConflictException('dataset_samples_referenced');
    }

    const deleted = await this.repo.hardDeleteSamples(datasetId, dto.sampleIds);
    if (deleted > 0) {
      await this.repo.decrementDatasetSampleCount(datasetId, deleted);
    }

    return { deleted };
  }

  async updateDatasetMetadata(
    projectId: string,
    datasetId: string,
    dto: UpdateDatasetMetadataDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetListItemDto> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    if (dto.name !== row.name) {
      const existing = await this.repo.findDatasetByProjectAndName(projectId, dto.name);
      if (existing && existing.id !== datasetId) {
        throw new ConflictException('dataset_name_taken');
      }
    }

    const updated = await this.repo.updateDatasetMetadata(projectId, datasetId, {
      name: dto.name,
      description: dto.description === undefined ? row.description : dto.description?.trim() || null,
    });
    if (!updated) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    const distribution = await this.getCategoryDistribution(updated);
    const references = await this.repo.countDatasetReferences([datasetId]);
    return this.toDatasetListItem(updated, distribution, references.get(datasetId) ?? this.emptyReferences());
  }

  async deleteDataset(projectId: string, datasetId: string, actor: CurrentUserPayload): Promise<void> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    const referencesMap = await this.repo.countDatasetReferences([datasetId]);
    const references = referencesMap.get(datasetId) ?? this.emptyReferences();
    if (references.experiments > 0 || references.optimizations > 0) {
      throw new ConflictException('dataset_referenced');
    }

    const deleted = await this.repo.hardDeleteDataset(projectId, datasetId);
    if (deleted === 0) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }
  }

  private async getAccessibleProject(projectId: string, actor: CurrentUserPayload): Promise<DatasetProjectAccessRow> {
    accessControl.assertCan(actor, 'project_read', { projectId });
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload): Promise<DatasetProjectAccessRow> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    return this.getAccessibleProject(projectId, actor);
  }

  private assertConsistentMappings(dto: CreateDatasetDto) {
    const expectedFieldCount = dto.fieldMappings.filter((field) => field.role === 'expected').length;
    if (expectedFieldCount > 1) {
      throw new ConflictException('dataset_expected_field_unique');
    }

    const mappingNames = dto.fieldMappings.map((field) => field.name);
    const uniqueNames = new Set(mappingNames);
    if (uniqueNames.size !== mappingNames.length) {
      throw new ConflictException('dataset_field_mapping_duplicate');
    }

    const firstSample = dto.samples[0] ?? {};
    const missingFields = mappingNames.filter((name) => !(name in firstSample));
    if (missingFields.length > 0) {
      throw new ConflictException(`dataset_field_mapping_missing:${missingFields.join(',')}`);
    }
  }

  private buildFieldSchema(
    mappings: DatasetFieldMappingDto[],
    samples: Array<Record<string, unknown>>,
  ): DatasetFieldSchemaDto[] {
    return mappings.map((field) => ({
      name: field.name,
      role: this.toSchemaRole(field, samples),
      type: this.inferFieldType(field.name, samples),
    }));
  }

  private toSchemaRole(field: DatasetFieldMappingDto, samples: Array<Record<string, unknown>>): DatasetFieldSchemaRole {
    if (field.role === 'expected') return 'expected_output';
    if (field.role === 'id') return 'metadata';
    if (field.role !== 'image') return field.role;

    const firstValue = samples.map((sample) => this.firstImageReference(sample[field.name])).find(Boolean);
    if (!firstValue) return 'image';
    if (/^https?:\/\//iu.test(firstValue)) return 'image_url';
    if (/^data:image\//iu.test(firstValue)) return 'image_base64';
    return 'image';
  }

  private firstImageReference(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (trimmed.length > 0) return trimmed;
      }
    }

    return null;
  }

  private inferFieldType(fieldName: string, samples: Array<Record<string, unknown>>): DatasetFieldSchemaDto['type'] {
    const value = samples.map((sample) => sample[fieldName]).find((item) => item !== undefined);
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'object') return type;
    return 'unknown';
  }

  private toDatasetListItem(
    row: DatasetRow,
    categoryDistribution = this.buildCategoryDistribution(this.toFieldSchema(row.fieldSchema), []),
    references: DatasetReferencesDto = this.emptyReferences(),
  ): DatasetListItemDto {
    const fieldSchema = this.toFieldSchema(row.fieldSchema);

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      sampleCount: row.sampleCount,
      fieldSchema,
      categoryDistribution,
      references,
      hasImages: row.hasImages,
      storagePrefix: row.storagePrefix,
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private emptyReferences(): DatasetReferencesDto {
    return { experiments: 0, optimizations: 0 };
  }

  private async getCategoryDistributions(rows: DatasetRow[]) {
    const rowsWithExpectedOutput = rows.filter((row) =>
      this.getExpectedOutputField(this.toFieldSchema(row.fieldSchema)),
    );
    const samples = await this.repo.listDatasetSampleDataByDatasetIds(rowsWithExpectedOutput.map((row) => row.id));
    const samplesByDatasetId = new Map<string, Array<{ data: unknown }>>();

    for (const sample of samples) {
      const datasetSamples = samplesByDatasetId.get(sample.datasetId) ?? [];
      datasetSamples.push({ data: sample.data });
      samplesByDatasetId.set(sample.datasetId, datasetSamples);
    }

    return new Map(
      rows.map((row) => [
        row.id,
        this.buildCategoryDistribution(this.toFieldSchema(row.fieldSchema), samplesByDatasetId.get(row.id) ?? []),
      ]),
    );
  }

  private async getCategoryDistribution(row: DatasetRow) {
    const fieldSchema = this.toFieldSchema(row.fieldSchema);
    if (!this.getExpectedOutputField(fieldSchema)) return this.buildCategoryDistribution(fieldSchema, []);

    const samples = await this.repo.listDatasetSampleDataByDatasetIds([row.id]);
    return this.buildCategoryDistribution(fieldSchema, samples);
  }

  private buildCategoryDistribution(
    fieldSchema: DatasetFieldSchemaDto[],
    samples: Array<{ data: unknown }>,
  ): DatasetCategoryDistributionDto {
    const expectedOutputField = this.getExpectedOutputField(fieldSchema);
    if (!expectedOutputField) {
      return { field: null, total: 0, categories: [] };
    }

    const counts = new Map<string, number>();
    for (const sample of samples) {
      const data = this.toRecord(sample.data);
      const label = this.toCategoryLabel(data[expectedOutputField.name]);
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const categories = [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

    return {
      field: expectedOutputField.name,
      total: categories.reduce((sum, category) => sum + category.count, 0),
      categories,
    };
  }

  private getExpectedOutputField(fieldSchema: DatasetFieldSchemaDto[]) {
    return fieldSchema.find((field) => field.role === 'expected_output') ?? null;
  }

  private toFieldSchema(value: unknown): DatasetFieldSchemaDto[] {
    return Array.isArray(value) ? (value as DatasetFieldSchemaDto[]) : [];
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toCategoryLabel(value: unknown) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      const label = value.trim();
      return label.length > 0 ? label : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  }

  private toDatasetSample(row: DatasetSampleRow): DatasetSampleDto {
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};

    return {
      id: row.id,
      datasetId: row.datasetId,
      data,
      externalId: row.externalId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCsv(dataset: DatasetListItemDto, samples: DatasetSampleDto[]) {
    const columns = this.getExportColumns(dataset, samples);
    const rows = samples.map((sample) => columns.map((column) => this.toCsvCell(sample.data[column])).join(','));
    return `\uFEFF${[columns.map((column) => this.toCsvCell(column)).join(','), ...rows].join('\n')}\n`;
  }

  private toJsonl(samples: DatasetSampleDto[]) {
    return `${samples.map((sample) => JSON.stringify(sample.data)).join('\n')}\n`;
  }

  private getExportColumns(dataset: DatasetListItemDto, samples: DatasetSampleDto[]) {
    const columns = dataset.fieldSchema.map((field) => field.name);
    const known = new Set(columns);

    for (const sample of samples) {
      for (const fieldName of Object.keys(sample.data)) {
        if (known.has(fieldName)) continue;
        known.add(fieldName);
        columns.push(fieldName);
      }
    }

    return columns;
  }

  private toCsvCell(value: unknown) {
    const text =
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? (JSON.stringify(value) ?? '')
          : String(value);

    if (!/[",\n\r]/u.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  private getExportFileName(datasetName: string, format: DatasetExportFormatDto) {
    const safeName =
      datasetName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || 'dataset';

    return `${safeName}.${format}`;
  }
}
