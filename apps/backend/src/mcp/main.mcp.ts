import { Injectable } from '@nestjs/common';
import { McpTool } from '@gitroom/nestjs-libraries/mcp/mcp.tool';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { string, array, enum as eenum, object, boolean, number } from 'zod';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import {
  EmptySettings,
  Post,
} from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';

@Injectable()
export class MainMcp {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _openAiService: OpenaiService
  ) {}

  @McpTool({ toolName: 'POSTIZ_GET_CONFIG_ID' })
  async preRun() {
    return [
      {
        type: 'text',
        text: `id: ${makeId(10)} Today date is ${dayjs.utc().format()}`,
      },
    ];
  }

  @McpTool({ toolName: 'POSTIZ_PROVIDERS_LIST' })
  async listOfProviders(organization: string) {
    const list = (
      await this._integrationService.getIntegrationsList(organization)
    ).map((org) => ({
      id: org.id,
      name: org.name,
      identifier: org.providerIdentifier,
      picture: org.picture,
      disabled: org.disabled,
      profile: org.profile,
      customer: org.customer
        ? { id: org.customer.id, name: org.customer.name }
        : undefined,
    }));
    return [{ type: 'text', text: JSON.stringify(list) }];
  }

  @McpTool({
    toolName: 'POSTIZ_SCHEDULE_POST',
    zod: {
      type: eenum(['draft', 'scheduled', 'update']),
      postId: string()
        .optional()
        .describe('Existing root post ID for an in-place update'),
      configId: string(),
      generatePictures: boolean(),
      date: string()
        .optional()
        .describe('ISO UTC time; required for scheduled creation'),
      providerId: string()
        .optional()
        .describe('One channel ID from POSTIZ_PROVIDERS_LIST'),
      providerIds: array(string())
        .min(1)
        .optional()
        .describe(
          'Selected channel IDs for one batch; use instead of providerId'
        ),
      posts: array(
        object({ text: string(), images: array(string().url()).optional() })
      ).min(1),
    },
  })
  async schedulePost(
    organization: string,
    obj: {
      type: 'draft' | 'scheduled' | 'update';
      generatePictures: boolean;
      date?: string;
      providerId?: string;
      providerIds?: string[];
      postId?: string;
      posts: { text: string; images?: string[] }[];
    }
  ) {
    if (obj.type === 'update') {
      if (!obj.postId || obj.generatePictures || obj.providerIds) {
        throw new Error(
          'Update requires postId and does not support generated pictures or channel changes'
        );
      }
      const existing = await this._postsService.getPostForMcp(
        organization,
        obj.postId,
        true
      );
      if (obj.providerId && obj.providerId !== existing.integrationId) {
        throw new Error('Update cannot change the channel');
      }
      const group = await this._postsService.getPost(organization, obj.postId);
      if (obj.posts.length !== group.posts.length) {
        throw new Error(
          'Update must contain every message in the existing group'
        );
      }
      const date = obj.date || existing.publishDate.toISOString();
      if (
        !dayjs(date).isValid() ||
        (existing.state === 'QUEUE' && !dayjs(date).isAfter(dayjs()))
      ) {
        throw new Error('Queued posts require a valid future date');
      }
      const result = await this._postsService.createPost(organization, {
        type: existing.state === 'DRAFT' ? 'draft' : 'schedule',
        date,
        shortLink: false,
        order: undefined,
        tags: existing.tags.map((entry) => ({
          value: entry.tag.id,
          label: entry.tag.name,
        })),
        posts: [
          {
            group: group.group,
            integration: { id: existing.integrationId },
            settings: group.settings,
            value: group.posts.map((post, index) => ({
              id: post.id,
              content: obj.posts[index].text,
              image:
                obj.posts[index].images === undefined
                  ? post.image
                  : obj.posts[index].images.map((path) => ({
                      id: makeId(10),
                      path: this.imageUrl(path),
                    })),
            })),
          },
        ],
      });
      return [
        {
          type: 'text',
          text: JSON.stringify({ action: 'updated', posts: result }),
        },
      ];
    }
    if (obj.providerId && obj.providerIds) {
      throw new Error('Use providerId or providerIds, not both');
    }
    const providers =
      obj.providerIds || (obj.providerId ? [obj.providerId] : []);
    if (!providers.length || new Set(providers).size !== providers.length) {
      throw new Error('Select at least one channel without duplicate IDs');
    }
    const available = await this._integrationService.getIntegrationsList(
      organization
    );
    if (
      providers.some(
        (id) =>
          !available.some((channel) => channel.id === id && !channel.disabled)
      )
    ) {
      throw new Error(
        'Every selected channel must belong to the current organization and be enabled'
      );
    }
    const date = obj.date || dayjs().toISOString();
    if (
      !dayjs(date).isValid() ||
      (obj.type === 'scheduled' && (!obj.date || !dayjs(date).isAfter(dayjs())))
    ) {
      throw new Error('Scheduled creation requires a valid future date');
    }
    const values = await Promise.all(
      obj.posts.map(async (post) => ({
        content: post.text,
        image: post.images?.length
          ? post.images.map((path) => ({
              id: makeId(10),
              path: this.imageUrl(path),
            }))
          : obj.generatePictures
          ? [
              {
                id: makeId(10),
                path: this.imageUrl(
                  await this._openAiService.generateImage(post.text, true)
                ),
              },
            ]
          : [],
      }))
    );
    const create = await this._postsService.createPost(organization, {
      date,
      type: obj.type === 'scheduled' ? 'schedule' : 'draft',
      shortLink: false,
      tags: [],
      order: undefined,
      posts: providers.map((providerId) => ({
        group: makeId(10),
        value: values.map((value) => ({ ...value, id: makeId(10) })),
        settings: new EmptySettings() as Post['settings'],
        integration: { id: providerId },
      })),
    });
    return [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'created',
          posts: create.map((post) => ({
            ...post,
            url: `${process.env.FRONTEND_URL}/p/${post.postId}`,
          })),
        }),
      },
    ];
  }

  @McpTool({ toolName: 'POSTIZ_GET_POST', zod: { postId: string() } })
  async getPost(organization: string, obj: { postId: string }) {
    const root = await this._postsService.getPostForMcp(
      organization,
      obj.postId
    );
    const group = await this._postsService.getPost(organization, obj.postId);
    return [
      {
        type: 'text',
        text: JSON.stringify({
          id: root.id,
          state: root.state,
          providerId: root.integrationId,
          date: root.publishDate,
          group: root.group,
          settings: group.settings,
          posts: group.posts.map((post) => ({
            id: post.id,
            text: post.content,
            images: post.image,
            state: post.state,
            parentPostId: post.parentPostId,
            releaseURL: post.releaseURL,
          })),
        }),
      },
    ];
  }

  @McpTool({ toolName: 'POSTIZ_DELETE_POST', zod: { postId: string() } })
  async deletePost(organization: string, obj: { postId: string }) {
    const post = await this._postsService.getPostForMcp(
      organization,
      obj.postId,
      true
    );
    await this._postsService.deletePost(organization, post.group);
    return [
      { type: 'text', text: JSON.stringify({ id: post.id, deleted: true }) },
    ];
  }

  @McpTool({
    toolName: 'POSTIZ_LIST_POSTS',
    zod: {
      year: number().int(),
      month: number().int().min(1).max(12),
      week: number().int().min(1).max(53),
      day: number().int().min(0).max(6),
      display: eenum(['day', 'week', 'month']),
    },
  })
  async listPosts(
    organization: string,
    obj: {
      year: number;
      month: number;
      week: number;
      day: number;
      display: 'day' | 'week' | 'month';
    }
  ) {
    const posts = await this._postsService.getPosts(organization, {
      ...obj,
      customer: undefined,
    });
    return [{ type: 'text', text: JSON.stringify(posts) }];
  }

  private imageUrl(path: string) {
    if (typeof path !== 'string' || new URL(path).protocol !== 'https:') {
      throw new Error('Images must use a valid public HTTPS URL');
    }
    return path;
  }
}
