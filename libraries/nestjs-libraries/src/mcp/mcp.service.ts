import { HttpException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpSettings } from '@gitroom/nestjs-libraries/mcp/mcp.settings';
import { MainMcp } from '@gitroom/backend/mcp/main.mcp';

@Injectable()
export class McpService implements OnModuleDestroy {
  private sessions = new Map<
    string,
    { organization: string; server: McpServer; transport: SSEServerTransport }
  >();
  constructor(private _mainMcp: MainMcp) {}

  async runServer(apiKey: string, organization: string, response: Response) {
    const server = McpSettings.load(organization, this._mainMcp).server();
    const transport = new SSEServerTransport(
      process.env.NEXT_PUBLIC_BACKEND_URL +
        '/mcp/' +
        encodeURIComponent(apiKey) +
        '/messages',
      response
    );
    transport.onclose = () => this.sessions.delete(transport.sessionId);
    this.sessions.set(transport.sessionId, { organization, server, transport });
    try {
      await server.connect(transport);
    } catch (error) {
      this.sessions.delete(transport.sessionId);
      await server.close();
      throw error;
    }
  }

  async processPostBody(
    organization: string,
    sessionId: string,
    request: Request,
    response: Response,
    body: unknown
  ) {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new HttpException(
        'MCP session not found; reconnect the client',
        404
      );
    if (session.organization !== organization)
      throw new HttpException(
        'MCP session belongs to another organization',
        403
      );
    await session.transport.handlePostMessage(request, response, body);
  }

  async onModuleDestroy() {
    for (const session of Array.from(this.sessions.values()))
      await session.server.close();
    this.sessions.clear();
  }
}
