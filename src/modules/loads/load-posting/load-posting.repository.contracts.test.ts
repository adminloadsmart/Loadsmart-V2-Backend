import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { LoadPostingRepository } from './load-posting.repository';

const contract = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  sourceCity: from[0],
  sourceState: from[1],
  destinationCity: to[0],
  destinationState: to[1],
});

function build(rows: unknown[]) {
  const qb = {
    leftJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(rows),
  };
  const dataSource = {
    getRepository: () => ({ createQueryBuilder: () => qb }),
  } as unknown as DataSource;
  return new LoadPostingRepository(dataSource);
}

describe('LoadPostingRepository.findMasterContractsOnLane', () => {
  it('matches the corridor however the city and state are written', async () => {
    const repository = build([
      contract('short-forms', ['Zirakpur', 'PB'], ['Mohali', 'PB']),
      contract('google-names', ['zirakpur', 'Punjab'], ['SAS Nagar', 'Punjab']),
      contract('other-drop', ['Zirakpur', 'PB'], ['Ludhiana', 'PB']),
      contract('reversed', ['Mohali', 'PB'], ['Zirakpur', 'PB']),
    ]);
    const found = await repository.findMasterContractsOnLane('tenant', {
      sourceCity: 'Zirakpur',
      sourceState: 'Punjab',
      destinationCity: 'Sahibzada Ajit Singh Nagar',
      destinationState: 'Punjab',
    });
    expect(found.map((c) => c.id)).toEqual(['short-forms', 'google-names']);
  });
});
