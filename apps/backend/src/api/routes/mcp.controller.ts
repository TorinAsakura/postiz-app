import {
  Body,
  Controller,
  HttpException,
  Param,
  Post,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { McpService } from '@gitroom/nestjs-libraries/mcp/mcp.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Request, Response } from 'express';

@ApiTags('Mcp')
@Controller('/mcp')
export class McpController {
  constructor(
    private _mcpService: McpService,
    private _organizationService: OrganizationService
  ) {}

  @Get('/:api/sse')
  async sse(@Param('api') api: string, @Res() response: Response) {
    const apiModel = await this._organizationService.getOrgByApiKey(api);
    if (!apiModel) {
      throw new HttpException('Invalid url', 400);
    }

    await this._mcpService.runServer(api, apiModel.id, response);
  }

  @Post('/:api/messages')
  async post(
    @Param('api') api: string,
    @Query('sessionId') sessionId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown
  ) {
    const apiModel = await this._organizationService.getOrgByApiKey(api);
    if (!apiModel) {
      throw new HttpException('Invalid url', 400);
    }

    await this._mcpService.processPostBody(
      apiModel.id,
      sessionId,
      request,
      response,
      body
    );
  }
}
