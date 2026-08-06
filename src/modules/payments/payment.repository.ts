import { DataSource, Repository } from 'typeorm';
import { PaymentEntity } from './payments.entity';

export class PaymentRepository {
    private readonly repo: Repository<PaymentEntity>;

    constructor(dataSource: DataSource) {
        this.repo = dataSource.getRepository(PaymentEntity);
    }

    async create(data: Partial<PaymentEntity>): Promise<PaymentEntity> {
        const entity = this.repo.create(data);
        return this.repo.save(entity);
    }

    findById(id: string): Promise<PaymentEntity | null> {
        return this.repo.findOneBy({ id });
    }
}
