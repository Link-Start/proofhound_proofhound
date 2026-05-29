import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  DatasetImportBatchDto,
  DatasetImportBatchResponseDto,
  DatasetImportItemDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const datasetImportClient = {
  getDatasetImport: (projectId: string, importId: string) =>
    httpClient.get<DatasetImportItemDto>(`/dataset-imports/${importId}`).then((r) => r.data),
  createDatasetImport: (projectId: string, body: CreateDatasetImportDto) =>
    httpClient.post<DatasetImportItemDto>(`/dataset-imports`, body).then((r) => r.data),
  appendDatasetImportBatch: (projectId: string, importId: string, body: DatasetImportBatchDto) =>
    httpClient
      .post<DatasetImportBatchResponseDto>(`/dataset-imports/${importId}/batch`, body)
      .then((r) => r.data),
  completeDatasetImport: (projectId: string, importId: string) =>
    httpClient
      .post<CompleteDatasetImportResponseDto>(`/dataset-imports/${importId}/complete`, {})
      .then((r) => r.data),
  abortDatasetImport: (projectId: string, importId: string) =>
    httpClient.post<void>(`/dataset-imports/${importId}/abort`, {}).then(() => undefined),
};

export type DatasetImportClient = typeof datasetImportClient;
