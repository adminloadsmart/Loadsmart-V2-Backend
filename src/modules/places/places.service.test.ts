import { describe, expect, it, vi } from 'vitest';
import { GooglePlacesClient, GooglePlacesError } from '../../adapters/google-places.client';
import { NotFoundError } from '../../shared/errors';
import { PlacesService, toPlaceDetails, toShortAddress } from './places.service';

describe('toPlaceDetails', () => {
  it('parses address components and coordinates', () => {
    expect(
      toPlaceDetails({
        place_id: 'abc',
        name: 'Pune Station',
        formatted_address: 'Pune, Maharashtra 411001, India',
        geometry: { location: { lat: 18.5, lng: 73.8 } },
        address_components: [
          { long_name: 'Pune', short_name: 'Pune', types: ['locality'] },
          { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1'] },
          { long_name: '411001', short_name: '411001', types: ['postal_code'] },
          { long_name: 'India', short_name: 'IN', types: ['country'] },
        ],
      }),
    ).toEqual({
      placeId: 'abc',
      name: 'Pune Station',
      formattedAddress: 'Pune, Maharashtra 411001, India',
      lat: 18.5,
      lng: 73.8,
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '411001',
      country: 'India',
    });
  });

  it('falls back to null for missing parts', () => {
    expect(toPlaceDetails({ place_id: 'x' })).toMatchObject({
      city: null,
      lat: null,
      pinCode: null,
    });
  });
});

describe('toShortAddress', () => {
  it('keeps area, town, district and state, without repeats', () => {
    expect(
      toShortAddress({
        place_id: 'r1',
        formatted_address: 'NH 48, Behror, Rajasthan 301701, India',
        address_components: [
          { long_name: 'NH 48', short_name: 'NH 48', types: ['route'] },
          { long_name: 'Behror', short_name: 'Behror', types: ['locality'] },
          { long_name: 'Alwar', short_name: 'Alwar', types: ['administrative_area_level_2'] },
          { long_name: 'Rajasthan', short_name: 'RJ', types: ['administrative_area_level_1'] },
          { long_name: '301701', short_name: '301701', types: ['postal_code'] },
        ],
      }),
    ).toBe('Behror, Alwar, Rajasthan');
    expect(
      toShortAddress({
        place_id: 'r2',
        address_components: [
          { long_name: 'Pune', short_name: 'Pune', types: ['locality'] },
          { long_name: 'Pune', short_name: 'Pune', types: ['administrative_area_level_2'] },
          { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1'] },
        ],
      }),
    ).toBe('Pune, Maharashtra');
  });

  it("falls back to Google's full address, else null", () => {
    expect(toShortAddress({ place_id: 'r3', formatted_address: 'Somewhere, India' })).toBe(
      'Somewhere, India',
    );
    expect(toShortAddress({ place_id: 'r4' })).toBeNull();
  });
});

describe('PlacesService', () => {
  it('maps predictions and falls back to description for missing structured text', async () => {
    const client = new GooglePlacesClient();
    vi.spyOn(client, 'autocomplete').mockResolvedValue([
      { place_id: 'p1', description: 'Pune, India', structured_formatting: { main_text: 'Pune' } },
    ]);
    const result = await new PlacesService(client).search({ q: 'pun', country: 'in' });
    expect(result).toEqual([
      { placeId: 'p1', description: 'Pune, India', mainText: 'Pune', secondaryText: '' },
    ]);
  });

  it('asks Google for cities only when type is city', async () => {
    const client = new GooglePlacesClient();
    const autocomplete = vi.spyOn(client, 'autocomplete').mockResolvedValue([]);
    await new PlacesService(client).search({ q: 'morad', country: 'in', type: 'city' });
    expect(autocomplete).toHaveBeenCalledWith(expect.objectContaining({ citiesOnly: true }));
  });

  it('maps Google NOT_FOUND to NotFoundError', async () => {
    const client = new GooglePlacesClient();
    vi.spyOn(client, 'details').mockRejectedValue(new GooglePlacesError('NOT_FOUND', 'nope'));
    await expect(new PlacesService(client).getDetails('bad')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('addressAt: short address at a point, null when Google has none or fails', async () => {
    const client = new GooglePlacesClient();
    const reverseGeocode = vi.spyOn(client, 'reverseGeocode').mockResolvedValueOnce({
      place_id: 'r1',
      address_components: [
        { long_name: 'Khanna', short_name: 'Khanna', types: ['locality'] },
        { long_name: 'Ludhiana', short_name: 'Ludhiana', types: ['administrative_area_level_2'] },
      ],
    });
    const service = new PlacesService(client);
    await expect(service.addressAt({ lat: 30.7, lng: 76.2 })).resolves.toBe('Khanna, Ludhiana');
    expect(reverseGeocode).toHaveBeenCalledWith({ lat: 30.7, lng: 76.2 });

    reverseGeocode.mockResolvedValueOnce(null);
    await expect(service.addressAt({ lat: 0, lng: 0 })).resolves.toBeNull();

    reverseGeocode.mockRejectedValueOnce(new GooglePlacesError('REQUEST_DENIED', 'no geocoding'));
    await expect(service.addressAt({ lat: 0, lng: 0 })).resolves.toBeNull();
  });
});
