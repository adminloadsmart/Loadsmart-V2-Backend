import { QueryFailedError } from 'typeorm';
import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { SettingsRepository } from './settings.repository';
import { SettingsVersionEntity } from './settings-version.entity';
import {
  DEFAULT_SETTINGS,
  parseStoredSettings,
  ResolvedSettings,
  SettingsReader,
  SettingsValues,
} from './settings.types';

export interface SaveSettingsInput {
  settings: SettingsValues;
  note?: string;
  /** The version the editor started from; a newer save in between is a conflict. */
  basedOnVersion?: number;
}

export interface SettingsVersionView extends ResolvedSettings {
  note: string | null;
  createdBy: string | null;
  createdAt: Date | null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string } | undefined)?.code === '23505';

/**
 * Super Admin → Settings (S03). Versions are immutable, so a version read by id is cached for the
 * life of the process; the latest version is always read from the database (it's one indexed row,
 * and a cache would let one instance keep posting under old values after a save on another).
 */
export class SettingsService implements SettingsReader {
  private readonly byIdCache = new Map<string, ResolvedSettings>();

  constructor(
    private readonly repository: SettingsRepository,
    private readonly auditService: AuditService,
  ) {}

  async current(): Promise<ResolvedSettings> {
    const latest = await this.repository.latest();
    // Version 1 is created by the migration; defaults only cover a database without it.
    if (!latest) return { id: null, version: 0, values: DEFAULT_SETTINGS };
    return this.remember(latest);
  }

  async forLoad(load: { settingsVersionId: string | null }): Promise<ResolvedSettings> {
    if (!load.settingsVersionId) return this.current();
    const cached = this.byIdCache.get(load.settingsVersionId);
    if (cached) return cached;
    const row = await this.repository.findById(load.settingsVersionId);
    return row ? this.remember(row) : this.current();
  }

  async getCurrent(): Promise<SettingsVersionView> {
    try {
      const latest = await this.repository.latest();
      if (!latest) {
        return { ...(await this.current()), note: null, createdBy: null, createdAt: null };
      }
      return this.toView(latest);
    } catch (error) {
      rethrow(error, 'Failed to read settings');
    }
  }

  async listVersions(limit = 50): Promise<SettingsVersionView[]> {
    try {
      return (await this.repository.list(limit)).map((row) => this.toView(row));
    } catch (error) {
      rethrow(error, 'Failed to list settings versions');
    }
  }

  async getVersion(id: string): Promise<SettingsVersionView> {
    try {
      const row = await this.repository.findById(id);
      if (!row) throw new NotFoundError(`Settings version ${id} not found`);
      return this.toView(row);
    } catch (error) {
      rethrow(error, 'Failed to read the settings version');
    }
  }

  /** Saves the next version. Applies to loads posted from now on; loads already posted keep the
   *  version they were posted under. */
  async save(actorId: string, input: SaveSettingsInput): Promise<SettingsVersionView> {
    try {
      const latest = await this.repository.latest();
      const latestVersion = latest?.version ?? 0;
      if (input.basedOnVersion !== undefined && input.basedOnVersion !== latestVersion) {
        throw new ConflictError(
          `Settings were changed since you opened them (now version ${latestVersion}) — reload and try again`,
        );
      }
      const settings = input.settings;
      let saved: SettingsVersionEntity;
      try {
        saved = await this.repository.create(
          latestVersion + 1,
          settings,
          input.note?.trim() || null,
          actorId,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            'Settings were saved by someone else just now — reload and try again',
          );
        }
        throw error;
      }

      await this.auditService.log({
        tenantId: null,
        userId: actorId,
        action: 'LOADSMART_SETTINGS_SAVED',
        resourceType: 'settings_version',
        oldData: latest ? { version: latest.version, settings: latest.settings } : null,
        newData: { id: saved.id, version: saved.version, settings, note: saved.note },
      });
      return this.toView(saved);
    } catch (error) {
      rethrow(error, 'Failed to save settings');
    }
  }

  private remember(row: SettingsVersionEntity): ResolvedSettings {
    const cached = this.byIdCache.get(row.id);
    if (cached) return cached;
    const resolved = {
      id: row.id,
      version: row.version,
      values: parseStoredSettings(row.settings),
    };
    this.byIdCache.set(row.id, resolved);
    return resolved;
  }

  private toView(row: SettingsVersionEntity): SettingsVersionView {
    return {
      ...this.remember(row),
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }
}
