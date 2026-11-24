import { mock } from 'jest-mock-extended';
import { Integration } from '@prisma/client';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';

describe('Facebook Page social conversations', () => {
  const original = global.fetch;
  const integration = mock<Integration>({
    internalId: 'selected-page',
    token: 'page-token',
  });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status });
  const page = { id: 'selected-page', name: 'Selected Page' };
  const post = {
    id: 'page-post',
    from: page,
    message: 'Post',
    permalink_url: 'https://www.facebook.com/page/posts/post',
  };
  afterEach(() => {
    global.fetch = original;
  });

  it('reads all stream pages with nested parents, authors, times and native permalinks', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(page))
      .mockResolvedValueOnce(json(post))
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'top',
              message: 'Question',
              from: { id: 'reader', name: 'Reader' },
            },
            {
              id: 'reply',
              message: 'Reply',
              parent: { id: 'top' },
              from: page,
              created_time: '2026-01-01T00:00:00+0000',
              permalink_url: 'https://www.facebook.com/comment/reply',
            },
          ],
          paging: {
            next: 'https://graph.facebook.com/next',
            cursors: { after: 'next-page' },
          },
        })
      )
      .mockResolvedValueOnce(
        json({
          data: [
            { id: 'nested', message: 'Nested', parent: { id: 'reply' } },
            {
              id: 'top',
              message: 'Question',
              from: { id: 'reader', name: 'Reader' },
            },
          ],
        })
      );
    global.fetch = fetcher;
    const result = await new FacebookProvider().socialConversation(
      integration,
      'page-post'
    );
    expect(result.comments.map((x) => [x.id, x.parentId])).toEqual([
      ['top', 'page-post'],
      ['reply', 'top'],
      ['nested', 'reply'],
    ]);
    expect(result.comments[1]).toMatchObject({
      author: { id: page.id, name: page.name },
      timestamp: '2026-01-01T00:00:00+0000',
      permalink: 'https://www.facebook.com/comment/reply',
    });
    expect(result.comments[2]).toMatchObject({
      author: { id: null, name: null },
      permalink: null,
    });
    expect(result.post.permalink).toBe(post.permalink_url);
    for (const call of fetcher.mock.calls.slice(2))
      expect(new URL(call[0]).searchParams.get('filter')).toBe('stream');
    expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('after')).toBe(
      'next-page'
    );
    expect(
      fetcher.mock.calls.every(
        ([url, options]) =>
          !String(url).includes('page-token') &&
          options.headers.Authorization === 'Bearer page-token'
      )
    ).toBe(true);
  });

  it('rejects a token for a different Page before any social write', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(json({ id: 'music-page' }));
    global.fetch = fetcher;
    await expect(
      new FacebookProvider().socialReply(integration, 'comment', 'Reply')
    ).rejects.toThrow('selected Page');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a publication by another author before reading its comments', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(page))
      .mockResolvedValueOnce(json({ ...post, from: { id: 'other-page' } }));
    global.fetch = fetcher;
    await expect(
      new FacebookProvider().socialConversation(integration, 'page-post')
    ).rejects.toThrow('does not belong');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('replies to the exact comment rather than the root post', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(page))
      .mockResolvedValueOnce(json({ id: 'native-reply' }));
    global.fetch = fetcher;
    expect(
      await new FacebookProvider().socialReply(
        integration,
        'target-comment',
        'Approved text'
      )
    ).toBe('native-reply');
    expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe(
      '/v27.0/target-comment/comments'
    );
    expect(fetcher.mock.calls[1][1].body.get('message')).toBe('Approved text');
  });

  it('does not retry an ambiguous POST and reports a permission failure without a retry', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(page))
      .mockRejectedValueOnce(new Error('Lost response'));
    global.fetch = fetcher;
    await expect(
      new FacebookProvider().socialReply(integration, 'target', 'Reply')
    ).rejects.toThrow('outcome');
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher
      .mockReset()
      .mockResolvedValueOnce(json(page))
      .mockResolvedValueOnce(json({ error: { code: 200 } }, 403));
    await expect(
      new FacebookProvider().socialReply(integration, 'target', 'Reply')
    ).rejects.toThrow('HTTP 403');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
