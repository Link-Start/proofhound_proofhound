'use client';

import type {
  ApiTokenSummaryDto,
  CreateApiTokenResponseDto,
  CreateGlobalMcpTokenResponseDto,
  GlobalMcpTokenSummaryDto,
} from '@proofhound/shared';
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlatformLoader } from '@/components/ui/platform-loader';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  type TableColumn,
} from '@/components/ui/table';
import { TableActionIconButton } from '@/components/ui/table-action';
import { Main } from '@/components/layout/main';
import {
  useApiTokens,
  useCreateApiToken,
  useCreateGlobalMcpToken,
  useDeleteApiToken,
  useDeleteGlobalMcpToken,
  useGlobalMcpToken,
  useRevealApiToken,
  useRevealGlobalMcpToken,
  useUpdateApiToken,
  useUpdateGlobalMcpToken,
} from '@/hooks/api-token';
import { useI18n } from '@/i18n';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type TokenExpiryPreset = 'never' | '7d' | '30d' | '90d' | 'custom';
type TokenKind = 'api' | 'mcp';

interface TokenCreateState {
  open: boolean;
  name: string;
  expiryPreset: TokenExpiryPreset;
  customExpiresAt: string;
  ipWhitelistRaw: string;
}

interface TokenEditState {
  open: boolean;
  tokenId: string;
  name: string;
  expiryPreset: TokenExpiryPreset;
  customExpiresAt: string;
}

const EMPTY_CREATE_STATE: TokenCreateState = {
  open: false,
  name: '',
  expiryPreset: 'never',
  customExpiresAt: '',
  ipWhitelistRaw: '',
};

const EMPTY_EDIT_STATE: TokenEditState = {
  open: false,
  tokenId: '',
  name: '',
  expiryPreset: 'never',
  customExpiresAt: '',
};

const API_TOKEN_COLUMNS: TableColumn[] = [
  { key: 'name', width: 'flex', minPx: 140, sticky: 'left' },
  { key: 'token', width: 'flex', minPx: 240 },
  { key: 'ipWhitelist', width: 'compact' },
  { key: 'lastUsedAt', width: 'compact' },
  { key: 'expiresAt', width: 'compact' },
  { key: 'createdAt', width: 'compact' },
  { key: 'actions', width: 'compact', sticky: 'right' },
];

const MCP_TOKEN_COLUMNS: TableColumn[] = [
  { key: 'name', width: 'flex', minPx: 180, sticky: 'left' },
  { key: 'token', width: 'flex', minPx: 280 },
  { key: 'lastUsedAt', width: 'compact' },
  { key: 'expiresAt', width: 'compact' },
  { key: 'createdAt', width: 'compact' },
  { key: 'actions', width: 'compact', sticky: 'right' },
];

