import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, permissionGated } from '../../../shared/openapi/core';
import { brokerValidators as v } from './broker.validators';
import { BROKER_EDIT_PERMISSIONS, BROKER_VIEW_PERMISSIONS } from './broker.permissions';

/** OpenAPI docs for broker.routes.ts — the Brokers page. */
export function registerBrokerOpenApi(registry: OpenAPIRegistry): void {
  const ops = `${API_VERSION_PREFIX}/loadsmart-ops`;
  const brokerView =
    '{ id, brokerName, contactName, phone, isOnWhatsapp, email, base, truckSources[], ' +
    'lane {origin, destinations[], label}, tdsPercent, loadsLast30Days, rating, status, holdReason, pendingOriginalPods }';

  registry.registerPath({
    method: 'get',
    path: `${ops}/brokers`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.listBrokers',
    ...permissionGated(
      [...BROKER_VIEW_PERMISSIONS],
      'The broker list, firm name A–Z. `status` picks the tab (approved / awaiting_approval / ' +
        'on_hold / rejected; omit for All); `search` matches broker name, contact, phone, base or ' +
        'lane. `summary` (the cards) and `tabs` (the tab counts) cover every broker, not the filter.',
    ),
    request: { query: v.listBrokers.shape.query },
    responses: {
      200: {
        description:
          `{ items: [${brokerView}], page, limit, total, totalPages, ` +
          'summary { approved {count, placedLoadLast30Days}, awaitingApproval {count}, onHold {count}, ' +
          'originalPodsPast15Days {count, brokers}, onWhatsapp {count, notOnWhatsapp} }, ' +
          'tabs { all, approved, awaiting_approval, on_hold, rejected } }',
      },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${ops}/brokers/export`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.exportBrokers',
    ...permissionGated(
      [...BROKER_VIEW_PERMISSIONS],
      'Export CSV: every broker matching `status` and `search` (not paged), as a text/csv download.',
    ),
    request: { query: v.exportBrokers.shape.query },
    responses: { 200: { description: 'text/csv' } },
  });
  const detailView =
    `{ ...${brokerView}, businessType, pan {number, verified} | null, aadhaar {number, linkedToPan} | null, ` +
    'asmName, approved {at, byName} | null, createdAt, added { partnerId, truckerSalesName, ' +
    'truckerSalesPhone, advancePercent (null = default), defaultAdvancePercent, noteForPlacement, ' +
    'preferredLanes [{fromCity, toCity}] }, bank { accountName, bankName, accountNumber, ifsc, upiId }, kpis { loadsPlaced, ' +
    'loadsPlacedLast30Days, bidsSent, bidsWon, trucksCancelled90Days, balanceDue, balanceDueLoads }, ' +
    'recentLoads [{ loadId, code, fromCity, toCity, vehicleNumber, truckType, carrierTrip, ' +
    'originalPod {status, courierName, deliveredOn, receivedAt} | null, advanceStatus, balanceStatus }], ' +
    'documents [{ id, docType, docNumber, issuedOn, expiresOn, note, updatedAt, updatedByName }], ' +
    'activity [{ id, kind, at, load {id, code} | null, amount, vehicleNumber, detail, byName }] }';
  registry.registerPath({
    method: 'get',
    path: `${ops}/brokers/{brokerId}`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.getBroker',
    ...permissionGated(
      [...BROKER_VIEW_PERMISSIONS],
      "One broker's page: the list fields, identity, who approved, what Loadsmart added (on the " +
        "broker's partner row — linked or created on first read), KPIs, the 5 most recent loads " +
        'its documents and the latest 20 activity events (bids, wins, losses, trucks placed, ' +
        'payments, cancellations, notes), newest first.',
    ),
    request: { params: v.getBroker.shape.params },
    responses: { 200: { description: detailView }, 404: { description: 'No such broker' } },
  });
  registry.registerPath({
    method: 'patch',
    path: `${ops}/brokers/{brokerId}`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.updateBroker',
    ...permissionGated(
      [...BROKER_EDIT_PERMISSIONS],
      "Edit the broker's contact, phone, WhatsApp and claimed lane, and what Loadsmart adds " +
        '(salesperson, advance %, placement note, preferred lanes). Only the fields sent change. ' +
        'Changing the advance % also needs loadsmart.money.approve. Returns the refreshed page.',
    ),
    request: {
      params: v.updateBroker.shape.params,
      body: { content: { 'application/json': { schema: v.updateBroker.shape.body } } },
    },
    responses: {
      200: { description: detailView },
      404: { description: 'No such broker' },
      409: { description: 'Advance % needs Super Admin, or the phone is already taken' },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${ops}/brokers/{brokerId}/notes`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.addBrokerNote',
    ...permissionGated([...BROKER_VIEW_PERMISSIONS], "Log a note to the broker's Activity."),
    request: {
      params: v.addBrokerNote.shape.params,
      body: { content: { 'application/json': { schema: v.addBrokerNote.shape.body } } },
    },
    responses: { 201: { description: '{ id, body, createdAt, createdByName }' } },
  });
  registry.registerPath({
    method: 'post',
    path: `${ops}/brokers/{brokerId}/documents`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.addBrokerDocument',
    ...permissionGated([...BROKER_EDIT_PERMISSIONS], "Add a document's details (no file)."),
    request: {
      params: v.addBrokerDocument.shape.params,
      body: { content: { 'application/json': { schema: v.addBrokerDocument.shape.body } } },
    },
    responses: {
      201: {
        description:
          '{ id, docType, docNumber, issuedOn, expiresOn, note, updatedAt, updatedByName }',
      },
      404: { description: 'No such broker' },
    },
  });
  registry.registerPath({
    method: 'put',
    path: `${ops}/brokers/{brokerId}/documents/{documentId}`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.updateBrokerDocument',
    ...permissionGated([...BROKER_EDIT_PERMISSIONS], "Replace a document's details."),
    request: {
      params: v.updateBrokerDocument.shape.params,
      body: { content: { 'application/json': { schema: v.updateBrokerDocument.shape.body } } },
    },
    responses: {
      200: {
        description:
          '{ id, docType, docNumber, issuedOn, expiresOn, note, updatedAt, updatedByName }',
      },
      404: { description: 'No such document' },
    },
  });
  registry.registerPath({
    method: 'delete',
    path: `${ops}/brokers/{brokerId}/documents/{documentId}`,
    tags: [TAGS.LOADS],
    operationId: 'loadsmartOps.deleteBrokerDocument',
    ...permissionGated([...BROKER_EDIT_PERMISSIONS], 'Remove a document.'),
    request: { params: v.deleteBrokerDocument.shape.params },
    responses: { 204: { description: 'Removed' }, 404: { description: 'No such document' } },
  });
}
