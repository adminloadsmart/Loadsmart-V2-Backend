import { DataSource, Repository } from 'typeorm';
import { NotificationTemplateEntity } from './template.entity';

export class TemplatesRepository {
  private readonly repo: Repository<NotificationTemplateEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(NotificationTemplateEntity);
  }

  findByTemplateId(templateId: string): Promise<NotificationTemplateEntity | null> {
    return this.repo.findOneBy({ templateId });
  }
}
