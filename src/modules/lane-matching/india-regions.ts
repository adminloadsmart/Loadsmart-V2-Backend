/**
 * India's states, union territories and the regions brokers name their lanes by ("NCR", "North",
 * "North East"), each with a rough centre point for the straight-line corridor. Pure data.
 *
 * A broker lane like "Rajasthan → Punjab, NCR" names regions, not cities: a load is on that lane
 * when its pickup is in the origin region and its drop in a destination region, or when both sit
 * on the straight line between the two centres (see lane-match-rules.ts).
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RegionDefinition {
  /** Canonical name, as shown in a match reason. */
  name: string;
  /** Canonical state names inside the region (a state is a region of itself). */
  states: readonly string[];
  /** Cities inside the region outside its states (NCR's Gurugram, Noida…), normalised. */
  cities?: readonly string[];
  center: GeoPoint;
  aliases?: readonly string[];
}

/** States and union territories, with the short forms people write ("UP", "J&K"). */
export const STATES: readonly RegionDefinition[] = [
  { name: 'Andhra Pradesh', states: [], center: { lat: 15.9, lng: 79.7 }, aliases: ['ap'] },
  { name: 'Arunachal Pradesh', states: [], center: { lat: 28.2, lng: 94.7 } },
  { name: 'Assam', states: [], center: { lat: 26.2, lng: 92.9 } },
  { name: 'Bihar', states: [], center: { lat: 25.1, lng: 85.3 } },
  { name: 'Chhattisgarh', states: [], center: { lat: 21.3, lng: 81.9 }, aliases: ['cg'] },
  { name: 'Goa', states: [], center: { lat: 15.3, lng: 74.1 } },
  { name: 'Gujarat', states: [], center: { lat: 22.3, lng: 71.2 }, aliases: ['gj'] },
  { name: 'Haryana', states: [], center: { lat: 29.1, lng: 76.1 }, aliases: ['hr'] },
  {
    name: 'Himachal Pradesh',
    states: [],
    center: { lat: 31.1, lng: 77.2 },
    aliases: ['himachal', 'hp'],
  },
  { name: 'Jharkhand', states: [], center: { lat: 23.6, lng: 85.3 } },
  { name: 'Karnataka', states: [], center: { lat: 15.3, lng: 75.7 } },
  { name: 'Kerala', states: [], center: { lat: 10.9, lng: 76.3 } },
  { name: 'Madhya Pradesh', states: [], center: { lat: 23.0, lng: 78.7 }, aliases: ['mp'] },
  { name: 'Maharashtra', states: [], center: { lat: 19.7, lng: 75.7 }, aliases: ['mh'] },
  { name: 'Manipur', states: [], center: { lat: 24.7, lng: 93.9 } },
  { name: 'Meghalaya', states: [], center: { lat: 25.5, lng: 91.4 } },
  { name: 'Mizoram', states: [], center: { lat: 23.2, lng: 92.9 } },
  { name: 'Nagaland', states: [], center: { lat: 26.2, lng: 94.6 } },
  { name: 'Odisha', states: [], center: { lat: 20.9, lng: 85.1 }, aliases: ['orissa'] },
  { name: 'Punjab', states: [], center: { lat: 31.1, lng: 75.3 }, aliases: ['pb'] },
  { name: 'Rajasthan', states: [], center: { lat: 27.0, lng: 74.2 }, aliases: ['rj'] },
  { name: 'Sikkim', states: [], center: { lat: 27.5, lng: 88.5 } },
  { name: 'Tamil Nadu', states: [], center: { lat: 11.1, lng: 78.7 }, aliases: ['tn'] },
  { name: 'Telangana', states: [], center: { lat: 18.1, lng: 79.0 }, aliases: ['ts'] },
  { name: 'Tripura', states: [], center: { lat: 23.9, lng: 91.9 } },
  {
    name: 'Uttar Pradesh',
    states: [],
    center: { lat: 26.8, lng: 80.9 },
    aliases: ['up'],
  },
  {
    name: 'Uttarakhand',
    states: [],
    center: { lat: 30.1, lng: 79.0 },
    aliases: ['uk', 'uttaranchal'],
  },
  {
    name: 'West Bengal',
    states: [],
    center: { lat: 23.0, lng: 87.9 },
    aliases: ['wb', 'bengal'],
  },
  {
    name: 'Delhi',
    states: [],
    center: { lat: 28.6, lng: 77.2 },
    aliases: ['new delhi', 'nct of delhi', 'national capital territory of delhi', 'dl'],
  },
  {
    name: 'Jammu and Kashmir',
    states: [],
    center: { lat: 33.5, lng: 75.0 },
    aliases: ['j&k', 'jk', 'jammu & kashmir', 'kashmir'],
  },
  { name: 'Ladakh', states: [], center: { lat: 34.2, lng: 77.6 } },
  { name: 'Chandigarh', states: [], center: { lat: 30.7, lng: 76.8 } },
  {
    name: 'Puducherry',
    states: [],
    center: { lat: 11.9, lng: 79.8 },
    aliases: ['pondicherry'],
  },
  {
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    states: [],
    center: { lat: 20.4, lng: 72.9 },
    aliases: ['daman', 'diu', 'silvassa', 'dadra and nagar haveli'],
  },
  {
    name: 'Andaman and Nicobar Islands',
    states: [],
    center: { lat: 11.7, lng: 92.7 },
    aliases: ['andaman'],
  },
  { name: 'Lakshadweep', states: [], center: { lat: 10.6, lng: 72.6 } },
].map((state) => ({ ...state, states: [state.name] }));

