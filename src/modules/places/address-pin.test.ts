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

  it('falls back to the PIN code area when Google cannot match the typed street', async () => {
    const geocode = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ geometry: { location: { lat: 18.52, lng: 73.85 } } });
    const pin = await pinForAddress(
      { geocode },
      {
        title: 'Shed 4, behind the petrol pump',
        city: 'Pune',
        state: 'Maharashtra',
        pinCode: '411001',
      },
    );
    expect(pin).toEqual({ latitude: 18.52, longitude: 73.85 });
    expect(geocode).toHaveBeenLastCalledWith({ address: 'Pune, Maharashtra, 411001' });
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
