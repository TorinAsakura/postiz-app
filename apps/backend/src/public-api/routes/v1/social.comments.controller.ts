import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/integrations/social.comments.service';
import type {
  ConversationRequest,
  ReplyRequest,
} from '@gitroom/nestjs-libraries/integrations/social/conversation';

@Controller('/public/v1/social-comments')
export class SocialCommentsController {
  constructor(private comments: SocialCommentsService) {}

  @Get('/conversation')
  conversation(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ConversationRequest
  ) {
    return this.comments.conversation(org.id, query);
  }

  @Post('/reply')
  reply(@GetOrgFromRequest() org: Organization, @Body() body: ReplyRequest) {
    return this.comments.reply(org.id, body);
  }
}
