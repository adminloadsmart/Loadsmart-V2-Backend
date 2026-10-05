import type { CatalogShape } from './en';

// Same shape as en.ts: `satisfies Catalog<CatalogShape>` makes a missing or extra key a compile
// error. DRAFT wording, pending native-speaker review (see docs/i18n-glossary.md once added).
export type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };

export const hi = {
  errors: {
    internal: 'कुछ गलत हो गया',
  },
  validation: {
    failed: 'जानकारी सही नहीं है',
    required: 'यह फ़ील्ड आवश्यक है',
    invalid: 'अमान्य मान',
    invalidType: 'गलत प्रकार: {expected} होना चाहिए',
    invalidFormat: 'फ़ॉर्मेट सही नहीं है',
    email: 'सही ईमेल पता दर्ज करें',
    uuid: 'सही ID दर्ज करें',
    url: 'सही URL दर्ज करें',
    regex: 'फ़ॉर्मेट सही नहीं है',
    invalidEnum: 'अमान्य विकल्प। मान्य विकल्प: {options}',
    unrecognizedKeys: 'अज्ञात फ़ील्ड: {keys}',
    notMultipleOf: '{divisor} का गुणज होना चाहिए',
    stringMin_one: 'कम से कम {min} अक्षर होना चाहिए',
    stringMin_other: 'कम से कम {min} अक्षर होने चाहिए',
    stringMax_one: 'अधिकतम {max} अक्षर हो सकता है',
    stringMax_other: 'अधिकतम {max} अक्षर हो सकते हैं',
    numberMin: 'कम से कम {min} होना चाहिए',
    numberMinExclusive: '{min} से अधिक होना चाहिए',
    numberMax: 'अधिकतम {max} हो सकता है',
    numberMaxExclusive: '{max} से कम होना चाहिए',
    arrayMin_one: 'कम से कम {min} आइटम होना चाहिए',
    arrayMin_other: 'कम से कम {min} आइटम होने चाहिए',
    arrayMax_one: 'अधिकतम {max} आइटम हो सकता है',
    arrayMax_other: 'अधिकतम {max} आइटम हो सकते हैं',
    types: {
      string: 'टेक्स्ट',
      number: 'संख्या',
      boolean: 'हाँ या नहीं',
      array: 'सूची',
      object: 'ऑब्जेक्ट',
      date: 'तारीख',
    },
  },
} as const satisfies Catalog<CatalogShape>;
