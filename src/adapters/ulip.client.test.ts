import { afterEach, describe, expect, it, vi } from 'vitest';
import { UlipClient } from './ulip.client';

vi.mock('../config/env', () => ({
  env: { ulipUsername: 'user', ulipPassword: 'pass', ulipBaseUrl: 'https://ulip.test' },
}));

function stubFetch(vahanBody: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ response: { id: 'token' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify(vahanBody)));
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UlipClient.lookupVehicle', () => {
  it("maps ULIP's camelCase VAHAN record", async () => {
    stubFetch({
      error: 'false',
      code: '200',
      message: 'Success',
      response: [
        {
          responseStatus: 'SUCCESS',
          response: {
            rcRegnNo: 'HR62A8246',
            rcFinancer: 'INDOSTAR CAPITAL FINANCE LTD.',
            rcUnldWt: '2775',
            rcInsuranceUpto: '24-Jun-2027',
            rcInsuranceComp: 'National Insurance Co. Ltd.',
            rcBodyTypeDesc: 'OPEN BODY',
            rcTaxUpto: '30-Jun-2027',
            rcFuelDesc: 'DIESEL',
            rcRegisteredAt: 'RTA, FATEHABAD, Haryana',
            rcPermanentAddress: null,
            rcPuccUpto: '29-Jun-2027',
            rcMakerDesc: 'TATA MOTORS LTD',
            rcRegnDt: '02-Nov-2023',
            rcMakerModel: '710 LPT DCR35CBC 100B6M5 ST',
            rcVhClassDesc: 'Goods Carrier',
            rcFitUpto: '10-Nov-2027',
          },
        },
      ],
    });

    const result = await new UlipClient().lookupVehicle('HR62A8246');

    expect(result).toMatchObject({
      status: 'verified',
      registrationNumber: 'HR62A8246',
      registeredOn: '2023-11-02',
      vehicleClass: 'Goods Carrier',
      makerModel: 'TATA MOTORS LTD 710 LPT DCR35CBC 100B6M5 ST',
      fuelType: 'DIESEL',
      registeringAuthority: 'RTA, FATEHABAD, Haryana',
      financierName: 'INDOSTAR CAPITAL FINANCE LTD.',
      bodyType: 'OPEN BODY',
      unladenWeightKg: 2775,
      papers: {
        insuranceValidTo: '2027-06-24',
        insuranceProvider: 'National Insurance Co. Ltd.',
        pucValidTo: '2027-06-29',
        fitnessValidTo: '2027-11-10',
        roadTaxValidTo: '2027-06-30',
      },
    });
    expect(result.addressLine1).toBeUndefined();
  });

  it('still maps snake_case VAHAN records', async () => {
    stubFetch({
      response: [
        {
          responseStatus: 'SUCCESS',
          response: {
            rc_regn_no: 'MH12AB1234',
            rc_maker_model: 'SIGNA 3118.T',
            rc_fit_upto: '17/10/2026',
          },
        },
      ],
    });

    const result = await new UlipClient().lookupVehicle('MH12AB1234');

    expect(result).toMatchObject({
      status: 'verified',
      makerModel: 'SIGNA 3118.T',
      papers: { fitnessValidTo: '2026-10-17' },
    });
  });

  it('returns not_found on a FAILURE item', async () => {
    stubFetch({ response: [{ responseStatus: 'FAILURE', response: {} }] });
    expect((await new UlipClient().lookupVehicle('XX00XX0000')).status).toBe('not_found');
  });
});
