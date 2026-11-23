import { DemoRequestsRepository } from './demo-requests.repository';
import {
  CreateDemoRequestInput,
  DemoRequestContext,
  DemoRequestReceipt,
} from './demo-requests.types';

/** A repeat of the same request inside this window (a double-click, a back-and-resubmit) is
 *  treated as the one already saved instead of creating a duplicate row. */
export const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

const RECEIPT: DemoRequestReceipt = { received: true };

export class DemoRequestsService {
  constructor(
    private readonly repository: DemoRequestsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    input: CreateDemoRequestInput,
    context: DemoRequestContext,
  ): Promise<DemoRequestReceipt> {
    // Honeypot filled in: a bot. Answer exactly like a real success so it learns nothing.
    if (input.website?.trim()) return RECEIPT;

    const since = new Date(this.now().getTime() - DUPLICATE_WINDOW_MS);
    const existing = await this.repository.findRecent(
      input.email,
      input.phoneNumber,
      input.product,
      since,
    );
    if (!existing) {
      const { website: _website, ...fields } = input;
      await this.repository.create(fields, context);
    }
    return RECEIPT;
  }
}
