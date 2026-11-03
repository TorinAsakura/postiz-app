import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { MainMcp } from './main.mcp';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';

function setup() {
  const integrations = mock<IntegrationService>();
  const posts = mock<PostsService>();
  const ai = mock<OpenaiService>();
  integrations.getIntegrationsList.mockResolvedValue([
    { id: 'channel-a', disabled: false },
    { id: 'channel-b', disabled: false },
  ] as Awaited<ReturnType<IntegrationService['getIntegrationsList']>>);
  posts.createPost.mockResolvedValue([
    { postId: 'root', integration: 'channel-a' },
  ]);
  const root = mock<Awaited<ReturnType<PostsService['getPostForMcp']>>>({
    id: 'root',
    integrationId: 'channel-a',
    group: 'group',
    state: 'DRAFT',
    publishDate: new Date('2099-01-01T12:00:00Z'),
    integration: mock<
      Awaited<ReturnType<PostsService['getPostForMcp']>>['integration']
    >({ token: 'must-not-leak' }),
    tags: [{ tag: { id: 'tag', name: 'Campaign' } }],
  });
  posts.getPostForMcp.mockResolvedValue(root);
  return {
    integrations,
    posts,
    ai,
    root,
    mcp: new MainMcp(integrations, posts, ai),
  };
}

