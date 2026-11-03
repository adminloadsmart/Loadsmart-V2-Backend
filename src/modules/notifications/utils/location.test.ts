import { describe, expect, it, vi } from 'vitest';
import { LOCATION_CACHE_TTL_SECONDS } from '../notifications.constants';
import { createLocationDescriber, mapLinkOf, shortenAddress } from './location';

const point = { lat: 27.8873, lng: 76.2869 };

function setup({ address = null as string | null, cached = null as string | null } = {}) {
  const addressAt = vi.fn(async () => address);
  const cache = { get: vi.fn(async () => cached), set: vi.fn(async () => 'OK') };
  return { addressAt, cache, describe: createLocationDescriber({ addressAt, cache }) };
}

describe('shortenAddress', () => {
  it('drops the PIN code and country', () => {
    expect(shortenAddress('NH 48, Behror, Rajasthan 301701, India')).toBe(
      'NH 48, Behror, Rajasthan',
    );
    expect(shortenAddress('Behror, Alwar, Rajasthan')).toBe('Behror, Alwar, Rajasthan');
  });
});

describe('createLocationDescriber', () => {
  it("uses tracking's address as is (shortened), without a lookup", async () => {
    const { describe: describeLocation, addressAt, cache } = setup();
    await expect(
      describeLocation(point, 'Dewas bypass, Madhya Pradesh 455001, India'),
    ).resolves.toBe('Dewas bypass, Madhya Pradesh');
    expect(addressAt).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('serves a cached address without asking Google', async () => {
    const { describe: describeLocation, addressAt } = setup({ cached: 'Behror, Alwar' });
    await expect(describeLocation(point, null)).resolves.toBe('Behror, Alwar');
    expect(addressAt).not.toHaveBeenCalled();
  });

  it('looks the address up and caches it per ~110 m cell', async () => {
    const { describe: describeLocation, cache } = setup({ address: 'Behror, Alwar, Rajasthan' });
    await expect(describeLocation(point, '  ')).resolves.toBe('Behror, Alwar, Rajasthan');
    expect(cache.set).toHaveBeenCalledWith(
      'notif:addr:27.887:76.287',
      'Behror, Alwar, Rajasthan',
      LOCATION_CACHE_TTL_SECONDS,
    );
  });

  it('falls back to a map link, without caching the miss', async () => {
    const { describe: describeLocation, cache } = setup();
    await expect(describeLocation(point)).resolves.toBe(mapLinkOf(point));
    expect(mapLinkOf(point)).toBe('https://maps.google.com/?q=27.88730,76.28690');
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('still answers when the cache is down', async () => {
    const { describe: describeLocation, cache } = setup({ address: 'Khanna, Ludhiana' });
    cache.get.mockRejectedValue(new Error('redis down'));
    cache.set.mockRejectedValue(new Error('redis down'));
    await expect(describeLocation(point)).resolves.toBe('Khanna, Ludhiana');
  });
});
