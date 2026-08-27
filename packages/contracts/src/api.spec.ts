import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  apiEnvelopeSchema,
  ApiError,
  ApiPaginatedSuccess,
  ApiSuccess,
  apiErrorBodySchema,
  apiPaginatedSuccessSchema,
  cursorPageRequestSchema,
  cursorPageSchema,
  correlationIdSchema,
  isApiErrorBody,
  newCorrelationId,
  pageInfoSchema,
  toPageInfo,
  type CursorPage,
} from './api';
import { ERROR_CODES } from './errors';

describe('correlation ids', () => {
  it('generates ids that pass the schema', () => {
    const id = newCorrelationId();
    expect(correlationIdSchema.parse(id)).toBe(id);
  });

  it('accepts foreign trace parents but rejects junk', () => {
    expect(correlationIdSchema.parse('  gateway-trace-0001  ')).toBe('gateway-trace-0001');
    // Lenient inbound acceptance: any non-empty trimmed value is preserved.
    expect(correlationIdSchema.parse('short')).toBe('short');
    expect(correlationIdSchema.safeParse('').success).toBe(false);
    expect(correlationIdSchema.safeParse('   ').success).toBe(false);
  });
});

describe('error envelope schema', () => {
  it('round-trips a canonical error body', () => {
    const body = {
      error: {
        code: ERROR_CODES.INVENTORY_INSUFFICIENT satisfies ApiError['code'],
        message: 'Requested quantity is not available.',
        details: {},
        correlationId: newCorrelationId(),
      },
    };

    expect(apiErrorBodySchema.parse(body)).toEqual(body);
  });

  it('rejects unknown codes and empty messages', () => {
    const badCode = { error: { code: 'TOTALLY_NEW', message: 'x' } };
    expect(apiErrorBodySchema.safeParse(badCode).success).toBe(false);

    const badMessage = { error: { code: ERROR_CODES.RESOURCE_NOT_FOUND, message: '' } };
    expect(apiErrorBodySchema.safeParse(badMessage).success).toBe(false);
  });

  it('discriminates success vs error bodies structurally', () => {
    expect(isApiErrorBody({ error: { code: 'RESOURCE_NOT_FOUND', message: 'x' } })).toBe(true);
    expect(isApiErrorBody({ data: { id: '1' } })).toBe(false);
    expect(isApiErrorBody(null)).toBe(false);
  });
});

describe('pagination round-trip', () => {
  it('serializes and parses a CursorPage of items', () => {
    const page: CursorPage<{ id: string }> = {
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'cursor-2',
      hasMore: true,
    };

    const wire = JSON.parse(JSON.stringify(page));
    expect(cursorPageSchema(z.object({ id: z.string() })).parse(wire)).toEqual(page);
  });

  it('treats a null nextCursor as the last page', () => {
    const lastPage: CursorPage<number> = { items: [1], nextCursor: null, hasMore: false };
    const parsed = cursorPageSchema(z.number()).parse(JSON.parse(JSON.stringify(lastPage)));
    expect(parsed.nextCursor).toBeNull();
    expect(parsed.hasMore).toBe(false);
  });

  it('maps a CursorPage onto wire PageInfo with explicit null', () => {
    expect(toPageInfo({ items: [], hasMore: false })).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(toPageInfo({ items: [], nextCursor: 'c9', hasMore: true }).nextCursor).toBe('c9');

    const info = toPageInfo({ items: [1], nextCursor: 'c1', hasMore: true });
    expect(pageInfoSchema.parse(info)).toEqual({ nextCursor: 'c1', hasMore: true });
  });

  it('coerces query-string limits and applies defaults/bounds', () => {
    expect(cursorPageRequestSchema.parse({})).toEqual({ limit: 50 });
    expect(cursorPageRequestSchema.parse({ limit: '25', after: 'abc' })).toEqual({
      limit: 25,
      after: 'abc',
    });
    expect(cursorPageRequestSchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(cursorPageRequestSchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(cursorPageRequestSchema.safeParse({ limit: '12.5' }).success).toBe(false);
    // The wire field is `after`; an empty continuation cursor is rejected.
    expect(cursorPageRequestSchema.safeParse({ after: '' }).success).toBe(false);
  });

  it('parses full list envelopes (data + page)', () => {
    const body: ApiPaginatedSuccess<string> = {
      data: ['a', 'b'],
      page: { nextCursor: null, hasMore: false },
    };
    expect(apiPaginatedSuccessSchema(z.string()).parse(body)).toEqual(body);
  });

  it('parses single-resource success envelopes', () => {
    const body: ApiSuccess<{ id: string }> = { data: { id: 'v1' } };
    expect(apiEnvelopeSchema(z.object({ id: z.string() })).parse(body)).toEqual(body);
  });

  it('parses a paginated half of the envelope union', () => {
    const body = { data: ['a', 'b'], page: { nextCursor: null, hasMore: false } };
    expect(apiEnvelopeSchema(z.string()).parse(body)).toEqual(body);
  });

  it('parses an error half of the envelope union', () => {
    const body = { error: { code: ERROR_CODES.PAYMENT_REQUIRED, message: 'pay first' } };
    expect(apiEnvelopeSchema(z.unknown()).parse(body)).toEqual(body);
  });
});
