import { describe, expect, it } from 'vitest';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import { NormalizedMessage, NormalizedStatus } from '../providers/whatsapp-provider.interface';
import { InboundResolutionPatch } from '../repositories/whatsapp-inbound.repository';
import { MessageLogPatch } from '../repositories/message-log.repository';
import { EnqueueOptions, JobQueue } from '../../../jobs/queue-registry';
import {
  InboundMessageHandler,
  InboundPipelineService,
  InboundStore,
  MessageLogStore,
  SenderBusyError,
  SenderLock,
} from './inbound-pipeline.service';

const SENDER_A = '919000000001';
const SENDER_B = '919000000002';

function message(id: string, fromPhone: string, second: number, text = 'hi'): NormalizedMessage {
  return {
    kind: 'message',
    provider: 'msg91',
    providerMessageId: id,
    fromPhone,
    fromUserId: null,
    contextMessageId: null,
    type: 'text',
    providerType: 'text',
    text,
    buttonId: null,
    buttonText: null,
    listRowId: null,
    flowResponse: null,
    media: null,
    timestamp: new Date(Date.UTC(2026, 10, 14, 10, 0, second)),
    raw: {},
  };
}

class FakeInboundStore implements InboundStore {
  rows: WhatsappInboundEntity[] = [];
  async insertIfNew(normalized: NormalizedMessage) {
    if (this.rows.some((row) => row.providerMessageId === normalized.providerMessageId))
      return null;
    const row = {
      id: `in-${this.rows.length + 1}`,
      providerMessageId: normalized.providerMessageId,
      fromPhone: normalized.fromPhone,
      body: normalized.text,
      receivedAt: normalized.timestamp,
      resolution: 'pending',
    } as WhatsappInboundEntity;
    this.rows.push(row);
    return row;
  }
  async findById(inboundId: string) {
    return this.rows.find((row) => row.id === inboundId) ?? null;
  }
  async findPendingForSender(fromPhone: string, upTo: Date) {
    return this.rows
      .filter(
        (row) =>
          row.fromPhone === fromPhone && row.resolution === 'pending' && row.receivedAt <= upTo,
      )
      .sort((first, second) => first.receivedAt.getTime() - second.receivedAt.getTime());
  }
  async recordResolution(inboundId: string, patch: InboundResolutionPatch) {
    Object.assign(
      this.rows.find((row) => row.id === inboundId)!,
      patch,
    );
  }
}

class FakeQueue implements JobQueue {
  jobs: { name: string; payload: unknown; options?: EnqueueOptions }[] = [];
  async enqueue(name: string, payload: unknown, options?: EnqueueOptions) {
    this.jobs.push({ name, payload, options });
  }
  async cancel() {}
  async upsertSchedule() {}
}

class FakeLock implements SenderLock {
  held = new Set<string>();
  async acquire(senderPhone: string) {
    if (this.held.has(senderPhone)) return null;
    this.held.add(senderPhone);
    return 'token';
  }
  async release(senderPhone: string) {
    this.held.delete(senderPhone);
  }
}

