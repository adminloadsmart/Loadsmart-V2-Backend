// Source of truth for every translatable key. Nested by namespace; `{name}` is a param
// placeholder. A key with `_one` / `_other` siblings is a plural: callers pass `count` and
// translate.ts picks the form via Intl.PluralRules. Reference such a key by its base name.
export const en = {
  errors: {
    internal: 'Something went wrong',
  },
  validation: {
    failed: 'Validation failed',
    required: 'This field is required',
    invalid: 'Invalid value',
    invalidType: 'Invalid type: expected {expected}',
    invalidFormat: 'Invalid format',
    email: 'Enter a valid email address',
    uuid: 'Enter a valid ID',
    url: 'Enter a valid URL',
    regex: 'Invalid format',
    invalidEnum: 'Invalid option. Allowed options: {options}',
    unrecognizedKeys: 'Unrecognized fields: {keys}',
    notMultipleOf: 'Must be a multiple of {divisor}',
    stringMin_one: 'Must be at least {min} character',
    stringMin_other: 'Must be at least {min} characters',
    stringMax_one: 'Must be at most {max} character',
    stringMax_other: 'Must be at most {max} characters',
    numberMin: 'Must be at least {min}',
    numberMinExclusive: 'Must be greater than {min}',
    numberMax: 'Must be at most {max}',
    numberMaxExclusive: 'Must be less than {max}',
    arrayMin_one: 'Must contain at least {min} item',
    arrayMin_other: 'Must contain at least {min} items',
    arrayMax_one: 'Must contain at most {max} item',
    arrayMax_other: 'Must contain at most {max} items',
    types: {
      string: 'text',
      number: 'a number',
      boolean: 'true or false',
      array: 'a list',
      object: 'an object',
      date: 'a date',
    },
  },
} as const;

export type CatalogShape = typeof en;
