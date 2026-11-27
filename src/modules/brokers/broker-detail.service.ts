import { QueryFailedError } from 'typeorm';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { rethrow } from '../../shared/errors/rethrow';
import {
  hasPermission,
  PermissionHolder,
} from '../../shared/middleware/require-permission.middleware';
import { LS_MONEY_APPROVE } from '../../shared/constants/permissions';
import { AuditService } from '../audit/audit.service';
import { LsPartnerEntity } from '../loadsmart-ops/entities/ls-partner.entity';
import { SettingsReader } from '../settings/settings.types';
import { BrokerDocumentEntity, BrokerDocumentType } from './broker-document.entity';
import { BROKER_DOCUMENT_RULES, normaliseDocumentNumber } from './broker-document.rules';
import { ActivityRow, BrokerDetailRepository, RecentLoadRow } from './broker-detail.repository';
import { BrokerEntity } from './broker.entity';
import { BrokerView, toBrokerView } from './broker.service';
import type {
  AddBrokerNoteInput,
  BrokerDocumentInput,
  UpdateBrokerInput,
} from './broker.validators';

const RECENT_LOADS = 5;
const CANCELLED_WINDOW_DAYS = 90;
const LAST_DAYS = 30;
const ACTIVITY_LIMIT = 20;

export interface BrokerRecentLoad {
  loadId: string;
  code: string;
  fromCity: string | null;
  toCity: string | null;
  vehicleNumber: string | null;
  truckType: string | null;
  carrierTrip: number | null;
  /** Null when the load has no original-POD record yet (not delivered). */
  originalPod: {
    status: string;
    courierName: string | null;
    deliveredOn: string | null;
    receivedAt: string | null;
  } | null;
  advanceStatus: string | null;
  balanceStatus: string | null;
}

export interface BrokerNoteView {
  id: string;
  body: string;
  createdAt: string;
  createdByName: string | null;
}

export type BrokerActivityKind = ActivityRow['kind'] | 'note' | 'approved' | 'added';

/** One line of the Activity feed. */
export interface BrokerActivityView {
  id: string;
  kind: BrokerActivityKind;
  at: string;
  load: { id: string; code: string } | null;
  amount: number | null;
  vehicleNumber: string | null;
  /** The note's text, the driver's name, the payment's UTR or the cancellation reason. */
  detail: string | null;
  byName: string | null;
}

