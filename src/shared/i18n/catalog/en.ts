// Source of truth for every translatable key. Nested by namespace; `{name}` is a param
// placeholder. A key with `_one` / `_other` siblings is a plural: callers pass `count` and
// translate.ts picks the form via Intl.PluralRules. Reference such a key by its base name.
export const en = {
  errors: {
    internal: 'Something went wrong',
    otp: {
      sent: 'OTP sent to {phoneNumber}',
      cooldown: 'Please wait before requesting another OTP',
      invalid: 'Invalid OTP',
      tooManyAttemptsLogin: 'Too many incorrect attempts, please request a new login OTP',
      tooManyAttempts: 'Too many incorrect attempts, please request a new OTP',
    },
    session: {
      invalidRefreshToken: 'Invalid or expired refresh token',
      noActiveSession: 'No active session found',
    },
    driver: {
      notRegistered: 'Driver is not registered',
      notFound: 'Driver not found',
      notFoundById: 'Driver {id} not found',
      invalidTenant: 'Invalid tenant selection',
      tenantRelationNotFound: 'Driver tenant relation not found',
      orgAccessUnavailable: 'Organization access is not available',
      invalidPhone: 'phoneNumber is invalid',
      phoneAlreadyRegistered: 'A driver with this phone number is already registered',
      licenseExists: 'A driver with this license number already exists',
      licenceImagesRequired: 'Driving licence front and back photos are both required',
      relationExists: 'A relation with this fleet owner already exists',
      inviteNotFound: 'Invite not found',
      phoneMismatch: 'The mobile number does not match your registered number',
      deleteBlockedActiveLoad:
        'You have a trip in progress. Complete it before deleting your account',
    },
  },
  loads: {
    stage: {
      created: 'Load created',
      assigned: 'Truck assigned',
      inTransit: 'In-transit',
      reachedDelivery: 'Reached unloading point',
      delivered: 'Delivered',
      payments: 'Payments',
    },
    status: {
      created: 'Created',
      assigned: 'Assigned',
      at_plant: 'At plant',
      loading_confirmed: 'Loading confirmed',
      in_transit: 'In transit',
      reached_delivery_point: 'Reached delivery point',
      delivered: 'Delivered',
      closed: 'Closed',
    },
    source: {
      ownFleet: 'Own fleet',
      market: 'Market',
      marketWithTransporter: 'Market · {transporter}',
    },
  },
  notifications: {
    vehicleComplianceExpiringSoon: {
      title: 'Vehicle compliance expiring soon',
      body: '{complianceType} for vehicle {vehicleNo} expires in 15 days on {expiryDate}. Please renew it before the expiry date.',
    },
    vehicleComplianceExpired: {
      title: 'Vehicle compliance expired',
      body: '{complianceType} for vehicle {vehicleNo} expired on {expiryDate}. The vehicle may be blocked from dispatch until valid documents are updated.',
    },
    driverLinkRequested: {
      title: 'Driver join request',
      body: '{driverName} ({phoneNumber}) has requested to join your fleet. Review it under Settings → Approvals.',
    },
    driverLinkAccepted: {
      title: 'Driver invite accepted',
      body: '{driverName} ({phoneNumber}) has accepted your invitation and is now linked to your fleet.',
    },
    driverAccountDeleted: {
      title: 'Driver account deleted',
      body: '{driverName} ({phoneNumber}) has deleted their account and is no longer linked to your fleet.',
    },
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
