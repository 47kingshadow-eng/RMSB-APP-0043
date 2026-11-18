import * as XLSX from "xlsx";
import {
  db,
  requireWrite,
  reclassify,
  transactionSchema,
  type Transaction,
  type OpsReference,
} from "./database";
import { readWorkbook } from "./workbooks";
export interface Issue {
  row: number;
  atc: string;
  reason: string;
  kind: "duplicate" | "invalid" | "warning";
}
export interface Preview {
  transactions: Transaction[];
  issues: Issue[];
  total: number;
  filename: string;
  sheet: string;
  unit: "kg" | "t";
  atcs: string[];
}
export const normalizeATC = (value: unknown) =>
  clean(value)
    .replace(/\s/g, "")
    .replace(/^(\d+)\.0+$/, "$1");
const clean = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
const key = (value: unknown) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function parseDate(value: unknown): string {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) throw new Error("Date Excel invalide");
    return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S)).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  const text = clean(value);
  const match = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (match) {
    let hour = Number(match[4] || 0);
    const meridian = match[7]?.toUpperCase();
    if (meridian) hour = (hour % 12) + (meridian === "PM" ? 12 : 0);
    const month = Number(match[1]),
      day = Number(match[2]);
    const d = new Date(
      Date.UTC(
        Number(match[3]),
        month - 1,
        day,
        hour,
        Number(match[5] || 0),
        Number(match[6] || 0),
      ),
    );
    if (
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day ||
      hour > 23 ||
      Number(match[5] || 0) > 59
    )
      throw new Error("Date invalide");
    return d.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || Number.isNaN(Date.parse(text)))
    throw new Error("Date invalide (format DDS MM/JJ/AAAA attendu)");
  return new Date(text.length === 10 ? text + "T00:00:00Z" : text).toISOString();
}
function weight(value: unknown) {
  const n =
    typeof value === "number" ? value : Number(clean(value).replace(/\s/g, "").replace(",", "."));
  if (value === "" || value == null || !Number.isFinite(n) || n < 0)
    throw new Error("Poids manquant ou invalide");
  return n;
}
const aliases: Record<string, string[]> = {
  entry: ["entrytime"],
  exit: ["exittime"],
  atc: ["atc"],
  truck: ["truckno", "trucknumber"],
  product: ["product"],
  driver: ["driver"],
  sender: ["sender"],
  receiver: ["receiver"],
  transporter: ["transporter"],
  tare: ["tareweight"],
  gross: ["grossweight"],
  net: ["netweight"],
};
export async function workbookSheets(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", bookSheets: true });
  return workbook.SheetNames;
}
export async function previewImport(
  file: File,
  unit: "kg" | "t",
  sheet?: string,
): Promise<Preview> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name))
    throw new Error("Format non accepté : utilisez XLSX, XLS ou CSV.");
  const workbook = await readWorkbook(file);
  const sheetName = sheet || workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) throw new Error("Feuille introuvable");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  });
  const header = rows.findIndex(
    (r, i) => i < 30 && r.some((c) => key(c) === "atc") && r.some((c) => key(c) === "netweight"),
  );
  if (header < 0)
    throw new Error("En-tête DDS introuvable. Les colonnes ATC et Net Weight sont obligatoires.");
  const columns: Record<string, number> = {};
  const missing: string[] = [];
  for (const [field, names] of Object.entries(aliases)) {
    const index = rows[header].findIndex((c) => names.includes(key(c)));
    if (index < 0) missing.push(field);
    columns[field] = index;
  }
  if (missing.length) throw new Error("Colonnes manquantes : " + missing.join(", "));
  const known = new Set(await db.transactions.toCollection().primaryKeys());
  const seen = new Set<string>();
  const transactions: Transaction[] = [];
  const issues: Issue[] = [];
  const atcs: string[] = [];
  let total = 0;
  for (let i = header + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => clean(c) === "")) continue;
    total++;
    const value = (field: string) => row[columns[field]];
    const atc = normalizeATC(value("atc"));
    if (atc) atcs.push(atc);
    if (atc && (known.has(atc) || seen.has(atc))) {
      issues.push({
        row: i + 1,
        atc,
        reason: "ATC déjà présent — ligne ignorée",
        kind: "duplicate",
      });
      continue;
    }
    try {
      const rawProduct = clean(value("product")).toUpperCase();
      const product =
        rawProduct === "POZZOLANA" || rawProduct === "POUZZOLANE"
          ? "POUZZOLANE"
          : rawProduct === "GRANITE"
            ? "GRANITE"
            : null;
      if (!product) throw new Error("Produit non reconnu : " + rawProduct);
      const divisor = unit === "kg" ? 1000 : 1;
      const t: Transaction = {
        atc,
        entry: parseDate(value("entry")),
        exit: parseDate(value("exit")),
        truck: clean(value("truck")),
        product,
        driver: clean(value("driver")),
        sender: clean(value("sender")),
        receiver: clean(value("receiver")),
        transporter: clean(value("transporter")).toUpperCase(),
        tare: weight(value("tare")) / divisor,
        gross: weight(value("gross")) / divisor,
        net: weight(value("net")) / divisor,
        special: false,
        assignedAt: "",
        assignedBy: "",
        comment: "",
        importedAt: new Date().toISOString(),
      };
      if (t.exit < t.entry) throw new Error("La sortie précède l’entrée");
      const validation = transactionSchema.safeParse(t);
      if (!validation.success)
        throw new Error(
          validation.error.issues
            .map((i) => (i.path.length ? i.path.join(".") + " : " + i.message : i.message))
            .join("; "),
        );
      if (!t.driver || !t.sender || !t.receiver)
        issues.push({
          row: i + 1,
          atc,
          reason: "Champ descriptif vide (chauffeur, expéditeur ou destinataire)",
          kind: "warning",
        });
      if (t.net > 100)
        issues.push({
          row: i + 1,
          atc,
          reason: "Charge supérieure à 100 t : vérifier l’unité choisie",
          kind: "warning",
        });
      transactions.push(t);
      seen.add(atc);
    } catch (error) {
      issues.push({
        row: i + 1,
        atc,
        reason: error instanceof Error ? error.message : "Ligne invalide",
        kind: "invalid",
      });
    }
  }
  return { transactions, issues, total, filename: file.name, sheet: sheetName, unit, atcs };
}
export interface OpsPreview {
  filename: string;
  sheet: string;
  references: OpsReference[];
  issues: Issue[];
}
export async function previewOps(file: File, sheet?: string): Promise<OpsPreview> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("Format Ops Spe non accepté.");
  const wb = await readWorkbook(file);
  const name = sheet || wb.SheetNames[0];
  if (!wb.Sheets[name]) throw new Error("Feuille Ops Spe introuvable.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1,
    defval: "",
    raw: true,
  });
  const header = rows.findIndex(
    (r, i) => i < 30 && r.some((v) => ["natcwb", "noatcwb", "atcwb"].includes(key(v))),
  );
  if (header < 0) throw new Error("Colonne officielle N° ATC WB introuvable dans Ops Spe.");
  const column = rows[header].findIndex((v) => ["natcwb", "noatcwb", "atcwb"].includes(key(v)));
  const dateColumn = rows[header].findIndex((v) => key(v) === "date");
  const fuelColumn = rows[header].findIndex((v) =>
    ["carburant", "carburantl", "fuel", "fuell", "litres", "litrage"].includes(key(v)),
  );
  const dutColumn = rows[header].findIndex((v) =>
    ["dutnunique", "dutnounique", "dutunique"].includes(key(v)),
  );
  const seen = new Set<string>(),
    references: OpsReference[] = [],
    issues: Issue[] = [];
  if (dutColumn < 0)
    issues.push({
      row: header + 1,
      atc: "",
      kind: "warning",
      reason: "Colonne DUT N°UNIQUE absente ; les DUT déjà connus seront conservés.",
    });
  if (fuelColumn < 0)
    issues.push({
      row: header + 1,
      atc: "",
      kind: "warning",
      reason:
        "Colonne Carburant absente ; les litrages déjà connus sont conservés, les nouveaux ATC valent 0 L.",
    });
  for (let i = header + 1; i < rows.length; i++) {
    if (rows[i].every((v) => clean(v) === "")) continue;
    const atc = normalizeATC(rows[i][column]);
    if (!atc) {
      issues.push({ row: i + 1, atc, kind: "invalid", reason: "N° ATC WB manquant" });
      continue;
    }
    if (seen.has(atc)) {
      issues.push({ row: i + 1, atc, kind: "duplicate", reason: "ATC Ops Spe répété — ignoré" });
      continue;
    }
    let date = "";
    if (dateColumn >= 0 && clean(rows[i][dateColumn])) {
      try {
        date = parseDate(rows[i][dateColumn]).slice(0, 10);
      } catch {
        issues.push({
          row: i + 1,
          atc,
          kind: "warning",
          reason: "Date Ops Spe invalide ; ATC conservé sans date",
        });
      }
    }
    seen.add(atc);
    // Carburant: blank or 0 => 0 L (normal value); invalid => 0 L with a warning.
    let importedFuel = 0;
    if (fuelColumn >= 0) {
      const raw = rows[i][fuelColumn];
      const text = clean(raw)
        .replace(/[\s\u00a0\u202f]/g, "")
        .replace(",", ".");
      if (text) {
        const litres = typeof raw === "number" ? raw : Number(text);
        if (Number.isFinite(litres) && litres >= 0) importedFuel = Math.round(litres * 100) / 100;
        else
          issues.push({
            row: i + 1,
            atc,
            kind: "warning",
            reason: `Carburant invalide (« ${clean(raw)} ») : compté 0 L, corrigeable dans Consommation Carburant Ops Spe.`,
          });
      }
    }
    references.push({
      atc,
      ...(fuelColumn >= 0 ? { importedFuel } : {}),
      ...(dutColumn >= 0 ? { dut: clean(rows[i][dutColumn]).normalize("NFKC").toUpperCase() } : {}),
      date,
      filename: file.name,
      importedAt: new Date().toISOString(),
      importedBy: "",
    });
  }
  return { filename: file.name, sheet: name, references, issues };
}
export async function commitImport(preview: Preview, ops: OpsPreview) {
  if (!preview?.filename || !ops?.filename)
    throw new Error("Les fichiers DDS et Ops Spe sont obligatoires à chaque import.");
  const user = requireWrite();
  let accepted = 0,
    duplicates = preview.issues.filter((i) => i.kind === "duplicate").length;
  const id = crypto.randomUUID();
  const importedAt = new Date().toISOString();
  await db.transaction("rw", [db.transactions, db.imports, db.ops, db.opsImportRows], async () => {
    for (const ref of ops.references) {
      const existing = await db.ops.get(ref.atc);
      const merged = {
        ...ref,
        dut: ref.dut ?? existing?.dut ?? "",
        importedFuel:
          ref.importedFuel === undefined ? (existing?.importedFuel ?? 0) : ref.importedFuel,
        date: ref.date || existing?.date || "",
        importedAt,
        importedBy: user,
      };
      await db.ops.put(merged);
      await db.opsImportRows.put({
        importId: id,
        atc: ref.atc,
        ...(ref.dut !== undefined ? { dut: ref.dut } : {}),
        ...(ref.importedFuel !== undefined ? { importedFuel: ref.importedFuel } : {}),
        date: ref.date,
        filename: ref.filename,
        importedAt,
        importedBy: user,
      });
    }
    const inserted = new Set<string>();
    for (const t of preview.transactions) {
      if (await db.transactions.get(t.atc)) {
        duplicates++;
        continue;
      }
      await db.transactions.add({ ...t, importIds: [id] });
      inserted.add(t.atc);
      accepted++;
    }
    // Known ATCs present in this DDS file are linked to this import too, so
    // deleting an earlier import never removes a trip still present here.
    for (const atc of new Set(preview.atcs)) {
      if (inserted.has(atc)) continue;
      const t = await db.transactions.get(atc);
      if (t && !(t.importIds || []).includes(id))
        await db.transactions.update(atc, { importIds: [...(t.importIds || []), id] });
    }
    await reclassify();
    await db.imports.add({
      id,
      date: importedAt,
      filename: preview.filename,
      opsFilename: ops.filename,
      opsCount: ops.references.length,
      accepted,
      duplicates,
      rejected: preview.issues.filter((i) => i.kind === "invalid").length,
      user,
    });
  });
  return { accepted, duplicates };
}
