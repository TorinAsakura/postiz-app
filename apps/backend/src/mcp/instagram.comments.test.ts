import { mock } from 'jest-mock-extended';
import { Integration } from '@prisma/client';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

describe('Instagram social conversations', () => {
  const original = global.fetch;
  const integration = mock<Integration>({
    internalId: 'ig-account',
    token: 'page-token___user-token',
  });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status });
  const identity = {
    id: 'fb-page',
    instagram_business_account: { id: 'ig-account', username: 'selected' },
  };
  const media = {
    id: 'media',
    owner: { id: 'ig-account' },
    caption: 'Caption',
    permalink: 'https://www.instagram.com/p/approved/',
  };
  afterEach(() => {
    global.fetch = original;
  });

  it('reads all comment and nested reply pages with authors, IDs and real parent relationships', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(identity))
      .mockResolvedValueOnce(json(media))
      .mockResolvedValueOnce(
        json({
          data: [{ id: 'top-a', text: 'A', username: 'reader' }],
          paging: {
            next: 'https://graph.facebook.com/next',
            cursors: { after: 'top-next' },
          },
        })
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'top-b',
              text: 'B',
              from: { id: 'reader-id', username: 'reader-two' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'reply-a',
              text: 'Answer',
              from: { id: 'ig-account', username: 'selected' },
              parent_id: 'top-a',
              timestamp: '2026-01-01T00:00:00Z',
            },
          ],
          paging: {
            next: 'https://graph.facebook.com/next',
            cursors: { after: 'reply-next' },
          },
        })
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'reply-b',
              text: 'Follow-up',
              username: 'reader',
              parent_id: 'top-a',
            },
          ],
        })
      )
      .mockResolvedValueOnce(json({ data: [] }));
    global.fetch = fetcher;
    const result = await new InstagramProvider().socialConversation(
      integration,
      'media'
    );
    expect(result.comments.map((x) => [x.id, x.parentId])).toEqual([
      ['top-a', 'media'],
      ['reply-a', 'top-a'],
      ['reply-b', 'top-a'],
      ['top-b', 'media'],
    ]);
    expect(result.comments.find((x) => x.id === 'reply-a')).toMatchObject({
      author: { id: 'ig-account', username: 'selected' },
      timestamp: '2026-01-01T00:00:00Z',
      permalink: null,
    });
    expect(result.post.permalink).toBe(media.permalink);
    expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('after')).toBe(
      'top-next'
    );
    expect(new URL(fetcher.mock.calls[5][0]).searchParams.get('after')).toBe(
      'reply-next'
    );
    expect(
      fetcher.mock.calls.every(
        ([url, options]) =>
          !String(url).includes('page-token') &&
          options.headers.Authorization === 'Bearer page-token'
      )
    ).toBe(true);
  });

  it('rejects a different linked account before reading or writing media', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        json({
          id: 'fb-page',
          instagram_business_account: {
            id: 'music-account',
            username: 'music',
          },
        })
      );
    global.fetch = fetcher;
    await expect(
      new InstagramProvider().socialReply(integration, 'comment', 'Reply')
    ).rejects.toThrow('selected Instagram');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a publication owned by another Instagram account', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(identity))
      .mockResolvedValueOnce(json({ ...media, owner: { id: 'other' } }));
    global.fetch = fetcher;
    await expect(
      new InstagramProvider().socialConversation(integration, 'media')
    ).rejects.toThrow('does not belong');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('replies to the exact comment replies edge rather than creating a new media comment', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(identity))
      .mockResolvedValueOnce(json({ id: 'native-reply' }));
    global.fetch = fetcher;
    expect(
      await new InstagramProvider().socialReply(
        integration,
        'target-comment',
        'Approved text'
      )
    ).toBe('native-reply');
    expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe(
      '/v27.0/target-comment/replies'
    );
    expect(fetcher.mock.calls[1][1].body.get('message')).toBe('Approved text');
  });

  it('does not retry an ambiguous social POST', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(json(identity))
      .mockRejectedValueOnce(new Error('Lost response'));
    global.fetch = fetcher;
    await expect(
      new InstagramProvider().socialReply(
        integration,
        'target-comment',
        'Reply'
      )
    ).rejects.toThrow('outcome');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