/** Regions spanning several states, as brokers write them. */
export const REGIONS: readonly RegionDefinition[] = [
  {
    name: 'NCR',
    states: ['Delhi'],
    cities: [
      'gurugram',
      'faridabad',
      'noida',
      'greater noida',
      'ghaziabad',
      'sonipat',
      'bahadurgarh',
      'manesar',
    ],
    center: { lat: 28.6, lng: 77.2 },
    aliases: ['delhi ncr', 'national capital region'],
  },
  {
    name: 'North',
    states: [
      'Delhi',
      'Haryana',
      'Punjab',
      'Himachal Pradesh',
      'Jammu and Kashmir',
      'Ladakh',
      'Uttarakhand',
      'Chandigarh',
      'Uttar Pradesh',
      'Rajasthan',
    ],
    center: { lat: 29.0, lng: 77.0 },
    aliases: ['north india'],
  },
  {
    name: 'North East',
    states: [
      'Assam',
      'Arunachal Pradesh',
      'Manipur',
      'Meghalaya',
      'Mizoram',
      'Nagaland',
      'Tripura',
      'Sikkim',
    ],
    center: { lat: 26.0, lng: 92.9 },
    aliases: ['northeast', 'north-east', 'ne'],
  },
  {
    name: 'South',
    states: ['Andhra Pradesh', 'Telangana', 'Karnataka', 'Tamil Nadu', 'Kerala', 'Puducherry'],
    center: { lat: 14.0, lng: 78.0 },
    aliases: ['south india'],
  },
  {
    name: 'East',
    states: ['West Bengal', 'Odisha', 'Bihar', 'Jharkhand'],
    center: { lat: 23.0, lng: 86.0 },
    aliases: ['east india'],
  },
  {
    name: 'West',
    states: ['Gujarat', 'Maharashtra', 'Goa', 'Dadra and Nagar Haveli and Daman and Diu'],
    center: { lat: 20.5, lng: 73.5 },
    aliases: ['west india'],
  },
  {
    name: 'Central',
    states: ['Madhya Pradesh', 'Chhattisgarh'],
    center: { lat: 22.5, lng: 80.0 },
    aliases: ['central india'],
  },
];

/** Old and short city names people still type. */
export const CITY_ALIASES: Readonly<Record<string, string>> = {
  gurgaon: 'gurugram',
  bangalore: 'bengaluru',
  bombay: 'mumbai',
  calcutta: 'kolkata',
  madras: 'chennai',
  'new delhi': 'delhi',
  poona: 'pune',
  baroda: 'vadodara',
  trivandrum: 'thiruvananthapuram',
  mysore: 'mysuru',
  mangalore: 'mangaluru',
  belgaum: 'belagavi',
  cochin: 'kochi',
  vizag: 'visakhapatnam',
  allahabad: 'prayagraj',
  'navi mumbai': 'navi mumbai',
};

/** Lower case, "&" kept, everything else not a letter or digit to one space. */
export function normalizePlace(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
}

export function canonicalCity(value: string | null | undefined): string {
  const name = normalizePlace(value);
  return CITY_ALIASES[name] ?? name;
}

const REGION_INDEX = new Map<string, RegionDefinition>();
for (const region of [...STATES, ...REGIONS]) {
  for (const key of [region.name, ...(region.aliases ?? [])]) {
    REGION_INDEX.set(normalizePlace(key), region);
  }
}

/** The state or region a name stands for ("UP", "Uttar Pradesh", "NCR"), or null for a city. */
export function regionNamed(value: string | null | undefined): RegionDefinition | null {
  return REGION_INDEX.get(normalizePlace(value)) ?? null;
}

/** The canonical state name ("UP" → "Uttar Pradesh"), or null when not a state. */
export function canonicalState(value: string | null | undefined): string | null {
  const region = regionNamed(value);
  return region && region.states.length === 1 && region.states[0] === region.name
    ? region.name
    : null;
}
