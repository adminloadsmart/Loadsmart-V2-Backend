import { describe, expect, it, vi } from 'vitest';
import { GooglePlacesClient, GooglePlacesError } from '../../adapters/google-places.client';
import { NotFoundError } from '../../shared/errors';
import { PlacesService, toPlaceDetails } from './places.service';

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

  it('maps Google NOT_FOUND to NotFoundError', async () => {
    const client = new GooglePlacesClient();
    vi.spyOn(client, 'details').mockRejectedValue(new GooglePlacesError('NOT_FOUND', 'nope'));
    await expect(new PlacesService(client).getDetails('bad')).rejects.toBeInstanceOf(NotFoundError);
  });
});
