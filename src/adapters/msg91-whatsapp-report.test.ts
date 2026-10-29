import { describe, expect, it } from 'vitest';
import { parseMsg91WhatsappReports, whatsappRequestIdOf } from './msg91-whatsapp-report';

describe('whatsappRequestIdOf', () => {
  it('reads the request id at the top level or under data', () => {
    expect(whatsappRequestIdOf({ status: 'success', request_id: 'r1' })).toBe('r1');
    expect(whatsappRequestIdOf({ status: 'success', data: { requestId: 'r2' } })).toBe('r2');
  });

  it('is null when there is none', () => {
    expect(whatsappRequestIdOf({ status: 'success', data: 'accepted' })).toBeNull();
    expect(whatsappRequestIdOf(undefined)).toBeNull();
  });
});

describe('parseMsg91WhatsappReports', () => {
  it('maps delivered/read/failed and skips sent or unknown events', () => {
    const reports = parseMsg91WhatsappReports([
      { requestId: 'a', status: 'delivered', ts: 1793000000 },
      { request_id: 'b', eventName: 'READ' },
      { uuid: 'c', status: 'undelivered' },
      { requestId: 'd', status: 'sent' },
      { status: 'read' },
    ]);
    expect(reports.map(({ requestId, status }) => [requestId, status])).toEqual([
      ['a', 'delivered'],
      ['b', 'read'],
      ['c', 'failed'],
    ]);
    expect(reports[0].at).toEqual(new Date(1793000000 * 1000));
  });

  it('accepts a single report or one wrapped in data', () => {
    expect(parseMsg91WhatsappReports({ requestId: 'a', status: 'read' })).toHaveLength(1);
    expect(parseMsg91WhatsappReports({ data: [{ requestId: 'a', status: 'read' }] })).toHaveLength(
      1,
    );
  });
});
