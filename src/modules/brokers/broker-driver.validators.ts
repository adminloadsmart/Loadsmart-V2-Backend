import { z } from 'zod';
import { paginationQuery } from '../../shared/validators/pagination';
import { BROKER_DRIVER_STATUSES } from './broker-driver.entity';

/** Indian driving licence: 2-letter state code + 13 digits — what Placement's drawer accepts. */
export const LICENCE_NUMBER_REGEX = /^[A-Z]{2}\d{13}$/;
export const MIN_DRIVER_AGE = 18;

const filters = {
  brokerId: z.string().uuid().optional(),
  status: z.enum(BROKER_DRIVER_STATUSES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
};

const driverParams = z.object({ driverId: z.string().uuid() });

const fullName = z
  .string()
  .trim()
  .min(2, 'Enter the driver name')
  .max(150)
  .regex(/^[A-Za-z][A-Za-z .']*$/, "Use letters, spaces, . and '");
const mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const licenceNumber = z
  .string()
  .transform((v) => v.replace(/[\s-]+/g, '').toUpperCase())
  .refine(
    (v) => LICENCE_NUMBER_REGEX.test(v),
    'Enter a valid licence number, e.g. UP2120040012345',
  );

const adultOn = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_DRIVER_AGE);
  return d.toISOString().slice(0, 10);
};
const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)')
  .refine((v) => v >= '1940-01-01', 'Enter a valid date of birth')
  .refine((v) => v <= adultOn(), `Driver must be at least ${MIN_DRIVER_AGE} years old`);
const fileKey = z.string().trim().min(1).max(500);
const note = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((v) => v || null);

const editable = {
  fullName,
  mobile,
  isOnWhatsapp: z.boolean(),
  licenceNumber,
  dateOfBirth: dateOfBirth.nullable(),
  licenceFrontFileKey: fileKey.nullable(),
  licenceBackFileKey: fileKey.nullable(),
  status: z.enum(BROKER_DRIVER_STATUSES),
  note,
};

export const brokerDriverValidators = {
  listDrivers: z.object({ query: paginationQuery.extend(filters) }),
  getDriver: z.object({ params: driverParams }),
  createDriver: z.object({
    body: z
      .object({
        brokerId: z.string().uuid(),
        ...editable,
        isOnWhatsapp: editable.isOnWhatsapp.default(true),
        dateOfBirth: dateOfBirth,
        licenceFrontFileKey: editable.licenceFrontFileKey.optional(),
        licenceBackFileKey: editable.licenceBackFileKey.optional(),
        status: editable.status.default('active'),
        note: editable.note.optional(),
      })
      .strict(),
  }),
  /** Only the fields sent change. */
  updateDriver: z.object({
    params: driverParams,
    body: z
      .object(editable)
      .partial()
      .strict()
      .refine((body) => Object.keys(body).length > 0, 'Nothing to update'),
  }),
};

export type ListBrokerDriversQuery = z.infer<typeof brokerDriverValidators.listDrivers>['query'];
export type CreateBrokerDriverInput = z.infer<typeof brokerDriverValidators.createDriver>['body'];
export type UpdateBrokerDriverInput = z.infer<typeof brokerDriverValidators.updateDriver>['body'];
