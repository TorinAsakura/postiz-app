import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import {
  Integration,
  Organization,
  SocialReplyOperation,
} from '@prisma/client';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { ReplyOperationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/reply.operation.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/integrations/social.comments.service';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  SocialComment,
  SocialConversation,
} from '@gitroom/nestjs-libraries/integrations/social/conversation';
import { ThreadsProvider } from '@gitroom/nestjs-libraries/integrations/social/threads.provider';
import { MainMcp } from './main.mcp';
import { SocialCommentsController } from '../public-api/routes/v1/social.comments.controller';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { McpSettings } from '@gitroom/nestjs-libraries/mcp/mcp.settings';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const input = {
  integrationId: 'channel',
  expectedActorId: 'account',
  postId: 'post',
  commentId: 'comment',
  message: 'Approved reply',
  requestId: 'one-operation',
};
const comment: SocialComment = {
  id: 'comment',
  rootId: 'post',
  parentId: 'post',
  text: 'Question',
  author: { id: null, username: 'reader', name: null },
  timestamp: null,
  permalink: null,
};
const conversation: SocialConversation = {
  actor: { id: 'account', username: 'selected', name: null },
  post: {
    ...comment,
    id: 'post',
    parentId: null,
    author: { id: 'account', username: 'selected', name: null },
  },
  comments: [comment],
};

function setup() {
  const integrations = mock<IntegrationRepository>();
  const operations = mock<ReplyOperationRepository>();
  const manager = mock<IntegrationManager>();
  const provider = mock<SocialProvider>();
  integrations.getIntegrationById.mockResolvedValue(
    mock<Integration>({
      id: 'channel',
      organizationId: 'org',
      internalId: 'account',
      providerIdentifier: 'threads',
      deletedAt: null,
      disabled: false,
      refreshNeeded: false,
      token: 'private-token',
    })
  );
  manager.getSocialIntegration.mockReturnValue(provider);
  provider.socialConversation.mockResolvedValue(conversation);
  provider.socialReply.mockResolvedValue('native-reply');
  const operation = mock<SocialReplyOperation>({
    id: 'operation',
    organizationId: 'org',
    requestId: input.requestId,
    integrationId: 'channel',
    actorId: 'account',
    postId: 'post',
    commentId: 'comment',
    status: 'pending',
    replyId: null,
    permalink: null,
  });
  operations.claim.mockResolvedValue(operation);
  operations.update.mockImplementation(async (_id, data) =>
    Object.assign(operation, data)
  );
  return {
    integrations,
    operations,
    provider,
    operation,
    service: new SocialCommentsService(integrations, operations, manager),
  };
}

