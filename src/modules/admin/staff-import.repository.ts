import { DataSource, IsNull, Repository } from 'typeorm';
import { StaffImportEntity, StaffImportStatus } from './entities/staff-import.entity';
import { StaffImportRowEntity } from './entities/staff-import-row.entity';

export class StaffImportRepository {
  private readonly imports: Repository<StaffImportEntity>;
  private readonly rows: Repository<StaffImportRowEntity>;
  constructor(dataSource: DataSource) {
    this.imports = dataSource.getRepository(StaffImportEntity);
    this.rows = dataSource.getRepository(StaffImportRowEntity);
  }
  createImport(data: Partial<StaffImportEntity>) {
    return this.imports.save(this.imports.create(data));
  }
  createRows(data: Partial<StaffImportRowEntity>[]) {
    return this.rows.save(data.map((row) => this.rows.create(row)));
  }
  findByIdForUser(id: string, uploadedBy: string) {
    return this.imports.findOne({ where: { id, uploadedBy }, relations: { rows: true } });
  }
  async updateImport(id: string, data: Partial<StaffImportEntity>) {
    await this.imports.update({ id }, data as never);
    return this.imports.findOne({ where: { id }, relations: { rows: true } });
  }
  async updateRow(id: string, data: Partial<StaffImportRowEntity>) {
    await this.rows.update({ id }, data as never);
  }
}
