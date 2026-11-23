import { describe, expect, it, vi } from 'vitest';
import { DemoRequestEntity } from './demo-request.entity';
import { DemoRequestsRepository } from './demo-requests.repository';
import { DUPLICATE_WINDOW_MS, DemoRequestsService } from './demo-requests.service';
import { CreateDemoRequestInput } from './demo-requests.types';
import { demoRequestsValidators } from './demo-requests.validators';

const NOW = new Date('2026-11-23T10:00:00Z');
const CONTEXT = { ipAddress: '203.0.113.7', userAgent: 'vitest' };
const INPUT: CreateDemoRequestInput = {
  name: 'Neha Sharma',
  companyName: 'Aravali Home Appliances',
  email: 'neha@aravali.in',
  phoneNumber: '9876543210',
  product: 'tms',
};

function setup(existing: DemoRequestEntity | null = null) {
  const repository = {
    findRecent: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockResolvedValue({}),
  };
  const service = new DemoRequestsService(
    repository as unknown as DemoRequestsRepository,
    () => NOW,
  );
  return { repository, service };
}

describe('DemoRequestsService.create', () => {
  it('saves a new request with its request context', async () => {
    const { repository, service } = setup();
    await expect(service.create(INPUT, CONTEXT)).resolves.toEqual({ received: true });
    expect(repository.findRecent).toHaveBeenCalledWith(
      INPUT.email,
      INPUT.phoneNumber,
      INPUT.product,
      new Date(NOW.getTime() - DUPLICATE_WINDOW_MS),
    );
    expect(repository.create).toHaveBeenCalledWith(INPUT, CONTEXT);
  });

  it('does not save a repeat of a recent request', async () => {
    const { repository, service } = setup({ id: 'x' } as DemoRequestEntity);
    await expect(service.create(INPUT, CONTEXT)).resolves.toEqual({ received: true });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('drops honeypot submissions but still answers success', async () => {
    const { repository, service } = setup();
    await expect(service.create({ ...INPUT, website: 'spam.example' }, CONTEXT)).resolves.toEqual({
      received: true,
    });
    expect(repository.findRecent).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('demoRequestsValidators.create', () => {
  const parse = (body: Record<string, unknown>) =>
    demoRequestsValidators.create.safeParse({ body: { ...INPUT, ...body } });

  it('normalises email and a +91-formatted number', () => {
    const result = parse({ email: '  Neha@Aravali.IN ', phoneNumber: '+91 98765 43210' });
    expect(result.success && result.data.body).toMatchObject({
      email: 'neha@aravali.in',
      phoneNumber: '9876543210',
    });
  });

  it.each([
    ['a number not starting 6-9', { phoneNumber: '5876543210' }],
    ['a short number', { phoneNumber: '98765' }],
    ['a bad email', { email: 'neha@' }],
    ['a one-letter name', { name: 'N' }],
    ['an unknown product', { product: 'crm' }],
    ['an unknown field', { notes: 'hi' }],
  ])('rejects %s', (_label, body) => {
    expect(parse(body).success).toBe(false);
  });
});
