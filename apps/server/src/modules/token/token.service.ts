import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateApiTokenDto,
  CreateApiTokenResponseDto,
  CreateGlobalMcpTokenDto,
  CreateGlobalMcpTokenResponseDto,
  DeleteGlobalMcpTokenResponseDto,
  DeleteApiTokenResponseDto,
  GetGlobalMcpTokenResponseDto,
  GlobalMcpTokenSummaryDto,
  ListApiTokensResponseDto,
  ApiTokenSummaryDto,
  RevealGlobalMcpTokenResponseDto,
  RevealApiTokenResponseDto,
  UpdateApiTokenDto,
  UpdateApiTokenResponseDto,
  UpdateGlobalMcpTokenDto,
  UpdateGlobalMcpTokenResponseDto,
} from '@proofhound/shared';
import { accessControl } from '../../common/access-control';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { TokenRepository, type ApiTokenRow, type ApiTokenRowWithCreator } from './token.repository';

type ActionSource = 'api' | 'mcp';

@Injectable()
export class TokenService {
  constructor(
    private readonly repo: TokenRepository,
    private readonly crypto: CryptoService,
  ) {}

  async listApiTokens(projectId: string, actor: CurrentUserPayload): Promise<ListApiTokensResponseDto> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    const rows = await this.repo.listApiTokens(projectId);
    return { data: rows.map((row) => this.toSummary(row)), total: rows.length };
  }

  async createApiToken(
    projectId: string,
    dto: CreateApiTokenDto,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<CreateApiTokenResponseDto> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    const existing = await this.repo.findApiTokenByName(projectId, dto.name);
    if (existing) throw new ConflictException(`api_token_name_in_use:${dto.name}`);

    const plaintext = this.generatePlaintext('ph_proj');
    const tokenHash = this.hashToken(plaintext);
    const prefix = plaintext.slice(0, 12);
    const row = await this.repo.insertApiToken({
      scope: 'project_api',
      projectId,
      name: dto.name,
      tokenHash,
      tokenEncrypted: this.crypto.encryptApiKey(plaintext),
      prefix,
      ipWhitelist: dto.ipWhitelist ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: actor.sub,
    });

    const rowWithCreator = await this.repo.findApiTokenById(projectId, row.id);
    return { token: this.toSummary(rowWithCreator ?? row), plaintext };
  }

  async updateApiToken(
    projectId: string,
    tokenId: string,
    dto: UpdateApiTokenDto,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<UpdateApiTokenResponseDto> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    const row = await this.repo.findApiTokenById(projectId, tokenId);
    if (!row) throw new NotFoundException(`API token ${tokenId} not found`);

    if (dto.name !== row.name) {
      const existing = await this.repo.findApiTokenByName(projectId, dto.name);
      if (existing && existing.id !== tokenId) throw new ConflictException(`api_token_name_in_use:${dto.name}`);
    }

    const updated = await this.repo.updateApiToken(projectId, tokenId, {
      name: dto.name,
      expiresAt: dto.expiresAt === undefined ? row.expiresAt : dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    if (!updated) throw new NotFoundException(`API token ${tokenId} not found`);
    return { token: this.toSummary(updated) };
  }

  async getGlobalMcpToken(actor: CurrentUserPayload): Promise<GetGlobalMcpTokenResponseDto> {
    accessControl.assertCan(actor, 'platform_manage');
    const row = await this.repo.findActiveGlobalMcpToken();
    return { token: row ? this.toGlobalSummary(row) : null };
  }

  async createGlobalMcpToken(
    dto: CreateGlobalMcpTokenDto,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<CreateGlobalMcpTokenResponseDto> {
    accessControl.assertCan(actor, 'platform_manage');
    const existing = await this.repo.findActiveGlobalMcpToken();
    if (existing) throw new ConflictException('global_mcp_token_already_exists');

    const plaintext = this.generatePlaintext('ph_mcp');
    const row = await this.repo.insertApiToken({
      scope: 'global_mcp',
      name: dto.name,
      tokenHash: this.hashToken(plaintext),
      tokenEncrypted: this.crypto.encryptApiKey(plaintext),
      prefix: plaintext.slice(0, 12),
      ipWhitelist: null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: actor.sub,
    });

    const rowWithCreator = await this.repo.findGlobalMcpTokenById(row.id);
    return { token: this.toGlobalSummary(rowWithCreator ?? row), plaintext };
  }

  async updateGlobalMcpToken(
    tokenId: string,
    dto: UpdateGlobalMcpTokenDto,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<UpdateGlobalMcpTokenResponseDto> {
    accessControl.assertCan(actor, 'platform_manage');
    const row = await this.repo.findGlobalMcpTokenById(tokenId);
    if (!row) throw new NotFoundException(`Global MCP token ${tokenId} not found`);

    const updated = await this.repo.updateGlobalMcpToken(tokenId, {
      name: dto.name,
      expiresAt: dto.expiresAt === undefined ? row.expiresAt : dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    if (!updated) throw new NotFoundException(`Global MCP token ${tokenId} not found`);
    return { token: this.toGlobalSummary(updated) };
  }

  async revealGlobalMcpToken(
    tokenId: string,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<RevealGlobalMcpTokenResponseDto> {
    accessControl.assertCan(actor, 'platform_manage');
    const row = await this.repo.findGlobalMcpTokenById(tokenId);
    if (!row) throw new NotFoundException(`Global MCP token ${tokenId} not found`);

    const plaintext = row.tokenEncrypted ? this.crypto.decryptApiKey(row.tokenEncrypted) : null;
    return { tokenId, plaintext, available: Boolean(plaintext) };
  }

  async deleteGlobalMcpToken(
    tokenId: string,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<DeleteGlobalMcpTokenResponseDto> {
    accessControl.assertCan(actor, 'platform_manage');
    const row = await this.repo.findGlobalMcpTokenById(tokenId);
    if (!row) throw new NotFoundException(`Global MCP token ${tokenId} not found`);

    const revoked = await this.repo.revokeGlobalMcpToken(tokenId, new Date());
    if (!revoked) throw new NotFoundException(`Global MCP token ${tokenId} not found`);
    return { tokenId };
  }

  async revealApiToken(
    projectId: string,
    tokenId: string,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<RevealApiTokenResponseDto> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    const row = await this.repo.findApiTokenById(projectId, tokenId);
    if (!row) throw new NotFoundException(`API token ${tokenId} not found`);

    const plaintext = row.tokenEncrypted ? this.crypto.decryptApiKey(row.tokenEncrypted) : null;
    return { tokenId, plaintext, available: Boolean(plaintext) };
  }

  async deleteApiToken(
    projectId: string,
    tokenId: string,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<DeleteApiTokenResponseDto> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    const row = await this.repo.findApiTokenById(projectId, tokenId);
    if (!row) throw new NotFoundException(`API token ${tokenId} not found`);

    const revoked = await this.repo.revokeApiToken(projectId, tokenId, new Date());
    if (!revoked) throw new NotFoundException(`API token ${tokenId} not found`);
    return { tokenId };
  }

  private generatePlaintext(prefix: 'ph_proj' | 'ph_mcp'): string {
    return `${prefix}_${randomBytes(24).toString('base64url')}`;
  }

  private hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private toSummary(row: ApiTokenRow | ApiTokenRowWithCreator): ApiTokenSummaryDto {
    if (!row.projectId) throw new Error('project_api_token_missing_project_id');
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      prefix: row.prefix,
      ipWhitelist: (row.ipWhitelist as string[] | null) ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdByDisplayName: 'createdByDisplayName' in row ? row.createdByDisplayName : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toGlobalSummary(row: ApiTokenRow | ApiTokenRowWithCreator): GlobalMcpTokenSummaryDto {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
