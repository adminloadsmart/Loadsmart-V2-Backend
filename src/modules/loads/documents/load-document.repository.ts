import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { LoadDocumentEntity } from './load-document.entity';
import { LoadDocumentType } from './load-document.types';

export class LoadDocumentRepository {
  private readonly docs: Repository<LoadDocumentEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.docs = dataSource.getRepository(LoadDocumentEntity);
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  private repo(manager?: EntityManager) {
    return manager?.getRepository(LoadDocumentEntity) ?? this.docs;
  }

  listCurrent(manager: EntityManager, tenantId: string, loadId: string) {
    return this.repo(manager).find({ where: { tenantId, loadId, supersededAt: IsNull() } });
  }

  async maxVersions(
    manager: EntityManager,
    loadId: string,
  ): Promise<Map<LoadDocumentType, number>> {
    const rows = await this.repo(manager)
      .createQueryBuilder('doc')
      .select('doc.doc_type', 'docType')
      .addSelect('MAX(doc.version)', 'version')
      .where('doc.load_id = :loadId', { loadId })
      .groupBy('doc.doc_type')
      .getRawMany<{ docType: LoadDocumentType; version: string }>();
    return new Map(rows.map((row) => [row.docType, Number(row.version)]));
  }

  async supersede(manager: EntityManager, ids: string[], at: Date): Promise<void> {
    if (ids.length) {
      await this.repo(manager).update(
        { id: In(ids), supersededAt: IsNull() },
        { supersededAt: at },
      );
    }
  }

  async insert(manager: EntityManager, rows: Partial<LoadDocumentEntity>[]): Promise<void> {
    if (rows.length) await this.repo(manager).save(this.repo(manager).create(rows));
  }

  list(tenantId: string, loadId: string, includeHistory: boolean) {
    return this.docs.find({
      where: { tenantId, loadId, ...(includeHistory ? {} : { supersededAt: IsNull() }) },
      order: { docType: 'ASC', version: 'DESC' },
    });
  }

  findById(tenantId: string, loadId: string, id: string) {
    return this.docs.findOneBy({ tenantId, loadId, id });
  }

  /** Decides a current document; the condition keeps a concurrent re-upload's supersede safe. */
  async decide(
    doc: LoadDocumentEntity,
    fields: Pick<
      LoadDocumentEntity,
      'reviewStatus' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'
    >,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await this.repo(manager).update(
      { id: doc.id, tenantId: doc.tenantId, supersededAt: IsNull() },
      fields,
    );
    return result.affected === 1;
  }

  /** The POD decision applied to the POD's current files. */
  async decideCurrent(
    tenantId: string,
    loadId: string,
    docTypes: readonly LoadDocumentType[],
    fields: Pick<
      LoadDocumentEntity,
      'reviewStatus' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'
    >,
  ): Promise<void> {
    await this.docs.update(
      { tenantId, loadId, docType: In([...docTypes]), supersededAt: IsNull() },
      fields,
    );
  }
}
