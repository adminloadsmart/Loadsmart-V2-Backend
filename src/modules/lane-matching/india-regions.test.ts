import { describe, expect, it } from 'vitest';
import { canonicalCity, samePlace } from './india-regions';

describe('canonicalCity — Mohali aliases', () => {
  it.each(['Mohali', 'Sahibzada Ajit Singh Nagar', 'SAS Nagar', 'S.A.S. Nagar', 'Ajitgarh'])(
    '%s → mohali',
    (name) => expect(canonicalCity(name)).toBe('mohali'),
  );
});

describe('samePlace', () => {
  it('matches a state short form with its full name', () => {
    expect(
      samePlace({ city: 'Zirakpur', state: 'PB' }, { city: ' zirakpur ', state: 'Punjab' }),
    ).toBe(true);
  });

  it('matches a city alias in the same state', () => {
    expect(
      samePlace(
        { city: 'Mohali', state: 'PB' },
        { city: 'Sahibzada Ajit Singh Nagar', state: 'Punjab' },
      ),
    ).toBe(true);
  });

  it('does not match a different city or state', () => {
    expect(samePlace({ city: 'Mohali', state: 'PB' }, { city: 'Ludhiana', state: 'Punjab' })).toBe(
      false,
    );
    expect(
      samePlace({ city: 'Mohali', state: 'Punjab' }, { city: 'Mohali', state: 'Haryana' }),
    ).toBe(false);
  });

  it('compares an unknown state by its normalised text', () => {
    expect(samePlace({ city: 'X', state: 'Some Place' }, { city: 'x', state: 'some-place' })).toBe(
      true,
    );
  });
});
