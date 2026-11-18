import { DataSource } from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadMemoEntity } from '../loads/memo/load-memo.entity';
import { ChannelPolicyInput } from './channel-policy';

/** What the channel rules need to know about a load. */
export interface LoadChannelFacts {
  forLoad(tenantId: string, loadId: string): Promise<ChannelPolicyInput['load']>;
}

/** Reads how the load was posted (own fleet has no memo step) and whether a memo was ever sent. */
export class TypeormLoadChannelFacts implements LoadChannelFacts {
  constructor(private readonly dataSource: DataSource) {}

  async forLoad(tenantId: string, loadId: string): Promise<ChannelPolicyInput['load']> {
    const load = await this.dataSource
      .getRepository(LoadEntity)
      .findOne({ where: { id: loadId, tenantId }, select: { id: true, postingType: true } });
    if (!load) return null;
    if (load.postingType === 'own_fleet') return { hasMemoStep: false, memoSent: false };
    const memoSent = await this.dataSource
      .getRepository(LoadMemoEntity)
      .exists({ where: { tenantId, loadId } });
    return { hasMemoStep: true, memoSent };
  }
}
