// Seeds 20 dummy brokers into brokers.brokers for the Brokers page. Safe to re-run: a broker is
// inserted only when no row with the same phone exists.
//
// Run via `npm run seed:all` (src/db/seed.ts) — no standalone CLI entry point of its own.

import { DataSource } from 'typeorm';
import { BrokerEntity } from '../modules/brokers/broker.entity';

type BrokerSeed = Pick<
  BrokerEntity,
  | 'truckerCompany'
  | 'truckerName'
  | 'phone'
  | 'base'
  | 'truckSources'
  | 'laneOrigin'
  | 'laneDestinations'
  | 'status'
> &
  Partial<
    Pick<
      BrokerEntity,
      | 'email'
      | 'isOnWhatsapp'
      | 'tdsPercent'
      | 'loadsLast30Days'
      | 'rating'
      | 'holdReason'
      | 'pendingOriginalPods'
    >
  >;

const DUMMY_BROKERS: BrokerSeed[] = [
  {
    truckerCompany: 'Shyam Kripa Roadlines',
    truckerName: 'Manoj Bhati',
    phone: '9829073162',
    email: 'manoj@shyamkripa.in',
    base: 'Jaipur',
    truckSources: ['Open Body 20–24 ft', 'Multi Axle 32 ft'],
    laneOrigin: 'Rajasthan',
    laneDestinations: ['Punjab', 'NCR'],
    tdsPercent: '1',
    loadsLast30Days: 7,
    rating: '4.5',
    status: 'approved',
  },
  {
    truckerCompany: 'Solan Freight Links',
    truckerName: 'Deepak Thakur',
    phone: '9816053982',
    email: 'deepak@solanfreight.in',
    base: 'Baddi',
    truckSources: ['Single Axle', 'Multi Axle'],
    laneOrigin: 'Himachal',
    laneDestinations: ['Maharashtra'],
    tdsPercent: '2',
    loadsLast30Days: 5,
    rating: '4.2',
    status: 'approved',
  },
  {
    truckerCompany: 'Palwal Cargo Movers',
    truckerName: 'Sunil Rawat',
    phone: '9996042566',
    base: 'Palwal',
    truckSources: ['Open Body 14–22 ft'],
    laneOrigin: 'Haryana',
    laneDestinations: ['UP', 'MP'],
    tdsPercent: '1',
    loadsLast30Days: 4,
    rating: '3.6',
    status: 'approved',
    pendingOriginalPods: 2,
  },
  {
    truckerCompany: 'Kandla Gateway Logistics',
    truckerName: 'Hitesh Parmar',
    phone: '9725060555',
    email: 'hitesh@kandlagateway.in',
    base: 'Gandhidham',
    truckSources: ['Container Body', 'Triple Axle'],
    laneOrigin: 'Gujarat',
    laneDestinations: ['North'],
    tdsPercent: '2',
    status: 'approved',
  },
  {
    truckerCompany: 'Doon Valley Transport',
    truckerName: 'Anil Negi',
    phone: '9412015772',
    isOnWhatsapp: false,
    base: 'Dehradun',
    truckSources: ['Open Body 17–19 ft'],
    laneOrigin: 'Uttarakhand',
    laneDestinations: ['Punjab'],
    tdsPercent: '0',
    loadsLast30Days: 2,
    rating: '4.0',
    status: 'approved',
  },
  {
    truckerCompany: 'Mohri Logistics Services',
    truckerName: 'Amandeep Kumar',
    phone: '7206232579',
    base: 'Kurukshetra',
    truckSources: ['Multi Axle 32 ft', 'Open Body 22 ft'],
    laneOrigin: 'Punjab',
    laneDestinations: ['Bihar', 'Jharkhand'],
    tdsPercent: '1',
    loadsLast30Days: 1,
    rating: '3.8',
    status: 'approved',
  },
  {
    truckerCompany: 'Kumar Roadlines',
    truckerName: 'Rajesh Kumar',
    phone: '9810000001',
    email: 'rajesh@kumarroadlines.in',
    base: 'Delhi',
    truckSources: ['Open Body 20–24 ft', 'Container 32 ft'],
    laneOrigin: 'NCR',
    laneDestinations: ['Maharashtra', 'Gujarat'],
    tdsPercent: '1',
    loadsLast30Days: 9,
    rating: '4.6',
    status: 'approved',
  },
  {
    truckerCompany: 'Ludhiana Freight Carriers',
    truckerName: 'Harpreet Singh',
    phone: '9814000003',
    email: 'harpreet@ludhianafreight.in',
    base: 'Ludhiana',
    truckSources: ['Multi Axle 32 ft', 'Trailer 40 ft'],
    laneOrigin: 'Punjab',
    laneDestinations: ['NCR', 'Rajasthan'],
    tdsPercent: '1',
    loadsLast30Days: 6,
    rating: '4.3',
    status: 'approved',
    pendingOriginalPods: 1,
  },
  {
    truckerCompany: 'Patel Cargo Movers',
    truckerName: 'Vikram Patel',
    phone: '9825000005',
    email: 'vikram@patelcargo.in',
    base: 'Ahmedabad',
    truckSources: ['Container Body', 'Open Body 20–24 ft'],
    laneOrigin: 'Gujarat',
    laneDestinations: ['Maharashtra', 'Karnataka'],
    tdsPercent: '1',
    loadsLast30Days: 3,
    rating: '4.1',
    status: 'approved',
  },
  {
    truckerCompany: 'Reddy Road Carriers',
    truckerName: 'Mahesh Reddy',
    phone: '9848000007',
    email: 'mahesh@reddyroad.in',
    base: 'Hyderabad',
    truckSources: ['Closed Body 19 ft', 'Multi Axle 32 ft'],
    laneOrigin: 'Telangana',
    laneDestinations: ['Karnataka', 'Tamil Nadu'],
    tdsPercent: '2',
    loadsLast30Days: 0,
    rating: '3.9',
    status: 'approved',
  },
  {
    truckerCompany: 'Murugan Lorry Service',
    truckerName: 'Senthil Murugan',
    phone: '9840000008',
    base: 'Chennai',
    truckSources: ['Open Body 17–19 ft'],
    laneOrigin: 'Tamil Nadu',
    laneDestinations: ['Kerala', 'Karnataka'],
    tdsPercent: '1',
    status: 'approved',
  },
  {
    truckerCompany: 'Deshmukh Transport',
    truckerName: 'Anil Deshmukh',
    phone: '9822000009',
    email: 'anil@deshmukhtransport.in',
    base: 'Pune',
    truckSources: ['Container 32 ft', 'Trailer 40 ft'],
    laneOrigin: 'Maharashtra',
    laneDestinations: ['MP', 'Chhattisgarh'],
    tdsPercent: '1',
    loadsLast30Days: 4,
    rating: '4.4',
    status: 'approved',
  },
  {
    truckerCompany: 'Mishra Roadways',
    truckerName: 'Sanjay Mishra',
    phone: '9839000010',
    isOnWhatsapp: false,
    base: 'Lucknow',
    truckSources: ['Open Body 14–22 ft'],
    laneOrigin: 'UP',
    laneDestinations: ['Bihar', 'West Bengal'],
    tdsPercent: '1',
    loadsLast30Days: 1,
    rating: '3.2',
    status: 'approved',
  },
  {
    truckerCompany: 'Jain Freight Solutions',
    truckerName: 'Prakash Jain',
    phone: '9826000012',
    email: 'prakash@jainfreight.in',
    base: 'Indore',
    truckSources: ['Single Axle', 'Multi Axle'],
    laneOrigin: 'MP',
    laneDestinations: ['Maharashtra', 'Gujarat'],
    tdsPercent: '2',
    loadsLast30Days: 2,
    rating: '4.0',
    status: 'approved',
  },
  {
    truckerCompany: 'Tiwari Logistics',
    truckerName: 'Manoj Tiwari',
    phone: '9935000013',
    base: 'Varanasi',
    truckSources: ['Open Body 20–24 ft'],
    laneOrigin: 'UP',
    laneDestinations: ['West Bengal', 'Odisha'],
    tdsPercent: '1',
    status: 'approved',
  },
  {
    truckerCompany: 'Choudhary Transport Co.',
    truckerName: 'Deepak Choudhary',
    phone: '9829000015',
    email: 'deepak@choudharytransport.in',
    base: 'Jodhpur',
    truckSources: ['Trailer 40 ft', 'Multi Axle 32 ft'],
    laneOrigin: 'Rajasthan',
    laneDestinations: ['Gujarat'],
    tdsPercent: '1',
    status: 'approved',
  },
  {
    truckerCompany: 'Nair Road Express',
    truckerName: 'Arun Nair',
    phone: '9847000016',
    email: 'arun@nairexpress.in',
    base: 'Kochi',
    truckSources: ['Closed Body 19 ft'],
    laneOrigin: 'Kerala',
    laneDestinations: ['Tamil Nadu', 'Karnataka'],
    tdsPercent: '0',
    loadsLast30Days: 3,
    rating: '4.7',
    status: 'approved',
  },
  {
    truckerCompany: 'Gill Goods Carriers',
    truckerName: 'Bhupinder Gill',
    phone: '9815000017',
    base: 'Chandigarh',
    truckSources: ['Open Body 17–19 ft', 'Single Axle'],
    laneOrigin: 'Punjab',
    laneDestinations: ['Himachal', 'J&K'],
    tdsPercent: '1',
    loadsLast30Days: 2,
    rating: '3.5',
    status: 'approved',
    pendingOriginalPods: 3,
  },
  {
    truckerCompany: 'Das Transport Agency',
    truckerName: 'Sunil Das',
    phone: '9830000019',
    email: 'sunil@dastransport.in',
    base: 'Kolkata',
    truckSources: ['Open Body 14–22 ft', 'Container Body'],
    laneOrigin: 'West Bengal',
    laneDestinations: ['Assam', 'North East'],
    tdsPercent: '2',
    loadsLast30Days: 1,
    rating: '3.9',
    status: 'approved',
  },
  {
    truckerCompany: 'Khan Roadlines',
    truckerName: 'Imran Khan',
    phone: '9821000020',
    isOnWhatsapp: false,
    base: 'Mumbai',
    truckSources: ['Container 32 ft'],
    laneOrigin: 'Maharashtra',
    laneDestinations: ['Gujarat'],
    tdsPercent: '1',
    status: 'approved',
  },
];

export async function seedBrokers(dataSource: DataSource): Promise<void> {
  const brokerRepo = dataSource.getRepository(BrokerEntity);

  let inserted = 0;
  for (const broker of DUMMY_BROKERS) {
    const existing = await brokerRepo.findOneBy({ phone: broker.phone });
    if (existing) continue;
    await brokerRepo.save(brokerRepo.create(broker));
    inserted += 1;
  }

  console.log(
    `Brokers seeded (${inserted} new, ${DUMMY_BROKERS.length - inserted} already present).`,
  );
}
