import { DataSource, Repository } from 'typeorm';
import { SettingsVersionEntity } from './settings-version.entity';
import { SettingsValues } from './settings.types';

export class SettingsRepository {
  private readonly versions: Repository<SettingsVersionEntity>;

  constructor(dataSource: DataSource) {
    this.versions = dataSource.getRepository(SettingsVersionEntity);
  }

  latest(): Promise<SettingsVersionEntity | null> {
    return this.versions.findOne({ where: {}, order: { version: 'DESC' } });
  }

  findById(id: string): Promise<SettingsVersionEntity | null> {
    return this.versions.findOneBy({ id });
  }

  list(limit: number): Promise<SettingsVersionEntity[]> {
    return this.versions.find({ order: { version: 'DESC' }, take: limit });
  }

  /** Inserts `version`. A concurrent save of the same number fails the unique index. */
  create(
    version: number,
    settings: SettingsValues,
    note: string | null,
    createdBy: string,
  ): Promise<SettingsVersionEntity> {
    return this.versions.save(
      this.versions.create({
        version,
        settings: settings as unknown as Record<string, unknown>,
        note,
        createdBy,
      }),
    );
  }
}
