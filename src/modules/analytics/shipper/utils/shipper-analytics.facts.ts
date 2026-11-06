import { LoadEntity } from '../../../loads/entities/load.entity';
import { resolveLoadOrigin } from '../../../loads/utils/load-origin';
import { toIstDateString } from '../../../../shared/utils/ist-time';
import {
  dailyFixedCost,
  dueAt,
  laneOf,
  loadArrival,
  loadDeparture,
  unloadingHours,
} from '../../fleet-analytics/utils/fleet-analytics.calculations';
import { TRUCK_BODY_TYPE_LABELS } from '../../fleet-analytics/utils/fleet-analytics.constants';
import { ShipperLoadRecords } from '../shipper-analytics.repository';
import {
  awardedAmountOf,
  costOfLoad,
  detentionBeyondFree,
  groupBy,
  LoadFact,
  sum,
  TruckTypeRef,
} from './shipper-analytics.calculations';
import { BuyMethod, EXTERNAL_ISSUE_CATEGORIES } from './shipper-analytics.constants';

// Turns the stored records of a load into a LoadFact — one place where each of the guide's data
// sources (§5) is mapped to a field. The calculations never read an entity.

/** Loadsmart moves a Loadsmart-sourced load itself; it has no transporter row. */
const LOADSMART_TRANSPORTER = { id: 'loadsmart', name: 'Loadsmart' };

const num = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

/** §6 "Bought as": own truck, else contract when the load came off a customer contract, else spot. */
function buyMethodOf(load: LoadEntity): BuyMethod {
  if (load.sourceType === 'own_fleet') return 'own_fleet';
  return load.posting?.contractId ? 'contract' : 'spot';
}

function truckTypeOf(load: LoadEntity): TruckTypeRef | null {
  const type = load.truckType;
  if (!type) return null;
  const bodyType = type.bodyType ?? 'unclassified';
  const rated = num(type.capacityTons);
  const size = rated !== null && rated > 0 ? `${rated}T` : null;
  return {
    key: `${bodyType}|${size ?? ''}`,
    bodyType,
    bodyTypeLabel: type.bodyType ? (TRUCK_BODY_TYPE_LABELS[type.bodyType] ?? type.name) : type.name,
    size,
    ratedTonnes: rated !== null && rated > 0 ? rated : null,
  };
}

/** The plant: a loading point changed on the load wins over the planned one. */
function plantOf(load: LoadEntity) {
  return (
    load.loadingPoint ?? load.requisition?.loadingPoint ?? load.posting?.pickupLoadingPoint ?? null
  );
}

function customerEntityOf(load: LoadEntity) {
  return load.requisition?.customer ?? load.posting?.customer ?? null;
}

/**
 * §2 Own-fleet cost, as Fleet Analytics defines it: the truck's daily fixed cost for the days the
 * load held it. Running and empty-run cost need km, which are not recorded (flagged by the
 * service), so they add nothing yet.
 */
function ownFleetFixedCost(load: LoadEntity, now: Date): number | null {
  const vehicle = load.vehicle;
  const from = loadDeparture(load);
  if (!vehicle || !from) return null;
  const to = loadArrival(load) ?? now;
  const days = Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
  const driver = load.driver;
  const salary = driver?.salaryType === 'fixed' ? Number(driver.salaryAmount ?? 0) : 0;
  // For an attached truck dailyFixedCost returns only our driver's salary: its hire is a running
  // cost, which is not recorded yet.
  return dailyFixedCost(vehicle, salary, toIstDateString(from)).total * days;
}

