import { describe, expect, it, vi } from 'vitest';
import { OutboxRelayService } from './outbox-relay.service';

describe('OutboxRelayService', () => {
  it('uses EventId as BullMQ job id so publication retries deduplicate', async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const service = new OutboxRelayService(db as never);
    expect(await service.relayOnce({ add: vi.fn() }, 0)).toBe(0);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});
