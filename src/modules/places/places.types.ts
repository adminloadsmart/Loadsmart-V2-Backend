export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetails {
  placeId: string;
  name: string | null;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  country: string | null;
}

export interface SearchPlacesQuery {
  q: string;
  sessionToken?: string;
  country: string;
}

export interface PlaceParams {
  placeId: string;
}

export interface PlaceDetailsQuery {
  sessionToken?: string;
}