export function buildLoadFacts(
  records: ShipperLoadRecords,
  orgFreeHours: number,
  now = new Date(),
): LoadFact[] {
  const chargesByLoad = groupBy(records.charges, (charge) => charge.loadId);
  const claimByLoad = new Map(records.claims.map((claim) => [claim.loadId, claim]));
  const invoiceByLoad = new Map(records.invoices.map((invoice) => [invoice.loadId, invoice]));
  const paymentsByLoad = groupBy(records.payments, (payment) => payment.loadId);
  const issuesByLoad = groupBy(records.issues, (issue) => issue.loadId);
  const external = new Set<string>(EXTERNAL_ISSUE_CATEGORIES);

  return records.loads.map((load): LoadFact => {
    const origin = resolveLoadOrigin(load);
    const buyMethod = buyMethodOf(load);
    const bought = buyMethod !== 'own_fleet';
    const lane = laneOf(load);
    const plant = plantOf(load);
    const customer = customerEntityOf(load);
    const firstItem = [...(load.cargoItems ?? [])].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];
    const product = firstItem?.product ?? null;
    const charges = chargesByLoad.get(load.id) ?? [];
    const chargeOf = (type: string) =>
      sum(
        charges.filter((charge) => charge.chargeType === type),
        (charge) => Number(charge.amount),
      );
    const claim = claimByLoad.get(load.id) ?? null;
    const invoice = invoiceByLoad.get(load.id) ?? null;
    const transporter = load.transporter
      ? { id: load.transporter.id, name: load.transporter.name }
      : load.sourceType === 'loadsmart'
        ? LOADSMART_TRANSPORTER
        : null;

    const awardedAmount = awardedAmountOf({
      bought,
      freightType: load.freightType,
      freightValue: num(load.freightValue),
      plannedTonnes: num(load.plannedCapacityTonnes),
    });
    // §2 Bought load, billed: Freight + FOV + Loading + Unloading + Detention + Other from the
    // invoice (before tax).
    const invoiceAmount = invoice
      ? Number(invoice.freightAmount) + Number(invoice.chargesAmount)
      : null;
    const { cost, source } = costOfLoad({
      bought,
      ownFleetCost: bought ? null : ownFleetFixedCost(load, now),
      invoiceAmount,
      awardedAmount,
    });

    const freeHours = customer?.freeHoursAtDrop ?? orgFreeHours;
    const drop = origin.drop;

    return {
      id: load.id,
      code: load.code,
      buyMethod,
      bought,
      transporter: bought ? transporter : null,
      customer: customer
        ? { id: customer.id, name: customer.name, city: drop?.city ?? null }
        : null,
      plant: plant ? { id: plant.id, name: plant.title } : null,
      plantTurnaroundHours: num(plant?.declaredTurnaroundHours),
      destinationCity: (drop?.city ?? drop?.location ?? null)?.trim() || null,
      destinationState: drop?.state?.trim() || null,
      lane,
      commodity: product ? { id: product.id, name: product.productDetails } : null,
      businessUnit: product?.businessUnit?.trim() || null,
      truckType: truckTypeOf(load),
      vehicle:
        !bought && load.vehicle
          ? { id: load.vehicle.id, name: load.vehicle.registrationNumber }
          : null,
      weight: num(load.elrNetWeightTonnes),

      orderAt: load.requisition?.createdAt ?? load.posting?.createdAt ?? null,
      pickupDate: origin.pickupDate,
      placementAt: load.atPlantAt,
      loadedAt: loadDeparture(load),
      deliveredAt: loadArrival(load),
      podAt: load.deliveredAt,
      dueAt: dueAt(load),

      awardedAmount,
      cost,
      costSource: source,
      invoice: invoice
        ? { amount: invoiceAmount!, date: toIstDateString(invoice.createdAt) }
        : null,
      payments: (paymentsByLoad.get(load.id) ?? []).map((payment) => ({
        amount: Number(payment.amount),
        date: payment.paymentDate,
        type: payment.paymentType,
      })),
      charges: {
        loading: chargeOf('loading'),
        unloading: chargeOf('unloading'),
        detention: chargeOf('detention'),
      },
      creditsRecovered: invoice ? Number(invoice.claimCredit) : 0,

      detentionHours: detentionBeyondFree(unloadingHours(load), freeHours),
      hasClaim:
        Boolean(claim) || (load.shortageOrDamage !== null && load.shortageOrDamage !== 'none'),
      claimValue: num(claim?.claimValue) ?? 0,
      externalDelay: (issuesByLoad.get(load.id) ?? []).some((issue) =>
        external.has(issue.category),
      ),
    };
  });
}