class FakeMessageLogStore implements MessageLogStore {
  rows: MessageLogEntity[] = [];
  async findByProviderMessageId(providerMessageId: string) {
    return this.rows.find((row) => row.providerMessageId === providerMessageId) ?? null;
  }
  async findAwaitingMessageIdByRequestId(providerRequestId: string) {
    return (
      this.rows.find(
        (row) => row.providerRequestId === providerRequestId && !row.providerMessageId,
      ) ?? null
    );
  }
  async findAwaitingMessageIdByAddress(address: string, since: Date) {
    return (
      this.rows
        .filter(
          (row) => row.address === address && !row.providerMessageId && row.createdAt >= since,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }
  async update(messageLogId: string, patch: MessageLogPatch) {
    Object.assign(
      this.rows.find((row) => row.id === messageLogId)!,
      patch,
    );
  }
}

function setup(handler?: InboundMessageHandler) {
  const handledOrder: string[] = [];
  const recordingHandler: InboundMessageHandler = handler ?? {
    async handle(inbound) {
      handledOrder.push(inbound.body ?? '');
      return { resolution: 'ignored' };
    },
  };
  const inboundStore = new FakeInboundStore();
  const messageLogStore = new FakeMessageLogStore();
  const queue = new FakeQueue();
  const lock = new FakeLock();
  const silentLogger = { warn: () => undefined };
  const pipeline = new InboundPipelineService(
    inboundStore,
    messageLogStore,
    queue,
    lock,
    recordingHandler,
    silentLogger,
  );
  return { pipeline, inboundStore, messageLogStore, queue, lock, handledOrder };
}

describe('InboundPipelineService.acceptEvents', () => {
  it('stores each message once and queues one job per new message', async () => {
    const { pipeline, inboundStore, queue } = setup();
    const summary = await pipeline.acceptEvents([
      message('wamid.1', SENDER_A, 1),
      message('wamid.1', SENDER_A, 1),
      message('wamid.2', SENDER_B, 2),
    ]);
    expect(summary).toEqual({ storedMessages: 2, duplicateMessages: 1, statuses: 0 });
    expect(inboundStore.rows).toHaveLength(2);
    expect(queue.jobs.map((job) => job.name)).toEqual(['process-sender', 'process-sender']);
    expect(queue.jobs[0].options?.jobId).toBe('in-1');
  });

  it('queues statuses as their own jobs', async () => {
    const { pipeline, queue } = setup();
    const status: NormalizedStatus = {
      kind: 'status',
      provider: 'msg91',
      providerMessageId: 'wamid.OUT',
      providerRequestId: null,
      recipientPhone: SENDER_A,
      status: 'read',
      timestamp: new Date(0),
      error: null,
      raw: {},
    };
    expect(await pipeline.acceptEvents([status])).toEqual({
      storedMessages: 0,
      duplicateMessages: 0,
      statuses: 1,
    });
    expect(queue.jobs[0]).toMatchObject({
      name: 'apply-status',
      payload: { providerMessageId: 'wamid.OUT', status: 'read' },
    });
  });
});

describe('InboundPipelineService.processSender', () => {
  it("handles the sender's pending messages oldest first, only that sender", async () => {
    const { pipeline, inboundStore, handledOrder } = setup();
    await pipeline.acceptEvents([
      message('w1', SENDER_A, 1, '47k'),
      message('w2', SENDER_B, 2, 'other user'),
      message('w3', SENDER_A, 3, 'pick'),
    ]);
    // The job for the later message runs first — the earlier one is still handled first.
    expect(await pipeline.processSender({ inboundId: 'in-3' })).toBe(2);
    expect(handledOrder).toEqual(['47k', 'pick']);
    expect(inboundStore.rows.find((row) => row.id === 'in-2')?.resolution).toBe('pending');
    expect(await pipeline.processSender({ inboundId: 'in-1' })).toBe(0);
  });

  it('throws SenderBusyError while another worker holds the sender', async () => {
    const { pipeline, lock } = setup();
    await pipeline.acceptEvents([message('w1', SENDER_A, 1)]);
    lock.held.add(SENDER_A);
    await expect(pipeline.processSender({ inboundId: 'in-1' })).rejects.toBeInstanceOf(
      SenderBusyError,
    );
  });

  it('turns a handler error into needs_review and keeps going', async () => {
    const { pipeline, inboundStore } = setup({
      async handle(inbound) {
        if (inbound.body === 'boom') throw new Error('router exploded');
        return { resolution: 'bid_recorded' };
      },
    });
    await pipeline.acceptEvents([
      message('w1', SENDER_A, 1, 'boom'),
      message('w2', SENDER_A, 2, '45k'),
    ]);
    await pipeline.processSender({ inboundId: 'in-2' });
    expect(inboundStore.rows.map((row) => row.resolution)).toEqual([
      'needs_review',
      'bid_recorded',
    ]);
    expect(inboundStore.rows[0].resolutionNote).toContain('router exploded');
  });
});

describe('InboundPipelineService.applyStatus', () => {
  it('applies forward-only statuses and ignores unknown messages', async () => {
    const { pipeline, messageLogStore } = setup();
    messageLogStore.rows.push({
      id: 'log-1',
      providerMessageId: 'wamid.OUT',
      providerRequestId: null,
      status: 'sent',
      sentAt: new Date(0),
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    } as MessageLogEntity);
    const base = { provider: 'msg91' as const, providerRequestId: null, error: null };
    expect(
      await pipeline.applyStatus({
        ...base,
        providerMessageId: 'wamid.OUT',
        status: 'read',
        timestamp: new Date(5000).toISOString(),
      }),
    ).toBe('applied');
    expect(messageLogStore.rows[0]).toMatchObject({
      status: 'read',
      deliveredAt: new Date(5000),
      readAt: new Date(5000),
    });
    expect(
      await pipeline.applyStatus({
        ...base,
        providerMessageId: 'wamid.OUT',
        status: 'sent',
        timestamp: new Date(1000).toISOString(),
      }),
    ).toBe('unchanged');
    expect(
      await pipeline.applyStatus({
        ...base,
        providerMessageId: 'wamid.OLD',
        status: 'read',
        timestamp: new Date(1000).toISOString(),
      }),
    ).toBe('unknown_message');
  });

  it('one status per message at a time: busy → SenderBusyError (BullMQ retries); lock released after', async () => {
    const { pipeline, messageLogStore, lock } = setup();
    messageLogStore.rows.push({
      id: 'log-lock',
      providerMessageId: 'wamid.LOCK',
      providerRequestId: null,
      status: 'submitted',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    } as MessageLogEntity);
    const read = {
      provider: 'msg91' as const,
      providerMessageId: 'wamid.LOCK',
      providerRequestId: null,
      status: 'read' as const,
      timestamp: new Date(5000).toISOString(),
      error: null,
    };
    lock.held.add('status:log-lock');
    await expect(pipeline.applyStatus(read)).rejects.toBeInstanceOf(SenderBusyError);
    lock.held.clear();
    expect(await pipeline.applyStatus(read)).toBe('applied');
    expect(lock.held.size).toBe(0);
  });

  it('backfills the WAMID from the request id when the send returned none (MSG91 case)', async () => {
    const { pipeline, messageLogStore } = setup();
    messageLogStore.rows.push({
      id: 'log-2',
      providerMessageId: null,
      providerRequestId: 'req-9',
      status: 'queued',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    } as MessageLogEntity);
    await pipeline.applyStatus({
      provider: 'msg91',
      providerMessageId: 'wamid.NEW',
      providerRequestId: 'req-9',
      status: 'sent',
      timestamp: new Date(2000).toISOString(),
      error: null,
    });
    expect(messageLogStore.rows[0]).toMatchObject({
      providerMessageId: 'wamid.NEW',
      status: 'sent',
    });
  });

  it('tells status listeners about applied changes; a failing listener does not fail the status', async () => {
    const { pipeline, messageLogStore } = setup();
    messageLogStore.rows.push({
      id: 'log-3',
      providerMessageId: 'wamid.L',
      providerRequestId: null,
      status: 'submitted',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    } as MessageLogEntity);
    const seen: string[] = [];
    pipeline.addStatusListener({ onStatusApplied: async () => Promise.reject(new Error('boom')) });
    pipeline.addStatusListener({
      onStatusApplied: async (log, patch) => {
        seen.push(`${log.id}:${patch.status}`);
      },
    });
    const base = {
      provider: 'msg91' as const,
      providerRequestId: null,
      error: null,
      providerMessageId: 'wamid.L',
    };
    expect(
      await pipeline.applyStatus({
        ...base,
        status: 'sent',
        timestamp: new Date(1000).toISOString(),
      }),
    ).toBe('applied');
    expect(
      await pipeline.applyStatus({
        ...base,
        status: 'sent',
        timestamp: new Date(1000).toISOString(),
      }),
    ).toBe('unchanged');
    expect(seen).toEqual(['log-3:sent']);
  });

  it('MSG91: an unknown request id falls back to the latest message to that number still waiting for its WAMID', async () => {
    const { pipeline, messageLogStore } = setup();
    messageLogStore.rows.push({
      id: 'log-9',
      providerMessageId: null,
      providerRequestId: 'req-from-send',
      address: '919876543210',
      status: 'submitted',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      createdAt: new Date('2026-11-18T10:00:00Z'),
    } as MessageLogEntity);
    const result = await pipeline.applyStatus({
      provider: 'msg91',
      providerMessageId: 'wamid.FROM.REPORT',
      providerRequestId: 'req-from-report',
      recipientPhone: '919876543210',
      status: 'read',
      timestamp: '2026-11-18T10:05:00.000Z',
      error: null,
    });
    expect(result).toBe('applied');
    expect(messageLogStore.rows[0]).toMatchObject({
      providerMessageId: 'wamid.FROM.REPORT',
      status: 'read',
    });
  });
});
