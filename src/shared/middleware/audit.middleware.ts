import { RequestHandler } from 'express';
import { AuditService } from '../../modules/audit/audit.service';

export const createAudit = (auditService: AuditService): RequestHandler => {
  return (req, res, next) => {
    res.on('finish', () => {
      auditService
        .log({
          tenantId: req.user?.tenantId ?? null,
          userId: req.user?.id ?? null,
          action: req.method,
          resourceType: req.baseUrl || req.path,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        })
        .catch((err) => console.error('[audit] failed to persist audit log', err));
    });
    next();
  };
};
