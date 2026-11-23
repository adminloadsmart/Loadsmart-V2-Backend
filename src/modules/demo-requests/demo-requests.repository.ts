import { DataSource, MoreThan, Repository } from 'typeorm';
import { DemoRequestEntity } from './demo-request.entity';
import { CreateDemoRequestInput, DemoRequestContext } from './demo-requests.types';

export class DemoRequestsRepository {
  private readonly requests: Repository<DemoRequestEntity>;

  constructor(dataSource: DataSource) {
    this.requests = dataSource.getRepository(DemoRequestEntity);
  }

  /** The same person asking for the same product since `since`, if any. */
  findRecent(
    email: string,
    phoneNumber: string,
    product: DemoRequestEntity['product'],
    since: Date,
  ): Promise<DemoRequestEntity | null> {
    return this.requests.findOne({
      where: { email, phoneNumber, product, createdAt: MoreThan(since) },
      order: { createdAt: 'DESC' },
    });
  }

  create(
    input: Omit<CreateDemoRequestInput, 'website'>,
    context: DemoRequestContext,
  ): Promise<DemoRequestEntity> {
    return this.requests.save(
      this.requests.create({
        name: input.name,
        companyName: input.companyName,
        email: input.email,
        phoneNumber: input.phoneNumber,
        product: input.product,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }),
    );
  }
}
