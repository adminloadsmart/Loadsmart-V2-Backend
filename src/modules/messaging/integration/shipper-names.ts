import { DataSource } from 'typeorm';
import { OrganizationEntity } from '../../organization/entities/organization.entity';
import { ShipperNameLookup } from './whatsapp-dispatch-notifier';

/** The shipper company's display name: the organization row whose id is the tenant id. */
export class TypeormShipperNames implements ShipperNameLookup {
  constructor(private readonly dataSource: DataSource) {}

  async nameOf(tenantId: string): Promise<string | null> {
    const organization = await this.dataSource.getRepository(OrganizationEntity).findOne({
      where: { id: tenantId },
      select: { id: true, name: true, registeredBusinessName: true, companyLegalName: true },
    });
    return (
      organization?.name ??
      organization?.registeredBusinessName ??
      organization?.companyLegalName ??
      null
    );
  }
}
