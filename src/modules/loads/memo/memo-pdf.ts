import PDFDocument from 'pdfkit';

export interface MemoPdfContent {
  reference: string;
  sentAt: string;
  expiresAt: string;
  sections: { heading: string; rows: { label: string; value: string }[] }[];
}

export interface MemoPdfSource {
  reference: string;
  loadCode: string;
  sentAt: Date;
  expiresAt: Date;
  transporterName: string | null;
  vehicleNumber: string;
  driverName: string;
  driverMobile: string;
  driverLicenceNumber: string | null;
  freightType: 'per_ton' | 'flat' | null;
  freightValue: string | null;
  advancePercentage: string | null;
  balancePercentage: string | null;
  loadingContactName: string | null;
  loadingContactPhone: string | null;
}

const IST = 'Asia/Kolkata';
const formatIst = (at: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);

const rupees = (value: string) =>
  `Rs. ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** What the memo says — the truck, driver, price and payment terms the shipper confirms. */
export function buildMemoPdfContent(source: MemoPdfSource): MemoPdfContent {
  const freight = source.freightValue
    ? `${rupees(source.freightValue)}${source.freightType === 'per_ton' ? ' per tonne' : ' per trip'}`
    : 'Not set';
  const terms =
    source.advancePercentage !== null
      ? `${Number(source.advancePercentage)}% advance, ${Number(source.balancePercentage ?? 0)}% balance`
      : 'As agreed';
  return {
    reference: source.reference,
    sentAt: formatIst(source.sentAt),
    expiresAt: formatIst(source.expiresAt),
    sections: [
      {
        heading: 'Load',
        rows: [
          { label: 'Load', value: source.loadCode },
          { label: 'Transporter', value: source.transporterName ?? '—' },
        ],
      },
      {
        heading: 'Truck and driver',
        rows: [
          { label: 'Truck number', value: source.vehicleNumber },
          { label: 'Driver', value: source.driverName },
          { label: 'Driver mobile', value: source.driverMobile },
          { label: 'Driving licence', value: source.driverLicenceNumber ?? '—' },
        ],
      },
      {
        heading: 'Price and payment',
        rows: [
          { label: 'Freight', value: freight },
          { label: 'Payment terms', value: terms },
        ],
      },
      {
        heading: 'Loading point contact',
        rows: [
          { label: 'Name', value: source.loadingContactName ?? '—' },
          { label: 'Mobile', value: source.loadingContactPhone ?? '—' },
        ],
      },
    ],
  };
}

/** Renders the memo as a one-page A4 PDF (Helvetica has no ₹ glyph — amounts use "Rs."). */
export function renderMemoPdf(content: MemoPdfContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: content.reference } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('Load memo', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `${content.reference}     Sent: ${content.sentAt}     Valid until: ${content.expiresAt}`,
        {
          align: 'center',
        },
      );
    for (const section of content.sections) {
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(12).text(section.heading, 48);
      doc.moveDown(0.2);
      for (const row of section.rows) {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).text(row.label, 48, y, { width: 150 });
        doc.font('Helvetica').fontSize(10).text(row.value, 210, y, { width: 337 });
        doc.moveDown(0.2);
      }
    }
    doc.moveDown(2);
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        'This memo is the only confirmation of the truck, driver and price. Accepting it assigns the truck to the load.',
        48,
      );
    doc.end();
  });
}
