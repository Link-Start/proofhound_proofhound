import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  CreateRawDatasetImportDto,
  CreateRawDatasetImportResponseDto,
  DatasetImportBatchDto,
  DatasetImportBatchResponseDto,
  DatasetImportItemDto,
  DatasetImportStatusDto,
  DatasetRawImportCapabilitiesDto,
  DatasetRawUploadSessionDto,
} from '@proofhound/shared';
import type { DatasetTransferProgress } from './dataset';
import { httpClient } from './http';
import { getServerBaseUrl } from './public-env';

export interface DatasetRawUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DatasetTransferProgress) => void;
}

function uploadRawDatasetFileWithXhr(
  uploadSession: DatasetRawUploadSessionDto,
  file: Blob,
  options?: DatasetRawUploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      options?.signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      xhr.abort();
      settle(() => reject(new DOMException('aborted', 'AbortError')));
    };

    xhr.upload.onprogress = (event) => {
      options?.onProgress?.({
        loadedBytes: event.loaded,
        totalBytes: event.lengthComputable ? event.total : file.size || null,
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options?.onProgress?.({ loadedBytes: file.size, totalBytes: file.size });
        settle(() => resolve());
        return;
      }
      settle(() => reject(new Error(`dataset_raw_upload_failed:${xhr.status}`)));
    };
    xhr.onerror = () => {
      settle(() => reject(new Error('dataset_raw_upload_failed:network')));
    };

    if (options?.signal?.aborted) {
      onAbort();
      return;
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.open('PUT', uploadSession.url, true);
    for (const [name, value] of Object.entries(uploadSession.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(file);
  });
}

export const datasetImportClient = {
  getDatasetImport: (projectId: string, importId: string) =>
    httpClient.get<DatasetImportStatusDto>(`/dataset-imports/${importId}`).then((r) => r.data),
  getRawImportCapabilities: (_projectId: string) =>
    httpClient.get<DatasetRawImportCapabilitiesDto>(`/dataset-imports/raw/capabilities`).then((r) => r.data),
  createDatasetImport: (projectId: string, body: CreateDatasetImportDto) =>
    httpClient.post<DatasetImportItemDto>(`/dataset-imports`, body).then((r) => r.data),
  createRawDatasetImport: (projectId: string, body: CreateRawDatasetImportDto) =>
    httpClient.post<CreateRawDatasetImportResponseDto>(`/dataset-imports/raw`, body).then((r) => r.data),
  uploadRawDatasetFile: async (
    uploadSession: DatasetRawUploadSessionDto,
    file: Blob,
    options?: DatasetRawUploadOptions,
  ) => {
    if (typeof XMLHttpRequest !== 'undefined') {
      return uploadRawDatasetFileWithXhr(uploadSession, file, options);
    }

    const response = await fetch(uploadSession.url, {
      method: 'PUT',
      headers: uploadSession.headers,
      body: file,
      signal: options?.signal,
    });
    if (!response.ok) {
      throw new Error(`dataset_raw_upload_failed:${response.status}`);
    }
    options?.onProgress?.({ loadedBytes: file.size, totalBytes: file.size });
  },
  appendDatasetImportBatch: (projectId: string, importId: string, body: DatasetImportBatchDto) =>
    httpClient.post<DatasetImportBatchResponseDto>(`/dataset-imports/${importId}/batch`, body).then((r) => r.data),
  completeRawDatasetUpload: (projectId: string, importId: string) =>
    httpClient.post<DatasetImportStatusDto>(`/dataset-imports/${importId}/upload-complete`, {}).then((r) => r.data),
  completeDatasetImport: (projectId: string, importId: string) =>
    httpClient.post<CompleteDatasetImportResponseDto>(`/dataset-imports/${importId}/complete`, {}).then((r) => r.data),
  abortDatasetImport: (projectId: string, importId: string) =>
    httpClient.post<void>(`/dataset-imports/${importId}/abort`, {}).then(() => undefined),
  // Fire-and-forget abort that survives page unload (tab close / refresh), where a normal fetch is
  // cancelled by the browser. Auth rides the same trusted-header / LOCAL_ACTOR path as other UI calls
  // (no JS-set Authorization header), so carrying no header is fine. Returns false when unsupported.
  abortDatasetImportBeacon: (projectId: string, importId: string): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    return navigator.sendBeacon(`${getServerBaseUrl()}/dataset-imports/${importId}/abort`);
  },
};

export type DatasetImportClient = typeof datasetImportClient;
