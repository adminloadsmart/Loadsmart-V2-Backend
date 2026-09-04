import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { transporterSettlementValidators } from './transporter-settlement.validators';
import { transporterPayablesValidators } from './transporter-payables.validators';
import { SETTLEMENTS_MANAGE } from '../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  errorContent,
  json,
} from '../../shared/openapi/core';

/**
 * OpenAPI docs for the payments module: registers every route in payments.routes.ts, in the same
 * order, under the `payments` tag. See loads.openapi.ts for the pattern this mirrors.
 */

const BASE = `${API_VERSION_PREFIX}/payments`; // absolute path — must match its mount in composition-root.ts
const manageSettlements = (description: string) =>
  permissionGated([SETTLEMENTS_MANAGE], description);

export function registerPaymentsOpenApi(registry: OpenAPIRegistry): void {
  // --- Transporter payables dashboard — Accounts. Read-only; "Record payment" isn't a route
  // here, it's POST /loads/{loadId}/payments/balance (loads.openapi.ts). ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporter-payables`,
    tags: [TAGS.PAYMENTS],
    operationId: 'payments.getTransporterPayablesDashboard',
    ...authenticated(
      'Tiles (total pending / due / overdue / paid-in-period) plus one row per transporter with ' +
        'a market-load balance owed — advance paid, balance pending, next due date, overdue ' +
        'amount and paid-to-date. A load counts as paid once its advance/balance UTR is recorded ' +
        '(/loads/{loadId}/payments/*) or its settlement is recorded ' +
        '(/payments/transporter-settlements/{loadId}) — either fully zeroes its pending balance ' +
        'here.',
    ),
    request: { query: transporterPayablesValidators.dashboard.shape.query },
    responses: {
      200: {
        description:
          '{ tiles: { totalPending, due, overdue, paidInPeriod }, transporters: [...], total }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporter-payables/{transporterId}/loads`,
    tags: [TAGS.PAYMENTS],
    operationId: 'payments.getTransporterPayableLoads',
    ...authenticated(
      'Drill-down behind "Open transporter" — one row per market load for this transporter: POD ' +
        'status, advance paid, balance pending, due date, overdue amount.',
    ),
    request: {
      params: transporterPayablesValidators.transporterLoads.shape.params,
      query: transporterPayablesValidators.transporterLoads.shape.query,
    },
    responses: {
      200: { description: '{ items: [...], total }' },
    },
  });

  // --- Transporter settlements ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporter-settlements/{loadId}/summary`,
    tags: [TAGS.PAYMENTS],
    operationId: 'payments.getTransporterSettlementSummary',
    ...authenticated(
      "Compute what's owed to a market load's transporter — full freight value less whatever " +
        "was already recorded via /loads/{loadId}/payments/* — plus whether the transporter's " +
        'bank details are on file and whether this load has already been settled.',
    ),
    request: { params: transporterSettlementValidators.summary.shape.params },
    responses: {
      200: {
        description:
          '{ loadId, transporterId, totalOwed, totalPaid, remainingAmount, bankDetailsOnFile, alreadySettled }',
      },
      404: { description: 'Load not found', ...errorContent },
      409: { description: 'Not a market load, or no transporter assigned', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporter-settlements/{loadId}`,
    tags: [TAGS.PAYMENTS],
    operationId: 'payments.recordTransporterSettlement',
    ...manageSettlements(
      'Record the settlement payout for a delivered market load. Refused if the transporter has ' +
        'no bank details on file, if a settlement was already recorded for this load, or if ' +
        'nothing remains owed.',
    ),
    request: {
      params: transporterSettlementValidators.record.shape.params,
      body: json(transporterSettlementValidators.record.shape.body),
    },
    responses: {
      201: { description: 'Recorded settlement' },
      400: {
        description: "Validation failed, or the transporter's bank details are missing",
        ...errorContent,
      },
      404: { description: 'Load not found', ...errorContent },
      409: {
        description:
          'Not a market load, not yet delivered, already settled, or nothing remaining to settle',
        ...errorContent,
      },
    },
  });
}
