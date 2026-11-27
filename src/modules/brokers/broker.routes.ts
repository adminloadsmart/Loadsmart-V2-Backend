import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { BrokerController } from './broker.controller';
import { brokerValidators as v } from './broker.validators';
import { BrokerDriverController } from './broker-driver.controller';
import { brokerDriverValidators as dv } from './broker-driver.validators';
import { BROKER_EDIT_PERMISSIONS, BROKER_VIEW_PERMISSIONS } from './broker.permissions';

/** At /v1/loadsmart-ops — the Brokers page (Masters → Brokers), one broker's page, and the
 *  brokers' drivers (Masters → Drivers). */
export function createBrokerRoutes(c: BrokerController, drivers: BrokerDriverController): Router {
  const router = Router();
  const canView = requirePermission(...BROKER_VIEW_PERMISSIONS);
  const canEdit = requirePermission(...BROKER_EDIT_PERMISSIONS);
  // Before /brokers/:brokerId, so "drivers" isn't read as a broker id.
  router.get('/brokers/drivers', canView, validate(dv.listDrivers), asyncHandler(drivers.list));
  router.post('/brokers/drivers', canEdit, validate(dv.createDriver), asyncHandler(drivers.create));
  router.get(
    '/brokers/drivers/:driverId',
    canView,
    validate(dv.getDriver),
    asyncHandler(drivers.detail),
  );
  router.patch(
    '/brokers/drivers/:driverId',
    canEdit,
    validate(dv.updateDriver),
    asyncHandler(drivers.update),
  );

  router.get('/brokers', canView, validate(v.listBrokers), asyncHandler(c.list));
  // Before /brokers/:brokerId, so "export" isn't read as an id.
  router.get('/brokers/export', canView, validate(v.exportBrokers), asyncHandler(c.exportCsv));
  router.get('/brokers/:brokerId', canView, validate(v.getBroker), asyncHandler(c.detail));
  router.patch('/brokers/:brokerId', canEdit, validate(v.updateBroker), asyncHandler(c.update));
  router.post(
    '/brokers/:brokerId/notes',
    canView,
    validate(v.addBrokerNote),
    asyncHandler(c.addNote),
  );
  router.post(
    '/brokers/:brokerId/documents',
    canEdit,
    validate(v.addBrokerDocument),
    asyncHandler(c.addDocument),
  );
  router.put(
    '/brokers/:brokerId/documents/:documentId',
    canEdit,
    validate(v.updateBrokerDocument),
    asyncHandler(c.updateDocument),
  );
  router.delete(
    '/brokers/:brokerId/documents/:documentId',
    canEdit,
    validate(v.deleteBrokerDocument),
    asyncHandler(c.deleteDocument),
  );
  return router;
}
