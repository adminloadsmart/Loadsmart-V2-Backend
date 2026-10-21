import { ImportColumn, topColumn } from '../../../shared/import/columns';

/**
 * The loading point bulk-upload sheet — mirrors POST /masters/loading-points
 * (loadingPointValidators.create). Keys are the payload field names, so headers written by older
 * sheets and the export still map. googlePlaceId is left out: it comes from the Places picker.
 */

const text = 'Text, up to';

const column = (
  field: string,
  header: string,
  kind: ImportColumn['kind'],
  format: string,
  example: string | number | undefined,
  extra: Partial<ImportColumn> = {},
) => topColumn({ key: field, field, header, kind, required: 'no', format, example, ...extra });

export const TEMPLATE_COLUMNS: ImportColumn[] = [
  column('title', 'Title', 'text', `${text} 150 characters`, 'Pune Warehouse', {
    required: 'yes',
    aliases: ['name', 'loadingpoint'],
  }),
  column('addressLine1', 'Address Line 1', 'text', `${text} 255 characters`, '12 MIDC Road', {
    aliases: ['address1', 'address'],
  }),
  column('addressLine2', 'Address Line 2', 'text', `${text} 255 characters`, 'Warehouse 4', {
    aliases: ['address2'],
  }),
  column('landmark', 'Landmark', 'text', `${text} 255 characters`, 'Near Main Gate'),
  column('areaLocality', 'Locality', 'text', `${text} 255 characters`, 'Bhosari', {
    aliases: ['area'],
  }),
  column('city', 'City', 'text', `${text} 100 characters`, 'Pune', { required: 'yes' }),
  column('state', 'State', 'text', `${text} 100 characters`, 'Maharashtra', { required: 'yes' }),
  column('pinCode', 'PIN', 'text', '6 digits', '411026', {
    required: 'yes',
    aliases: ['pin', 'zipcode'],
  }),
  column('latitude', 'Latitude', 'number', 'Decimal degrees, -90 to 90', 18.6298, {
    aliases: ['lat'],
  }),
  column('longitude', 'Longitude', 'number', 'Decimal degrees, -180 to 180', 73.7997, {
    aliases: ['lng', 'long'],
  }),
  column(
    'geofenceRadiusM',
    'Geofence Radius (m)',
    'integer',
    'Metres, 50–5000 (default 300)',
    300,
    {
      aliases: ['geofenceradius', 'geofence'],
    },
  ),
  column('gateOpensAt', 'Gate Opens At', 'time', 'Time as HH:mm (24-hour)', '08:00', {
    aliases: ['gateopen'],
  }),
  column('gateClosesAt', 'Gate Closes At', 'time', 'Time as HH:mm (24-hour)', '20:00', {
    aliases: ['gateclose'],
  }),
  column(
    'contactPersonName',
    'Contact Person Name',
    'text',
    `${text} 150 characters`,
    'Rajesh Kumar',
    {
      aliases: ['contactname'],
    },
  ),
  column('contactPersonNumber', 'Contact Person Phone', 'text', '10–15 digits', '9876543210', {
    aliases: ['contactnumber', 'contactphone'],
  }),
  column(
    'contactPersonEmail',
    'Contact Person Email',
    'text',
    'Email address',
    'rajesh@abc.example',
    {
      aliases: ['contactemail'],
    },
  ),
  column('notes', 'Notes', 'text', `${text} 2000 characters`, undefined, {
    aliases: ['remarks'],
  }),
];

export const IMPORT_COLUMNS: ImportColumn[] = TEMPLATE_COLUMNS;