describe('social comment operations', () => {
  it('returns a conversation without credentials', async () => {
    const { service, integrations } = setup();
    const { commentId, message, requestId, ...query } = input;
    const result = await service.conversation('org', query);
    expect(result.comments).toEqual([comment]);
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(integrations.getIntegrationById).toHaveBeenCalledWith(
      'org',
      'channel'
    );
  });

  it('rejects a missing organization before looking up an operation', async () => {
    const { service, operations, provider } = setup();
    await expect(service.reply('', input)).rejects.toThrow('authentication');
    expect(operations.find).not.toHaveBeenCalled();
    expect(provider.socialReply).not.toHaveBeenCalled();
  });

  it('rejects another organization, changed actor and unrelated comments without sending', async () => {
    const { service, integrations, provider } = setup();
    await expect(
      service.reply('org', { ...input, expectedActorId: 'music-account' })
    ).rejects.toThrow('account');
    await expect(
      service.reply('org', { ...input, commentId: 'another-post-comment' })
    ).rejects.toThrow('publication');
    integrations.getIntegrationById.mockResolvedValue(
      mock<Integration>({ organizationId: 'other' })
    );
    await expect(service.reply('org', input)).rejects.toThrow('unavailable');
    expect(provider.socialReply).not.toHaveBeenCalled();
  });

  it('confirms the native reply under the exact parent and selected actor', async () => {
    const { service, provider } = setup();
    provider.socialConversation
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce({
        ...conversation,
        comments: [
          ...conversation.comments,
          {
            ...comment,
            id: 'native-reply',
            parentId: 'comment',
            author: { id: 'account', username: 'selected', name: null },
            permalink: 'https://www.threads.net/@selected/post/reply',
          },
        ],
      });
    const result = await service.reply('org', input);
    expect(result).toMatchObject({
      status: 'confirmed',
      verified: true,
      replyId: 'native-reply',
    });
    expect(provider.socialReply).toHaveBeenCalledTimes(1);
    expect(provider.socialReply.mock.calls[0].slice(1)).toEqual([
      'comment',
      'Approved reply',
    ]);
  });

  it('does not claim verification for the wrong parent or author', async () => {
    const { service, provider } = setup();
    provider.socialConversation.mockResolvedValue({
      ...conversation,
      comments: [
        comment,
        {
          ...comment,
          id: 'native-reply',
          parentId: 'another-comment',
          author: { id: 'other', username: 'other', name: null },
        },
      ],
    });
    expect(await service.reply('org', input)).toMatchObject({
      status: 'published',
      verified: false,
    });
  });

  it('does not resend after a lost response, including a new service instance', async () => {
    const { service, operations, provider, operation, integrations } = setup();
    provider.socialReply.mockRejectedValueOnce(
      new Error('Connection lost after send')
    );
    expect(await service.reply('org', input)).toMatchObject({
      status: 'unknown',
      retryAllowed: false,
    });
    operation.fingerprint = operations.claim.mock.calls[0][0].fingerprint;
    operations.find.mockResolvedValue(operation);
    const manager = mock<IntegrationManager>();
    manager.getSocialIntegration.mockReturnValue(provider);
    const restarted = new SocialCommentsService(
      integrations,
      operations,
      manager
    );
    expect(await restarted.reply('org', input)).toMatchObject({
      status: 'unknown',
      verified: false,
    });
    expect(provider.socialReply).toHaveBeenCalledTimes(1);
  });

  it('rejects reusing an operation ID for different content', async () => {
    const { service, operations, operation, provider } = setup();
    operation.fingerprint = 'different-request';
    operations.find.mockResolvedValue(operation);
    await expect(service.reply('org', input)).rejects.toThrow(
      'different reply'
    );
    expect(provider.socialReply).not.toHaveBeenCalled();
  });

  it('rejects an account reconnected during preflight without claiming or sending', async () => {
    const { service, integrations, operations, provider } = setup();
    integrations.getIntegrationById
      .mockResolvedValueOnce(
        mock<Integration>({
          id: 'channel',
          organizationId: 'org',
          internalId: 'account',
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
        })
      )
      .mockResolvedValueOnce(
        mock<Integration>({
          id: 'channel',
          organizationId: 'org',
          internalId: 'music-account',
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
        })
      );
    await expect(service.reply('org', input)).rejects.toThrow('account');
    expect(operations.claim).not.toHaveBeenCalled();
    expect(provider.socialReply).not.toHaveBeenCalled();
  });

  it('does not report a disappeared saved reply as currently verified', async () => {
    const { service, operations, operation, provider } = setup();
    await service.reply('org', input);
    operation.fingerprint = operations.claim.mock.calls[0][0].fingerprint;
    operation.status = 'confirmed';
    operations.find.mockResolvedValue(operation);
    expect(await service.reply('org', input)).toMatchObject({
      status: 'published',
      verified: false,
    });
    expect(provider.socialReply).toHaveBeenCalledTimes(1);
  });

  it('does not send when the database claim is already owned by a concurrent request', async () => {
    const { service, operations, operation, provider } = setup();
    operations.claim.mockImplementationOnce(async (data) => {
      operation.fingerprint = data.fingerprint;
      return null;
    });
    operations.find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(operation);
    expect(await service.reply('org', input)).toMatchObject({
      status: 'pending',
      verified: false,
    });
    expect(provider.socialReply).not.toHaveBeenCalled();
  });

  it('retains the native ID when readback fails and never resends it', async () => {
    const { service, operations, operation, provider } = setup();
    provider.socialConversation
      .mockResolvedValueOnce(conversation)
      .mockRejectedValueOnce(new Error('Read failed'));
    expect(await service.reply('org', input)).toMatchObject({
      status: 'published',
      replyId: 'native-reply',
      verified: false,
    });
    operation.fingerprint = operations.claim.mock.calls[0][0].fingerprint;
    operations.find.mockResolvedValue(operation);
    provider.socialConversation.mockResolvedValue(conversation);
    await service.reply('org', input);
    expect(provider.socialReply).toHaveBeenCalledTimes(1);
  });

  it('passes the same explicit actor and parent through API and MCP', async () => {
    const service = mock<SocialCommentsService>();
    const controller = new SocialCommentsController(service);
    const mcp = new MainMcp(
      mock<IntegrationService>(),
      mock<PostsService>(),
      mock<OpenaiService>(),
      service
    );
    await controller.reply(mock<Organization>({ id: 'org' }), input);
    await mcp.replyToSocialComment('org', input);
    expect(service.reply).toHaveBeenNthCalledWith(1, 'org', input);
    expect(service.reply).toHaveBeenNthCalledWith(2, 'org', input);
  });

  it('advertises and invokes the new tools through the native MCP protocol', async () => {
    const service = mock<SocialCommentsService>();
    service.conversation.mockResolvedValue({
      ...conversation,
      integrationId: 'channel',
      provider: 'threads',
    });
    service.reply.mockResolvedValue({
      requestId: 'one-operation',
      integrationId: 'channel',
      actorId: 'account',
      postId: 'post',
      commentId: 'comment',
      status: 'confirmed',
      replyId: 'native-reply',
      permalink: null,
      verified: true,
      retryAllowed: false,
    });
    const mcp = new MainMcp(
      mock<IntegrationService>(),
      mock<PostsService>(),
      mock<OpenaiService>(),
      service
    );
    const server = McpSettings.load('org', mcp).server();
    const client = new Client({
      name: 'comment-contract-test',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'POSTIZ_READ_SOCIAL_CONVERSATION',
          'POSTIZ_REPLY_TO_SOCIAL_COMMENT',
        ])
      );
      const { commentId, message, requestId, ...query } = input;
      await client.callTool({
        name: 'POSTIZ_READ_SOCIAL_CONVERSATION',
        arguments: query,
      });
      const result = await client.callTool({
        name: 'POSTIZ_REPLY_TO_SOCIAL_COMMENT',
        arguments: input,
      });
      expect(service.conversation).toHaveBeenCalledWith('org', query);
      expect(service.reply).toHaveBeenCalledWith('org', input);
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).toContain('native-reply');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('Threads conversation provider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const integration = mock<Integration>({
    internalId: 'account',
    token: 'private-token',
  });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it('reads every page, retains nesting and does not manufacture missing permalinks', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json({ id: 'account', username: 'selected' }))
      .mockResolvedValueOnce(
        json({ id: 'post', username: 'selected', text: 'Root' })
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'comment',
              username: 'reader',
              text: 'Question',
              root_post: { id: 'post' },
              replied_to: { id: 'post' },
            },
          ],
          paging: {
            next: 'https://graph.threads.net/opaque',
            cursors: { after: 'next-page' },
          },
        })
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'child',
              username: 'selected',
              text: 'Reply',
              is_reply_owned_by_me: true,
              root_post: { id: 'post' },
              replied_to: { id: 'comment' },
            },
          ],
        })
      );
    global.fetch = fetcher;
    const result = await new ThreadsProvider().socialConversation(
      integration,
      'post'
    );
    expect(result.comments.map((entry) => [entry.id, entry.parentId])).toEqual([
      ['comment', 'post'],
      ['child', 'comment'],
    ]);
    expect(result.comments[0].permalink).toBeNull();
    expect(result.comments[1].author.id).toBe('account');
    expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('after')).toBe(
      'next-page'
    );
    expect(
      fetcher.mock.calls.every(
        ([url]) => !String(url).includes('private-token')
      )
    ).toBe(true);
  });

  it('fails on missing read permissions rather than reporting an empty conversation', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json({ id: 'account', username: 'selected' }))
      .mockResolvedValueOnce(json({ id: 'post', username: 'selected' }))
      .mockResolvedValueOnce(
        json({ error: { code: 10, message: 'private-token' } }, 403)
      );
    global.fetch = fetcher;
    await expect(
      new ThreadsProvider().socialConversation(integration, 'post')
    ).rejects.toThrow('HTTP 403');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects a mismatched token before creating any reply', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        json({ id: 'personal-account', username: 'personal' })
      );
    global.fetch = fetcher;
    await expect(
      new ThreadsProvider().socialReply(integration, 'comment', 'Reply')
    ).rejects.toThrow('another account');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates and publishes a reply once without retrying a timed out publish', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json({ id: 'account', username: 'selected' }))
      .mockResolvedValueOnce(json({ id: 'container' }))
      .mockResolvedValueOnce(json({ status: 'FINISHED' }))
      .mockRejectedValueOnce(new Error('Response lost'));
    global.fetch = fetcher;
    await expect(
      new ThreadsProvider().socialReply(integration, 'comment', 'Reply')
    ).rejects.toThrow('outcome');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[1][1].body.get('reply_to_id')).toBe('comment');
    expect(fetcher.mock.calls[3][1].body.get('creation_id')).toBe('container');
  });
});
