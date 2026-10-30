import { z } from 'zod';

// A "true"/"false" query-string flag as a boolean — query params always arrive as strings.
export const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