function resolveExpiresAt(
  state: Pick<TokenCreateState, 'expiryPreset' | 'customExpiresAt'>,
): string | null | undefined {
  if (state.expiryPreset === 'never') return null;
  if (state.expiryPreset === 'custom') {
    const date = new Date(state.customExpiresAt);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const days = state.expiryPreset === '7d' ? 7 : state.expiryPreset === '30d' ? 30 : 90;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function parseIpWhitelist(value: string): string[] | undefined {
  const entries = value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function toDatetimeLocalValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => part.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function createEditState(token: Pick<ApiTokenSummaryDto, 'id' | 'name' | 'expiresAt'>): TokenEditState {
  return {
    open: true,
    tokenId: token.id,
    name: token.name,
    expiryPreset: token.expiresAt ? 'custom' : 'never',
    customExpiresAt: toDatetimeLocalValue(token.expiresAt),
  };
}

function maskToken(prefix: string, plaintext?: string): string {
  const visiblePrefix = plaintext?.slice(0, 12) ?? prefix;
  return `${visiblePrefix}••••••`;
}

function mergeCreatedApiToken(
  rows: ApiTokenSummaryDto[],
  created: CreateApiTokenResponseDto | null,
): ApiTokenSummaryDto[] {
  if (!created) return rows;
  if (rows.some((row) => row.id === created.token.id)) return rows;
  return [created.token, ...rows];
}

function addSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  next.add(value);
  return next;
}

function deleteSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  next.delete(value);
  return next;
}

export function SettingsPage() {
  const { t } = useI18n();
  const apiTokensQuery = useApiTokens();
  const globalMcpTokenQuery = useGlobalMcpToken();
  const createApiToken = useCreateApiToken();
  const revealApiToken = useRevealApiToken();
  const updateApiToken = useUpdateApiToken();
  const deleteApiToken = useDeleteApiToken();
  const createGlobalMcpToken = useCreateGlobalMcpToken();
  const revealGlobalMcpToken = useRevealGlobalMcpToken();
  const updateGlobalMcpToken = useUpdateGlobalMcpToken();
  const deleteGlobalMcpToken = useDeleteGlobalMcpToken();

  const [apiCreate, setApiCreate] = useState<TokenCreateState>(EMPTY_CREATE_STATE);
  const [mcpCreate, setMcpCreate] = useState<TokenCreateState>(EMPTY_CREATE_STATE);
  const [apiEdit, setApiEdit] = useState<TokenEditState>(EMPTY_EDIT_STATE);
  const [mcpEdit, setMcpEdit] = useState<TokenEditState>(EMPTY_EDIT_STATE);
  const [apiDeleteTarget, setApiDeleteTarget] = useState<ApiTokenSummaryDto | null>(null);
  const [mcpDeleteTarget, setMcpDeleteTarget] = useState<GlobalMcpTokenSummaryDto | null>(null);
  const [createdApiToken, setCreatedApiToken] = useState<CreateApiTokenResponseDto | null>(null);
  const [createdMcpToken, setCreatedMcpToken] = useState<CreateGlobalMcpTokenResponseDto | null>(null);
  const [apiPlaintexts, setApiPlaintexts] = useState<Record<string, string>>({});
  const [mcpPlaintexts, setMcpPlaintexts] = useState<Record<string, string>>({});
  const [visibleApiTokenIds, setVisibleApiTokenIds] = useState<Set<string>>(() => new Set());
  const [visibleMcpTokenIds, setVisibleMcpTokenIds] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiRows = useMemo(
    () => mergeCreatedApiToken(apiTokensQuery.data?.data ?? [], createdApiToken),
    [apiTokensQuery.data?.data, createdApiToken],
  );
  const globalMcpToken = globalMcpTokenQuery.data?.token ?? createdMcpToken?.token ?? null;
  const mcpRows = globalMcpToken ? [globalMcpToken] : [];

  function showNotice(message: string) {
    setNotice(message);
    setError(null);
  }

  function showError(message: string) {
    setError(message);
    setNotice(null);
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showNotice(t('settings.notice.copied'));
    } catch {
      showError(t('settings.error.copyFailed'));
    }
  }

  async function submitCreateApiToken() {
    const expiresAt = resolveExpiresAt(apiCreate);
    if (expiresAt === undefined) {
      showError(t('settings.token.invalidExpiresAt'));
      return;
    }

    try {
      const result = await createApiToken.mutateAsync({
        name: apiCreate.name.trim(),
        ipWhitelist: parseIpWhitelist(apiCreate.ipWhitelistRaw),
        expiresAt,
      });
      setCreatedApiToken(result);
      setApiPlaintexts((prev) => ({ ...prev, [result.token.id]: result.plaintext }));
      setVisibleApiTokenIds((prev) => addSetValue(prev, result.token.id));
      setApiCreate(EMPTY_CREATE_STATE);
      showNotice(t('settings.apiToken.created'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.apiToken.createFailed'));
    }
  }

  async function submitCreateMcpToken() {
    const expiresAt = resolveExpiresAt(mcpCreate);
    if (expiresAt === undefined) {
      showError(t('settings.token.invalidExpiresAt'));
      return;
    }

    try {
      const result = await createGlobalMcpToken.mutateAsync({
        name: mcpCreate.name.trim(),
        expiresAt,
      });
      setCreatedMcpToken(result);
      setMcpPlaintexts((prev) => ({ ...prev, [result.token.id]: result.plaintext }));
      setVisibleMcpTokenIds((prev) => addSetValue(prev, result.token.id));
      setMcpCreate(EMPTY_CREATE_STATE);
      showNotice(t('settings.mcpToken.created'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.mcpToken.createFailed'));
    }
  }

  async function toggleApiTokenPlaintext(token: ApiTokenSummaryDto) {
    if (visibleApiTokenIds.has(token.id)) {
      setVisibleApiTokenIds((prev) => deleteSetValue(prev, token.id));
      return;
    }

    const cached = apiPlaintexts[token.id];
    if (cached) {
      setVisibleApiTokenIds((prev) => addSetValue(prev, token.id));
      return;
    }

    try {
      const result = await revealApiToken.mutateAsync(token.id);
      if (!result.available || !result.plaintext) {
        showError(t('settings.token.revealUnavailable'));
        return;
      }
      setApiPlaintexts((prev) => ({ ...prev, [token.id]: result.plaintext! }));
      setVisibleApiTokenIds((prev) => addSetValue(prev, token.id));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.apiToken.revealFailed'));
    }
  }

  async function toggleMcpTokenPlaintext(token: GlobalMcpTokenSummaryDto) {
    if (visibleMcpTokenIds.has(token.id)) {
      setVisibleMcpTokenIds((prev) => deleteSetValue(prev, token.id));
      return;
    }

    const cached = mcpPlaintexts[token.id];
    if (cached) {
      setVisibleMcpTokenIds((prev) => addSetValue(prev, token.id));
      return;
    }

    try {
      const result = await revealGlobalMcpToken.mutateAsync(token.id);
      if (!result.available || !result.plaintext) {
        showError(t('settings.token.revealUnavailable'));
        return;
      }
      setMcpPlaintexts((prev) => ({ ...prev, [token.id]: result.plaintext! }));
      setVisibleMcpTokenIds((prev) => addSetValue(prev, token.id));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.mcpToken.revealFailed'));
    }
  }

  async function submitUpdateApiToken() {
    const expiresAt = resolveExpiresAt(apiEdit);
    if (expiresAt === undefined) {
      showError(t('settings.token.invalidExpiresAt'));
      return;
    }

    try {
      const result = await updateApiToken.mutateAsync({
        tokenId: apiEdit.tokenId,
        body: { name: apiEdit.name.trim(), expiresAt },
      });
      setCreatedApiToken((prev) => (prev?.token.id === result.token.id ? { ...prev, token: result.token } : prev));
      setApiEdit(EMPTY_EDIT_STATE);
      showNotice(t('settings.apiToken.updated'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.apiToken.updateFailed'));
    }
  }

  async function submitUpdateMcpToken() {
    const expiresAt = resolveExpiresAt(mcpEdit);
    if (expiresAt === undefined) {
      showError(t('settings.token.invalidExpiresAt'));
      return;
    }

    try {
      const result = await updateGlobalMcpToken.mutateAsync({
        tokenId: mcpEdit.tokenId,
        body: { name: mcpEdit.name.trim(), expiresAt },
      });
      setCreatedMcpToken((prev) => (prev?.token.id === result.token.id ? { ...prev, token: result.token } : prev));
      setMcpEdit(EMPTY_EDIT_STATE);
      showNotice(t('settings.mcpToken.updated'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.mcpToken.updateFailed'));
    }
  }

  async function submitDeleteApiToken() {
    if (!apiDeleteTarget) return;
    try {
      await deleteApiToken.mutateAsync(apiDeleteTarget.id);
      setApiPlaintexts((prev) => {
        const next = { ...prev };
        delete next[apiDeleteTarget.id];
        return next;
      });
      setVisibleApiTokenIds((prev) => deleteSetValue(prev, apiDeleteTarget.id));
      setCreatedApiToken((prev) => (prev?.token.id === apiDeleteTarget.id ? null : prev));
      setApiDeleteTarget(null);
      showNotice(t('settings.apiToken.deleted'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.apiToken.deleteFailed'));
    }
  }

  async function submitDeleteMcpToken() {
    if (!mcpDeleteTarget) return;
    try {
      await deleteGlobalMcpToken.mutateAsync(mcpDeleteTarget.id);
      setMcpPlaintexts((prev) => {
        const next = { ...prev };
        delete next[mcpDeleteTarget.id];
        return next;
      });
      setVisibleMcpTokenIds((prev) => deleteSetValue(prev, mcpDeleteTarget.id));
      setCreatedMcpToken((prev) => (prev?.token.id === mcpDeleteTarget.id ? null : prev));
      setMcpDeleteTarget(null);
      showNotice(t('settings.mcpToken.deleted'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.mcpToken.deleteFailed'));
    }
  }

  const loading = apiTokensQuery.isLoading || globalMcpTokenQuery.isLoading;

  return (
    <Main className="gap-0">
      <div className="flex flex-col gap-5" data-testid="settings-page">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-normal">{t('settings.title')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('settings.subtitle')}</p>
        </div>

        {notice ? <StatusBanner tone="success">{notice}</StatusBanner> : null}
        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        {loading ? <PlatformLoader /> : null}

        <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="settings-api-token-section">
          <SectionHeader
            icon={<ShieldCheck className="h-4 w-4" />}
            title={t('settings.apiToken.title')}
            description={t('settings.apiToken.description')}
            actions={
              <Button
                type="button"
                variant="outline"
                onClick={() => setApiCreate({ ...EMPTY_CREATE_STATE, open: true })}
                disabled={createApiToken.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('settings.apiToken.create')}
              </Button>
            }
          />

          {createdApiToken ? (
            <PlaintextResult
              title={t('settings.apiToken.createdTitle')}
              plaintext={createdApiToken.plaintext}
              onCopy={() => void copyValue(createdApiToken.plaintext)}
            />
          ) : null}

          {apiTokensQuery.isError ? (
            <StatusBanner tone="error">{t('settings.apiToken.loadFailed')}</StatusBanner>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table columns={API_TOKEN_COLUMNS}>
                <TableHeader>
                  <TableRow>
                    <TableHead column="name">{t('settings.token.column.name')}</TableHead>
                    <TableHead column="token">{t('settings.token.column.token')}</TableHead>
                    <TableHead column="ipWhitelist">{t('settings.apiToken.column.ipWhitelist')}</TableHead>
                    <TableHead column="lastUsedAt">{t('settings.token.column.lastUsedAt')}</TableHead>
                    <TableHead column="expiresAt">{t('settings.token.column.expiresAt')}</TableHead>
                    <TableHead column="createdAt">{t('settings.token.column.createdAt')}</TableHead>
                    <TableHead column="actions" className="text-right">
                      {t('common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiRows.length === 0 ? (
                    <TableEmpty>{t('settings.apiToken.empty')}</TableEmpty>
                  ) : (
                    apiRows.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell column="name" truncate>
                          {token.name}
                        </TableCell>
                        <TableCell column="token">
                          <TokenPlaintextCell
                            kind="api"
                            prefix={token.prefix}
                            plaintext={apiPlaintexts[token.id]}
                            visible={visibleApiTokenIds.has(token.id)}
                            revealing={revealApiToken.isPending}
                            onToggle={() => void toggleApiTokenPlaintext(token)}
                            onCopy={(plaintext) => void copyValue(plaintext)}
                          />
                        </TableCell>
                        <TableCell column="ipWhitelist" truncate>
                          {token.ipWhitelist?.length
                            ? token.ipWhitelist.join(', ')
                            : t('settings.apiToken.ipWhitelistNone')}
                        </TableCell>
                        <TableCell column="lastUsedAt">{formatDateTime(token.lastUsedAt)}</TableCell>
                        <TableCell column="expiresAt">{formatDateTime(token.expiresAt)}</TableCell>
                        <TableCell column="createdAt">{formatDateTime(token.createdAt)}</TableCell>
                        <TableCell column="actions">
                          <div className="flex items-center justify-end gap-0.5">
                            <TableActionIconButton
                              label={t('settings.apiToken.edit')}
                              onClick={() => setApiEdit(createEditState(token))}
                              disabled={updateApiToken.isPending}
                            >
                              <Pencil className="h-4 w-4" />
                            </TableActionIconButton>
                            <TableActionIconButton
                              label={t('settings.apiToken.delete')}
                              onClick={() => setApiDeleteTarget(token)}
                              disabled={deleteApiToken.isPending}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </TableActionIconButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="settings-mcp-token-section">
          <SectionHeader
            icon={<KeyRound className="h-4 w-4" />}
            title={t('settings.mcpToken.title')}
            description={t('settings.mcpToken.description')}
            actions={
              globalMcpToken ? null : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMcpCreate({ ...EMPTY_CREATE_STATE, open: true })}
                  disabled={createGlobalMcpToken.isPending || globalMcpTokenQuery.isLoading}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('settings.mcpToken.create')}
                </Button>
              )
            }
          />

          {createdMcpToken ? (
            <PlaintextResult
              title={t('settings.mcpToken.createdTitle')}
              plaintext={createdMcpToken.plaintext}
              onCopy={() => void copyValue(createdMcpToken.plaintext)}
            />
          ) : null}

          {globalMcpTokenQuery.isError ? (
            <StatusBanner tone="error">{t('settings.mcpToken.loadFailed')}</StatusBanner>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table columns={MCP_TOKEN_COLUMNS}>
                <TableHeader>
                  <TableRow>
                    <TableHead column="name">{t('settings.token.column.name')}</TableHead>
                    <TableHead column="token">{t('settings.token.column.token')}</TableHead>
                    <TableHead column="lastUsedAt">{t('settings.token.column.lastUsedAt')}</TableHead>
                    <TableHead column="expiresAt">{t('settings.token.column.expiresAt')}</TableHead>
                    <TableHead column="createdAt">{t('settings.token.column.createdAt')}</TableHead>
                    <TableHead column="actions" className="text-right">
                      {t('common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mcpRows.length === 0 ? (
                    <TableEmpty>{t('settings.mcpToken.empty')}</TableEmpty>
                  ) : (
                    mcpRows.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell column="name" truncate>
                          {token.name}
                        </TableCell>
                        <TableCell column="token">
                          <TokenPlaintextCell
                            kind="mcp"
                            prefix={token.prefix}
                            plaintext={mcpPlaintexts[token.id]}
                            visible={visibleMcpTokenIds.has(token.id)}
                            revealing={revealGlobalMcpToken.isPending}
                            onToggle={() => void toggleMcpTokenPlaintext(token)}
                            onCopy={(plaintext) => void copyValue(plaintext)}
                          />
                        </TableCell>
                        <TableCell column="lastUsedAt">{formatDateTime(token.lastUsedAt)}</TableCell>
                        <TableCell column="expiresAt">{formatDateTime(token.expiresAt)}</TableCell>
                        <TableCell column="createdAt">{formatDateTime(token.createdAt)}</TableCell>
                        <TableCell column="actions">
                          <div className="flex items-center justify-end gap-0.5">
                            <TableActionIconButton
                              label={t('settings.mcpToken.edit')}
                              onClick={() => setMcpEdit(createEditState(token))}
                              disabled={updateGlobalMcpToken.isPending}
                            >
                              <Pencil className="h-4 w-4" />
                            </TableActionIconButton>
                            <TableActionIconButton
                              label={t('settings.mcpToken.delete')}
                              onClick={() => setMcpDeleteTarget(token)}
                              disabled={deleteGlobalMcpToken.isPending}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </TableActionIconButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <CreateTokenDialog
          kind="api"
          state={apiCreate}
          pending={createApiToken.isPending}
          onChange={setApiCreate}
          onCancel={() => setApiCreate(EMPTY_CREATE_STATE)}
          onSubmit={() => void submitCreateApiToken()}
        />
        <CreateTokenDialog
          kind="mcp"
          state={mcpCreate}
          pending={createGlobalMcpToken.isPending}
          onChange={setMcpCreate}
          onCancel={() => setMcpCreate(EMPTY_CREATE_STATE)}
          onSubmit={() => void submitCreateMcpToken()}
        />
        <EditTokenDialog
          kind="api"
          state={apiEdit}
          pending={updateApiToken.isPending}
          onChange={setApiEdit}
          onCancel={() => setApiEdit(EMPTY_EDIT_STATE)}
          onSubmit={() => void submitUpdateApiToken()}
        />
        <EditTokenDialog
          kind="mcp"
          state={mcpEdit}
          pending={updateGlobalMcpToken.isPending}
          onChange={setMcpEdit}
          onCancel={() => setMcpEdit(EMPTY_EDIT_STATE)}
          onSubmit={() => void submitUpdateMcpToken()}
        />
        <DeleteTokenDialog
          kind="api"
          open={Boolean(apiDeleteTarget)}
          name={apiDeleteTarget?.name ?? ''}
          prefix={apiDeleteTarget?.prefix ?? ''}
          pending={deleteApiToken.isPending}
          onCancel={() => setApiDeleteTarget(null)}
          onConfirm={() => void submitDeleteApiToken()}
        />
        <DeleteTokenDialog
          kind="mcp"
          open={Boolean(mcpDeleteTarget)}
          name={mcpDeleteTarget?.name ?? ''}
          prefix={mcpDeleteTarget?.prefix ?? ''}
          pending={deleteGlobalMcpToken.isPending}
          onCancel={() => setMcpDeleteTarget(null)}
          onConfirm={() => void submitDeleteMcpToken()}
        />
      </div>
    </Main>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-md border bg-background p-2 text-muted-foreground">{icon}</div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}

function Field({
  htmlFor,
  label,
  required,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CreateTokenDialog({
  kind,
  state,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  kind: TokenKind;
  state: TokenCreateState;
  pending: boolean;
  onChange: (state: TokenCreateState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const isApi = kind === 'api';
  const idPrefix = kind === 'api' ? 'settings-api-token' : 'settings-mcp-token';
  const disabled =
    pending ||
    state.name.trim().length < 2 ||
    (state.expiryPreset === 'custom' && state.customExpiresAt.trim().length === 0);

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isApi ? t('settings.apiToken.createDialogTitle') : t('settings.mcpToken.createDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {isApi ? t('settings.apiToken.createDialogDescription') : t('settings.mcpToken.createDialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field htmlFor={`${idPrefix}-name`} label={t('settings.token.name')} required>
            <Input
              id={`${idPrefix}-name`}
              value={state.name}
              onChange={(event) => onChange({ ...state, name: event.target.value })}
              autoFocus
              required
            />
          </Field>
          {isApi ? (
            <Field
              htmlFor={`${idPrefix}-ip-whitelist`}
              label={t('settings.apiToken.ipWhitelist')}
              hint={t('settings.apiToken.ipWhitelistHint')}
            >
              <textarea
                id={`${idPrefix}-ip-whitelist`}
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                value={state.ipWhitelistRaw}
                onChange={(event) => onChange({ ...state, ipWhitelistRaw: event.target.value })}
                placeholder="10.0.0.0/8&#10;192.168.1.10"
              />
            </Field>
          ) : null}
          <Field htmlFor={`${idPrefix}-expires-at`} label={t('settings.token.expiresAt')}>
            <select
              id={`${idPrefix}-expires-at`}
              value={state.expiryPreset}
              onChange={(event) =>
                onChange({
                  ...state,
                  expiryPreset: event.target.value as TokenExpiryPreset,
                  customExpiresAt: event.target.value === 'custom' ? state.customExpiresAt : '',
                })
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="never">{t('settings.token.expiry.never')}</option>
              <option value="7d">{t('settings.token.expiry.7d')}</option>
              <option value="30d">{t('settings.token.expiry.30d')}</option>
              <option value="90d">{t('settings.token.expiry.90d')}</option>
              <option value="custom">{t('settings.token.expiry.custom')}</option>
            </select>
          </Field>
          {state.expiryPreset === 'custom' ? (
            <Field htmlFor={`${idPrefix}-custom-expires-at`} label={t('settings.token.customExpiresAt')} required>
              <Input
                id={`${idPrefix}-custom-expires-at`}
                type="datetime-local"
                value={state.customExpiresAt}
                onChange={(event) => onChange({ ...state, customExpiresAt: event.target.value })}
                required
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={disabled}>
            {pending ? t('settings.token.creating') : t('settings.token.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTokenDialog({
  kind,
  state,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  kind: TokenKind;
  state: TokenEditState;
  pending: boolean;
  onChange: (state: TokenEditState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const isApi = kind === 'api';
  const idPrefix = kind === 'api' ? 'settings-api-token-edit' : 'settings-mcp-token-edit';
  const disabled =
    pending ||
    state.name.trim().length < 2 ||
    (state.expiryPreset === 'custom' && state.customExpiresAt.trim().length === 0);

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isApi ? t('settings.apiToken.editDialogTitle') : t('settings.mcpToken.editDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {isApi ? t('settings.apiToken.editDialogDescription') : t('settings.mcpToken.editDialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field htmlFor={`${idPrefix}-name`} label={t('settings.token.name')} required>
            <Input
              id={`${idPrefix}-name`}
              value={state.name}
              onChange={(event) => onChange({ ...state, name: event.target.value })}
              autoFocus
              required
            />
          </Field>
          <Field htmlFor={`${idPrefix}-expires-at`} label={t('settings.token.expiresAt')}>
            <select
              id={`${idPrefix}-expires-at`}
              value={state.expiryPreset}
              onChange={(event) =>
                onChange({
                  ...state,
                  expiryPreset: event.target.value as TokenExpiryPreset,
                  customExpiresAt: event.target.value === 'custom' ? state.customExpiresAt : '',
                })
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="never">{t('settings.token.expiry.never')}</option>
              <option value="7d">{t('settings.token.expiry.7d')}</option>
              <option value="30d">{t('settings.token.expiry.30d')}</option>
              <option value="90d">{t('settings.token.expiry.90d')}</option>
              <option value="custom">{t('settings.token.expiry.custom')}</option>
            </select>
          </Field>
          {state.expiryPreset === 'custom' ? (
            <Field htmlFor={`${idPrefix}-custom-expires-at`} label={t('settings.token.customExpiresAt')} required>
              <Input
                id={`${idPrefix}-custom-expires-at`}
                type="datetime-local"
                value={state.customExpiresAt}
                onChange={(event) => onChange({ ...state, customExpiresAt: event.target.value })}
                required
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={disabled}>
            {pending ? t('settings.token.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTokenDialog({
  kind,
  open,
  name,
  prefix,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: TokenKind;
  open: boolean;
  name: string;
  prefix: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const isApi = kind === 'api';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isApi ? t('settings.apiToken.deleteTitle') : t('settings.mcpToken.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {isApi ? t('settings.apiToken.deleteDescription') : t('settings.mcpToken.deleteDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{name}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{maskToken(prefix)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t('settings.token.deleting') : t('settings.token.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenPlaintextCell({
  kind,
  prefix,
  plaintext,
  visible,
  revealing,
  onToggle,
  onCopy,
}: {
  kind: TokenKind;
  prefix: string;
  plaintext?: string;
  visible: boolean;
  revealing: boolean;
  onToggle: () => void;
  onCopy: (plaintext: string) => void;
}) {
  const { t } = useI18n();
  const canCopy = Boolean(plaintext);
  const displayValue = visible && plaintext ? plaintext : maskToken(prefix, plaintext);
  const labelPrefix = kind === 'api' ? t('settings.apiToken.title') : t('settings.mcpToken.title');

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
        {displayValue}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onToggle}
        disabled={revealing}
        aria-label={visible ? t('settings.token.hidePlaintext') : t('settings.token.showPlaintext')}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => plaintext && onCopy(plaintext)}
        disabled={!canCopy}
        aria-label={`${labelPrefix} ${t('settings.token.copyPlaintext')}`}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PlaintextResult({ title, plaintext, onCopy }: { title: string; plaintext: string; onCopy: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.token.createdPlaintextHint')}</p>
        </div>
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          {t('settings.token.copyPlaintext')}
        </Button>
      </div>
      <code className="mt-3 block overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs">
        {plaintext}
      </code>
    </div>
  );
}

function StatusBanner({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'success'
          ? 'border-primary/30 bg-primary/5 text-foreground'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </div>
  );
}
