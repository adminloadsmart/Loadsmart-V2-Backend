import { describe, expect, it } from 'vitest';
import {
  bestMatch,
  corridorKmFor,
  haversineKm,
  isInside,
  laneEndOf,
  matchLane,
  phoneKey,
  type Lane,
  type LoadRoute,
  type RoutePlace,
} from './lane-match-rules';
import { canonicalState, regionNamed } from './india-regions';

const P = {
  delhi: { lat: 28.61, lng: 77.21 },
  mumbai: { lat: 19.08, lng: 72.88 },
  jaipur: { lat: 26.91, lng: 75.79 },
  ahmedabad: { lat: 23.02, lng: 72.57 },
  kolkata: { lat: 22.57, lng: 88.36 },
  pune: { lat: 18.52, lng: 73.86 },
  ludhiana: { lat: 30.9, lng: 75.85 },
  gurugram: { lat: 28.46, lng: 77.03 },
  surat: { lat: 21.17, lng: 72.83 },
  indore: { lat: 22.72, lng: 75.86 },
};

const place = (city: string, state: string, point: keyof typeof P | null = null): RoutePlace => ({
  city,
  state,
  point: point ? P[point] : null,
});
const route = (pickup: RoutePlace, drop: RoutePlace): LoadRoute => ({ pickup, drop });
const cityLane = (from: keyof typeof P, to: keyof typeof P): Lane => ({
  from: laneEndOf(from, P[from]),
  to: laneEndOf(to, P[to]),
});

describe('names', () => {
  it('reads short state names and regions', () => {
    expect(canonicalState('UP')).toBe('Uttar Pradesh');
    expect(canonicalState('J&K')).toBe('Jammu and Kashmir');
    expect(canonicalState('Himachal')).toBe('Himachal Pradesh');
    expect(canonicalState('Pune')).toBeNull();
    expect(regionNamed('North East')?.states).toContain('Assam');
  });

  it('puts Gurugram in NCR and old city names on the new ones', () => {
    const ncr = laneEndOf('NCR');
    expect(isInside(place('Gurgaon', 'Haryana'), ncr)).toBe(true);
    expect(isInside(place('New Delhi', 'Delhi'), ncr)).toBe(true);
    expect(isInside(place('Karnal', 'Haryana'), ncr)).toBe(false);
    expect(isInside(place('Bangalore', 'Karnataka'), laneEndOf('Bengaluru'))).toBe(true);
  });

  it('measures distance and keys phones by their last 10 digits', () => {
    expect(Math.round(haversineKm(P.delhi, P.mumbai))).toBeGreaterThan(1100);
    expect(phoneKey('+91 98290 73162')).toBe('9829073162');
  });
});

describe('matching a load to a lane', () => {
  it('matches the same cities as the lane', () => {
    expect(
      matchLane(
        route(place('Delhi', 'Delhi', 'delhi'), place('Mumbai', 'Maharashtra', 'mumbai')),
        cityLane('delhi', 'mumbai'),
      ),
    ).toEqual({ kind: 'lane', lane: 'Delhi → mumbai', offRouteKm: 0 });
  });

  it('matches a load inside the lane states', () => {
    const lane: Lane = { from: laneEndOf('Rajasthan'), to: laneEndOf('Punjab') };
    const match = matchLane(
      route(place('Jaipur', 'Rajasthan', 'jaipur'), place('Ludhiana', 'Punjab', 'ludhiana')),
      lane,
    );
    expect(match).toEqual({ kind: 'lane', lane: 'Rajasthan → Punjab', offRouteKm: 0 });
  });

  it('matches a load lying in between the lane, in its direction', () => {
    const lane = cityLane('delhi', 'mumbai');
    const onTheWay = matchLane(
      route(place('Jaipur', 'Rajasthan', 'jaipur'), place('Surat', 'Gujarat', 'surat')),
      lane,
    );
    expect(onTheWay).toEqual({ kind: 'en_route', lane: 'Delhi → mumbai', offRouteKm: 94 });
    // The other way round is not on this lane.
    expect(
      matchLane(
        route(place('Surat', 'Gujarat', 'surat'), place('Jaipur', 'Rajasthan', 'jaipur')),
        lane,
      ),
    ).toBeNull();
  });

  it('takes a load from the lane start to a point on the way', () => {
    const match = matchLane(
      route(place('Gurugram', 'Haryana', 'gurugram'), place('Indore', 'Madhya Pradesh', 'indore')),
      cityLane('delhi', 'mumbai'),
    );
    expect(match?.kind).toBe('en_route');
  });

  it('scales the corridor with the lane, 50 to 150 km', () => {
    expect(corridorKmFor(cityLane('delhi', 'mumbai'))).toBe(150);
    expect(corridorKmFor(cityLane('delhi', 'gurugram'))).toBe(50);
  });

  it('refuses a load off the corridor or off the lane', () => {
    const lane = cityLane('delhi', 'mumbai');
    expect(
      matchLane(
        route(place('Kolkata', 'West Bengal', 'kolkata'), place('Pune', 'Maharashtra', 'pune')),
        lane,
      ),
    ).toBeNull();
    // Ahmedabad is ~200 km off the straight Delhi–Mumbai line.
    expect(
      matchLane(
        route(place('Jaipur', 'Rajasthan', 'jaipur'), place('Ahmedabad', 'Gujarat', 'ahmedabad')),
        lane,
      ),
    ).toBeNull();
  });

  it('matches a city lane by name only when the lane has no coordinates', () => {
    const lane: Lane = { from: laneEndOf('Nashik'), to: laneEndOf('Pune') };
    expect(
      matchLane(route(place('Nashik', 'Maharashtra'), place('Poona', 'Maharashtra')), lane)?.kind,
    ).toBe('lane');
    expect(
      matchLane(
        route(place('Jaipur', 'Rajasthan', 'jaipur'), place('Surat', 'Gujarat', 'surat')),
        lane,
      ),
    ).toBeNull();
  });

  it('does not count a load inside one end of the lane', () => {
    const lane: Lane = { from: laneEndOf('Rajasthan'), to: laneEndOf('Punjab') };
    expect(
      matchLane(route(place('Jaipur', 'Rajasthan', 'jaipur'), place('Jodhpur', 'Rajasthan')), lane),
    ).toBeNull();
  });

  it('prefers the exact lane over one the load is on the way of', () => {
    const lanes = [cityLane('delhi', 'mumbai'), cityLane('jaipur', 'surat')];
    const match = bestMatch(
      route(place('Jaipur', 'Rajasthan', 'jaipur'), place('Surat', 'Gujarat', 'surat')),
      lanes,
    );
    expect(match).toEqual({ kind: 'lane', lane: 'jaipur → surat', offRouteKm: 0 });
  });
});
