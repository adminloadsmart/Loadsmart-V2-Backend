import { IsNull, Repository } from 'typeorm';
import { JobQueue } from '../../jobs/queue-registry';
import { AuditService } from '../audit/audit.service';
import { GstVerificationService } from '../masters/gst/gst.service';
import { GstRateGate } from '../masters/gst/gst-rate-gate';
import {
  GstBackgroundVerification,
  GstVerificationTarget,
} from '../masters/gst/gst-background-verification';
import { CustomerEntity } from './entities/customer.entity';
import { verifiedGstColumns } from './customer.service';

type CustomerStore = Pick<Repository<CustomerEntity>, 'findOneBy' | 'update'>;

/** The customer side of the background GST check ('verify-customer' jobs). */
export function customerGstTarget(customers: CustomerStore): GstVerificationTarget<CustomerEntity> {
  return {
    jobName: 'verify-customer',
    find: (tenantId, id) => customers.findOneBy({ id, tenantId, deletedAt: IsNull() }),
    verifiedColumns: (customer, verified) => ({
      ...verifiedGstColumns(verified, customer.gstin!, customer.name),
      // Fill the address from the register only when the sheet left it blank.
      ...(!customer.registeredAddress && verified.registeredAddress
        ? { registeredAddress: verified.registeredAddress }
        : {}),
    }),
    updateIfPending: async (customer, gstin, columns) => {
      await customers.update(
        { id: customer.id, tenantId: customer.tenantId, gstin, gstVerificationStatus: 'pending' },
        columns,
      );
    },
    auditAction: 'CUSTOMER_GST_VERIFICATION_COMPLETED',
    resourceType: 'customer',
  };
}

/** Background GST verification for bulk-imported customers — see GstBackgroundVerification. */
export class CustomerGstVerificationService extends GstBackgroundVerification<CustomerEntity> {
  constructor(
    customers: CustomerStore,
    gstVerification: GstVerificationService,
    rateGate: GstRateGate,
    audit: AuditService,
    jobQueue: JobQueue,
  ) {
    super(customerGstTarget(customers), gstVerification, rateGate, audit, jobQueue);
  }
}
