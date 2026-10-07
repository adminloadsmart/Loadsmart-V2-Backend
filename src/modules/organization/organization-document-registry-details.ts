import { OrganizationDocumentType } from './entities/organization-document.entity';

type RegistryOutput = Record<string, unknown>;

/** What the onboarding UI shows after a registry (IDfy) check — normalised across document types
 *  so the frontend never has to know each vendor response shape. `active` is false for a record
 *  the registry found but that isn't in good standing (e.g. a cancelled GSTIN). */
export interface RegistryDetails {
  legalName: string;
  documentNumber: string | null;
  status: string | null;
  registeredSince: string | null;
  address: string | null;
  // The same address split into the onboarding form's fields (empty string when unknown).
  addressParts: RegistryAddressParts;
  active: boolean;
}

export interface RegistryAddressParts {
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  state: string;
  pinCode: string;
}

const asRecord = (value: unknown): RegistryOutput =>
  value && typeof value === 'object' ? (value as RegistryOutput) : {};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return null;
};

const joinAddress = (...parts: unknown[]): string | null => {
  const joined = parts
    .map(text)
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return joined || null;
};

const EMPTY_ADDRESS: RegistryAddressParts = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  state: '',
  pinCode: '',
};

// Best-effort split of a single-string address such as
// "PLOT NO A-45, MOHALI, Mohali, Punjab - 160059" → street / city / state / pin.
function parseFreeformAddress(address: string | null): RegistryAddressParts {
  if (!address) return EMPTY_ADDRESS;
  const pinMatch = address.match(/(\d{6})\s*$/);
  const withoutPin = address.replace(/[\s,-]*\d{6}\s*$/, '');
  const parts = withoutPin
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!pinMatch || parts.length < 3) {
    return { ...EMPTY_ADDRESS, addressLine1: address, pinCode: pinMatch?.[1] ?? '' };
  }
  const state = parts[parts.length - 1];
  const city = parts[parts.length - 2];
  return {
    ...EMPTY_ADDRESS,
    addressLine1: parts.slice(0, -2).join(', '),
    city,
    state,
    pinCode: pinMatch[1],
  };
}

const isActive = (status: string | null): boolean => status?.toLowerCase() === 'active';

type Extractor = (output: RegistryOutput) => Omit<RegistryDetails, 'legalName' | 'addressParts'> & {
  legalName: string | null;
  addressParts?: RegistryAddressParts;
};

// Field names follow IDfy's get-task `result.source_output` for each task type.
const EXTRACTORS: Partial<Record<OrganizationDocumentType, Extractor>> = {
  gst_certificate: (output) => {
    const place = asRecord(
      asRecord(output.principal_place_of_business_fields).principal_place_of_business_address,
    );
    const status = text(output.gstin_status);
    return {
      legalName: firstText(output.legal_name, output.trade_name),
      documentNumber: text(output.gstin),
      status,
      registeredSince: text(output.date_of_registration),
      address: joinAddress(
        place.door_number,
        place.building_name,
        place.street,
        place.location,
        place.dst,
        place.pincode,
        place.state_name,
      ),
      addressParts: {
        addressLine1: joinAddress(place.door_number, place.building_name) ?? '',
        addressLine2: joinAddress(place.street, place.location) ?? '',
        city: firstText(place.city, place.dst) ?? '',
        district: text(place.dst) ?? '',
        state: text(place.state_name) ?? '',
        pinCode: text(place.pincode) ?? '',
      },
      active: isActive(status),
    };
  },
  udyam: (output) => {
    const general = asRecord(output.general_details);
    const address = asRecord(output.official_address);
    return {
      legalName: text(general.enterprise_name),
      documentNumber: null,
      status: 'Registered',
      registeredSince: firstText(general.date_of_inc, general.commencement_date),
      address: joinAddress(
        address.door,
        address.name_of_premises,
        address.road,
        address.area,
        address.town ?? address.city,
        address.district,
        address.state,
        address.pin,
      ),
      addressParts: {
        addressLine1: joinAddress(address.door, address.name_of_premises) ?? '',
        addressLine2: joinAddress(address.road, address.area) ?? '',
        city: firstText(address.town, address.city) ?? '',
        district: text(address.district) ?? '',
        state: text(address.state) ?? '',
        pinCode: text(address.pin) ?? '',
      },
      active: true,
    };
  },
  cin: (output) => {
    const status = text(output.company_status);
    return {
      legalName: text(output.company_name),
      documentNumber: text(output.cin),
      status,
      registeredSince: text(output.date_of_incorporation),
      address: text(output.registered_address),
      active: isActive(status),
    };
  },
  // Shop licence response shape isn't confirmed against a live record yet — tolerant lookups.
  shop_establishment: (output) => ({
    legalName: firstText(output.name, output.establishment_name, output.business_name),
    documentNumber: firstText(output.certificate_number, output.registration_number),
    status: firstText(output.status_of_registration, output.license_status) ?? 'Registered',
    registeredSince: firstText(
      output.date_of_registration,
      output.registration_date,
      output.date_of_commencement,
    ),
    address: firstText(output.address, output.establishment_address),
    active: true,
  }),
};

/** Null when the registry didn't return a record for this document. */
export function extractRegistryDetails(
  documentType: OrganizationDocumentType,
  rawResponse: RegistryOutput | null,
): RegistryDetails | null {
  const extractor = EXTRACTORS[documentType];
  if (!extractor || !rawResponse || rawResponse.status !== 'id_found') {
    return null;
  }
  const details = extractor(rawResponse);
  if (!details.legalName) return null;
  return {
    ...details,
    legalName: details.legalName,
    addressParts: details.addressParts ?? parseFreeformAddress(details.address),
  };
}