export interface BrokerDocumentView {
  id: string;
  docType: BrokerDocumentType;
  docNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  note: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

/** GET /loadsmart-ops/brokers/:brokerId — the broker page. */
export interface BrokerDetailView extends BrokerView {
  businessType: string | null;
  pan: { number: string; verified: boolean } | null;
  /** From the Aadhaar on file (full number), else onboarding's last 4 digits. */
  aadhaar: { number: string; linkedToPan: boolean } | null;
  asmName: string | null;
  approved: { at: string; byName: string | null } | null;
  createdAt: string;
  /** "Added by Loadsmart" — kept on the broker's ls_partners row. */
  added: {
    partnerId: string;
    truckerSalesName: string | null;
    truckerSalesPhone: string | null;
    /** Null: the settings' default applies. */
    advancePercent: number | null;
    defaultAdvancePercent: number;
    noteForPlacement: string | null;
    preferredLanes: { fromCity: string; toCity: string }[];
  };
  bank: {
    accountName: string | null;
    bankName: string | null;
    accountNumber: string | null;
    ifsc: string | null;
    upiId: string | null;
  };
  documents: BrokerDocumentView[];
  kpis: {
    loadsPlaced: number;
    loadsPlacedLast30Days: number;
    bidsSent: number;
    bidsWon: number;
    trucksCancelled90Days: number;
    /** Carrier freight not yet paid on loads whose balance isn't paid: trip − advance paid. */
    balanceDue: number;
    balanceDueLoads: number;
  };
  recentLoads: BrokerRecentLoad[];
  /** The latest 20 events, newest first. */
  activity: BrokerActivityView[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export class BrokerDetailService {
  constructor(
    private readonly repo: BrokerDetailRepository,
    private readonly settings: SettingsReader,
    private readonly auditService: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async detail(brokerId: string): Promise<BrokerDetailView> {
    try {
      const broker = await this.repo.findBroker(brokerId);
      if (!broker) throw new NotFoundError(`Broker ${brokerId} not found`);
      const partner = await this.repo.partnerFor(broker);
      const [placed, bids, cancelled, recent, notes, events, documents, settings] =
        await Promise.all([
          this.repo.placedLoads(partner.id),
          this.repo.bidTotals(partner.id),
          this.repo.trucksCancelled(partner.id, CANCELLED_WINDOW_DAYS),
          this.repo.recentLoads(partner.id, RECENT_LOADS),
          this.repo.notes(broker.id),
          this.repo.activity(partner.id, ACTIVITY_LIMIT),
          this.repo.documents(broker.id),
          this.settings.current(),
        ]);
      const names = await this.repo.userNames([
        broker.approvedBy,
        ...notes.map((n) => n.createdBy),
        ...events.map((e) => e.actorId),
        ...documents.map((d) => d.updatedBy ?? d.createdBy),
      ]);
      const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);

      const since = this.now().getTime() - LAST_DAYS * 24 * 60 * 60 * 1000;
      const owed = placed
        .filter((row) => !row.balancePaid && row.carrierTrip !== null)
        .map((row) => Math.max(0, Number(row.carrierTrip) - Number(row.advancePaid)))
        .filter((amount) => amount > 0);

      return {
        ...toBrokerView(broker),
        businessType: broker.businessType,
        ...identityFrom(broker, documents),
        asmName: broker.asmName,
        approved: broker.approvedAt
          ? {
              at: broker.approvedAt.toISOString(),
              byName: broker.approvedBy ? (names.get(broker.approvedBy) ?? null) : null,
            }
          : null,
        createdAt: broker.createdAt.toISOString(),
        added: {
          partnerId: partner.id,
          truckerSalesName: partner.truckerSalesName,
          truckerSalesPhone: partner.truckerSalesPhone,
          advancePercent: partner.advancePercent === null ? null : Number(partner.advancePercent),
          defaultAdvancePercent: settings.values.defaultCarrierAdvancePercent,
          noteForPlacement: partner.noteForPlacement,
          preferredLanes: (partner.lanes ?? [])
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((lane) => ({ fromCity: lane.fromCity, toCity: lane.toCity })),
        },
        bank: {
          accountName: partner.bankAccountName,
          bankName: partner.bankName,
          accountNumber: partner.bankAccountNumber,
          ifsc: partner.bankIfsc,
          upiId: partner.upiId,
        },
        kpis: {
          loadsPlaced: placed.length,
          loadsPlacedLast30Days: placed.filter((row) => new Date(row.placedAt).getTime() >= since)
            .length,
          bidsSent: bids.sent,
          bidsWon: bids.won,
          trucksCancelled90Days: cancelled,
          balanceDue: round2(owed.reduce((sum, amount) => sum + amount, 0)),
          balanceDueLoads: owed.length,
        },
        documents: documents.map((d) => toDocumentView(d, nameOf(d.updatedBy ?? d.createdBy))),
        recentLoads: recent.map(toRecentLoad),
        activity: [
          ...events.map((e): BrokerActivityView => ({
            id: e.id,
            kind: e.kind,
            at: new Date(e.at).toISOString(),
            load: { id: e.loadId, code: e.loadCode },
            amount: e.amount === null ? null : round2(Number(e.amount)),
            vehicleNumber: e.vehicleNumber,
            detail: e.detail,
            byName: nameOf(e.actorId),
          })),
          ...notes.map((note): BrokerActivityView => ({
            ...EMPTY_EVENT,
            id: note.id,
            kind: 'note',
            at: note.createdAt.toISOString(),
            detail: note.body,
            byName: nameOf(note.createdBy),
          })),
          ...(broker.approvedAt
            ? [
                {
                  ...EMPTY_EVENT,
                  id: `approved-${broker.id}`,
                  kind: 'approved' as const,
                  at: broker.approvedAt.toISOString(),
                  byName: nameOf(broker.approvedBy),
                },
              ]
            : []),
          {
            ...EMPTY_EVENT,
            id: `added-${broker.id}`,
            kind: 'added' as const,
            at: broker.createdAt.toISOString(),
          },
        ]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, ACTIVITY_LIMIT),
      };
    } catch (error) {
      rethrow(error, 'Failed to load the broker');
    }
  }

  /** The broker page's edits, in one transaction; returns the refreshed page. */
  async update(
    actor: PermissionHolder & { id: string },
    brokerId: string,
    input: UpdateBrokerInput,
  ): Promise<BrokerDetailView> {
    try {
      const changes = await this.repo.transaction(async (manager) => {
        const broker = await this.repo.findBroker(brokerId, manager);
        if (!broker) throw new NotFoundError(`Broker ${brokerId} not found`);
        const partner = await this.repo.partnerFor(broker, manager);

        const advanceChanges =
          input.advancePercent !== undefined &&
          input.advancePercent !==
            (partner.advancePercent === null ? null : Number(partner.advancePercent));
        if (advanceChanges && !hasPermission(actor, LS_MONEY_APPROVE)) {
          throw new ConflictError("Changing a carrier's advance % needs Super Admin");
        }

        const brokerData: Partial<BrokerEntity> = {
          ...(input.contactName !== undefined ? { truckerName: input.contactName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isOnWhatsapp !== undefined ? { isOnWhatsapp: input.isOnWhatsapp } : {}),
          ...(input.claimedLane !== undefined
            ? {
                laneOrigin: input.claimedLane.origin,
                laneDestinations: input.claimedLane.destinations,
              }
            : {}),
        };
        const partnerData: Partial<LsPartnerEntity> = {
          // The partner's phone is where bids and WhatsApp offers go — keep it the broker's.
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(advanceChanges
            ? {
                advancePercent: input.advancePercent === null ? null : String(input.advancePercent),
              }
            : {}),
          ...(input.noteForPlacement !== undefined
            ? { noteForPlacement: input.noteForPlacement || null }
            : {}),
          ...(input.truckerSalesName !== undefined
            ? { truckerSalesName: input.truckerSalesName || null }
            : {}),
          ...(input.truckerSalesPhone !== undefined
            ? { truckerSalesPhone: input.truckerSalesPhone }
            : {}),
          ...(input.bank !== undefined
            ? {
                bankAccountName: input.bank.accountName,
                bankName: input.bank.bankName,
                bankAccountNumber: input.bank.accountNumber,
                bankIfsc: input.bank.ifsc,
                upiId: input.bank.upiId,
              }
            : {}),
        };

        if (Object.keys(brokerData).length) {
          await manager.getRepository(BrokerEntity).update({ id: broker.id }, brokerData);
        }
        if (Object.keys(partnerData).length) {
          await manager.getRepository(LsPartnerEntity).update({ id: partner.id }, partnerData);
        }
        if (input.preferredLanes !== undefined) {
          await this.repo.replaceLanes(manager, partner.id, input.preferredLanes);
        }
        return {
          partnerId: partner.id,
          old: {
            contactName: broker.truckerName,
            phone: broker.phone,
            advancePercent: partner.advancePercent,
            ...(input.bank !== undefined
              ? {
                  bankAccountNumber: partner.bankAccountNumber,
                  bankIfsc: partner.bankIfsc,
                  upiId: partner.upiId,
                }
              : {}),
          },
          new: { ...brokerData, ...partnerData, preferredLanes: input.preferredLanes },
        };
      });

      await this.auditService.log({
        tenantId: null,
        userId: actor.id,
        action: 'LS_PARTNER_SAVED',
        resourceType: 'ls_partner',
        oldData: { id: changes.partnerId, brokerId, ...changes.old },
        newData: { id: changes.partnerId, brokerId, ...changes.new },
      });
      return await this.detail(brokerId);
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { code?: string }).code === '23505') {
        throw new ConflictError('Another broker already uses this phone number');
      }
      rethrow(error, 'Failed to save the broker');
    }
  }

