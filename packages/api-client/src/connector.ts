import type {
  BulkDeleteConnectorsRequestDto,
  BulkDeleteConnectorsResponseDto,
  ConnectorCreateResponseDto,
  ConnectorDetailDto,
  ConnectorListItemDto,
  ConnectorListQueryDto,
  ConnectorListResponseDto,
  ConnectorReferencesResponseDto,
  ConnectorWebhookTokenListDto,
  CreateConnectorDto,
  CreateWebhookTokenDto,
  CreateWebhookTokenResponseDto,
  PeekConnectorRequestDto,
  PeekConnectorResponseDto,
  ProbeConnectorResponseDto,
  RevealWebhookTokenResponseDto,
  UpdateConnectorDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export interface ConnectorDeleteOptions {
  force?: boolean;
  reason?: string;
}

function buildDeleteParams(options?: ConnectorDeleteOptions): Record<string, string> | undefined {
  if (!options) return undefined;
  const params: Record<string, string> = {};
  if (options.force) params.force = 'true';
  if (options.reason) params.reason = options.reason;
  return Object.keys(params).length > 0 ? params : undefined;
}

function buildListParams(query?: ConnectorListQueryDto): Record<string, string> | undefined {
  if (!query) return undefined;
  const params: Record<string, string> = {};
  if (query.direction) params.direction = query.direction;
  if (query.type) params.type = query.type;
  if (query.healthStatus) params.healthStatus = query.healthStatus;
  if (query.search) params.search = query.search;
  return Object.keys(params).length > 0 ? params : undefined;
}

export const connectorClient = {
  list: (projectId: string, query?: ConnectorListQueryDto) =>
    httpClient
      .get<ConnectorListResponseDto>(`/connectors`, { params: buildListParams(query) })
      .then((r) => r.data),

  get: (projectId: string, connectorId: string) =>
    httpClient
      .get<ConnectorDetailDto>(`/connectors/${connectorId}`)
      .then((r) => r.data),

  getReferences: (projectId: string, connectorId: string) =>
    httpClient
      .get<ConnectorReferencesResponseDto>(`/connectors/${connectorId}/references`)
      .then((r) => r.data),

  create: (projectId: string, body: CreateConnectorDto) =>
    httpClient.post<ConnectorCreateResponseDto>(`/connectors`, body).then((r) => r.data),

  update: (projectId: string, connectorId: string, body: UpdateConnectorDto) =>
    httpClient
      .patch<ConnectorDetailDto>(`/connectors/${connectorId}`, body)
      .then((r) => r.data),

  delete: (projectId: string, connectorId: string, options?: ConnectorDeleteOptions) =>
    httpClient
      .delete<void>(`/connectors/${connectorId}`, { params: buildDeleteParams(options) })
      .then(() => undefined),

  bulkDelete: (projectId: string, body: BulkDeleteConnectorsRequestDto) =>
    httpClient
      .post<BulkDeleteConnectorsResponseDto>(`/connectors/bulk-delete`, body)
      .then((r) => r.data),

  probe: (projectId: string, connectorId: string) =>
    httpClient
      .post<ProbeConnectorResponseDto>(`/connectors/${connectorId}/probe`)
      .then((r) => r.data),

  peek: (projectId: string, connectorId: string, body: PeekConnectorRequestDto) =>
    httpClient
      .post<PeekConnectorResponseDto>(`/connectors/${connectorId}/peek`, body)
      .then((r) => r.data),

  // per-connector webhook tokens (scope='webhook', AND connector_id=...)
  // 详见 docs/specs/26-connectors.md / docs/specs/06-database-schema.md §3.2
  listWebhookTokens: (projectId: string, connectorId: string) =>
    httpClient
      .get<ConnectorWebhookTokenListDto>(`/connectors/${connectorId}/webhook-tokens`)
      .then((r) => r.data),

  createWebhookToken: (projectId: string, connectorId: string, body: CreateWebhookTokenDto) =>
    httpClient
      .post<CreateWebhookTokenResponseDto>(`/connectors/${connectorId}/webhook-tokens`, body)
      .then((r) => r.data),

  revokeWebhookToken: (projectId: string, connectorId: string, tokenId: string) =>
    httpClient
      .delete<void>(`/connectors/${connectorId}/webhook-tokens/${tokenId}`)
      .then(() => undefined),

  revealWebhookToken: (projectId: string, connectorId: string, tokenId: string) =>
    httpClient
      .get<RevealWebhookTokenResponseDto>(`/connectors/${connectorId}/webhook-tokens/${tokenId}/plaintext`)
      .then((r) => r.data),
};

export type ConnectorListItem = ConnectorListItemDto;
