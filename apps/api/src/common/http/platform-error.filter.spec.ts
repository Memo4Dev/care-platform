import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PlatformErrorFilter } from './platform-error.filter';

describe('PlatformErrorFilter logging', () => {
  it('logs only allowlisted metadata for unexpected exceptions', () => {
    const send = vi.fn();
    const code = vi.fn(() => ({ send }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, correlationId: 'correlation-1' }),
        getResponse: () => ({ code }),
      }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(new Error('sensitive SQL and provider details'), { code: 'XX001' });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      new PlatformErrorFilter().catch(error, host);
      expect(logged).toHaveBeenCalledWith('[PlatformErrorFilter] UNHANDLED', {
        name: 'Error',
        code: 'XX001',
        correlationId: 'correlation-1',
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain('sensitive SQL');
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ correlationId: 'correlation-1' }),
        }),
      );
    } finally {
      logged.mockRestore();
    }
  });
});
