import type { CatalogShape } from './en';

// Same shape as en.ts: `satisfies Catalog<CatalogShape>` makes a missing or extra key a compile
// error. DRAFT wording, pending native-speaker review (see docs/i18n-glossary.md once added).
export type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };

export const hi = {
  errors: {
    internal: 'कुछ गलत हो गया',
    otp: {
      sent: '{phoneNumber} पर OTP भेज दिया गया है',
      cooldown: 'दूसरा OTP मांगने से पहले कृपया प्रतीक्षा करें',
      invalid: 'गलत OTP',
      tooManyAttemptsLogin: 'बहुत ज़्यादा गलत प्रयास हुए, कृपया नया लॉगिन OTP मांगें',
      tooManyAttempts: 'बहुत ज़्यादा गलत प्रयास हुए, कृपया नया OTP मांगें',
    },
    session: {
      invalidRefreshToken: 'रिफ्रेश टोकन गलत है या समाप्त हो गया है',
      noActiveSession: 'कोई सक्रिय सेशन नहीं मिला',
    },
    driver: {
      notRegistered: 'ड्राइवर रजिस्टर्ड नहीं है',
      notFound: 'ड्राइवर नहीं मिला',
      notFoundById: 'ड्राइवर {id} नहीं मिला',
      invalidTenant: 'गलत संगठन चुना गया है',
      tenantRelationNotFound: 'ड्राइवर और संगठन का संबंध नहीं मिला',
      orgAccessUnavailable: 'संगठन की पहुँच उपलब्ध नहीं है',
      invalidPhone: 'फ़ोन नंबर सही नहीं है',
      phoneAlreadyRegistered: 'इस फ़ोन नंबर वाला ड्राइवर पहले से रजिस्टर्ड है',
      licenseExists: 'इस लाइसेंस नंबर वाला ड्राइवर पहले से मौजूद है',
      licenceImagesRequired: 'ड्राइविंग लाइसेंस की आगे और पीछे दोनों फोटो ज़रूरी हैं',
      relationExists: 'इस फ्लीट मालिक के साथ संबंध पहले से मौजूद है',
      inviteNotFound: 'आमंत्रण नहीं मिला',
    },
  },
  loads: {
    stage: {
      created: 'लोड बनाया गया',
      assigned: 'ट्रक असाइन किया गया',
      inTransit: 'रास्ते में',
      reachedDelivery: 'अनलोडिंग पॉइंट पर पहुँचा',
      delivered: 'डिलीवर हो गया',
      payments: 'भुगतान',
    },
    status: {
      created: 'बनाया गया',
      assigned: 'असाइन किया गया',
      at_plant: 'प्लांट पर',
      loading_confirmed: 'लोडिंग की पुष्टि हुई',
      in_transit: 'रास्ते में',
      reached_delivery_point: 'डिलीवरी पॉइंट पर पहुँचा',
      delivered: 'डिलीवर हो गया',
      closed: 'बंद',
    },
    source: {
      ownFleet: 'अपना फ्लीट',
      market: 'मार्केट',
      marketWithTransporter: 'मार्केट · {transporter}',
    },
  },
  notifications: {
    vehicleComplianceExpiringSoon: {
      title: 'वाहन का अनुपालन दस्तावेज़ जल्द समाप्त होगा',
      body: 'वाहन {vehicleNo} का {complianceType} 15 दिनों में {expiryDate} को समाप्त हो रहा है। कृपया समाप्ति तिथि से पहले इसका नवीनीकरण करें।',
    },
    vehicleComplianceExpired: {
      title: 'वाहन का अनुपालन दस्तावेज़ समाप्त हो गया',
      body: 'वाहन {vehicleNo} का {complianceType} {expiryDate} को समाप्त हो गया है। वैध दस्तावेज़ अपडेट होने तक वाहन को डिस्पैच से रोका जा सकता है।',
    },
    driverLinkRequested: {
      title: 'ड्राइवर जुड़ने का अनुरोध',
      body: '{driverName} ({phoneNumber}) ने आपके फ्लीट से जुड़ने का अनुरोध किया है। इसे सेटिंग्स → अप्रूवल में देखें।',
    },
    driverLinkAccepted: {
      title: 'ड्राइवर ने आमंत्रण स्वीकार किया',
      body: '{driverName} ({phoneNumber}) ने आपका आमंत्रण स्वीकार कर लिया है और अब आपके फ्लीट से जुड़ गया है।',
    },
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
