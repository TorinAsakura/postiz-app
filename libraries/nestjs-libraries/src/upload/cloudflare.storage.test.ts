import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CloudflareStorage } from './cloudflare.storage';

describe('CloudflareStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createStorage() {
    return new CloudflareStorage(
      'test-account',
      'test-access-key',
      'test-secret-key',
      'auto',
      'postiz-media',
      'https://media.example.test'
    );
  }

  function createFile(mimetype: string): Express.Multer.File {
    const buffer = Buffer.from('test image');
    return { buffer, mimetype, size: buffer.length } as Express.Multer.File;
  }

  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpeg'],
  ])('uploads %s without an object ACL', async (mimetype, extension) => {
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const file = createFile(mimetype);

    const result = await createStorage().uploadFile(file);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'postiz-media',
      Key: result.filename,
      Body: file.buffer,
      ContentType: mimetype,
    });
    expect(command.input).not.toHaveProperty('ACL');
    expect(result.filename).toMatch(new RegExp(`\\.${extension}$`));
    expect(result.path).toBe(`https://media.example.test/${result.filename}`);
    expect(result.destination).toBe(result.path);
    expect(result.mimetype).toBe(mimetype);
  });

  it('does not return a media URL when the upload fails', async () => {
    const error = new Error('R2 upload rejected');
    jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(error as never);

    await expect(createStorage().uploadFile(createFile('image/png'))).rejects.toBe(error);
  });
});
