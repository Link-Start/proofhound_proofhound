import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi, type Mocked } from 'vitest';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { TokenRepository, type ApiTokenRow } from '../token.repository';
import { TokenService } from '../token.service';

const PM = { sub: 'pm-1', email: 'p@p.com', isSuperAdmin: false, isActive: true };
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

function fakeRow(overrides: Partial<ApiTokenRow> = {}): ApiTokenRow {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
    scope: 'project_api',
    projectId: PROJECT_ID,
    name: 'webhook-token',
    tokenHash: 'hash',
    tokenEncrypted: 'enc:ph_proj_plaintext',
    prefix: 'ph_proj_abc',
    ipWhitelist: null,
    lastUsedAt: null,
    expiresAt: null,
    createdBy: PM.sub,
    createdAt: new Date('2026-05-20T00:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let repo: Mocked<TokenRepository>;
  let crypto: Mocked<CryptoService>;

  beforeEach(async () => {
    repo = {
      listApiTokens: vi.fn().mockResolvedValue([{ ...fakeRow(), createdByDisplayName: 'Local User' }]),
      findApiTokenById: vi.fn().mockResolvedValue({ ...fakeRow(), createdByDisplayName: 'Local User' }),
      findApiTokenByName: vi.fn().mockResolvedValue(null),
      findActiveGlobalMcpToken: vi.fn().mockResolvedValue(null),
      findGlobalMcpTokenById: vi.fn().mockResolvedValue({
        ...fakeRow({
          id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
          scope: 'global_mcp',
          projectId: null,
          name: 'mcp-token',
          tokenEncrypted: 'enc:ph_mcp_plaintext',
          prefix: 'ph_mcp_abc',
        }),
        createdByDisplayName: null,
      }),
      insertApiToken: vi.fn().mockImplementation((values) => Promise.resolve(fakeRow(values))),
      updateApiToken: vi.fn().mockImplementation((_projectId, _tokenId, values) =>
        Promise.resolve({
          ...fakeRow(values),
          createdByDisplayName: 'Local User',
        }),
      ),
      updateGlobalMcpToken: vi.fn().mockImplementation((_tokenId, values) =>
        Promise.resolve({
          ...fakeRow({
            id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
            scope: 'global_mcp',
            projectId: null,
            name: 'mcp-token',
            ...values,
          }),
          createdByDisplayName: null,
        }),
      ),
      revokeApiToken: vi.fn().mockResolvedValue(true),
      revokeGlobalMcpToken: vi.fn().mockResolvedValue(true),
    } as unknown as Mocked<TokenRepository>;
    crypto = {
      encryptApiKey: vi.fn((plain: string) => `enc:${plain}`),
      decryptApiKey: vi.fn((cipher: string) => cipher.replace(/^enc:/, '')),
    } as unknown as Mocked<CryptoService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: TokenRepository, useValue: repo },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
  });

  it('lists API tokens without plaintext', async () => {
    const result = await service.listApiTokens(PROJECT_ID, PM);
    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ projectId: PROJECT_ID, prefix: 'ph_proj_abc' }));
    expect(result.data[0]?.createdByDisplayName).toBe('Local User');
    expect(result.data[0]).not.toHaveProperty('plaintext');
  });

  it('rejects duplicate active names', async () => {
    repo.findApiTokenByName.mockResolvedValueOnce(fakeRow());
    await expect(service.createApiToken(PROJECT_ID, { name: 'webhook-token' }, PM)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates a hashed and encrypted API token and returns plaintext', async () => {
    const result = await service.createApiToken(PROJECT_ID, { name: 'webhook-token' }, PM);
    expect(result.plaintext).toMatch(/^ph_proj_/);
    expect(result.token.createdByDisplayName).toBe('Local User');
    expect(repo.insertApiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project_api',
        projectId: PROJECT_ID,
        name: 'webhook-token',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        tokenEncrypted: expect.stringMatching(/^enc:ph_proj_/),
        prefix: expect.stringMatching(/^ph_proj_/),
      }),
    );
  });

  it('reveals encrypted API token plaintext', async () => {
    const result = await service.revealApiToken(PROJECT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', PM);
    expect(result).toEqual({
      tokenId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      plaintext: 'ph_proj_plaintext',
      available: true,
    });
    expect(crypto.decryptApiKey).toHaveBeenCalledWith('enc:ph_proj_plaintext');
  });

  it('updates API token name and expiration without changing plaintext fields', async () => {
    const result = await service.updateApiToken(
      PROJECT_ID,
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      { name: 'webhook-prod', expiresAt: '2026-06-01T00:00:00.000Z' },
      PM,
    );
    expect(result.token).toEqual(expect.objectContaining({ name: 'webhook-prod' }));
    expect(repo.updateApiToken).toHaveBeenCalledWith(PROJECT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', {
      name: 'webhook-prod',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('rejects updating API token to a duplicate active name', async () => {
    repo.findApiTokenByName.mockResolvedValueOnce(fakeRow({ id: 'dddddddd-dddd-4ddd-8ddd-000000000001' }));
    await expect(
      service.updateApiToken(PROJECT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', { name: 'taken-token' }, PM),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns unavailable when revealing a legacy hash-only token', async () => {
    repo.findApiTokenById.mockResolvedValueOnce({
      ...fakeRow({ tokenEncrypted: null }),
      createdByDisplayName: 'Local User',
    });
    const result = await service.revealApiToken(PROJECT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', PM);
    expect(result.available).toBe(false);
    expect(result.plaintext).toBeNull();
  });

  it('deletes API token by revoking it', async () => {
    const result = await service.deleteApiToken(PROJECT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', PM);
    expect(result).toEqual({ tokenId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001' });
    expect(repo.revokeApiToken).toHaveBeenCalledWith(
      PROJECT_ID,
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      expect.any(Date),
    );
  });

  it('creates a single global MCP token and returns plaintext', async () => {
    const result = await service.createGlobalMcpToken({ name: 'mcp-token' }, PM);
    expect(result.plaintext).toMatch(/^ph_mcp_/);
    expect(repo.insertApiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'global_mcp',
        name: 'mcp-token',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        tokenEncrypted: expect.stringMatching(/^enc:ph_mcp_/),
        prefix: expect.stringMatching(/^ph_mcp_/),
      }),
    );
  });

  it('rejects creating a second active global MCP token', async () => {
    repo.findActiveGlobalMcpToken.mockResolvedValueOnce({
      ...fakeRow({ scope: 'global_mcp', projectId: null }),
      createdByDisplayName: null,
    });
    await expect(service.createGlobalMcpToken({ name: 'mcp-token' }, PM)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reveals encrypted global MCP token plaintext', async () => {
    const result = await service.revealGlobalMcpToken('cccccccc-cccc-4ccc-8ccc-000000000001', PM);
    expect(result).toEqual({
      tokenId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
      plaintext: 'ph_mcp_plaintext',
      available: true,
    });
  });

  it('updates global MCP token name and expiration', async () => {
    const result = await service.updateGlobalMcpToken(
      'cccccccc-cccc-4ccc-8ccc-000000000001',
      { name: 'mcp-prod', expiresAt: null },
      PM,
    );
    expect(result.token).toEqual(expect.objectContaining({ name: 'mcp-prod', expiresAt: null }));
    expect(repo.updateGlobalMcpToken).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-000000000001', {
      name: 'mcp-prod',
      expiresAt: null,
    });
  });

  it('deletes global MCP token by revoking it', async () => {
    const result = await service.deleteGlobalMcpToken('cccccccc-cccc-4ccc-8ccc-000000000001', PM);
    expect(result).toEqual({ tokenId: 'cccccccc-cccc-4ccc-8ccc-000000000001' });
    expect(repo.revokeGlobalMcpToken).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-000000000001', expect.any(Date));
  });
});