  /** "Log note" — added to the broker's Activity. */
  async addNote(
    actorId: string,
    brokerId: string,
    input: AddBrokerNoteInput,
  ): Promise<BrokerNoteView> {
    try {
      const broker = await this.repo.findBroker(brokerId);
      if (!broker) throw new NotFoundError(`Broker ${brokerId} not found`);
      const note = await this.repo.addNote(broker.id, input.body, actorId);
      const names = await this.repo.userNames([actorId]);
      return {
        id: note.id,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        createdByName: names.get(actorId) ?? null,
      };
    } catch (error) {
      rethrow(error, 'Failed to log the note');
    }
  }

  /** "Add document" — its details only. */
  async addDocument(
    actorId: string,
    brokerId: string,
    input: BrokerDocumentInput,
  ): Promise<BrokerDocumentView> {
    try {
      const broker = await this.repo.findBroker(brokerId);
      if (!broker) throw new NotFoundError(`Broker ${brokerId} not found`);
      await this.assertSingle(brokerId, input.docType, null);
      const saved = await this.repo.saveDocument({
        brokerId,
        docType: input.docType,
        docNumber: documentNumber(input),
        issuedOn: input.issuedOn,
        expiresOn: input.expiresOn,
        note: input.note,
        createdBy: actorId,
        updatedBy: actorId,
      });
      await this.auditDocument(actorId, brokerId, null, saved);
      return toDocumentView(saved, (await this.repo.userNames([actorId])).get(actorId) ?? null);
    } catch (error) {
      rethrow(error, 'Failed to add the document');
    }
  }

