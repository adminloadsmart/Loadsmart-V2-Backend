import { ReplyValueKind } from '../messaging.types';

/**
 * Session replies after a button or a typed value. The wording of each button's follow-up is the
 * load-flow CTA sheet's ("Accept / Negotiate / Give rate / Reject" rows); the rest follows the
 * catalog's copy rules (plain words, short sentences, one action per message). Each starts with
 * the load code: MSG91 replies don't quote the user's message, and a broker may have several
 * loads open.
 */
export const REPLY_TEXTS = {
  notUnderstood:
    "Sorry, we couldn't read that. Type your rate in ₹ (for example 42000) and the truck number.",
  nothingWaiting:
    "We couldn't match this to an open load. Reply to the load's message to answer it.",
  wrongStage: (loadRef: string) => `${loadRef} can't take this reply now. Our team will check it.`,
  firstAnswerKept: (loadRef: string, firstAction: string) =>
    `${loadRef}: your first answer "${firstAction}" is recorded. Call Loadsmart to change it.`,
  incompleteDispatch: (loadRef: string) =>
    `${loadRef}: send the driver's name, 10-digit mobile, DL number and date of birth in one message.`,
  // After LS_N_0121: the driver details, checked on Sarathi (and the truck on VAHAN).
  dispatchMissing: (loadRef: string, missing: string[]) =>
    `${loadRef}: please also send the ${missing.join(' and the ')}, with the driver's name and mobile in one message.`,
  dispatchMemoSent: (loadRef: string, driverName: string) =>
    `${loadRef}: Driver ${driverName} noted and checked. The load memo has gone to your customer.`,
  // A Loadsmart partner's driver (answer to LS_N_0107): the memo waits for Placement's review.
  dispatchWithPlacement: (loadRef: string, driverName: string) =>
    `${loadRef}: Driver ${driverName} noted. Our team will check the papers and confirm.`,
  dispatchRecorded: (loadRef: string, driverName: string) =>
    `${loadRef}: Driver ${driverName} noted. Thanks. We'll get back to you.`,
  dispatchCheckFailed: (loadRef: string, reason: string) =>
    `${loadRef}: we couldn't use these details. ${reason.replace(/\.$/, '')}. Please send another driver or truck.`,
  pickerExpired: "This list has expired. Reply to the load's message to send it again.",
  pickerAlreadyAnswered: 'This list was already answered.',
  // A tap whose message we still can't find after TAPPED_MESSAGE_WAIT.
  tapNotMatched: "Sorry, we couldn't record that tap. Please tap the button again.",
  // Every message we get is answered: the closing reply when it goes to the team to review.
  teamWillCheck: (loadRef: string | null) =>
    loadRef ? `${loadRef}: Our team will check it.` : 'Our team will check it.',
  // The closing reply when the step is done but its outcome has no wording of its own.
  noted: (loadRef: string) => `${loadRef}: Noted.`,
  // The same button tapped again on the same message.
  alreadyNoted: (loadRef: string, answer: string) => `${loadRef}: Already noted: "${answer}".`,
  // A tap or reply on a message that was sent to someone else (forwarded), or one we can't place.
  notYourLoadMessage: "We couldn't match this to your loads. Our team will check it.",
  // A voice note, location, contact, sticker or video.
  textAndPhotosOnly: 'Sorry, we can only read text and photos here.',
  // A rate or Negotiate on an indent: it has a contract rate.
  indentFixedRate: (loadRef: string) =>
    `${loadRef}: This indent has a fixed contract rate. Our team will check your message.`,
  // CTA sheet: Negotiate / Give rate → "Type your rate in ₹ and the truck number".
  rateRequest: (loadRef: string) => `${loadRef}: Type your rate in ₹ and the truck number.`,
  dispatchRequest: (loadRef: string) =>
    `${loadRef}: Reply with the truck number, driver name, driver mobile, DL number and the driver's date of birth.`,
  slipRequest: (loadRef: string) => `${loadRef}: Send a photo of the loading slip here.`,
  // CTA sheet: after the rate → "Thanks. We'll get back to you."
  rateRecorded: (loadRef: string, rate: number) =>
    `${loadRef}: ₹${rate.toLocaleString('en-IN')} noted. Thanks. We'll get back to you.`,
  // A rate with no truck number yet — the bid can't be accepted without one, so ask for it
  // (same ask as Accept: "Send the truck number if you have it.").
  rateRecordedAskTruck: (loadRef: string, rate: number) =>
    `${loadRef}: ₹${rate.toLocaleString('en-IN')} noted. Send the truck number if you have it.`,
  // CTA sheet: Accept (broker / transporter) → "Send the truck number if you have it."
  offerAccepted: (loadRef: string) => `${loadRef}: Done. Send the truck number if you have it.`,
  truckRecorded: (loadRef: string, truckNumber: string) =>
    `${loadRef}: Truck ${truckNumber} noted. Thanks. We'll get back to you.`,
  // CTA sheet: Reject → broker "Okay. We'll send you the next load."; own transporter
  // "Okay, noted."; indent "Noted. The load goes to the open market."
  brokerRejected: (loadRef: string) => `${loadRef}: Okay. We'll send you the next load.`,
  transporterRejected: (loadRef: string) => `${loadRef}: Okay, noted.`,
  indentRejected: (loadRef: string) => `${loadRef}: Noted. The load goes to the open market.`,
  // CTA sheet, Loadsmart's bid to the shipper (LS_N_0067): Accept → "Done. Truck details will
  // follow."; Counter → "Type your price in ₹", then "Got it. We'll come back to you."; Reject →
  // "Noted. We'll come back with a better bid."
  loadsmartBidAccepted: (loadRef: string) => `${loadRef}: Done. Truck details will follow.`,
  priceRequest: (loadRef: string) => `${loadRef}: Type your price in ₹.`,
  counterRecorded: (loadRef: string, price: number) =>
    `${loadRef}: ₹${price.toLocaleString('en-IN')} noted. Got it. We'll come back to you.`,
  loadsmartBidRejected: (loadRef: string) =>
    `${loadRef}: Noted. We'll come back with a better bid.`,
  // CTA sheet: Accept memo (WhatsApp) → "Confirmed. Truck {{vehicle_no}} is on its way."; an
  // expired memo → "This memo has expired. We'll send a new one."
  memoAccepted: (loadRef: string, vehicleNumber: string) =>
    `${loadRef}: Confirmed. Truck ${vehicleNumber} is on its way.`,
  memoExpired: (loadRef: string) => `${loadRef}: This memo has expired. We'll send a new one.`,
  loadClosed: (loadRef: string) => `${loadRef} is no longer open, so this reply was not recorded.`,
  // Why a reply couldn't be taken, when we know — instead of the general wrongStage / notRecorded.
  truckInUse: (loadRef: string, truckNumber: string) =>
    `${loadRef}: Truck ${truckNumber} is already on another active trip, so we can't use it for this load. Please send a different truck number with the driver details.`,
  truckMissing: (loadRef: string) =>
    `${loadRef}: Please send the truck number too, with the driver's name, mobile, DL number and date of birth.`,
  driverAlreadyConfirmed: (loadRef: string) =>
    `${loadRef}: The truck and driver for this load are already confirmed. To change them, please call the Loadsmart team.`,
  driverDetailsNeeded: (loadRef: string) =>
    `${loadRef}: Please send the truck number, driver name, driver mobile, DL number and the driver's date of birth in one message.`,
  driverBeforeAward: (loadRef: string) =>
    `${loadRef}: Your rate is with the customer. Send the truck and driver details after we confirm this load to you.`,
  loadGivenToOther: (loadRef: string) =>
    `${loadRef} has been given to another truck, so this reply was not recorded. We'll send you the next load.`,
  loadCancelled: (loadRef: string) =>
    `${loadRef} was cancelled by the customer, so this reply was not recorded.`,
  notRecorded: (loadRef: string) => `${loadRef}: We couldn't record this. Our team will call you.`,
  pickerPrompt: (kind: ReplyValueKind, sourceText: string) =>
    kind === 'slip'
      ? 'Which load is this loading slip for? Pick it from the list or type the load code.'
      : `Which load is "${sourceText}" for? Pick it from the list or type the load code.`,
} as const;

/**
 * Free-text notices the shipper's own actions trigger (load-party-whatsapp.ts). Session messages
 * with no approved template: they reach a transporter / broker only inside its 24-h window
 * (it wrote to us in the last 24 h); outside it they are logged as suppressed.
 */
export const NOTICE_TEXTS = {
  // The shipper rejected this transporter's bid.
  bidRejected: (loadRef: string, rate: string, origin: string, destination: string) =>
    `${loadRef}: Your rate of ₹${rate} for ${origin} to ${destination} was not accepted.`,
  // The shipper cancelled (or withdrew) the load — to everyone we messaged about it.
  loadCancelled: (loadRef: string, origin: string, destination: string) =>
    `${loadRef}: The load ${origin} to ${destination} has been cancelled.`,
} as const;
