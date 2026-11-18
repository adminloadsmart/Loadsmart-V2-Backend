import { z } from 'zod';
import { CALL_OUTCOMES, CALL_PARTIES, CALL_TEAMS } from '../utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });

const party = z
  .object({
    role: z.enum(CALL_PARTIES),
    name: z.string().trim().min(1).max(150).optional(),
    phone: z.string().trim().min(10).max(15).optional(),
  })
  .strict();

const callBody = {
  parties: z
    .array(party)
    .min(1, 'Pick who was spoken to')
    .max(CALL_PARTIES.length * 3),
  notes: z.string().trim().min(1, 'Say what was discussed').max(2000),
  outcome: z.enum(CALL_OUTCOMES),
  price: z.number().positive().max(10_000_000).optional(),
  reminderAt: z.string().datetime({ offset: true }).optional(),
};

const loadsmartTeams = CALL_TEAMS.filter((team) => team !== 'shipper') as [
  Exclude<(typeof CALL_TEAMS)[number], 'shipper'>,
  ...Exclude<(typeof CALL_TEAMS)[number], 'shipper'>[],
];

/** Log a call (spec p.36). */
export const loadCallValidators = {
  listCalls: z.object({ params }),
  logShipperCall: z.object({ params, body: z.object(callBody).strict() }),
  logLoadsmartCall: z.object({
    params,
    body: z.object({ ...callBody, team: z.enum(loadsmartTeams) }).strict(),
  }),
  myReminders: z.object({}),
  reminderDone: z.object({ params: z.object({ callId: uuid }) }),
};
