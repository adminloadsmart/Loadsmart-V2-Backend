import { QueryFailedError } from 'typeorm';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { rethrow } from '../../shared/errors/rethrow';
import { paginate, Paginated } from '../../shared/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { BrokerEntity } from './broker.entity';
import type { BrokerDriverStatus } from './broker-driver.entity';
import {
  BrokerDriverRepository,
  type BrokerDriverCheckRow,
  type BrokerDriverRow,
  type PlacedDriver,
} from './broker-driver.repository';
import type {
  CreateBrokerDriverInput,
  ListBrokerDriversQuery,
  UpdateBrokerDriverInput,
} from './broker-driver.validators';

/** Where the driver's licence stands, from the latest check of it on any load. */
export const LICENCE_STATES = [
  'verified',
  'manual',
  'expired',
  'failed',
  'unavailable',
  'not_checked',
] as const;
export type LicenceState = (typeof LICENCE_STATES)[number];

export interface BrokerDriverView {
  id: string;
  broker: { id: string; name: string };
  fullName: string;
  mobile: string;
  isOnWhatsapp: boolean;
  licenceNumber: string;
  dateOfBirth: string | null;
  status: BrokerDriverStatus;
  note: string | null;
  licence: {
    state: LicenceState;
    holderName: string | null;
    validUntil: string | null;
    licenseClass: string | null;
    transportClass: string | null;
    checkedAt: Date | null;
    failures: string[];
  };
  lastVehicleNumber: string | null;
  loadsLast30Days: number;
  totalLoads: number;
  lastLoad: { id: string; code: string | null; at: Date | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrokerDriverListResponse extends Paginated<BrokerDriverView> {
  summary: {
    total: { count: number; active: number };
    verified: { count: number };
    expiringIn30Days: { count: number };
    needsAttention: { count: number };
    onWhatsapp: { count: number; notOnWhatsapp: number };
  };
  tabs: { all: number; active: number; inactive: number };
}

export interface BrokerDriverDetail extends BrokerDriverView {
  photos: {
    front: { key: string; url: string | null } | null;
    back: { key: string; url: string | null } | null;
  };
  loads: {
    id: string;
    code: string;
    status: string;
    fromCity: string | null;
    toCity: string | null;
    vehicleNumber: string | null;
    namedAt: Date;
    memoAcceptedAt: Date | null;
  }[];
  trucks: { vehicleNumber: string; loads: number; lastUsedAt: Date }[];
  checks: {
    id: string;
    loadId: string;
    loadCode: string | null;
    status: BrokerDriverCheckRow['status'];
    source: BrokerDriverCheckRow['source'];
    failures: string[];
    notes: string[];
    validUntil: string | null;
    licenseClass: string | null;
    checkedAt: Date;
  }[];
}

const LOADS_ON_PAGE = 50;
const CHECKS_ON_PAGE = 10;

const today = () => new Date().toISOString().slice(0, 10);
const text = (v: unknown) => (typeof v === 'string' && v ? v : null);

function licenceState(r: BrokerDriverRow): LicenceState {
  if (!r.checkStatus) return 'not_checked';
  if (r.checkStatus === 'failed') return 'failed';
  if (r.checkStatus === 'unavailable') return 'unavailable';
  if (r.licenceValidUntil && r.licenceValidUntil < today()) return 'expired';
  return r.checkSource === 'manual' ? 'manual' : 'verified';
}

export function toBrokerDriverView(r: BrokerDriverRow): BrokerDriverView {
  const details = r.checkDetails ?? {};
  return {
    id: r.id,
    broker: { id: r.brokerId, name: r.brokerName },
    fullName: r.fullName,
    mobile: r.mobile,
    isOnWhatsapp: r.isOnWhatsapp,
    licenceNumber: r.licenceNumber,
    dateOfBirth: r.dateOfBirth,
    status: r.status,
    note: r.note,
    licence: {
      state: licenceState(r),
      holderName: text(details.holderName),
      validUntil: r.licenceValidUntil,
      licenseClass: text(details.licenseClass),
      transportClass: text(details.transportClass),
      checkedAt: r.checkedAt,
      failures: r.checkFailures ?? [],
    },
    lastVehicleNumber: r.lastVehicleNumber,
    loadsLast30Days: Number(r.loadsLast30Days),
    totalLoads: Number(r.totalLoads),
    lastLoad: r.lastLoadId ? { id: r.lastLoadId, code: r.lastLoadCode, at: r.lastLoadAt } : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof QueryFailedError && (error as { code?: string }).code === '23505';

/** Masters → Drivers: the drivers brokers put on Loadsmart loads. */
export class BrokerDriverService {
  constructor(
    private readonly repo: BrokerDriverRepository,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListBrokerDriversQuery): Promise<BrokerDriverListResponse> {
    const { page, limit, brokerId, status, search } = query;
    const [[rows, total], totals] = await Promise.all([
      this.repo.list({ brokerId, status, search }, { page, limit }),
      this.repo.totals(brokerId),
    ]);
    return {
      ...paginate(rows.map(toBrokerDriverView), total, { page, limit }),
      summary: {
        total: { count: totals.all, active: totals.active },
        verified: { count: totals.verified },
        expiringIn30Days: { count: totals.expiringIn30Days },
        needsAttention: { count: totals.needsAttention },
        onWhatsapp: { count: totals.onWhatsapp, notOnWhatsapp: totals.all - totals.onWhatsapp },
      },
      tabs: { all: totals.all, active: totals.active, inactive: totals.inactive },
    };
  }

  async detail(driverId: string): Promise<BrokerDriverDetail> {
    const row = await this.repo.findRow(driverId);
    if (!row) throw new NotFoundError(`Driver ${driverId} not found`);
    const [loads, checks, front, back] = await Promise.all([
      this.repo.loads(row.brokerId, row.licenceNumber, LOADS_ON_PAGE),
      this.repo.checks(row.licenceNumber, CHECKS_ON_PAGE),
      this.photo(row.licenceFrontFileKey),
      this.photo(row.licenceBackFileKey),
    ]);

    const trucks = new Map<string, { vehicleNumber: string; loads: number; lastUsedAt: Date }>();
    for (const load of loads) {
      if (!load.vehicleNumber) continue;
      const t = trucks.get(load.vehicleNumber);
      if (t) t.loads += 1;
      else
        trucks.set(load.vehicleNumber, {
          vehicleNumber: load.vehicleNumber,
          loads: 1,
          lastUsedAt: load.namedAt,
        });
    }

    return {
      ...toBrokerDriverView(row),
      photos: { front, back },
      loads: loads.map((l) => ({
        id: l.loadId,
        code: l.code,
        status: l.status,
        fromCity: l.fromCity,
        toCity: l.toCity,
        vehicleNumber: l.vehicleNumber,
        namedAt: l.namedAt,
        memoAcceptedAt: l.memoAcceptedAt,
      })),
      trucks: [...trucks.values()],
      checks: checks.map((c) => ({
        id: c.id,
        loadId: c.loadId,
        loadCode: c.loadCode,
        status: c.status,
        source: c.source,
        failures: c.failures ?? [],
        notes: c.notes ?? [],
        validUntil: text(c.details?.validUntil),
        licenseClass: text(c.details?.licenseClass),
        checkedAt: c.checkedAt,
      })),
    };
  }

  async create(actorId: string, input: CreateBrokerDriverInput): Promise<BrokerDriverDetail> {
    try {
      const broker = await this.repo.drivers.manager.findOneBy(BrokerEntity, {
        id: input.brokerId,
      });
      if (!broker) throw new NotFoundError(`Broker ${input.brokerId} not found`);
      const saved = await this.repo.drivers.save(
        this.repo.drivers.create({
          brokerId: input.brokerId,
          fullName: input.fullName,
          mobile: input.mobile,
          isOnWhatsapp: input.isOnWhatsapp,
          licenceNumber: input.licenceNumber,
          dateOfBirth: input.dateOfBirth,
          licenceFrontFileKey: input.licenceFrontFileKey ?? null,
          licenceBackFileKey: input.licenceBackFileKey ?? null,
          status: input.status,
          note: input.note ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      );
      await this.auditService.log({
        tenantId: null,
        userId: actorId,
        action: 'BROKER_DRIVER_ADDED',
        resourceType: 'broker_driver',
        newData: { id: saved.id, brokerId: saved.brokerId, licenceNumber: saved.licenceNumber },
      });
      return await this.detail(saved.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This broker already has a driver with that licence number');
      }
      rethrow(error, 'Failed to add the driver');
    }
  }

  async update(
    actorId: string,
    driverId: string,
    input: UpdateBrokerDriverInput,
  ): Promise<BrokerDriverDetail> {
    try {
      const driver = await this.repo.drivers.findOneBy({ id: driverId });
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      const before = { ...driver };
      Object.assign(driver, input, { updatedBy: actorId });
      await this.repo.drivers.save(driver);
      const changed = Object.keys(input) as (keyof UpdateBrokerDriverInput)[];
      await this.auditService.log({
        tenantId: null,
        userId: actorId,
        action: 'BROKER_DRIVER_UPDATED',
        resourceType: 'broker_driver',
        oldData: { id: driverId, ...Object.fromEntries(changed.map((k) => [k, before[k]])) },
        newData: { id: driverId, ...input },
      });
      return await this.detail(driverId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This broker already has a driver with that licence number');
      }
      rethrow(error, 'Failed to update the driver');
    }
  }

  /** Placement named a driver on a broker's load — keeps the master in step. Never fails the
   *  naming: a problem here is logged, the load already has its driver. */
  async recordFromPlacement(driver: PlacedDriver): Promise<void> {
    try {
      await this.repo.upsertFromPlacement(driver);
    } catch (error) {
      console.warn(
        `[brokers] could not record driver ${driver.licenceNumber} in the master`,
        error,
      );
    }
  }

  private async photo(key: string | null) {
    if (!key) return null;
    try {
      return { key, url: await this.storage.getPresignedDownloadUrlForKey(key) };
    } catch {
      return { key, url: null };
    }
  }
}