  async updateDocument(
    actorId: string,
    brokerId: string,
    documentId: string,
    input: BrokerDocumentInput,
  ): Promise<BrokerDocumentView> {
    try {
      const existing = await this.repo.findDocument(brokerId, documentId);
      if (!existing) throw new NotFoundError(`Document ${documentId} not found`);
      await this.assertSingle(brokerId, input.docType, existing.id);
      const saved = await this.repo.saveDocument({
        ...existing,
        docType: input.docType,
        docNumber: documentNumber(input),
        issuedOn: input.issuedOn,
        expiresOn: input.expiresOn,
        note: input.note,
        updatedBy: actorId,
      });
      await this.auditDocument(actorId, brokerId, existing, saved);
      return toDocumentView(saved, (await this.repo.userNames([actorId])).get(actorId) ?? null);
    } catch (error) {
      rethrow(error, 'Failed to save the document');
    }
  }

  async deleteDocument(actorId: string, brokerId: string, documentId: string): Promise<void> {
    try {
      const existing = await this.repo.findDocument(brokerId, documentId);
      if (!existing) throw new NotFoundError(`Document ${documentId} not found`);
      await this.repo.deleteDocument(existing.id);
      await this.auditDocument(actorId, brokerId, existing, null);
    } catch (error) {
      rethrow(error, 'Failed to remove the document');
    }
  }

  /** PAN, Aadhaar and GST: one per broker. */
  private async assertSingle(brokerId: string, type: BrokerDocumentType, exceptId: string | null) {
    if (!BROKER_DOCUMENT_RULES[type].single) return;
    const clash = (await this.repo.documents(brokerId)).some(
      (d) => d.docType === type && d.id !== exceptId,
    );
    if (clash) {
      throw new ConflictError('This broker already has one on file — edit that one instead');
    }
  }

  private auditDocument(
    actorId: string,
    brokerId: string,
    before: BrokerDocumentEntity | null,
    after: BrokerDocumentEntity | null,
  ) {
    const pick = (d: BrokerDocumentEntity) => ({
      id: d.id,
      brokerId,
      docType: d.docType,
      docNumber: d.docNumber,
      issuedOn: d.issuedOn,
      expiresOn: d.expiresOn,
    });
    return this.auditService.log({
      tenantId: null,
      userId: actorId,
      action: 'LS_PARTNER_SAVED',
      resourceType: 'broker_document',
      oldData: before ? pick(before) : undefined,
      newData: after ? pick(after) : undefined,
    });
  }
}

const EMPTY_EVENT = {
  load: null,
  amount: null,
  vehicleNumber: null,
  detail: null,
  byName: null,
} satisfies Partial<BrokerActivityView>;

/** Spaces removed and upper-cased. */
function documentNumber(input: BrokerDocumentInput): string | null {
  return input.docNumber ? normaliseDocumentNumber(input.docType, input.docNumber) : null;
}

/** Identity's PAN and Aadhaar: the documents on file first, else what onboarding recorded. */
function identityFrom(
  broker: BrokerEntity,
  documents: readonly BrokerDocumentEntity[],
): Pick<BrokerDetailView, 'pan' | 'aadhaar'> {
  const numberOf = (type: BrokerDocumentType) =>
    documents.find((d) => d.docType === type && d.docNumber)?.docNumber ?? null;
  const pan = numberOf('pan_card') ?? broker.panNumber;
  const aadhaar = numberOf('aadhaar') ?? broker.aadhaarLast4;
  return {
    pan: pan ? { number: pan, verified: pan === broker.panNumber && broker.panVerified } : null,
    aadhaar: aadhaar ? { number: aadhaar, linkedToPan: broker.aadhaarLinkedToPan } : null,
  };
}

function toDocumentView(d: BrokerDocumentEntity, updatedByName: string | null): BrokerDocumentView {
  return {
    id: d.id,
    docType: d.docType,
    docNumber: d.docNumber,
    issuedOn: d.issuedOn,
    expiresOn: d.expiresOn,
    note: d.note,
    updatedAt: d.updatedAt.toISOString(),
    updatedByName,
  };
}

function toRecentLoad(row: RecentLoadRow): BrokerRecentLoad {
  return {
    loadId: row.loadId,
    code: row.code,
    fromCity: row.fromCity,
    toCity: row.toCity,
    vehicleNumber: row.vehicleNumber,
    truckType: row.truckTypeName,
    carrierTrip: row.carrierTrip === null ? null : Number(row.carrierTrip),
    originalPod: row.podStatus
      ? {
          status: row.podStatus,
          courierName: row.podCourier,
          deliveredOn: row.podDeliveredOn,
          receivedAt: iso(row.podReceivedAt),
        }
      : null,
    advanceStatus: row.advanceStatus,
    balanceStatus: row.balanceStatus,
  };
}
