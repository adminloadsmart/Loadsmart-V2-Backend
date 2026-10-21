import { IsNull, Repository } from 'typeorm';
import { JobQueue } from '../../../jobs/queue-registry';
import { AuditService } from '../../audit/audit.service';
import { GstVerificationService } from '../gst/gst.service';
import { GstRateGate } from '../gst/gst-rate-gate';
import {
  GstBackgroundVerification,
  GstVerificationTarget,
} from '../gst/gst-background-verification';
import { TransporterEntity } from './entities/transporter.entity';
import { verifiedTransporterGstColumns } from './transporter.service';

type TransporterStore = Pick<Repository<TransporterEntity>, 'findOneBy' | 'update'>;

/** The transporter side of the background GST check ('verify-transporter' jobs). A verified
 *  GSTIN also fills constitution, company type and a blank address — same as the drawer save. */
export function transporterGstTarget(
  transporters: TransporterStore,
): GstVerificationTarget<TransporterEntity> {
  return {
    jobName: 'verify-transporter',
    find: (tenantId, id) => transporters.findOneBy({ id, tenantId, deletedAt: IsNull() }),
    verifiedColumns: (transporter, verified) =>
      verifiedTransporterGstColumns(verified, transporter.name, transporter),
    updateIfPending: async (transporter, gstin, columns) => {
      await transporters.update(
        {
          id: transporter.id,
          tenantId: transporter.tenantId,
          gstin,
          gstVerificationStatus: 'pending',
        },
        columns,
      );
    },
    auditAction: 'TRANSPORTER_GST_VERIFICATION_COMPLETED',
    resourceType: 'transporter',
  };
}

/** Background GST verification for bulk-imported transporters — see GstBackgroundVerification. */
export class TransporterGstVerificationService extends GstBackgroundVerification<TransporterEntity> {
  constructor(
    transporters: TransporterStore,
    gstVerification: GstVerificationService,
    rateGate: GstRateGate,
    audit: AuditService,
    jobQueue: JobQueue,
  ) {
    super(transporterGstTarget(transporters), gstVerification, rateGate, audit, jobQueue);
  }
}
