import type {
  CreateExperimentDto,
  ExperimentControlActionDto,
  ExperimentExportFormatDto,
  ExperimentListQueryDto,
  ExperimentListResponseDto,
  ExperimentListItemDto,
} from '@proofhound/shared';
import type { AxiosProgressEvent } from 'axios';
import { httpClient } from './http';

export interface ExperimentTransferProgress {
  loadedBytes: number;
  totalBytes: number | null;
}

export interface ExperimentTransferOptions {
  onProgress?: (progress: ExperimentTransferProgress) => void;
}

export interface ExperimentDownloadResult {
  blob: Blob;
  fileName: string;
  contentType: string;
}

function toTransferProgress(event: AxiosProgressEvent): ExperimentTransferProgress {
  return {
    loadedBytes: event.loaded,
    totalBytes: typeof event.total === 'number' && Number.isFinite(event.total) ? event.total : null,
  };
}

function getFileNameFromDisposition(disposition: string | undefined, fallback: string) {
  if (!disposition) return fallback;

  const utf8Match = /filename\*=UTF-8''([^;]+)/iu.exec(disposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = /filename="?([^";]+)"?/iu.exec(disposition);
  return asciiMatch?.[1] ?? fallback;
}

function toDownloadResult(
  blob: Blob,
  headers: Record<string, unknown>,
  fallbackFileName: string,
): ExperimentDownloadResult {
  const contentTypeHeader = headers['content-type'];
  const dispositionHeader = headers['content-disposition'];
  const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : 'application/octet-stream';

  return {
    blob,
    contentType,
    fileName: getFileNameFromDisposition(
      typeof dispositionHeader === 'string' ? dispositionHeader : undefined,
      fallbackFileName,
    ),
  };
}

export const experimentClient = {
  createExperiment: (projectId: string, dto: CreateExperimentDto) =>
    httpClient.post<ExperimentListItemDto>(`/experiments`, dto).then((r) => r.data),
  listExperiments: (projectId: string, query?: ExperimentListQueryDto) =>
    httpClient
      .get<ExperimentListResponseDto>(`/experiments`, { params: query })
      .then((r) => r.data),
  getExperiment: (projectId: string, experimentId: string) =>
    httpClient.get<ExperimentListItemDto>(`/experiments/${experimentId}`).then((r) => r.data),
  controlExperiment: (projectId: string, experimentId: string, action: ExperimentControlActionDto) =>
    httpClient
      .post<ExperimentListItemDto>(`/experiments/${experimentId}/actions/${action}`)
      .then((r) => r.data),
  downloadExperiments: (projectId: string, format: ExperimentExportFormatDto, options?: ExperimentTransferOptions) =>
    httpClient
      .get<Blob>(`/experiments/export`, {
        params: { format },
        responseType: 'blob',
        onDownloadProgress: options?.onProgress
          ? (event) => options.onProgress?.(toTransferProgress(event))
          : undefined,
      })
      .then((r) => toDownloadResult(r.data, r.headers, `experiments-${projectId}.${format}`)),
  downloadExperiment: (
    projectId: string,
    experimentId: string,
    format: ExperimentExportFormatDto,
    options?: ExperimentTransferOptions,
  ) =>
    httpClient
      .get<Blob>(`/experiments/${experimentId}/export`, {
        params: { format },
        responseType: 'blob',
        onDownloadProgress: options?.onProgress
          ? (event) => options.onProgress?.(toTransferProgress(event))
          : undefined,
      })
      .then((r) => toDownloadResult(r.data, r.headers, `experiment-${experimentId}.${format}`)),
  deleteExperiment: (projectId: string, experimentId: string) =>
    httpClient.delete<void>(`/experiments/${experimentId}`).then(() => undefined),
};
