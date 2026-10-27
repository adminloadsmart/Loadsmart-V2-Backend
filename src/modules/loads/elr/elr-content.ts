import { LoadEntity } from '../entities/load.entity';
import { resolveLoadOrigin } from '../utils/load-origin';
import { ElrInput, ElrContent } from '../utils/elr.interface';

const dash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

const place = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');

/** The e-LR's text, built from the load (with requisition/posting/cargo relations loaded). Pure,
 *  so "freight hidden unless ticked" is unit-tested without rendering a PDF. */
export function buildElrContent(
  load: LoadEntity,
  elrNumber: string,
  generatedOn: string,
  input: Required<Pick<ElrInput, 'packages'>> & Omit<ElrInput, 'packages'>,
): ElrContent {
  const { customer, pickup, drop } = resolveLoadOrigin(load);
  const goods =
    (load.cargoItems ?? [])
      .map((item) => item.product?.productDetails)
      .filter(Boolean)
      .join(', ') ||
    load.posting?.commodityName ||
    null;
  const freight = input.showFreight
    ? load.freightValue
      ? `₹${load.freightValue} ${load.freightType === 'per_ton' ? 'per tonne' : 'per trip'}`
      : '—'
    : 'As agreed';

  return {
    title: 'e-Lorry Receipt',
    elrNumber,
    date: generatedOn,
    sections: [
      {
        heading: 'Consignment',
        rows: [
          { label: 'Load', value: load.code },
          {
            label: 'Consignor (from)',
            value: dash(
              pickup &&
                place([
                  pickup.title,
                  pickup.addressLine1,
                  pickup.city,
                  pickup.state,
                  pickup.pinCode,
                ]),
            ),
          },
          {
            label: 'Consignee (to)',
            value: dash(
              drop &&
                place([
                  customer?.name,
                  drop.location,
                  drop.addressLine1,
                  drop.city,
                  drop.state,
                  drop.pinCode,
                ]),
            ),
          },
        ],
      },
      {
        heading: 'Truck',
        rows: [
          { label: 'Vehicle number', value: dash(load.vehicleNumber) },
          { label: 'Driver', value: dash(load.driverName ?? load.driver?.fullName) },
          { label: 'Driver mobile', value: dash(load.driverNumber) },
          { label: 'Transporter', value: dash(load.transporter?.name) },
        ],
      },
      {
        heading: 'Goods',
        rows: [
          { label: 'Description', value: dash(goods) },
          { label: 'Weight', value: `${load.plannedCapacityTonnes} t` },
          { label: 'Packages', value: String(input.packages) },
          { label: 'Seal number', value: dash(input.sealNumber) },
        ],
      },
      {
        heading: 'Documents',
        rows: [
          { label: 'Invoice number', value: dash(input.invoiceNumber ?? load.invoiceNumber) },
          { label: 'Invoice date', value: dash(input.invoiceDate) },
          {
            label: 'Invoice value',
            value: input.invoiceValue === undefined ? '—' : `₹${input.invoiceValue}`,
          },
          { label: 'E-way bill', value: dash(load.ewayBillNumber) },
          { label: 'Freight', value: freight },
        ],
      },
    ],
  };
}
