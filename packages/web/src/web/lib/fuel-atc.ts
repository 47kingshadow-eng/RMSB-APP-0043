import {
  db,
  category,
  requireWrite,
  settingAt,
  type FuelChange,
  type FuelEntry,
  type OpsReference,
  type Product,
  type Settings,
  type Transaction,
} from "./database";

export type FuelSource = "Correction manuelle" | "Fichier Ops Spe" | "Vide / 0 L" | "Coefficient";
export interface OpsFuelItem {
  atc: string;
  exit: string;
  product: Product;
  special: true;
  net: number;
  truck: string;
  transporter: string;
  dut: string;
  inDds: boolean;
  litres: number;
  imported: number | null;
  correction: number | null;
  source: FuelSource;
  history: FuelChange[];
  filename: string;
}
export interface FuelDetail {
  litres: number;
  source: FuelSource;
  imported: number | null;
  correction: number | null;
}
const valid = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

// Actual litres per ATC.
// Ops Spe: manual correction ?? Carburant column ?? 0 (blank and 0 both mean 0 L).
// Reverse Log: coefficient (L/voyage) in force at the exit date. 3rd Party: never counted.
// Official refs absent from the DDS are kept, dated by their Ops date; undated ones are listed apart.
export function fuelByAtc(
  rows: Transaction[],
  refs: OpsReference[],
  entries: FuelEntry[],
  settings: Settings,
) {
  const official = new Map(refs.map((r) => [r.atc, r]));
  const manual = new Map(entries.filter((e) => e.kind === "ops").map((e) => [e.atc, e]));
  const amounts = new Map<string, number>();
  const details = new Map<string, FuelDetail>();
  const opsItems: OpsFuelItem[] = [];
  const undated: OpsReference[] = [];
  let opsTotal = 0;
  let reverseTotal = 0;
  let reverseTrips = 0;
  const opsDetail = (atc: string) => {
    const ref = official.get(atc);
    const entry = manual.get(atc);
    const imported = valid(ref?.importedFuel);
    const correction = valid(entry?.litres);
    const litres = correction ?? imported ?? 0;
    const source: FuelSource =
      correction !== null ? "Correction manuelle" : imported ? "Fichier Ops Spe" : "Vide / 0 L";
    return { litres, imported, correction, source, history: entry?.history || [] };
  };
  const seen = new Set<string>();
  for (const t of rows) {
    if (seen.has(t.atc)) continue;
    seen.add(t.atc);
    const cat = category(t);
    if (cat === "3rd Party") continue;
    if (cat === "Reverse Logistics") {
      const litres = settingAt(settings, "reverseFuel", t.exit);
      amounts.set(t.atc, litres);
      details.set(t.atc, { litres, source: "Coefficient", imported: null, correction: null });
      reverseTotal += litres;
      reverseTrips++;
      continue;
    }
    const d = opsDetail(t.atc);
    amounts.set(t.atc, d.litres);
    details.set(t.atc, d);
    opsTotal += d.litres;
    opsItems.push({
      atc: t.atc,
      exit: t.exit,
      product: t.product,
      special: true,
      net: t.net,
      truck: t.truck,
      transporter: t.transporter,
      dut: official.get(t.atc)?.dut || "",
      inDds: true,
      filename: official.get(t.atc)?.filename || "",
      ...d,
    });
  }
  for (const r of refs) {
    if (seen.has(r.atc)) continue;
    if (!r.date || !/^\d{4}-\d{2}-\d{2}/.test(r.date)) {
      undated.push(r);
      continue;
    }
    const d = opsDetail(r.atc);
    amounts.set(r.atc, d.litres);
    details.set(r.atc, d);
    opsItems.push({
      atc: r.atc,
      exit: r.date.slice(0, 10) + "T12:00:00.000Z",
      product: "POUZZOLANE",
      special: true,
      net: 0,
      truck: "",
      transporter: "",
      dut: r.dut || "",
      inDds: false,
      filename: r.filename,
      ...d,
    });
  }
  opsItems.sort((a, b) => a.exit.localeCompare(b.exit) || a.atc.localeCompare(b.atc));
  return {
    amounts,
    details,
    opsItems,
    undated,
    opsTotal,
    reverseTotal,
    reverseTrips,
    total: opsTotal + reverseTotal,
  };
}
const litresSchema = (v: number) => {
  if (!Number.isFinite(v) || v < 0) throw new Error("Litrage invalide : nombre positif ou zéro.");
  return Math.round(v * 100) / 100;
};
// Manual Ops Spe correction, prioritised over the file value; full audit trail.
export async function setAtcFuel(atc: string, litres: number) {
  const user = requireWrite();
  const value = litresSchema(litres);
  await db.transaction("rw", [db.ops, db.fuelEntries], async () => {
    const ref = await db.ops.get(atc);
    if (!ref) throw new Error("Cet ATC n’est pas une référence Ops Spe officielle.");
    const existing = await db.fuelEntries.get(`ops:${atc}`);
    const previous = existing?.litres ?? valid(ref.importedFuel) ?? 0;
    const at = new Date().toISOString();
    await db.fuelEntries.put({
      id: `ops:${atc}`,
      atc,
      kind: "ops",
      litres: value,
      updatedBy: user,
      updatedAt: at,
      history: [...(existing?.history || []), { litres: value, previous, by: user, at }],
    });
  });
}
// Withdraw a correction: the file value applies again, history is kept.
export async function clearAtcFuel(atc: string) {
  const user = requireWrite();
  await db.transaction("rw", [db.ops, db.fuelEntries], async () => {
    const existing = await db.fuelEntries.get(`ops:${atc}`);
    if (!existing || existing.litres === null) return;
    const at = new Date().toISOString();
    await db.fuelEntries.put({
      ...existing,
      litres: null,
      updatedBy: user,
      updatedAt: at,
      history: [
        ...(existing.history || []),
        { litres: null, previous: existing.litres, by: user, at },
      ],
    });
  });
}
