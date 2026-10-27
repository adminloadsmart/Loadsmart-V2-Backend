import PDFDocument from 'pdfkit';
import { ElrContent } from './elr-content';

/** Renders the e-LR as a one-page A4 PDF. The built-in Helvetica has no ₹ glyph, so amounts are
 *  printed with "Rs." */
export function renderElrPdf(content: ElrContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: content.elrNumber } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const text = (value: string) => value.replace(/₹/g, 'Rs. ');
    doc.font('Helvetica-Bold').fontSize(18).text(content.title, { align: 'center' });
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `${content.numberLabel ?? 'LR number'}: ${content.elrNumber}     Date: ${content.date}`,
        {
          align: 'center',
        },
      );

    for (const section of content.sections) {
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(12).text(section.heading);
      doc.moveDown(0.2);
      for (const row of section.rows) {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).text(row.label, 48, y, { width: 150 });
        doc.font('Helvetica').fontSize(10).text(text(row.value), 210, y, { width: 337 });
        doc.moveDown(0.2);
      }
    }

    doc.moveDown(3);
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).text('Signature of consignor', 48, y);
    doc.text('Signature of driver', 380, y);
    doc.end();
  });
}
