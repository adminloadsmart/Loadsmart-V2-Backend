import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../audit/audit.service';
import type { TransporterService } from '../../masters/transporter/transporter.service';
import type { LoadEventNotifier } from '../../notifications/notifications.interface';
import type { LoadEntity } from '../entities/load.entity';
import type { LoadActivityService } from '../load-activity.service';
import type { LoadStageService } from '../load-stage.service';
import type { LoadRepository } from '../load.repository';
import type { LoadVerificationService } from '../verification/load-verification.service';
import type { LoadBidEntity } from './load-bid.entity';
import type { LoadBidRepository } from './load-bid.repository';
import { LoadBidService } from './load-bid.service';

const NOW = new Date('2026-10-27T10:00:00Z');

const load = {
  id: 'load-1',
  tenantId: 'tenant-1',
  status: 'bids_received',
  freightType: 'flat',
  postingId: null,
  createdAt: new Date('2026-10-27T09:00:00Z'),
} as unknown as LoadEntity;

const bid = {
  id: 'bid-1',
  loadId: 'load-1',
  source: 'transporter',
  status: 'received',
  rate: '40000',
  vehicleNumber: 'MH12AB1234',
  truckVerified: true,
  transporterId: 'transporter-1',
  expiresAt: new Date('2026-10-27T13:00:00Z'),
  createdAt: new Date('2026-10-27T09:30:00Z'),
} as unknown as LoadBidEntity;

function setup(onLoadEvent?: LoadEventNotifier) {
  const assigned = { ...load, status: 'truck_assigned' } as LoadEntity;
  const bidRepository = {
    findById: vi.fn(async () => bid),
    accept: vi.fn(async () => undefined),
    rejectOthers: vi.fn(async () => undefined),
    markExpired: vi.fn(async () => undefined),
  } as unknown as LoadBidRepository;
  const loadRepository = {
    findById: vi.fn(async () => load),
    findActiveByVehicleNumber: vi.fn(async () => null),
  } as unknown as LoadRepository;
  const stageService = {
    transition: vi.fn(async () => assigned),
  } as unknown as LoadStageService;
  const service = new LoadBidService(
    bidRepository,
    loadRepository,
    {} as TransporterService,
    stageService,
    { record: vi.fn(async () => undefined) } as unknown as LoadActivityService,
    {} as AuditService,
    {} as LoadVerificationService,
    onLoadEvent,
    () => NOW,
  );
  return { service, stageService, assigned };
}

describe('LS_N_0016 truck assigned — accepting a bid', () => {
  it('moves the load to Truck assigned and queues the assigned event', async () => {
    const onLoadEvent = vi.fn(async () => undefined);
    const { service, stageService, assigned } = setup(onLoadEvent);

    const result = await service.acceptBid('tenant-1', 'user-1', 'load-1', 'bid-1');

    expect(result).toBe(assigned);
    expect(stageService.transition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'truck_assigned', loadId: 'load-1' }),
    );
    expect(onLoadEvent).toHaveBeenCalledWith({
      kind: 'assigned',
      tenantId: 'tenant-1',
      loadId: 'load-1',
      at: NOW,
      vehicleChecked: false,
      driverChecked: false,
    });
  });

  it('still accepts the bid when no notifier is wired', async () => {
    const { service, assigned } = setup();
    await expect(service.acceptBid('tenant-1', 'user-1', 'load-1', 'bid-1')).resolves.toBe(
      assigned,
    );
  });
});
