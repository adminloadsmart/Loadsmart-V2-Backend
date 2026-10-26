import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ZodObject } from 'zod';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  LS_APPROVAL,
  LS_CS,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_POD,
  LS_RECEIVABLES,
  LS_TRACKING,
  LS_VERIFICATION,
  PAYMENTS_MANAGE,
} from '../../shared/constants/permissions';
import { TAGS, authenticated, json, permissionGated } from '../../shared/openapi/core';
import { loadsmartValidators as v } from './loadsmart.validators';

/** OpenAPI docs for the Loadsmart ops console (/loadsmart-ops) and the shipper's Loadsmart
 *  routes — table-driven, one row per route in loadsmart.routes.ts. */

const OPS = `${API_VERSION_PREFIX}/loadsmart-ops`;
const LOADS = `${API_VERSION_PREFIX}/loads`;
const ANY_TEAM = [
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_VERIFICATION,
  LS_TRACKING,
  LS_POD,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
];

type Row = {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  op: string;
  description: string;
  permissions?: string[];
  schema?: ZodObject;
};

const ROWS: Row[] = [
  // Partners and terms
  {
    method: 'get',
    path: `${OPS}/partners`,
    op: 'loadsmart.listPartners',
    permissions: ANY_TEAM,
    description: "Loadsmart's partners — fleet owners and brokers.",
  },
  {
    method: 'post',
    path: `${OPS}/partners`,
    op: 'loadsmart.createPartner',
    permissions: [LS_PLACEMENT],
    schema: v.createPartner,
    description: 'Add a partner (TDS % defaults to 1).',
  },
  {
    method: 'patch',
    path: `${OPS}/partners/{partnerId}`,
    op: 'loadsmart.updatePartner',
    permissions: [LS_PLACEMENT],
    schema: v.updatePartner,
    description: 'Update a partner.',
  },
  {
    method: 'get',
    path: `${OPS}/terms/{tenantId}`,
    op: 'loadsmart.getTerms',
    permissions: ANY_TEAM,
    schema: v.getTerms,
    description: "A shipper's margin and trucker advance % (defaults 8% / 80%).",
  },
  {
    method: 'put',
    path: `${OPS}/terms/{tenantId}`,
    op: 'loadsmart.saveTerms',
    permissions: [LS_APPROVAL],
    schema: v.saveTerms,
    description: "Set a shipper's margin and trucker advance %.",
  },
  // Part 1
  {
    method: 'get',
    path: `${OPS}/approval-queue`,
    op: 'loadsmart.approvalQueue',
    permissions: [LS_APPROVAL],
    description: 'Market loads waiting for the Approval team, with anything flagged missing.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/approve`,
    op: 'loadsmart.approve',
    permissions: [LS_APPROVAL],
    schema: v.approve,
    description:
      'Post the load on the load board. Partners see the target with the margin taken out. Missing fields must be acknowledged.',
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/reject`,
    op: 'loadsmart.reject',
    permissions: [LS_APPROVAL],
    schema: v.reject,
    description: "Don't take the load.",
  },
  {
    method: 'get',
    path: `${OPS}/load-board`,
    op: 'loadsmart.loadBoard',
    permissions: [LS_PLACEMENT],
    description:
      "The load board as partners see it — Loadsmart's rate to them, no shipper or margin.",
  },
  {
    method: 'get',
    path: `${OPS}/placement-queue`,
    op: 'loadsmart.placementQueue',
    permissions: [LS_PLACEMENT],
    description: 'Loads on the board.',
  },
  {
    method: 'get',
    path: `${OPS}/sourcings/{sourcingId}/placement`,
    op: 'loadsmart.placement',
    permissions: [LS_PLACEMENT],
    schema: v.sourcing,
    description:
      "Partner bids ranked (usable truck, then lowest rate) with Loadsmart's price for each, and the partners to call once the load has been on the board 5 minutes.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/partner-bids`,
    op: 'loadsmart.recordPartnerBid',
    permissions: [LS_PLACEMENT],
    schema: v.partnerBid,
    description:
      "Record a partner's rate and truck (checked on VAHAN). Bids from salespeople are refused; quoting again revises the partner's bid.",
  },
  {
    method: 'post',
    path: `${OPS}/sourcings/{sourcingId}/send-bid`,
    op: 'loadsmart.sendBid',
    permissions: [LS_PLACEMENT],
    schema: v.sendBid,
    description:
      "Send the shipper one bid as Loadsmart's — no partner name, priced at the margin unless shipperPrice is given. Under 6% margin needs negotiationNote.",
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/driver`,
    op: 'loadsmart.nameDriver',
    permissions: [LS_PLACEMENT],
    schema: v.nameDriver,
    description:
      "The partner's driver, licence (Sarathi) and papers. The memo waits for the Verification team.",
  },
  {
    method: 'get',
    path: `${OPS}/verification-queue`,
    op: 'loadsmart.verificationQueue',
    permissions: [LS_VERIFICATION],
    description: 'Loads with a driver named, waiting for approval, with their portal checks.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/verification/approve`,
    op: 'loadsmart.approveVerification',
    permissions: [LS_VERIFICATION],
    schema: v.approveVerification,
    description:
      'Approve truck and driver (no failed check) and send the shipper the memo, optionally with the loading contact.',
  },
  {
    method: 'get',
    path: `${OPS}/tracking-queue`,
    op: 'loadsmart.trackingQueue',
    permissions: [LS_TRACKING],
    description: 'Loadsmart loads on the road (read-only — the shipper runs the trip).',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/partner-advance`,
    op: 'loadsmart.payPartnerAdvance',
    permissions: [LS_PAYABLES],
    schema: v.partnerPayment,
    description: "Release the partner's advance (trucker advance %) less TDS, once Loaded.",
  },
  // Part 2
  {
    method: 'get',
    path: `${OPS}/cs-queue`,
    op: 'loadsmart.csQueue',
    permissions: [LS_CS],
    description: 'Loads delivered with issues and their claims (read-only — the shipper settles).',
  },
  {
    method: 'get',
    path: `${OPS}/pod-queue`,
    op: 'loadsmart.podQueue',
    permissions: [LS_POD],
    description: 'Loads with an approved E-POD waiting for the original.',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/ratings`,
    op: 'loadsmart.rate',
    permissions: [LS_POD],
    schema: v.rate,
    description: 'Rate the shipper and the partner (1–5).',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/original-pod`,
    op: 'loadsmart.originalPod',
    permissions: [LS_POD],
    schema: v.originalPod,
    description:
      'The signed original POD reached the office — stage 11, which unlocks the invoice and the partner balance.',
  },
  {
    method: 'get',
    path: `${OPS}/receivables-queue`,
    op: 'loadsmart.receivablesQueue',
    permissions: [LS_RECEIVABLES],
    description: 'Invoiced Loadsmart loads and the shipper payments on them (read-only).',
  },
  {
    method: 'post',
    path: `${OPS}/loads/{loadId}/partner-balance`,
    op: 'loadsmart.payPartnerBalance',
    permissions: [LS_PAYABLES],
    schema: v.partnerPayment,
    description:
      "Pay the partner's balance — trip + approved charges − advance − claim recovery − TDS — from the original POD on. Closes the load if the shipper has paid the balance.",
  },
  {
    method: 'get',
    path: `${OPS}/loads/{loadId}`,
    op: 'loadsmart.loadDetail',
    permissions: ANY_TEAM,
    schema: v.load,
    description:
      'Everything Loadsmart holds on a load — sourcing, partner bids and payments, charges, claim, invoice, ratings.',
  },
  // Shipper side
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/charges`,
    op: 'loads.listCharges',
    schema: v.load,
    description: 'Charges on a Loadsmart load.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/charges/{chargeId}/decision`,
    op: 'loads.decideCharge',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.decideCharge,
    description: 'Approve or reject a charge still waiting for a decision.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/charges`,
    op: 'loads.addCharge',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.addCharge,
    description:
      'Add a loading (at the loading point), unloading (at the drop) or detention (during the trip) charge. It counts as approved and goes on the invoice.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/papers/approve`,
    op: 'loads.approveLoadsmartPapers',
    permissions: [LOADS_DOCUMENTS_MANAGE],
    schema: v.approvePapers,
    description:
      'Approve invoice, e-way bill and signed LR on a Loadsmart load — the e-way bill must name Loadsmart. Moves the load to Loaded.',
  },
  {
    method: 'patch',
    path: `${LOADS}/loads/{loadId}/unloading-contact`,
    op: 'loads.setUnloadingContact',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.unloadingContact,
    description: 'Who will receive the truck.',
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/claim`,
    op: 'loads.getClaim',
    schema: v.load,
    description: 'The claim on a Loadsmart load delivered with issues.',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/claim`,
    op: 'loads.addClaimValue',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.claimValue,
    description: 'Add the claim value (credited on the invoice once settled).',
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/claim/settle`,
    op: 'loads.settleLoadsmartClaim',
    permissions: [DISPATCH_PLANNING_MANAGE],
    schema: v.settleClaim,
    description:
      'Settle the claim with the partner (amount recovered from them) once the claim value is added. The load becomes Delivered without issues.',
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/invoice`,
    op: 'loads.getLoadsmartInvoice',
    schema: v.load,
    description:
      "Loadsmart's invoice and its PDF. Pay it with POST /loads/{loadId}/payments/balance (with the UTR) — the payment counts as verified at once.",
  },
  {
    method: 'post',
    path: `${LOADS}/loads/{loadId}/invoice`,
    op: 'loads.generateLoadsmartInvoice',
    permissions: [PAYMENTS_MANAGE],
    schema: v.invoice,
    description:
      "Generate Loadsmart's invoice (LSI-nnnn, PDF) once the original POD is received: freight + approved charges − settled claim, GST (default 12%), less the advance received.",
  },
  {
    method: 'get',
    path: `${LOADS}/loads/{loadId}/documents-bundle`,
    op: 'loads.documentsBundle',
    schema: v.load,
    description: 'Every document on the load with download URLs, the load memo and the payments.',
  },
];

export function registerLoadsmartOpenApi(registry: OpenAPIRegistry): void {
  for (const row of ROWS) {
    const shape = row.schema?.shape as { params?: ZodObject; body?: ZodObject } | undefined;
    registry.registerPath({
      method: row.method,
      path: row.path,
      tags: [TAGS.LOADS],
      operationId: row.op,
      ...(row.permissions
        ? permissionGated(row.permissions, row.description)
        : authenticated(row.description)),
      request: {
        ...(shape?.params ? { params: shape.params } : {}),
        ...(shape?.body ? { body: json(shape.body) } : {}),
      },
      responses: { 200: { description: 'OK' } },
    });
  }
}
