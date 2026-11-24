import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SocialReplyOperation } from '@prisma/client';
import { IntegrationRepository } from '../database/prisma/integrations/integration.repository';
import { ReplyOperationRepository } from '../database/prisma/integrations/reply.operation.repository';
import { IntegrationManager } from './integration.manager';
import type {
  ConversationRequest,
  ReplyRequest,
  SocialConversation,
} from './social/conversation';
import { z } from 'zod';

export const conversationRequest = z
  .object({
    integrationId: z.string().min(1).max(256),
    expectedActorId: z
      .string()
      .min(1)
      .max(256)
      .describe(
        'Native accountId from POSTIZ_PROVIDERS_LIST; never infer an account'
      ),
    postId: z
      .string()
      .min(1)
      .max(256)
      .describe('Native social publication ID, not a Postiz database ID'),
  })
  .strict();

export const replyRequest = conversationRequest.extend({
  commentId: z
    .string()
    .min(1)
    .max(256)
    .describe(
      'Exact native comment ID returned by POSTIZ_READ_SOCIAL_CONVERSATION'
    ),
  message: z
    .string()
    .min(1)
    .max(10000)
    .refine((value) => value.trim().length > 0),
  requestId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Stable operation ID: reuse on retries; never replace it to retry an unknown outcome'
    ),
});

@Injectable()
export class SocialCommentsService {
  constructor(
    private integrations: IntegrationRepository,
    private operations: ReplyOperationRepository,
    private manager: IntegrationManager
  ) {}

  private async channel(
    organizationId: string,
    integrationId: string,
    expectedActorId: string
  ) {
    if (!organizationId)
      throw new HttpException('Organization authentication is required', 401);
    const integration = await this.integrations.getIntegrationById(
      organizationId,
      integrationId
    );
    if (
      !integration ||
      integration.organizationId !== organizationId ||
      integration.deletedAt ||
      integration.disabled ||
      integration.refreshNeeded
    ) {
      throw new HttpException('Social channel is unavailable', 404);
    }
    if (integration.internalId !== expectedActorId) {
      throw new HttpException('Selected social account does not match', 409);
    }
    const provider = this.manager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider || !provider.socialConversation || !provider.socialReply) {
      throw new HttpException(
        'Social comments are not supported for this channel',
        400
      );
    }
    return { integration, provider };
  }

  async conversation(organizationId: string, input: ConversationRequest) {
    const parsed = conversationRequest.safeParse(input);
    if (!parsed.success)
      throw new HttpException('Invalid conversation request', 400);
    const { integration, provider } = await this.channel(
      organizationId,
      input.integrationId,
      input.expectedActorId
    );
    const result = await provider.socialConversation(integration, input.postId);
    if (
      result.actor.id !== input.expectedActorId ||
      result.post.id !== input.postId
    ) {
      throw new HttpException(
        'Social account or publication does not match',
        409
      );
    }
    return {
      integrationId: integration.id,
      provider: provider.identifier,
      ...result,
    };
  }

  private result(operation: SocialReplyOperation) {
    return {
      requestId: operation.requestId,
      integrationId: operation.integrationId,
      actorId: operation.actorId,
      postId: operation.postId,
      commentId: operation.commentId,
      status: operation.status,
      replyId: operation.replyId,
      permalink: operation.permalink,
      verified: operation.status === 'confirmed',
      retryAllowed: false,
    };
  }

  private async reconcile(
    operation: SocialReplyOperation,
    conversation: SocialConversation
  ) {
    const reply = conversation.comments.find(
      (item) => item.id === operation.replyId
    );
    if (
      reply &&
      reply.parentId === operation.commentId &&
      reply.rootId === operation.postId &&
      reply.author.id === operation.actorId
    ) {
      return this.result(
        await this.operations.update(operation.id, {
          status: 'confirmed',
          permalink: reply.permalink,
        })
      );
    }
    if (operation.status === 'confirmed') {
      return this.result(
        await this.operations.update(operation.id, { status: 'published' })
      );
    }
    return this.result(operation);
  }

  async reply(organizationId: string, input: ReplyRequest) {
    if (!organizationId)
      throw new HttpException('Organization authentication is required', 401);
    const parsed = replyRequest.safeParse(input);
    if (!parsed.success)
      throw new HttpException('Invalid social reply request', 400);
    const request = parsed.data;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          request.integrationId,
          request.expectedActorId,
          request.postId,
          request.commentId,
          request.message,
        ])
      )
      .digest('hex');
    const existing = await this.operations.find(
      organizationId,
      request.requestId
    );
    if (existing && existing.fingerprint !== fingerprint) {
      throw new HttpException(
        'Request ID already belongs to a different reply',
        409
      );
    }
    const conversation = await this.conversation(organizationId, {
      integrationId: request.integrationId,
      expectedActorId: request.expectedActorId,
      postId: request.postId,
    });
    if (existing) return this.reconcile(existing, conversation);
    if (
      !conversation.comments.some(
        (item) =>
          item.id === request.commentId && item.rootId === request.postId
      )
    ) {
      throw new HttpException(
        'Comment does not belong to this publication',
        404
      );
    }
    const { integration, provider } = await this.channel(
      organizationId,
      request.integrationId,
      request.expectedActorId
    );
    const operation = await this.operations.claim({
      organizationId,
      requestId: request.requestId,
      fingerprint,
      integrationId: request.integrationId,
      postId: request.postId,
      commentId: request.commentId,
      actorId: request.expectedActorId,
    });
    if (!operation) {
      const claimed = await this.operations.find(
        organizationId,
        request.requestId
      );
      if (!claimed || claimed.fingerprint !== fingerprint) {
        throw new HttpException('Conflicting social reply operation', 409);
      }
      return this.result(claimed);
    }
    let published: SocialReplyOperation;
    try {
      const replyId = await provider.socialReply(
        integration,
        request.commentId,
        request.message
      );
      if (!replyId) throw new Error('Missing native reply ID');
      published = await this.operations.update(operation.id, {
        status: 'published',
        replyId,
      });
    } catch {
      return this.result(
        await this.operations.update(operation.id, { status: 'unknown' })
      );
    }
    try {
      const verified = await this.conversation(organizationId, {
        integrationId: request.integrationId,
        expectedActorId: request.expectedActorId,
        postId: request.postId,
      });
      return this.reconcile(published, verified);
    } catch {
      return this.result(published);
    }
  }
}
