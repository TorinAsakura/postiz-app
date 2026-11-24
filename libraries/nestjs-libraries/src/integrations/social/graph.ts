import { HttpException } from '@nestjs/common';
import { z } from 'zod';

export const META_GRAPH_VERSION = 'v27.0';

const pageSchema = z.object({
  data: z.array(z.record(z.unknown())),
  paging: z
    .object({
      next: z.string().optional(),
      cursors: z.object({ after: z.string().optional() }).optional(),
    })
    .optional(),
});

export class SocialGraph {
  constructor(private origin: string, private token: string) {}

  async request(path: string, fields?: string, body?: URLSearchParams) {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) {
      throw new HttpException('Invalid social API origin', 400);
    }
    if (fields) url.searchParams.set('fields', fields);
    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new HttpException('Social API request outcome is unavailable', 502);
    }
    if (!response.ok) {
      throw new HttpException(
        `Social API rejected the request (HTTP ${response.status})`,
        response.status === 401 || response.status === 403 ? 403 : 502
      );
    }
    try {
      const result: unknown = await response.json();
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error('Provider error');
      }
      return result;
    } catch {
      throw new HttpException('Social API returned an invalid response', 502);
    }
  }

  async pages(path: string, fields: string) {
    const records: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const url = new URL(path, this.origin);
    url.searchParams.set('limit', '100');
    while (true) {
      const result = pageSchema.safeParse(
        await this.request(`${url.pathname}${url.search}`, fields)
      );
      if (!result.success) {
        throw new HttpException('Social API returned an invalid page', 502);
      }
      records.push(...result.data.data);
      if (!result.data.paging?.next) return records;
      const after = result.data.paging.cursors?.after;
      if (!after || seen.has(after)) {
        throw new HttpException(
          'Social API pagination could not be completed',
          502
        );
      }
      seen.add(after);
      url.searchParams.set('after', after);
    }
  }
}
