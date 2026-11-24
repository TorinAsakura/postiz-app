import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { META_GRAPH_VERSION, SocialGraph } from './graph';
import type { SocialConversation } from './conversation';

const facebookAuthor = z.object({ id: z.string(), name: z.string().nullish() });
const facebookComment = z.object({
  id: z.string(),
  message: z.string().nullish(),
  from: facebookAuthor.nullish(),
  created_time: z.string().nullish(),
  parent: z.object({ id: z.string() }).nullish(),
  permalink_url: z.string().nullish(),
});

export class FacebookProvider extends SocialAbstract implements SocialProvider {
  identifier = 'facebook';
  name = 'Facebook Page';
  isBetweenSteps = true;
  scopes = [
    'pages_show_list',
    'business_management',
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement',
    'pages_read_user_content',
    'read_insights',
  ];

  private socialGraph(integration: Integration) {
    return new SocialGraph('https://graph.facebook.com', integration.token);
  }

  private async socialIdentity(integration: Integration, graph: SocialGraph) {
    const page = facebookAuthor.parse(
      await graph.request('/' + META_GRAPH_VERSION + '/me', 'id,name')
    );
    if (page.id !== integration.internalId)
      throw new HttpException(
        'Facebook token is not for the selected Page',
        409
      );
    return { id: page.id, username: null, name: page.name || null };
  }

  async socialConversation(
    integration: Integration,
    postId: string
  ): Promise<SocialConversation> {
    const graph = this.socialGraph(integration);
    const actor = await this.socialIdentity(integration, graph);
    const path = '/' + META_GRAPH_VERSION + '/' + encodeURIComponent(postId);
    const post = facebookComment.parse(
      await graph.request(
        path,
        'id,message,from{id,name},created_time,permalink_url'
      )
    );
    if (post.id !== postId || post.from?.id !== actor.id)
      throw new HttpException(
        'Facebook post does not belong to this Page',
        409
      );
    // The stream filter includes every comment level; parent IDs retain the tree.
    const entries = await graph.pages(
      path + '/comments?filter=stream',
      'id,message,from{id,name},created_time,parent{id},permalink_url'
    );
    const normalize = (
      entry: z.infer<typeof facebookComment>,
      parentId: string | null
    ) => ({
      id: entry.id,
      parentId,
      rootId: postId,
      text: entry.message || '',
      author: {
        id: entry.from?.id || null,
        username: null,
        name: entry.from?.name || null,
      },
      timestamp: entry.created_time || null,
      permalink: entry.permalink_url || null,
    });
    const comments = new Map(
      entries.map((raw) => {
        const entry = facebookComment.parse(raw);
        return [entry.id, normalize(entry, entry.parent?.id || postId)];
      })
    );
    return {
      actor,
      post: normalize(post, null),
      comments: Array.from(comments.values()),
    };
  }

  async socialReply(
    integration: Integration,
    commentId: string,
    message: string
  ): Promise<string> {
    const graph = this.socialGraph(integration);
    await this.socialIdentity(integration, graph);
    const result = z
      .object({ id: z.string().min(1) })
      .parse(
        await graph.request(
          '/' +
            META_GRAPH_VERSION +
            '/' +
            encodeURIComponent(commentId) +
            '/comments',
          undefined,
          new URLSearchParams({ message })
        )
      );
    return result.id;
  }
  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/facebook`
        )}` +
        `&state=${state}` +
        `&scope=${this.scopes.join(',')}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<AuthTokenDetails> {
    const information = await this.fetchPageInformation(
      accessToken,
      requiredId
    );

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      refreshToken: information.access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: information.picture,
      username: information.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const getAccessToken = await (
      await this.fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/facebook${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token } = await (
      await this.fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}&fields=access_token,expires_in`
      )
    ).json();

    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const {
      id,
      name,
      picture: {
        data: { url },
      },
    } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: url,
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,username,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    return data;
  }

  async fetchPageInformation(accessToken: string, pageId: string) {
    const {
      id,
      name,
      access_token,
      username,
      picture: {
        data: { url },
      },
    } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${pageId}?fields=username,access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name,
      access_token,
      picture: url,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    let finalId = '';
    let finalUrl = '';
    if ((firstPost?.media?.[0]?.url?.indexOf('mp4') || -2) > -1) {
      const {
        id: videoId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/videos?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_url: firstPost?.media?.[0]?.url!,
              description: firstPost.message,
              published: true,
            }),
          },
          'upload mp4'
        )
      ).json();

      finalUrl = 'https://www.facebook.com/reel/' + videoId;
      finalId = videoId;
    } else {
      const uploadPhotos = !firstPost?.media?.length
        ? []
        : await Promise.all(
            firstPost.media.map(async (media) => {
              const { id: photoId } = await (
                await this.fetch(
                  `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      url: media.url,
                      published: false,
                    }),
                  },
                  'upload images slides'
                )
              ).json();

              return { media_fbid: photoId };
            })
          );

      const {
        id: postId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/feed?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(uploadPhotos?.length ? { attached_media: uploadPhotos } : {}),
              message: firstPost.message,
              published: true,
            }),
          },
          'finalize upload'
        )
      ).json();

      finalUrl = permalink_url;
      finalId = postId;
    }

    const postsArray = [];
    for (const comment of comments) {
      const data = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${finalId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(comment.media?.length
                ? { attachment_url: comment.media[0].url }
                : {}),
              message: comment.message,
            }),
          },
          'add comment'
        )
      ).json();

      postsArray.push({
        id: comment.id,
        postId: data.id,
        releaseURL: data.permalink_url,
        status: 'success',
      });
    }
    return [
      {
        id: firstPost.id,
        postId: finalId,
        releaseURL: finalUrl,
        status: 'success',
      },
      ...postsArray,
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, error } = await (
      await fetch(
        `https://graph.facebook.com/v25.0/${id}/insights?metric=page_total_media_view_unique,page_media_view,page_post_engagements,page_daily_follows&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    if (error) {
      throw new Error(error.message);
    }

    const sumValue = (value: any): number => {
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, number>).reduce(
          (sum: number, v: number) => sum + (Number(v) || 0),
          0
        );
      }
      return Number(value) || 0;
    };

    return (
      data?.map((d: any) => ({
        label:
          d.name === 'page_total_media_view_unique'
            ? 'Page Impressions'
            : d.name === 'page_post_engagements'
            ? 'Posts Engagement'
            : d.name === 'page_daily_follows'
            ? 'Page followers'
            : 'Media views',
        percentageChange: 5,
        data: d?.values?.map((v: any) => ({
          total: sumValue(v.value),
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || []
    );
  }
}
