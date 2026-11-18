import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../../shared/errors';
import { NotificationTriggers } from '../../notifications/notifications.interface';
import { LoadActivityService } from '../activity/load-activity.service';
import { CallOutcome, LoadsmartCallTeam } from '../utils/loads.types';
import { CallPartyRef, LoadCallEntity } from './load-call.entity';
import { LoadCallRepository } from './load-call.repository';

export interface LogCallInput {
  parties: CallPartyRef[];
  notes: string;
  outcome: CallOutcome;
  price?: number;
  /** Optional reminder (ISO, in the future). */
  reminderAt?: string;
}

export interface CallView {
  id: string;
  loadId: string;
  team: string;
  calledBy: { id: string; name: string | null };
  parties: CallPartyRef[];
  notes: string;
  outcome: CallOutcome;
  price: string | null;
  reminderAt: string | null;
  reminderDoneAt: string | null;
  createdAt: string;
}

/**
 * Log a call (load module spec p.36): a short form on every load — who was spoken to (one or more
 * of shipper, driver, broker, shipper sales, trucker sales), what was discussed, the outcome (not
 * picked up / picked up / price) and an optional reminder. Each call is saved with the user and
 * time and noted on the load's timeline (CALL_LOGGED). A shipper user's reminder arrives as a
 * notification (call.reminder); Loadsmart's teams have no tenant inbox, so theirs is the
 * "my reminders" queue.
 */
export class LoadCallService {
  constructor(
    private readonly repository: LoadCallRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly triggers?: NotificationTriggers,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The shipper's own team, on their own load. */
  async logShipperCall(
    tenantId: string,
    userId: string,
    loadId: string,
    input: LogCallInput,
  ): Promise<CallView> {
    try {
      const load = await this.repository.findLoad(loadId, tenantId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      const call = await this.save(load.tenantId, userId, loadId, 'shipper', input);
      if (call.reminderAt) {
        await this.triggers?.enqueue(
          'call.reminder',
          load.tenantId,
          { callId: call.id, loadId, userId, reminderAt: call.reminderAt.toISOString() },
          { delayMs: Math.max(1, call.reminderAt.getTime() - this.now().getTime()) },
        );
      }
      return (await this.toViews([call]))[0];
    } catch (error) {
      rethrow(error, 'Failed to log the call');
    }
  }

  /** One of Loadsmart's teams, on any load. */
  async logLoadsmartCall(
    userId: string,
    loadId: string,
    team: LoadsmartCallTeam,
    input: LogCallInput,
  ): Promise<CallView> {
    try {
      const load = await this.repository.findLoad(loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      return (await this.toViews([await this.save(load.tenantId, userId, loadId, team, input)]))[0];
    } catch (error) {
      rethrow(error, 'Failed to log the call');
    }
  }

  /** The shipper sees its own team's calls — never Loadsmart's internal ones. */
  async listForShipper(tenantId: string, loadId: string): Promise<CallView[]> {
    if (!(await this.repository.findLoad(loadId, tenantId)))
      throw new NotFoundError(`Load ${loadId} not found`);
    return this.toViews(await this.repository.listForLoad(loadId, ['shipper']));
  }

  /** Loadsmart's teams see every call on the load. */
  async listForLoadsmart(loadId: string): Promise<CallView[]> {
    if (!(await this.repository.findLoad(loadId)))
      throw new NotFoundError(`Load ${loadId} not found`);
    return this.toViews(await this.repository.listForLoad(loadId));
  }

  /** The user's open reminders, soonest first, with the load code and whether each is due. */
  async myReminders(userId: string) {
    const now = this.now();
    const calls = await this.repository.listOpenReminders(userId);
    const codes = await this.repository.loadCodes([...new Set(calls.map((call) => call.loadId))]);
    return (await this.toViews(calls)).map((view, index) => ({
      ...view,
      loadCode: codes.get(view.loadId) ?? null,
      isDue: calls[index].reminderAt!.getTime() <= now.getTime(),
    }));
  }

  /** The caller closes their own reminder. */
  async markReminderDone(userId: string, callId: string): Promise<CallView> {
    try {
      const call = await this.repository.findById(callId);
      if (!call || call.calledByUserId !== userId)
        throw new NotFoundError(`Call ${callId} not found`);
      if (!call.reminderAt) throw new ConflictError('This call has no reminder');
      if (!call.reminderDoneAt) {
        call.reminderDoneAt = this.now();
        await this.repository.markReminderDone(callId, call.reminderDoneAt);
      }
      return (await this.toViews([call]))[0];
    } catch (error) {
      rethrow(error, 'Failed to close the reminder');
    }
  }

  /** For the call.reminder notification: the call while its reminder is still open, else null. */
  async openReminder(
    callId: string,
    reminderAt: string,
  ): Promise<{ call: LoadCallEntity; loadCode: string | null } | null> {
    const call = await this.repository.findById(callId);
    if (!call || call.reminderDoneAt || call.reminderAt?.toISOString() !== reminderAt) return null;
    const codes = await this.repository.loadCodes([call.loadId]);
    return { call, loadCode: codes.get(call.loadId) ?? null };
  }

  private async save(
    tenantId: string,
    userId: string,
    loadId: string,
    team: LoadCallEntity['team'],
    input: LogCallInput,
  ): Promise<LoadCallEntity> {
    if (input.outcome === 'price' && input.price === undefined) {
      throw new ValidationError('Add the price when the outcome is "price"');
    }
    const reminderAt = input.reminderAt ? new Date(input.reminderAt) : null;
    if (reminderAt && reminderAt.getTime() <= this.now().getTime()) {
      throw new ValidationError('The reminder must be in the future');
    }
    const call = await this.repository.create({
      tenantId,
      loadId,
      calledByUserId: userId,
      team,
      parties: input.parties,
      notes: input.notes,
      outcome: input.outcome,
      price: input.outcome === 'price' && input.price !== undefined ? String(input.price) : null,
      reminderAt,
    });
    await this.loadActivityService.record(tenantId, loadId, userId, 'CALL_LOGGED', null, null, {
      callId: call.id,
      team,
      parties: input.parties.map((party) => party.role),
      outcome: input.outcome,
      price: call.price,
      reminderAt: reminderAt?.toISOString() ?? null,
    });
    return call;
  }

  private async toViews(calls: LoadCallEntity[]): Promise<CallView[]> {
    const names = await this.repository.userNames([
      ...new Set(calls.map((call) => call.calledByUserId)),
    ]);
    return calls.map((call) => ({
      id: call.id,
      loadId: call.loadId,
      team: call.team,
      calledBy: { id: call.calledByUserId, name: names.get(call.calledByUserId) ?? null },
      parties: call.parties,
      notes: call.notes,
      outcome: call.outcome,
      price: call.price,
      reminderAt: call.reminderAt?.toISOString() ?? null,
      reminderDoneAt: call.reminderDoneAt?.toISOString() ?? null,
      createdAt: call.createdAt.toISOString(),
    }));
  }
}
