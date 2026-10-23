import { FacebookProvider } from './social/facebook.provider';
import { InstagramProvider } from './social/instagram.provider';
import { BadBody, RefreshToken, SocialAbstract } from './social.abstract';

class GenericSocialProvider extends SocialAbstract {}

describe('SocialAbstract Meta authentication errors', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  async function expectFailure(
    provider: SocialAbstract,
    status: number,
    body: unknown,
    error: typeof BadBody | typeof RefreshToken
  ) {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(body), { status })
      ) as jest.MockedFunction<typeof fetch>;

    await expect(
      provider.fetch('https://graph.facebook.com/test', {}, 'test', 2)
    ).rejects.toBeInstanceOf(error);
  }

  it('classifies Facebook and Instagram media-fetch errors as bad requests', async () => {
    await expectFailure(
      new FacebookProvider(),
      400,
      { error: { code: 324, error_subcode: 2069019 } },
      BadBody
    );

    await expectFailure(
      new InstagramProvider(),
      400,
      { error: { code: 9004, error_subcode: 2207052 } },
      BadBody
    );
  });

  it('refreshes Meta token errors using the existing OAuthException behavior', async () => {
    await expectFailure(
      new FacebookProvider(),
      400,
      { error: { type: 'OAuthException', code: 190 } },
      RefreshToken
    );

    await expectFailure(
      new InstagramProvider(),
      400,
      { error: { type: 'OAuthException', code: 190 } },
      RefreshToken
    );
  });

  it('continues to classify non-Meta OAuthException responses as refresh errors', async () => {
    await expectFailure(
      new GenericSocialProvider(),
      400,
      { error: { type: 'OAuthException', code: 190 } },
      RefreshToken
    );
  });

  it('preserves existing Meta OAuthException behavior for other errors', async () => {
    await expectFailure(
      new FacebookProvider(),
      400,
      { error: { type: 'OAuthException', code: 10 } },
      RefreshToken
    );
  });

  it('classifies HTTP 401 responses as Meta authentication failures', async () => {
    await expectFailure(
      new FacebookProvider(),
      401,
      { error: 'Unauthorized' },
      RefreshToken
    );

    await expectFailure(
      new InstagramProvider(),
      401,
      { error: 'Unauthorized' },
      RefreshToken
    );
  });
});
