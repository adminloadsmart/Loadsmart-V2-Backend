import { NotFoundError, rethrow } from '../../../shared/errors';
import { LoadPostingRepository } from './load-posting.repository';
import { SettingsReader } from '../../settings/settings.types';
import { reportingLeadError } from './utils/reporting-lead';

/**
 * "Save draft" keeps every field including the picked past load. The payload is stored as-is (a
 * draft may be incomplete); on reopen the minimum reporting lead (Settings) is checked again and a pickup that
 * is now too soon is flagged, not silently kept.
 */
export class LoadDraftService {
  constructor(
    private readonly repository: LoadPostingRepository,
    private readonly settings: SettingsReader,
  ) {}

  async create(tenantId: string, userId: string, payload: Record<string, unknown>) {
    try {
      return await this.repository.createDraft(tenantId, userId, payload);
    } catch (error) {
      rethrow(error, 'Failed to save draft');
    }
  }

  async list(tenantId: string, userId: string) {
    try {
      return await this.repository.listDrafts(tenantId, userId);
    } catch (error) {
      rethrow(error, 'Failed to list drafts');
    }
  }

  async get(tenantId: string, userId: string, draftId: string) {
    try {
      const draft = await this.repository.findDraft(tenantId, userId, draftId);
      if (!draft) throw new NotFoundError(`Draft ${draftId} not found`);
      const pickupAt =
        typeof draft.payload.pickupAt === 'string' ? Date.parse(draft.payload.pickupAt) : NaN;
      const { values } = await this.settings.current();
      const pickupMessage = Number.isNaN(pickupAt)
        ? null
        : reportingLeadError(new Date(pickupAt), new Date(), values.minReportingLeadMinutes);
      return {
        id: draft.id,
        payload: draft.payload,
        updatedAt: draft.updatedAt,
        pickupTooSoon: pickupMessage !== null,
        pickupMessage,
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch draft');
    }
  }

  async update(
    tenantId: string,
    userId: string,
    draftId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      const draft = await this.repository.findDraft(tenantId, userId, draftId);
      if (!draft) throw new NotFoundError(`Draft ${draftId} not found`);
      return await this.repository.updateDraft(draft, payload);
    } catch (error) {
      rethrow(error, 'Failed to update draft');
    }
  }

  async delete(tenantId: string, userId: string, draftId: string): Promise<void> {
    try {
      if (!(await this.repository.deleteDraft(tenantId, userId, draftId))) {
        throw new NotFoundError(`Draft ${draftId} not found`);
      }
    } catch (error) {
      rethrow(error, 'Failed to delete draft');
    }
  }
}