describe('Postiz MCP authoring', () => {
  it('creates a draft with the supplied image without generating a replacement', async () => {
    const { mcp, posts, ai } = setup();
    const image = 'https://media.example.test/approved.png';
    await mcp.schedulePost('org', {
      type: 'draft',
      generatePictures: false,
      providerId: 'channel-a',
      posts: [{ text: 'Approved text #Atlantis #Hiring', images: [image] }],
    });
    expect(posts.createPost).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({
        type: 'draft',
        shortLink: false,
        posts: [
          expect.objectContaining({
            integration: { id: 'channel-a' },
            value: [
              expect.objectContaining({
                content: 'Approved text #Atlantis #Hiring',
                image: [expect.objectContaining({ path: image })],
              }),
            ],
          }),
        ],
      })
    );
    expect(ai.generateImage).not.toHaveBeenCalled();
  });

  it('passes all selected channels in one native creation request', async () => {
    const { mcp, posts } = setup();
    await mcp.schedulePost('org', {
      type: 'draft',
      generatePictures: false,
      providerIds: ['channel-a', 'channel-b'],
      posts: [
        {
          text: 'First message',
          images: ['https://media.example.test/approved.png'],
        },
        { text: 'Continuation' },
      ],
    });
    expect(posts.createPost).toHaveBeenCalledTimes(1);
    const body = posts.createPost.mock.calls[0][1];
    expect(body.posts.map((post) => post.integration.id)).toEqual([
      'channel-a',
      'channel-b',
    ]);
    expect(
      body.posts.map((post) => post.value.map((value) => value.content))
    ).toEqual([
      ['First message', 'Continuation'],
      ['First message', 'Continuation'],
    ]);
    expect(body.posts[0].value[0].id).not.toBe(body.posts[1].value[0].id);
  });

  it('rejects an unavailable channel before creating any records', async () => {
    const { mcp, posts } = setup();
    await expect(
      mcp.schedulePost('org', {
        type: 'draft',
        generatePictures: false,
        providerIds: ['channel-a', 'other-org'],
        posts: [{ text: 'Text' }],
      })
    ).rejects.toThrow('Every selected channel');
    expect(posts.createPost).not.toHaveBeenCalled();
  });

  it('maps scheduled creation to the native schedule state', async () => {
    const { mcp, posts } = setup();
    await mcp.schedulePost('org', {
      type: 'scheduled',
      date: '2099-01-01T12:00:00Z',
      generatePictures: false,
      providerId: 'channel-a',
      posts: [{ text: 'Text' }],
    });
    expect(posts.createPost.mock.calls[0][1].type).toBe('schedule');
  });

  it('rejects past schedules and local image paths without creating posts', async () => {
    const { mcp, posts } = setup();
    await expect(
      mcp.schedulePost('org', {
        type: 'scheduled',
        date: '2000-01-01T12:00:00Z',
        generatePictures: false,
        providerId: 'channel-a',
        posts: [{ text: 'Text' }],
      })
    ).rejects.toThrow('future date');
    await expect(
      mcp.schedulePost('org', {
        type: 'draft',
        generatePictures: false,
        providerId: 'channel-a',
        posts: [{ text: 'Text', images: ['file:///tmp/image.png'] }],
      })
    ).rejects.toThrow('public HTTPS');
    expect(posts.createPost).not.toHaveBeenCalled();
  });

  it('updates the existing complete group while retaining IDs, settings, tags and media', async () => {
    const { mcp, posts } = setup();
    const image = [
      { id: 'media', path: 'https://media.example.test/approved.png' },
    ];
    posts.getPost.mockResolvedValue({
      group: 'group',
      integration: 'channel-a',
      integrationPicture: '',
      settings: { reply: false },
      posts: [
        { id: 'root', image },
        { id: 'child', image: [] },
      ],
    } as Awaited<ReturnType<PostsService['getPost']>>);
    await mcp.schedulePost('org', {
      type: 'update',
      postId: 'root',
      generatePictures: false,
      posts: [
        { text: 'Updated photo caption #Atlantis' },
        { text: 'Updated continuation #Hiring' },
      ],
    });
    const body = posts.createPost.mock.calls[0][1];
    expect(body.type).toBe('draft');
    expect(body.tags).toEqual([{ value: 'tag', label: 'Campaign' }]);
    expect(body.posts[0]).toEqual(
      expect.objectContaining({
        group: 'group',
        integration: { id: 'channel-a' },
        settings: { reply: false },
        value: [
          { id: 'root', content: 'Updated photo caption #Atlantis', image },
          { id: 'child', content: 'Updated continuation #Hiring', image: [] },
        ],
      })
    );
  });

  it('deletes by the validated group without reading or processing attached images', async () => {
    const { mcp, posts } = setup();
    const result = await mcp.deletePost('org', { postId: 'root' });
    expect(posts.getPostForMcp).toHaveBeenCalledWith('org', 'root', true);
    expect(posts.getPost).not.toHaveBeenCalled();
    expect(posts.deletePost).toHaveBeenCalledWith('org', 'group');
    expect(JSON.parse(result[0].text)).toEqual({ id: 'root', deleted: true });
  });

  it('returns the saved copy and media without exposing integration credentials', async () => {
    const { mcp, posts } = setup();
    posts.getPost.mockResolvedValue({
      settings: {},
      posts: [{ id: 'root', content: 'Saved text', image: [] }],
    } as Awaited<ReturnType<PostsService['getPost']>>);
    const result = await mcp.getPost('org', { postId: 'root' });
    expect(JSON.parse(result[0].text).posts[0].text).toBe('Saved text');
    expect(result[0].text).not.toContain('must-not-leak');
  });
});

describe('Postiz MCP mutation authorization', () => {
  it.each([
    null,
    { deletedAt: new Date(), parentPostId: null },
    { deletedAt: null, parentPostId: 'parent' },
    { deletedAt: null, parentPostId: null, state: 'PUBLISHED' },
    { deletedAt: null, parentPostId: null, state: 'ERROR' },
    {
      deletedAt: null,
      parentPostId: null,
      state: 'DRAFT',
      submittedForOrderId: 'order',
    },
  ])(
    'rejects unavailable, child, terminal or submitted posts',
    async (post) => {
      const repository = { getPostById: jest.fn().mockResolvedValue(post) };
      await expect(
        PostsService.prototype.getPostForMcp.call(
          { _postRepository: repository },
          'org',
          'root',
          true
        )
      ).rejects.toThrow();
      expect(repository.getPostById).toHaveBeenCalledWith('root', 'org');
    }
  );
});
