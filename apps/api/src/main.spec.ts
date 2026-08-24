import { describe, expect, it } from 'vitest';

import { bootstrap } from './main';

describe('bootstrap', () => {
  it('returns the bootstrap marker', () => {
    expect(bootstrap()).toBe('api-bootstrap');
  });
});
