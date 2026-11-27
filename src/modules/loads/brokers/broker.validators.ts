import { z } from 'zod';
import { paginationQuery } from '../../../shared/validators/pagination';
import { BROKER_DOCUMENT_TYPES } from './broker-document.entity';
import { BROKER_DOCUMENT_RULES, normaliseDocumentNumber } from './broker-document.rules';
import { BROKER_STATUSES } from './broker.types';

const filters = {
  status: z.enum(BROKER_STATUSES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
};

const brokerParams = z.object({ brokerId: z.string().uuid() });
const mobile = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Must be a 10-digit mobile number');
const place = z.string().trim().min(1).max(100);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)');

const today = () => new Date().toISOString().slice(0, 10);

/** The payout account on the broker's ls_partners row. UPI is optional. */
const bank = z
  .object({
    accountName: z
      .string()
      .trim()
      .min(3, 'Enter the account holder name')
      .max(150)
      .regex(/^[A-Za-z0-9 .&'(),/-]+$/, "Use letters, digits, spaces and . & ' ( ) , / -")
      .regex(/[A-Za-z]/, 'Enter the account holder name'),
    bankName: z
      .string()
      .trim()
      .min(2, 'Enter the bank name')
      .max(100)
      .regex(/^[A-Za-z .&()-]+$/, 'Use letters, spaces and . & ( ) -'),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234'),
    upiId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/, 'Enter a valid UPI ID, e.g. name@okhdfc')
      .nullable(),
  })
  .strict();

/** A document's details (no file) — the number, dates and note each type needs
 *  (BROKER_DOCUMENT_RULES). */
const documentBody = z
  .object({
    docType: z.enum(BROKER_DOCUMENT_TYPES),
    docNumber: optionalText(50),
    issuedOn: isoDate.nullable(),
    expiresOn: isoDate.nullable(),
    note: optionalText(500),
  })
  .strict()
  .superRefine((d, ctx) => {
    const r = BROKER_DOCUMENT_RULES[d.docType];
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!d.docNumber) {
      if (r.numberRequired) issue('docNumber', 'Enter the document number');
    } else if (!r.pattern.test(normaliseDocumentNumber(d.docType, d.docNumber))) {
      issue('docNumber', r.message);
    }
    if (r.issuedOnRequired && !d.issuedOn) issue('issuedOn', 'Enter the issue date');
    if (r.expiresOnRequired && !d.expiresOn) issue('expiresOn', 'Enter the valid-till date');
    if (r.noteRequired && !d.note) issue('note', 'Describe the document');
    if (d.issuedOn && d.issuedOn > today()) issue('issuedOn', "Issue date can't be in the future");
    if (d.issuedOn && d.expiresOn && d.expiresOn < d.issuedOn) {
      issue('expiresOn', 'Valid-till must be after the issue date');
    }
  });
const documentParams = brokerParams.extend({ documentId: z.string().uuid() });

export const brokerValidators = {
  listBrokers: z.object({ query: paginationQuery.extend(filters) }),
  exportBrokers: z.object({ query: z.object(filters) }),
  getBroker: z.object({ params: brokerParams }),
  /** The broker page's edits: the contact and claimed lane (loads.brokers) and what Loadsmart
   *  adds (the broker's ls_partners row). Only the fields sent change. */
  updateBroker: z.object({
    params: brokerParams,
    body: z
      .object({
        contactName: z.string().trim().min(1).max(150).optional(),
        phone: mobile.optional(),
        isOnWhatsapp: z.boolean().optional(),
        claimedLane: z
          .object({ origin: place, destinations: z.array(place).min(1).max(20) })
          .strict()
          .optional(),
        truckerSalesName: z.string().trim().max(150).nullable().optional(),
        truckerSalesPhone: mobile.nullable().optional(),
        /** null: back to the settings' default. 85% or 80% needs Super Admin. */
        advancePercent: z.number().min(50).max(100).nullable().optional(),
        noteForPlacement: z.string().trim().max(1000).nullable().optional(),
        preferredLanes: z
          .array(z.object({ fromCity: place, toCity: place }).strict())
          .max(100)
          .optional(),
        bank: bank.optional(),
      })
      .strict()
      .refine((body) => Object.keys(body).length > 0, 'Nothing to update'),
  }),
  addBrokerNote: z.object({
    params: brokerParams,
    body: z.object({ body: z.string().trim().min(1).max(1000) }).strict(),
  }),
  addBrokerDocument: z.object({ params: brokerParams, body: documentBody }),
  updateBrokerDocument: z.object({ params: documentParams, body: documentBody }),
  deleteBrokerDocument: z.object({ params: documentParams }),
};

export type ListBrokersQuery = z.infer<typeof brokerValidators.listBrokers>['query'];
export type BrokerFilters = z.infer<typeof brokerValidators.exportBrokers>['query'];
export type UpdateBrokerInput = z.infer<typeof brokerValidators.updateBroker>['body'];
export type AddBrokerNoteInput = z.infer<typeof brokerValidators.addBrokerNote>['body'];
export type BrokerDocumentInput = z.infer<typeof brokerValidators.addBrokerDocument>['body'];
