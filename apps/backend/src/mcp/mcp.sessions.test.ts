import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { McpController } from '../api/routes/mcp.controller';
import { McpService } from '@gitroom/nestjs-libraries/mcp/mcp.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { MainMcp } from './main.mcp';

describe('native SSE session isolation', () => {
  let app: INestApplication;
  let base: string;
  const clients: Client[] = [];
  let sessionA: string;
  const previousBackend = process.env.NEXT_PUBLIC_BACKEND_URL;

  beforeAll(async () => {
    const main = mock<MainMcp>();
    main.getPost.mockImplementation(async (_org, input) => [
      { type: 'text', text: input.postId },
    ]);
    const organizations = {
      getOrgByApiKey: jest.fn(async (key: string) =>
        key === 'key-a'
          ? { id: 'org-a' }
          : key === 'key-b'
          ? { id: 'org-b' }
          : null
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: new McpService(main) },
        { provide: OrganizationService, useValue: organizations },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        req: { path: string; query: { sessionId?: string } },
        _res: unknown,
        next: () => void
      ) => {
        if (req.path === '/mcp/key-a/messages') sessionA = req.query.sessionId;
        next();
      }
    );
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    process.env.NEXT_PUBLIC_BACKEND_URL = base;
  });

  afterAll(async () => {
    for (const client of clients) await client.close();
    await app.close();
    if (previousBackend === undefined)
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = previousBackend;
  });

  async function connect(key: string) {
    const client = new Client({ name: 'isolated-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(
      new SSEClientTransport(new URL(base + '/mcp/' + key + '/sse'))
    );
    return client;
  }

  it('does not mix identical JSON-RPC counters or break a peer when one client closes', async () => {
    const a = await connect('key-a');
    const b = await connect('key-a');
    const results = await Promise.all([
      a.callTool({
        name: 'POSTIZ_GET_POST',
        arguments: { postId: 'client-a-post' },
      }),
      b.callTool({
        name: 'POSTIZ_GET_POST',
        arguments: { postId: 'client-b-post' },
      }),
    ]);
    expect(results[0].content).toEqual([
      { type: 'text', text: 'client-a-post' },
    ]);
    expect(results[1].content).toEqual([
      { type: 'text', text: 'client-b-post' },
    ]);
    await a.close();
    const result = await b.callTool({
      name: 'POSTIZ_GET_POST',
      arguments: { postId: 'peer-still-connected' },
    });
    expect(result.content).toEqual([
      { type: 'text', text: 'peer-still-connected' },
    ]);
  });

  it('rejects an authenticated organization using another session', async () => {
    const response = await fetch(
      base + '/mcp/key-b/messages?sessionId=' + sessionA,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'ping' }),
      }
    );
    expect(response.status).toBe(403);
  });
});
