import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  bulkDeleteConnectorsRequestSchema,
  connectorDeleteQuerySchema,
  connectorIdParamSchema,
  connectorListQuerySchema,
  createConnectorSchema,
  peekConnectorRequestSchema,
  updateConnectorSchema,
} from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { LocalActorGuard } from '../../common/guards/local-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { ConnectorService } from './connector.service';

@Controller('connectors')
@UseGuards(LocalActorGuard)
export class ConnectorController {
  constructor(private readonly service: ConnectorService) {}

  @Get()
  async list(
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parseQuery = connectorListQuerySchema.safeParse(rawQuery);
    if (!parseQuery.success) throw new BadRequestException(parseQuery.error.issues);
    return this.service.list(resolveProjectContext(actor).projectId, actor, parseQuery.data);
  }

  @Get(':connectorId')
  async detail(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.getDetail(resolveProjectContext(actor).projectId, this.parseConnectorId(connectorId), actor);
  }

  @Get(':connectorId/references')
  async references(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.getReferences(resolveProjectContext(actor).projectId, this.parseConnectorId(connectorId), actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = createConnectorSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.create(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Patch(':connectorId')
  async update(
    @Param('connectorId') connectorId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updateConnectorSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.update(resolveProjectContext(actor).projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  @Delete(':connectorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('connectorId') connectorId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = connectorDeleteQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    await this.service.delete(resolveProjectContext(actor).projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  @Post('bulk-delete')
  async bulkDelete(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = bulkDeleteConnectorsRequestSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.bulkDelete(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Post(':connectorId/probe')
  async probe(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.probe(resolveProjectContext(actor).projectId, this.parseConnectorId(connectorId), actor);
  }

  @Post(':connectorId/peek')
  async peek(
    @Param('connectorId') connectorId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = peekConnectorRequestSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.peek(resolveProjectContext(actor).projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  private parseConnectorId(connectorId: string): string {
    const parse = connectorIdParamSchema.safeParse(connectorId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
