import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";
import { download } from "./exports";
export interface ReportTable {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}
export async function exportOperational(
  format: "pdf" | "xlsx" | "docx",
  title: string,
  subtitle: string,
  tables: ReportTable[],
  filename: string,
) {
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    for (const t of tables) {
      const sheet = XLSX.utils.aoa_to_sheet([[title], [subtitle], [], t.headers, ...t.rows]);
      sheet["!cols"] = t.headers.map((h) => ({ wch: Math.max(18, Math.min(45, h.length + 5)) }));
      if (sheet["!ref"])
        sheet["!autofilter"] = {
          ref: "A4:" + XLSX.utils.encode_cell({ r: t.rows.length + 3, c: t.headers.length - 1 }),
        };
      for (const [a, c] of Object.entries(sheet))
        if (!a.startsWith("!") && c.t === "n") c.z = "#,##0.00";
      XLSX.utils.book_append_sheet(wb, sheet, t.name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename + ".xlsx");
    return;
  }
  if (format === "pdf") {
    const pdf = new jsPDF({ orientation: "landscape" });
    tables.forEach((t, i) => {
      if (i) pdf.addPage();
      pdf.setFontSize(16);
      pdf.text(title, 14, 17);
      pdf.setFontSize(10);
      pdf.text(subtitle, 14, 25);
      pdf.text(t.name, 14, 33);
      autoTable(pdf, {
        head: [t.headers],
        body: t.rows,
        startY: 39,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [7, 75, 96] },
      });
    });
    pdf.save(filename + ".pdf");
    return;
  }
  const children = [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] }),
    new Paragraph(subtitle),
  ];
  const doc = new Document({
    sections: [
      {
        properties: { page: { size: { orientation: "landscape", width: 16838, height: 11906 } } },
        children: [
          ...children,
          ...tables.flatMap((t) => [
            new Paragraph({ text: t.name, spacing: { before: 250 } }),
            new Table({
              rows: [t.headers, ...t.rows].map(
                (row, i) =>
                  new TableRow({
                    children: row.map(
                      (v) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [new TextRun({ text: String(v), bold: i === 0, size: 18 })],
                            }),
                          ],
                        }),
                    ),
                  }),
              ),
            }),
          ]),
        ],
      },
    ],
  });
  download(await Packer.toBlob(doc), filename + ".docx");
}
