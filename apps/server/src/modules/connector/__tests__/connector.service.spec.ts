import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi, type Mocked } from 'vitest';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { ConnectorDriverFactory } from '../connector.driver-factory';
import { ConnectorRepository, type ConnectorRow, type ConnectorRowWithJoins } from '../connector.repository';
import { ConnectorService } from '../connector.service';

const WORKSPACE_ID = '11111111-1111-4111-8111-000000000010';
const CONNECTOR_ID = '22222222-2222-4222-8222-000000000010';
const ACTOR = { sub: 'local-user', email: 'local@proofhound.dev', isSuperAdmin: true, isActive: true };

function fakeJoinRow(overrides: Partial<ConnectorRowWithJoins> = {}): ConnectorRowWithJoins {
  return {
    id: CONNECTOR_ID,
    projectId: WORKSPACE_ID,
    name: 'redis-input-stream',
    description: 'stream input',
    direction: 'input',
    type: 'redis',
    configEncrypted: null,
    config: {
      mode: 'stream',
      key: 'events:stream',
      connection: {
        source: 'local_config',
        host: 'redis.local.internal',
        port: 6379,
      },
    },
    webhookPath: null,
    webhookTokenId: null,
    ipWhitelist: null,
    healthStatus: 'unknown',
    lastProbedAt: null,
    lastProbeError: null,
    createdBy: ACTOR.sub,
    createdByDisplayName: null,
    tokenName: null,
    tokenPrefix: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function fakeRow(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  return {
    id: CONNECTOR_ID,
    projectId: WORKSPACE_ID,
    name: 'redis-input-stream',
    description: null,
    direction: 'input',
    type: 'redis',
    configEncrypted: null,
    config: {
      mode: 'stream',
      key: 'events',
      connection: {
        source: 'local_config',
        host: 'redis.local.internal',
        port: 6379,
      },
    },
    webhookPath: null,
    webhookTokenId: null,
    ipWhitelist: null,
    healthStatus: 'unknown',
    lastProbedAt: null,
    lastProbeError: null,
    createdBy: ACTOR.sub,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('ConnectorService', () => {
  let service: ConnectorService;
  let repo: Mocked<ConnectorRepository>;
  let driverFactory: Mocked<ConnectorDriverFactory>;
  let crypto: Mocked<CryptoService>;

  beforeEach(async () => {
    repo = {
      findProjectAccess: vi.fn().mockResolvedValue({ id: WORKSPACE_ID }),
      listByProject: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      findByProjectAndName: vi.fn().mockResolvedValue(null),
      findByWebhookPath: vi.fn().mockResolvedValue(null),
      findTokenByIdAndProject: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn().mockResolvedValue(undefined),
      updateProbeOutcome: vi.fn().mockResolvedValue(undefined),
      countReferences: vi
        .fn()
        .mockResolvedValue(new Map([[CONNECTOR_ID, { canaryReleases: 0, productionReleases: 0 }]])),
      listReferenceDetails: vi.fn().mockResolvedValue([]),
      countByProject: vi.fn().mockResolvedValue(0),
      findManyByIds: vi.fn().mockResolvedValue([]),
    } as unknown as Mocked<ConnectorRepository>;

    driverFactory = {
      peek: vi.fn().mockResolvedValue({ source: 'driver', messages: [], error: null }),
      probe: vi.fn().mockResolvedValue({ source: 'driver', error: null }),
    } as unknown as Mocked<ConnectorDriverFactory>;
    crypto = {
      encryptApiKey: vi.fn((value: string) => `encrypted:${value}`),
      decryptApiKey: vi.fn((value: string) => value.replace(/^encrypted:/u, '')),
    } as unknown as Mocked<CryptoService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorService,
        { provide: ConnectorRepository, useValue: repo },
        { provide: ConnectorDriverFactory, useValue: driverFactory },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();
    service = moduleRef.get(ConnectorService);
  });

  it('rejects users without local workspace access', async () => {
    repo.findProjectAccess.mockResolvedValueOnce(null);
    await expect(service.list(WORKSPACE_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates redis connectors from local connection config only', async () => {
    repo.insert.mockResolvedValue(fakeRow());
    repo.findById.mockResolvedValue(fakeJoinRow());

    await service.create(
      WORKSPACE_ID,
      {
        type: 'redis',
        direction: 'input',
        name: 'direct-redis',
        credentials: { password: 'direct-secret' },
        config: {
          mode: 'stream',
          key: 'events',
          connection: {
            source: 'local_config',
            host: 'redis.local.internal',
            port: 6380,
            deploymentType: 'standalone',
            defaultDbIndex: 0,
          },
        },
      },
      ACTOR,
    );

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        configEncrypted: 'encrypted:{"password":"direct-secret"}',
        config: expect.objectContaining({
          connection: expect.objectContaining({
            source: 'local_config',
            host: 'redis.local.internal',
            port: 6380,
          }),
        }),
      }),
    );
  });

  it('requires local connection config for queue connectors', async () => {
    await expect(
      service.create(
        WORKSPACE_ID,
        {
          type: 'redis',
          direction: 'input',
          name: 'missing-connection',
          config: { mode: 'stream', key: 'events' },
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allocates a webhook path for webhook input', async () => {
    repo.findTokenByIdAndProject.mockResolvedValue({
      id: '44444444-4444-4444-8444-000000000010',
      projectId: WORKSPACE_ID,
      scope: 'project_api',
    } as never);
    repo.insert.mockResolvedValue(fakeRow({ type: 'webhook', direction: 'input' }));
    repo.findById.mockResolvedValue(fakeJoinRow({ type: 'webhook', direction: 'input', webhookPath: 'p' }));

    await service.create(
      WORKSPACE_ID,
      {
        type: 'webhook',
        direction: 'input',
        name: 'wh-in',
        tokenId: '44444444-4444-4444-8444-000000000010',
        config: { webhookMode: 'sync' },
      },
      ACTOR,
    );

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ webhookPath: expect.any(String) }));
  });

  it('rejects duplicate connector names', async () => {
    repo.findByProjectAndName.mockResolvedValueOnce(fakeRow());

    await expect(
      service.create(
        WORKSPACE_ID,
        {
          type: 'redis',
          direction: 'input',
          name: 'redis-input-stream',
          config: {
            mode: 'stream',
            key: 'events',
            connection: { source: 'local_config', host: 'redis.local.internal', port: 6379 },
          },
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks delete when referenced unless force=true', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());
    repo.countReferences.mockResolvedValueOnce(
      new Map([[CONNECTOR_ID, { canaryReleases: 1, productionReleases: 0 }]]),
    );

    await expect(service.delete(WORKSPACE_ID, CONNECTOR_ID, {}, ACTOR)).rejects.toBeInstanceOf(ConflictException);

    repo.countReferences.mockResolvedValueOnce(
      new Map([[CONNECTOR_ID, { canaryReleases: 1, productionReleases: 0 }]]),
    );
    await service.delete(WORKSPACE_ID, CONNECTOR_ID, { force: true, reason: 'cleanup' }, ACTOR);
    expect(repo.softDelete).toHaveBeenCalledWith(WORKSPACE_ID, CONNECTOR_ID);
  });

  it('forwards peek to the driver factory and stores inferred schema metadata', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());
    driverFactory.peek.mockResolvedValueOnce({
      source: 'driver',
      messages: [
        {
          id: 'm1',
          receivedAt: '2026-05-10T00:00:00.000Z',
          payload: { hi: 1, nested: { ok: true } },
        },
      ],
      error: null,
    });

    const result = await service.peek(WORKSPACE_ID, CONNECTOR_ID, { limit: 5 }, ACTOR);

    expect(result.source).toBe('driver');
    expect(result.messages).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          lastPeekPayloadSchema: result.payloadSchema,
          lastPeekMessage: result.messages[0],
          lastPeekedAt: expect.any(String),
          lastPeekMessageCount: 1,
        }),
        healthStatus: 'healthy',
      }),
    );
  });

  it('records probe status from the driver factory', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());
    driverFactory.probe.mockResolvedValueOnce({ source: 'driver', error: 'kafka topic not found: risk-decisions' });

    const result = await service.probe(WORKSPACE_ID, CONNECTOR_ID, ACTOR);

    expect(result.status).toBe('failed');
    expect(repo.updateProbeOutcome).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.any(Date),
      'kafka topic not found: risk-decisions',
    );
  });

  it('returns partial bulk delete success when some connectors are referenced', async () => {
    const idA = '55555555-5555-4555-8555-000000000010';
    const idB = '66666666-6666-4666-8666-000000000010';
    repo.findManyByIds.mockResolvedValue([fakeRow({ id: idA }), fakeRow({ id: idB })]);
    repo.countReferences.mockResolvedValue(
      new Map([
        [idA, { canaryReleases: 0, productionReleases: 0 }],
        [idB, { canaryReleases: 1, productionReleases: 0 }],
      ]),
    );

    const result = await service.bulkDelete(WORKSPACE_ID, { ids: [idA, idB] }, ACTOR);

    expect(result.deletedIds).toEqual([idA]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ id: idB, reason: 'connector_referenced' });
  });

  it('preserves the saved connection config when queue config is edited', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());

    await service.update(WORKSPACE_ID, CONNECTOR_ID, { config: { mode: 'stream', key: 'events:next' } }, ACTOR);

    expect(repo.update).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          key: 'events:next',
          connection: expect.objectContaining({ host: 'redis.local.internal', port: 6379 }),
        }),
      }),
    );
  });

  it('updates the saved connection config and encrypted credential when edited', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow({ configEncrypted: 'encrypted:{"password":"old-secret"}' }));

    await service.update(
      WORKSPACE_ID,
      CONNECTOR_ID,
      {
        credentials: { password: 'new-secret' },
        config: {
          mode: 'stream',
          key: 'events',
          connection: {
            source: 'local_config',
            host: 'redis.local.next',
            port: 6380,
            username: 'default',
            defaultDbIndex: 2,
            deploymentType: 'standalone',
          },
        },
      },
      ACTOR,
    );

    expect(repo.update).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.objectContaining({
        configEncrypted: 'encrypted:{"password":"new-secret"}',
        config: expect.objectContaining({
          connection: expect.objectContaining({
            source: 'local_config',
            host: 'redis.local.next',
            port: 6380,
          }),
        }),
      }),
    );
  });
});
