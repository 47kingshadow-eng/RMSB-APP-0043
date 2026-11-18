import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  ImageRun,
  WidthType,
} from "docx";
import {
  category,
  fmt,
  totals,
  planned,
  products,
  snapshot,
  type Transaction,
  type Settings,
  type Plan,
} from "./database";

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export async function exportBackup(format: "json" | "xlsx") {
  const data = await snapshot();
  const name = "RM-SB-sauvegarde-" + new Date().toISOString().slice(0, 10);
  if (format === "json")
    return download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      name + ".json",
    );
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries({
    RM_META: [{ version: data.version }],
    RM_OPS: data.ops,
    RM_TRANSACTIONS: data.transactions,
    RM_PLANS: data.plans,
    RM_SETTINGS: [data.settings],
    RM_USERS: data.users,
    RM_IMPORTS: data.imports,
    RM_FUEL_RES: data.reservations,
    RM_FUEL_OPEN: data.fuelOpening ? [data.fuelOpening] : [],
    RM_DUT_REC: data.dutReceipts,
    RM_DUT_OPEN: data.dutOpening ? [data.dutOpening] : [],
    RM_FUEL_ATC: data.fuelEntries,
    RM_SETTINGS_HIST: data.settingsHistory,
    RM_OPS_ROWS: data.opsImportRows,
  }))
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet((rows as object[]).map(encodeRow)),
      name,
    );
  XLSX.writeFile(wb, name + ".xlsx");
}
// Spreadsheet cells only hold scalars: arrays/objects (importIds, audit trails,
// version values) are stored as JSON text and nulls as an explicit marker.
const NULL_CELL = "__null__";
const JSON_KEYS = new Set(["importIds", "history", "values"]);
function encodeRow(row: object) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v === null ? NULL_CELL : typeof v === "object" ? JSON.stringify(v) : v,
    ]),
  );
}
function decodeRow(row: unknown) {
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([k, v]) => {
      if (v === NULL_CELL) return [k, null];
      if (JSON_KEYS.has(k) && typeof v === "string" && /^[[{]/.test(v.trim()))
        try {
          return [k, JSON.parse(v)];
        } catch {
          return [k, v];
        }
      return [k, v];
    }),
  );
}
export async function readBackup(file: File) {
  if (file.name.toLowerCase().endsWith(".json")) return JSON.parse(await file.text());
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const get = (name: string) => {
    if (!wb.Sheets[name])
      throw new Error("Ce fichier n’est pas une sauvegarde RM-SB : " + name + " manquant.");
    return XLSX.utils.sheet_to_json(wb.Sheets[name]).map(decodeRow);
  };
  const optional = (name: string) => (wb.Sheets[name] ? get(name) : []);
  return {
    version: (get("RM_META")[0] as { version: number })?.version,
    ops: wb.Sheets.RM_OPS ? get("RM_OPS") : [],
    transactions: get("RM_TRANSACTIONS"),
    plans: get("RM_PLANS"),
    settings: get("RM_SETTINGS")[0],
    users: get("RM_USERS"),
    imports: get("RM_IMPORTS"),
    reservations: wb.Sheets.RM_FUEL_RES ? get("RM_FUEL_RES") : [],
    fuelOpening: wb.Sheets.RM_FUEL_OPEN ? get("RM_FUEL_OPEN")[0] || null : null,
    dutReceipts: wb.Sheets.RM_DUT_REC ? get("RM_DUT_REC") : [],
    dutOpening: wb.Sheets.RM_DUT_OPEN ? get("RM_DUT_OPEN")[0] || null : null,
    fuelEntries: optional("RM_FUEL_ATC").map((e) => ({ litres: null, ...e })),
    settingsHistory: optional("RM_SETTINGS_HIST"),
    opsImportRows: optional("RM_OPS_ROWS"),
  };
}
export function exportTransactions(rows: Transaction[], filename = "RM-SB-transactions.xlsx") {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((t) => ({
      ATC: t.atc,
      Entrée: t.entry,
      Sortie: t.exit,
      Camion: t.truck,
      Produit: t.product,
      Transporteur: t.transporter,
      Chauffeur: t.driver,
      Expéditeur: t.sender,
      Destinataire: t.receiver,
      "Tare (t)": t.tare,
      "Brut (t)": t.gross,
      "Net (t)": t.net,
      Catégorie: category(t),
      "Classé le": t.assignedAt,
      "Classification par": t.assignedBy,
      "Source officielle": t.comment,
    })),
  );
  sheet["!cols"] = Array.from({ length: 16 }, (_, i) => ({
    wch: i === 1 || i === 2 || i === 13 ? 25 : 20,
  }));
  if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
  for (const [address, cell] of Object.entries(sheet))
    if (!address.startsWith("!") && typeof cell === "object" && cell.t === "n") cell.z = "#,##0.00";
  XLSX.utils.book_append_sheet(wb, sheet, "Transactions");
  XLSX.writeFile(wb, filename);
}
export function summary(rows: Transaction[], plans: Plan[], settings: Settings) {
  return [...products, "TOTAL"].map((product) => {
    const current = product === "TOTAL" ? rows : rows.filter((t) => t.product === product);
    const actual = current.reduce((s, t) => s + t.net, 0);
    const target = planned(
      plans,
      settings,
      product === "TOTAL" ? undefined : (product as (typeof products)[number]),
    );
    return {
      product,
      trips: current.length,
      target,
      actual,
      gap: actual - target,
      rate: target ? (actual / target) * 100 : null,
    };
  });
}
async function logoData() {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 192;
      canvas.getContext("2d")!.drawImage(image, 0, 0, 192, 192);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Logo indisponible"));
    image.src = "/images/icon-192.png";
  });
}
export async function exportReport(
  format: "pdf" | "xlsx" | "docx",
  rows: Transaction[],
  plans: Plan[],
  settings: Settings,
  from: string,
  to: string,
  title: string,
  fuelAmounts: Map<string, number | null> = new Map(),
  outsideFuel = 0,
) {
  const sums = summary(rows, plans, settings);
  const base = totals(rows, settings, fuelAmounts);
  // Official Ops Spe refs absent from the DDS (dated by Ops date) still count as consumed fuel.
  const total = { ...base, fuel: base.fuel + outsideFuel };
  const fuelOf = (c: "Opérations Spéciales" | "Reverse Logistics") =>
    rows.filter((t) => category(t) === c).reduce((s, t) => s + (fuelAmounts.get(t.atc) || 0), 0);
  const opsFuel = fuelOf("Opérations Spéciales") + outsideFuel;
  const reverseFuel = fuelOf("Reverse Logistics");
  const fuelLine = `Carburant réel : Ops Spe ${fmt(opsFuel)} L + Reverse Log ${fmt(reverseFuel)} L = ${fmt(total.fuel)} L  |  Distance estimée : ${fmt(total.distance)} km`;
  const fuelNote = `3rd Party exclus du carburant et de la distance. Ops Spe : litres du fichier ou corrigés (vide = 0 L). Reverse Log : coefficient versionné à la date du voyage.`;
  const fuelCell = (t: Transaction) => {
    if (category(t) === "3rd Party") return "Exclu (3rd Party)";
    const v = fuelAmounts.get(t.atc);
    return v ?? 0;
  };
  const heading = ["Produit", "Voyages", "Prévu (t)", "Réalisé (t)", "Écart (t)", "Taux"];
  const body = sums.map((s) => [
    s.product,
    fmt(s.trips),
    fmt(s.target, 2),
    fmt(s.actual, 2),
    fmt(s.gap, 2),
    s.rate === null ? "Non planifié" : fmt(s.rate, 1) + " %",
  ]);
  const breakdown = products.flatMap((p) =>
    (["Reverse Logistics", "Opérations Spéciales", "3rd Party"] as const).map((c) => {
      const group = rows.filter((t) => t.product === p && category(t) === c);
      return [
        p,
        c,
        fmt(group.length),
        fmt(
          group.reduce((s, t) => s + t.net, 0),
          2,
        ),
      ];
    }),
  );
  const filename = `RM-SB-${from}-${to}`;
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [settings.organization],
      [title],
      [`Période : ${from} — ${to}`],
      [],
      heading,
      ...body,
      [],
      ["Carburant Ops Spe (L)", opsFuel],
      ["Carburant Reverse Log (L)", reverseFuel],
      ["Carburant réel total (L) — 3rd Party exclus", total.fuel],
      ["Distance estimée (km)", total.distance],
      [],
      ["Produit", "Catégorie", "Voyages", "Tonnage (t)"],
      ...breakdown,
    ]);
    sheet["!cols"] = [{ wch: 27 }, { wch: 25 }, ...Array(4).fill({ wch: 20 })];
    XLSX.utils.book_append_sheet(wb, sheet, "Synthèse");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        rows.map((t) => ({ ...t, categorie: category(t), carburantL: fuelCell(t) })),
      ),
      "Transactions",
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plans), "Planification");
    XLSX.writeFile(wb, filename + ".xlsx");
    return;
  }
  const logo = await logoData();
  if (format === "pdf") {
    const pdf = new jsPDF();
    pdf.addImage(logo, "PNG", 15, 12, 22, 22);
    pdf.setTextColor("#092c40");
    pdf.setFontSize(20);
    pdf.text("RM-SB", 43, 20);
    pdf.setFontSize(10);
    pdf.text(settings.organization, 43, 27);
    pdf.setFontSize(15);
    pdf.text(title, 15, 47);
    pdf.setFontSize(10);
    pdf.text(`Période : ${from} au ${to} | Date de sortie`, 15, 55);
    autoTable(pdf, {
      head: [heading],
      body,
      startY: 64,
      headStyles: { fillColor: [9, 44, 64] },
      styles: { fontSize: 9 },
      theme: "striped",
    });
    autoTable(pdf, {
      head: [["Produit", "Catégorie", "Voyages", "Tonnage (t)"]],
      body: breakdown,
      startY: 113,
      headStyles: { fillColor: [44, 139, 80] },
      styles: { fontSize: 9 },
    });
    pdf.setFontSize(9);
    pdf.text(fuelLine, 15, 190);
    pdf.setFontSize(8);
    pdf.text(
      fuelNote + " Distance selon les coefficients paramétrés. Données locales RM-SB.",
      15,
      198,
      { maxWidth: 180 },
    );
    if (rows.length) {
      pdf.addPage();
      autoTable(pdf, {
        head: [
          [
            "Sortie",
            "ATC",
            "Camion",
            "Produit",
            "Transporteur",
            "Net (t)",
            "Catégorie",
            "Carb. (L)",
          ],
        ],
        body: rows.map((t) => {
          const f = fuelCell(t);
          return [
            t.exit.slice(0, 10),
            t.atc,
            t.truck,
            t.product,
            t.transporter,
            fmt(t.net, 2),
            category(t),
            typeof f === "number" ? fmt(f) : f,
          ];
        }),
        headStyles: { fillColor: [9, 44, 64] },
        styles: { fontSize: 7 },
        margin: { top: 16 },
      });
    }
    for (let i = 1; i <= pdf.getNumberOfPages(); i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.text(`RM-SB • ${i} / ${pdf.getNumberOfPages()}`, 165, 288);
    }
    pdf.save(filename + ".pdf");
    return;
  }
  const bytes = Uint8Array.from(atob(logo.split(",")[1]), (c) => c.charCodeAt(0));
  const table = (rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (row, i) =>
          new TableRow({
            children: row.map(
              (text) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text,
                          bold: i === 0,
                          color: i === 0 ? "FFFFFF" : "193549",
                          size: 18,
                        }),
                      ],
                    }),
                  ],
                  shading: i === 0 ? { fill: "092c40" } : undefined,
                }),
            ),
          }),
      ),
    });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ImageRun({ data: bytes, type: "png", transformation: { width: 74, height: 74 } }),
              new TextRun({ text: "  RM-SB", bold: true, size: 40, color: "092c40" }),
            ],
          }),
          new Paragraph(settings.organization),
          new Paragraph({ text: title, heading: "Heading1" }),
          new Paragraph(`Période : ${from} au ${to} — Date de sortie`),
          table([heading, ...body]),
          new Paragraph({ text: "Répartition par catégorie", heading: "Heading2" }),
          table([["Produit", "Catégorie", "Voyages", "Tonnage (t)"], ...breakdown]),
          new Paragraph(fuelLine),
          new Paragraph(fuelNote + " Distance selon les coefficients paramétrés."),
          new Paragraph({ text: "Transactions", heading: "Heading2" }),
          table([
            ["Sortie", "ATC", "Produit", "Net (t)", "Catégorie", "Carburant (L)"],
            ...rows.map((t) => {
              const f = fuelCell(t);
              return [
                t.exit.slice(0, 10),
                t.atc,
                t.product,
                fmt(t.net, 2),
                category(t),
                typeof f === "number" ? fmt(f) : f,
              ];
            }),
          ]),
        ],
      },
    ],
  });
  download(await Packer.toBlob(doc), filename + ".docx");
}
