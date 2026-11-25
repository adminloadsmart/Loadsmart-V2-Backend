import { describe, expect, it, vi } from 'vitest';
import { GooglePlacesError } from '../../adapters/google-places.client';
import { pinForAddress } from './address-pin';

describe('pinForAddress', () => {
  it('pins a typed address from its parts', async () => {
    const geocode = vi
      .fn()
      .mockResolvedValue({ geometry: { location: { lat: 30.7, lng: 76.78 } } });
    const pin = await pinForAddress(
      { geocode },
      { title: 'Chandigarh bus stand', city: 'Chandigarh', state: 'Chandigarh', pinCode: '160002' },
    );
    expect(pin).toEqual({ latitude: 30.7, longitude: 76.78 });
    expect(geocode).toHaveBeenCalledWith({ address: 'Chandigarh bus stand, Chandigarh, 160002' });
  });

  it('gives no pin when Google has no match, is not configured or fails', async () => {
    const address = { title: 'Somewhere', city: 'Pune' };
    expect(await pinForAddress({ geocode: vi.fn().mockResolvedValue(null) }, address)).toBeNull();
    expect(await pinForAddress(undefined, address)).toBeNull();
    const notConfigured = new GooglePlacesError('NOT_CONFIGURED', 'no key');
    expect(
      await pinForAddress({ geocode: vi.fn().mockRejectedValue(notConfigured) }, address),
    ).toBeNull();
  });
});
