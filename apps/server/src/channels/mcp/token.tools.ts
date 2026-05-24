/**
 * MCP tool definitions for API tokens.
 * Token plaintext is only returned by explicit create/reveal operations.
 */
import {
  createGlobalMcpTokenSchema,
  createApiTokenSchema,
  apiTokenIdParamSchema,
  updateApiTokenSchema,
  updateGlobalMcpTokenSchema,
} from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { TokenService } from '../../modules/token/token.service';
import type { McpToolDefinition } from './mcp.types';

export function createTokenTools(service: TokenService): McpToolDefinition[] {
  return [
    {
      name: 'global_mcp_token_get',
      description: '查看当前全局 MCP Token 摘要(不返回明文)',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => service.getGlobalMcpToken(getMcpActor(ctx)),
    },
    {
      name: 'global_mcp_token_create',
      description: '创建全局 MCP Token(同一时刻只允许一个有效 Token,返回明文)',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const dto = createGlobalMcpTokenSchema.parse({
          name: input.name,
          expiresAt: input.expiresAt,
        });
        return service.createGlobalMcpToken(dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'global_mcp_token_reveal',
      description: '查看全局 MCP Token 明文；仅对已加密保存明文的 Token 返回 plaintext',
      inputSchema: {
        type: 'object',
        required: ['tokenId'],
        properties: { tokenId: { type: 'string', format: 'uuid' } },
      },
      handler: async (input, ctx) =>
        service.revealGlobalMcpToken(apiTokenIdParamSchema.parse(input.tokenId), getMcpActor(ctx), 'mcp'),
    },
    {
      name: 'global_mcp_token_update',
      description: '更新全局 MCP Token 名称和失效时间；不改变明文、前缀或 hash',
      inputSchema: {
        type: 'object',
        required: ['tokenId', 'name'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const dto = updateGlobalMcpTokenSchema.parse({
          name: input.name,
          expiresAt: input.expiresAt,
        });
        return service.updateGlobalMcpToken(apiTokenIdParamSchema.parse(input.tokenId), dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'global_mcp_token_delete',
      description: '删除全局 MCP Token；实际执行为吊销 revoked_at，Token 将立即失效',
      inputSchema: {
        type: 'object',
        required: ['tokenId'],
        properties: { tokenId: { type: 'string', format: 'uuid' } },
      },
      handler: async (input, ctx) =>
        service.deleteGlobalMcpToken(apiTokenIdParamSchema.parse(input.tokenId), getMcpActor(ctx), 'mcp'),
    },
    {
      name: 'api_token_list',
      description: '列出 API Token(只返回 prefix,不返回明文)',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => service.listApiTokens(resolveMcpProjectContext(ctx).projectId, getMcpActor(ctx)),
    },
    {
      name: 'api_token_create',
      description: '创建 API Token(返回明文,用于 Webhook 鉴权)',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          ipWhitelist: { type: 'array', items: { type: 'string' } },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const dto = createApiTokenSchema.parse({
          name: input.name,
          ipWhitelist: input.ipWhitelist,
          expiresAt: input.expiresAt,
        });
        return service.createApiToken(resolveMcpProjectContext(ctx).projectId, dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'api_token_reveal',
      description: '查看 API Token 明文；仅对已加密保存明文的 Token 返回 plaintext',
      inputSchema: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) =>
        service.revealApiToken(
          resolveMcpProjectContext(ctx).projectId,
          apiTokenIdParamSchema.parse(input.tokenId),
          getMcpActor(ctx),
          'mcp',
        ),
    },
    {
      name: 'api_token_update',
      description: '更新 API Token 名称和失效时间；不改变明文、前缀、hash 或 IP 白名单',
      inputSchema: {
        type: 'object',
        required: ['tokenId', 'name'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const dto = updateApiTokenSchema.parse({
          name: input.name,
          expiresAt: input.expiresAt,
        });
        return service.updateApiToken(
          resolveMcpProjectContext(ctx).projectId,
          apiTokenIdParamSchema.parse(input.tokenId),
          dto,
          getMcpActor(ctx),
          'mcp',
        );
      },
    },
    {
      name: 'api_token_delete',
      description: '删除 API Token；实际执行为吊销 revoked_at，Token 将立即失效',
      inputSchema: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) =>
        service.deleteApiToken(
          resolveMcpProjectContext(ctx).projectId,
          apiTokenIdParamSchema.parse(input.tokenId),
          getMcpActor(ctx),
          'mcp',
        ),
    },
  ];
}
