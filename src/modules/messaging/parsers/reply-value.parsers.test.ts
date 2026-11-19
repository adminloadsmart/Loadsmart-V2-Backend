import { describe, expect, it } from 'vitest';
import {
  classifyTypedReply,
  decodeLoadRowId,
  decodeOfferButtonId,
  encodeLoadRowId,
  encodeOfferButtonId,
  parseDispatchDetails,
  parseTypedRate,
} from './reply-value.parsers';

describe('parseTypedRate', () => {
  it.each([
    ['45000', 45000],
    ['45,000/-', 45000],
    ['₹45000', 45000],
    ['Rs 45000', 45000],
    ['45k', 45000],
    ['45 K', 45000],
    ['45 hazar', 45000],
    ['50,000', 50000],
  ])('reads %s as %d', (text, expected) => {
    expect(parseTypedRate(text)).toBe(expected);
  });

  it.each(['ok bhai', 'kal 10 baje', '9876543210', ''])('does not read %s as a rate', (text) => {
    expect(parseTypedRate(text)).toBeNull();
  });
});

describe('parseDispatchDetails', () => {
  it('reads truck, name and mobile from one message', () => {
    expect(parseDispatchDetails('PB10AB1234 Ramesh Kumar 9876543210')).toEqual({
      truckNumber: 'PB10AB1234',
      driverName: 'Ramesh Kumar',
      driverMobile: '9876543210',
      licenceNumber: null,
      dateOfBirth: null,
      isComplete: true,
    });
  });

  // The LS_N_0121 reply from 19 Nov, one detail per line. The licence starts like a truck number.
  it('reads truck, name, mobile, DL and date of birth, one per line', () => {
    expect(
      parseDispatchDetails('RJ11GC9628\nSHUBHAM\n7973805477\nHR3120210000616\n12 MAY 1990'),
    ).toEqual({
      truckNumber: 'RJ11GC9628',
      driverName: 'SHUBHAM',
      driverMobile: '7973805477',
      licenceNumber: 'HR3120210000616',
      dateOfBirth: '1990-05-12',
      isComplete: true,
    });
  });

  it.each([
    ['DL HR-31 2021 0000616, DOB 12/05/1990, Shubham 7973805477', '1990-05-12'],
    ['Shubham 7973805477 HR3120210000616 1990-05-12', '1990-05-12'],
    ['Shubham 7973805477 HR3120210000616 3 Feb, 1985', '1985-02-03'],
  ])('reads the DL and date from "%s"', (text, dateOfBirth) => {
    expect(parseDispatchDetails(text)).toMatchObject({
      driverName: 'Shubham',
      driverMobile: '7973805477',
      licenceNumber: 'HR3120210000616',
      dateOfBirth,
      truckNumber: null,
    });
  });

  it('does not read a spaced truck number as a date', () => {
    expect(parseDispatchDetails('MH 12 MAR 1234 Ravi 9000011111')).toMatchObject({
      truckNumber: 'MH12MAR1234',
      dateOfBirth: null,
    });
  });

  it('handles lowercase, spaces, commas and +91', () => {
    const details = parseDispatchDetails('hr26 ab 4321, Mohan, +91 99887 76655');
    expect(details).toMatchObject({
      truckNumber: 'HR26AB4321',
      driverName: 'Mohan',
      driverMobile: '9988776655',
      isComplete: true,
    });
  });

  it('marks details without a mobile as incomplete', () => {
    expect(parseDispatchDetails('MH12XY9999 Suresh').isComplete).toBe(false);
  });
});

describe('classifyTypedReply', () => {
  it('treats truck/driver text as dispatch, not as a rate', () => {
    expect(classifyTypedReply('KA01AB1111 Ravi 9000011111').kind).toBe('dispatch');
  });
  it('treats "42k" as a rate', () => {
    expect(classifyTypedReply('42k')).toEqual({ kind: 'rate', rate: 42000, truckNumber: null });
  });
  it('reads a rate and a truck number from one message ("Type your rate in ₹ and the truck number")', () => {
    expect(classifyTypedReply('42000 PB10AB1234')).toEqual({
      kind: 'rate',
      rate: 42000,
      truckNumber: 'PB10AB1234',
    });
    expect(classifyTypedReply('truck hr-26 ab 4321, rate ₹38,500/-')).toEqual({
      kind: 'rate',
      rate: 38500,
      truckNumber: 'HR26AB4321',
    });
  });
  it('a truck number alone is a truck value — its digits are never read as a rate', () => {
    expect(classifyTypedReply('PB10AB1234')).toEqual({ kind: 'truck', truckNumber: 'PB10AB1234' });
  });
  it('returns null for unknown text', () => {
    expect(classifyTypedReply('kuch bhi').kind).toBeNull();
  });
});

describe('our interactive ids', () => {
  it('round-trips an offer button id', () => {
    const id = encodeOfferButtonId({
      action: 'negotiate',
      loadRef: 'LS-2002',
      recipientRef: 'partner_A',
    });
    expect(id).toBe('negotiate:LS-2002:partner_A');
    expect(decodeOfferButtonId(id)).toEqual({
      action: 'negotiate',
      loadRef: 'LS-2002',
      recipientRef: 'partner_A',
    });
  });

  it('rejects unknown actions and malformed ids', () => {
    expect(decodeOfferButtonId('maybe:LS-1:p')).toBeNull();
    expect(decodeOfferButtonId('accept:LS-1')).toBeNull();
    expect(decodeOfferButtonId(null)).toBeNull();
  });

  it('round-trips a load row id', () => {
    expect(decodeLoadRowId(encodeLoadRowId('LS-2004'))).toBe('LS-2004');
    expect(decodeLoadRowId('other:LS-2004')).toBeNull();
  });
});
