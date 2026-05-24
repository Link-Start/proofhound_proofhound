import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createGlobalMcpTokenSchema,
  createApiTokenSchema,
  apiTokenIdParamSchema,
  updateApiTokenSchema,
  updateGlobalMcpTokenSchema,
} from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { TokenService } from './token.service';

@Controller('api-tokens')
@UseGuards(LocalActorGuard)
export class TokenController {
  constructor(private readonly service: TokenService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.listApiTokens(resolveProjectContext(actor).projectId, actor);
  }

  @Post()
  async create(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createApiTokenSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.createApiToken(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Patch(':tokenId')
  async update(@Param('tokenId') tokenId: string, @Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = updateApiTokenSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateApiToken(
      resolveProjectContext(actor).projectId,
      this.parseTokenId(tokenId),
      parse.data,
      actor,
    );
  }

  @Get(':tokenId/plaintext')
  async reveal(@Param('tokenId') tokenId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.revealApiToken(resolveProjectContext(actor).projectId, this.parseTokenId(tokenId), actor);
  }

  @Delete(':tokenId')
  async delete(@Param('tokenId') tokenId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.deleteApiToken(resolveProjectContext(actor).projectId, this.parseTokenId(tokenId), actor);
  }

  private parseTokenId(tokenId: string): string {
    const parse = apiTokenIdParamSchema.safeParse(tokenId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}

@Controller('api-tokens/global-mcp')
@UseGuards(LocalActorGuard)
export class GlobalMcpTokenController {
  constructor(private readonly service: TokenService) {}

  @Get()
  async get(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.getGlobalMcpToken(actor);
  }

  @Post()
  async create(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createGlobalMcpTokenSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.createGlobalMcpToken(parse.data, actor);
  }

  @Patch(':tokenId')
  async update(@Param('tokenId') tokenId: string, @Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = updateGlobalMcpTokenSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateGlobalMcpToken(this.parseTokenId(tokenId), parse.data, actor);
  }

  @Get(':tokenId/plaintext')
  async reveal(@Param('tokenId') tokenId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.revealGlobalMcpToken(this.parseTokenId(tokenId), actor);
  }

  @Delete(':tokenId')
  async delete(@Param('tokenId') tokenId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.deleteGlobalMcpToken(this.parseTokenId(tokenId), actor);
  }

  private parseTokenId(tokenId: string): string {
    const parse = apiTokenIdParamSchema.safeParse(tokenId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
