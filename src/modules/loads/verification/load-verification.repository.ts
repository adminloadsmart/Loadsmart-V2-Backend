import { DataSource, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { VerificationSubject } from '../utils/loads.types';
import { LoadVerificationEntity } from './load-verification.entity';

export type CreateLoadVerificationData = Omit<LoadVerificationEntity, 'id' | 'load' | 'createdAt'>;

export class LoadVerificationRepository {
  private readonly checks: Repository<LoadVerificationEntity>;
  private readonly vehicles: Repository<VehicleEntity>;

  constructor(dataSource: DataSource) {
    this.checks = dataSource.getRepository(LoadVerificationEntity);
    this.vehicles = dataSource.getRepository(VehicleEntity);
  }

  create(data: CreateLoadVerificationData): Promise<LoadVerificationEntity> {
    return this.checks.save(this.checks.create(data));
  }

  /** A conclusive check of the same truck or licence in this tenant since `since` — reused
   *  rather than calling the portal again. */
  findRecentConclusive(
    tenantId: string,
    subject: VerificationSubject,
    subjectRef: string,
    since: Date,
  ): Promise<LoadVerificationEntity | null> {
    return this.checks.findOne({
      where: {
        tenantId,
        subject,
        subjectRef,
        status: Not('unavailable'),
        checkedAt: MoreThanOrEqual(since),
      },
      order: { checkedAt: 'DESC' },
    });
  }

  /** The load's latest check of each subject (bid checks excluded unless `ref` matches). */
  findLatestForLoad(
    tenantId: string,
    loadId: string,
    subject: VerificationSubject,
    subjectRef?: string,
  ): Promise<LoadVerificationEntity | null> {
    return this.checks.findOne({
      where: { tenantId, loadId, subject, ...(subjectRef ? { subjectRef } : {}) },
      order: { checkedAt: 'DESC' },
    });
  }

  async findVehicleGrossWeight(tenantId: string, vehicleId: string): Promise<number | null> {
    const vehicle = await this.vehicles.findOne({
      where: { tenantId, id: vehicleId },
      select: { id: true, grossVehicleWeightKg: true },
    });
    return vehicle?.grossVehicleWeightKg ?? null;
  }
}
