import Dexie, { type Table } from "dexie";
import { create } from "zustand";
import { z } from "zod";

export const products = ["POUZZOLANE", "GRANITE"] as const;
export type Product = (typeof products)[number];
export type Category = "Reverse Logistics" | "Opérations Spéciales" | "3rd Party";
export type Role = "ADMIN" | "SUPERVISER" | "CONSULTANT";
export interface Transaction {
  atc: string;
  entry: string;
  exit: string;
  truck: string;
  product: Product;
  driver: string;
  sender: string;
  receiver: string;
  transporter: string;
  tare: number;
  gross: number;
  net: number;
  special: boolean;
  assignedAt: string;
  assignedBy: string;
  comment: string;
  importedAt: string;
  importIds?: string[];
}
export interface Plan {
  date: string;
  pozzolana: number;
  granite: number;
  comment?: string;
}
export interface Settings {
  id: string;
  pozzolanaCapacity: number;
  graniteCapacity: number;
  pozzolanaFuel: number;
  graniteFuel: number;
  pozzolanaDistance: number;
  graniteDistance: number;
  organization: string;
  dutPrice: number;
  dutCurrency: string;
  reverseFuel?: number;
  history?: SettingsVersion[];
}
export const versionedKeys = [
  "pozzolanaCapacity",
  "graniteCapacity",
  "pozzolanaFuel",
  "graniteFuel",
  "pozzolanaDistance",
  "graniteDistance",
  "dutPrice",
  "reverseFuel",
] as const;
export type VersionedKey = (typeof versionedKeys)[number];
export const versionedLabels: Record<VersionedKey, string> = {
  pozzolanaCapacity: "Capacité Pouzzolane (t)",
  graniteCapacity: "Capacité Granite (t)",
  pozzolanaFuel: "Carburant prévisionnel Pouzzolane (L/voyage)",
  graniteFuel: "Carburant prévisionnel Granite (L/voyage)",
  pozzolanaDistance: "Distance Pouzzolane (km)",
  graniteDistance: "Distance Granite (km)",
  dutPrice: "Prix unitaire DUT",
  reverseFuel: "Carburant Reverse Log (L/voyage)",
};
// A version only carries the parameters changed at its effective date. Each
// parameter resolves independently to the latest version in force at a date.
export interface SettingsVersion {
  id: string;
  effectiveDate: string;
  createdAt: string;
  createdBy: string;
  values: Partial<Record<VersionedKey, number>>;
  base?: boolean;
}
export interface OpsImportRow {
  importId: string;
  atc: string;
  dut?: string;
  importedFuel?: number | null;
  date: string;
  filename: string;
  importedAt: string;
  importedBy: string;
}
export interface User {
  name: Role;
  hash: string;
  salt: string;
}
export interface ImportLog {
  id: string;
  filename: string;
  opsFilename?: string;
  opsCount?: number;
  date: string;
  accepted: number;
  duplicates: number;
  rejected: number;
  user: string;
  ddsDeleted?: boolean;
  opsDeleted?: boolean;
  legacy?: boolean;
}
export interface OpsReference {
  atc: string;
  dut?: string;
  importedFuel?: number | null;
  date: string;
  filename: string;
  importedAt: string;
  importedBy: string;
}
export interface FuelReservation {
  id: string;
  number: string;
  date: string;
  quantity: number;
  pozzolana: number;
  granite: number;
  comment: string;
  createdBy: string;
  createdAt: string;
  pozzolanaLitres?: number | null;
  graniteLitres?: number | null;
}
export interface FuelOpening {
  id: "main";
  date: string;
  quantity: number;
}
export interface DutReceipt {
  id: string;
  date: string;
  quantity: number;
  comment: string;
  createdBy: string;
  createdAt: string;
}
export interface DutOpening {
  id: "main";
  date: string;
  quantity: number;
}
export interface FuelChange {
  litres: number | null;
  previous: number | null;
  by: string;
  at: string;
}
// Manual Ops Spe correction per ATC. litres = null means the correction was
// withdrawn (file value applies again) while its audit trail is kept.
export interface FuelEntry {
  id: string;
  atc: string;
  kind: "ops" | "reverse";
  litres: number | null;
  updatedBy: string;
  updatedAt: string;
  history?: FuelChange[];
}
class LocalDB extends Dexie {
  transactions!: Table<Transaction, string>;
  ops!: Table<OpsReference, string>;
  plans!: Table<Plan, string>;
  settings!: Table<Settings, string>;
  users!: Table<User, string>;
  imports!: Table<ImportLog, string>;
  reservations!: Table<FuelReservation, string>;
  fuelOpening!: Table<FuelOpening, string>;
  dutReceipts!: Table<DutReceipt, string>;
  dutOpening!: Table<DutOpening, string>;
  fuelEntries!: Table<FuelEntry, string>;
  settingsHistory!: Table<SettingsVersion, string>;
  opsImportRows!: Table<OpsImportRow, [string, string]>;
  constructor() {
    super("RM-SB");
    this.version(1).stores({
      transactions: "&atc, exit, product, transporter",
      plans: "&date",
      settings: "&id",
      users: "&name",
      imports: "&id,date",
    });
    this.version(2)
      .stores({ ops: "&atc,date" })
      .upgrade(async (tx) => {
        await tx.table("transactions").toCollection().modify({
          special: false,
          assignedAt: "",
          assignedBy: "",
          comment: "",
        });
      });
    this.version(3)
      .stores({ reservations: "&id,&number,date", fuelOpening: "&id" })
      .upgrade(async (tx) => {
        await tx
          .table("ops")
          .toCollection()
          .modify((r) => {
            r.dut = r.dut || "";
          });
        await tx
          .table("plans")
          .toCollection()
          .modify((p) => {
            p.comment = p.comment || "";
          });
        await tx
          .table("settings")
          .toCollection()
          .modify((s) => {
            s.dutPrice = s.dutPrice ?? 2500;
            s.dutCurrency = s.dutCurrency || "FCFA";
          });
      });
    this.version(4).stores({ dutReceipts: "&id,date", dutOpening: "&id" });
    this.version(5).stores({ fuelEntries: "&id,atc,kind" });
    this.version(6)
      .stores({
        transactions: "&atc, exit, product, transporter, *importIds",
        settingsHistory: "&id,effectiveDate",
        opsImportRows: "&[importId+atc],importId,atc",
      })
      .upgrade(async (tx) => {
        const main = (await tx.table("settings").get("main")) as Settings | undefined;
        if (!(await tx.table("settingsHistory").count()))
          await tx.table("settingsHistory").put(baseVersion(main || defaults));
        if (main) await tx.table("settings").put({ ...main, reverseFuel: main.reverseFuel ?? 50 });
        await tx
          .table("fuelEntries")
          .toCollection()
          .modify((e: FuelEntry) => {
            e.history = e.history || [
              { litres: e.litres, previous: null, by: e.updatedBy, at: e.updatedAt },
            ];
          });
        await backfillProvenance(
          tx.table("transactions"),
          tx.table("ops"),
          tx.table("imports"),
          tx.table("opsImportRows"),
        );
      });
  }
}
export const db = new LocalDB();
export const defaults: Settings = {
  id: "main",
  pozzolanaCapacity: 50,
  graniteCapacity: 50,
  pozzolanaFuel: 200,
  graniteFuel: 182,
  pozzolanaDistance: 400,
  graniteDistance: 364,
  organization: "Raw Material STOCK BUILDING",
  dutPrice: 2500,
  dutCurrency: "FCFA",
  reverseFuel: 50,
};
export function baseVersion(s: Settings): SettingsVersion {
  return {
    id: "base",
    effectiveDate: "1900-01-01",
    createdAt: new Date().toISOString(),
    createdBy: "Migration v1.6",
    base: true,
    values: Object.fromEntries(
      versionedKeys.map((k) => [k, k === "reverseFuel" ? (s.reverseFuel ?? 50) : s[k]]),
    ) as Record<VersionedKey, number>,
  };
}
// Legacy provenance (pre-v1.6): each record is assigned to the first import
// logged at or after its own importedAt. Approximate for older imports.
export async function backfillProvenance(
  transactions: Table<Transaction, string>,
  ops: Table<OpsReference, string>,
  imports: Table<ImportLog, string>,
  rowsTable: Table<OpsImportRow, [string, string]>,
) {
  const logs = (await imports.toArray()).sort((a, b) => a.date.localeCompare(b.date));
  if (!logs.length) return;
  const touched = new Set<string>();
  const after = (iso: string, filter: (l: ImportLog) => boolean = () => true) =>
    logs.find((l) => filter(l) && l.date >= iso) || logs.filter(filter).slice(-1)[0];
  await transactions.toCollection().modify((t) => {
    if (t.importIds?.length) return;
    const log = after(t.importedAt);
    t.importIds = log ? [log.id] : [];
    if (log) touched.add(log.id);
  });
  const known = new Set((await rowsTable.toArray()).map((r) => r.atc));
  for (const r of await ops.toArray()) {
    if (known.has(r.atc)) continue;
    const log = after(r.importedAt, (l) => l.opsFilename === r.filename) || after(r.importedAt);
    if (!log) continue;
    touched.add(log.id);
    await rowsTable.put({ ...r, importId: log.id });
  }
  for (const id of touched) await imports.update(id, { legacy: true });
}
const historyCache = new WeakMap<SettingsVersion[], SettingsVersion[]>();
function sortedHistory(history: SettingsVersion[]) {
  let sorted = historyCache.get(history);
  if (!sorted) {
    sorted = history
      .slice()
      .sort(
        (a, b) =>
          a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt),
      );
    historyCache.set(history, sorted);
  }
  return sorted;
}
// Version in force at an operation date: latest effective date <= date (ties:
// latest creation). Before the first version, the earliest one applies.
export function settingAt(settings: Settings, key: VersionedKey, date: string): number {
  const day = date.slice(0, 10);
  const sorted = sortedHistory(settings.history || []);
  let found: number | undefined;
  let earliest: number | undefined;
  for (const v of sorted) {
    const value = v.values[key];
    if (value === undefined) continue;
    if (earliest === undefined) earliest = value;
    if (v.effectiveDate <= day) found = value;
    else break;
  }
  return (
    found ?? earliest ?? (key === "reverseFuel" ? (settings.reverseFuel ?? 50) : settings[key])
  );
}
export function settingsAt(settings: Settings, date: string): Settings & { reverseFuel: number } {
  const resolved = { ...settings, reverseFuel: settings.reverseFuel ?? 50 };
  for (const k of versionedKeys) resolved[k] = settingAt(settings, k, date);
  return resolved;
}
export function versionFor(settings: Settings, key: VersionedKey, date: string) {
  const day = date.slice(0, 10);
  const sorted = sortedHistory(settings.history || []).filter((v) => v.values[key] !== undefined);
  return sorted.filter((v) => v.effectiveDate <= day).slice(-1)[0] || sorted[0];
}
export async function addSettingsVersion(
  effectiveDate: string,
  values: Partial<Record<VersionedKey, number>>,
) {
  const user = requireWrite(true);
  if (!dateSchema.safeParse(effectiveDate).success) throw new Error("Date d’effet invalide.");
  const parsed = z.record(z.string(), nonnegative).parse(values);
  if (!Object.keys(parsed).length) throw new Error("Aucune valeur modifiée à cette date d’effet.");
  if (
    (parsed.pozzolanaCapacity !== undefined && parsed.pozzolanaCapacity <= 0) ||
    (parsed.graniteCapacity !== undefined && parsed.graniteCapacity <= 0)
  )
    throw new Error("La capacité doit être supérieure à 0.");
  const version: SettingsVersion = {
    id: crypto.randomUUID(),
    effectiveDate,
    createdAt: new Date().toISOString(),
    createdBy: user,
    values: parsed as SettingsVersion["values"],
  };
  await db.transaction("rw", [db.settingsHistory, db.settings], async () => {
    await db.settingsHistory.add(version);
    await syncMainSettings();
  });
  return version;
}
export async function deleteSettingsVersion(id: string) {
  requireWrite(true);
  await db.transaction("rw", [db.settingsHistory, db.settings], async () => {
    const v = await db.settingsHistory.get(id);
    if (!v) throw new Error("Cette version n’existe plus.");
    if (v.base) throw new Error("La version de base ne peut pas être supprimée.");
    await db.settingsHistory.delete(id);
    await syncMainSettings();
  });
}
// settings.main mirrors the values in force today, for compatibility.
async function syncMainSettings() {
  const main = (await db.settings.get("main")) || defaults;
  const history = await db.settingsHistory.toArray();
  const today = settingsAt({ ...main, history }, dateISO(new Date()));
  delete today.history;
  await db.settings.put(today);
}
export async function initialize() {
  if (!(await db.settings.get("main"))) await db.settings.put(defaults);
  if (!(await db.settingsHistory.count()))
    await db.settingsHistory.put(baseVersion((await db.settings.get("main")) || defaults));
  const hashes = {
    ADMIN: "deeb3217bce2878fec62a750ff7d9afff4981dbe158302730cbedafd394710f9",
    SUPERVISER: "c962136f364e1f6c2a33ae4b6eaa26ea8aba7e1ac478faa2be450ffa5559d72f",
    CONSULTANT: "beb6ec0d43a379abca54b4316a20cb1643d0ffaace67ec6bc6204dcd1433725a",
  };
  await db.transaction("rw", db.users, async () => {
    for (const name of Object.keys(hashes) as Role[])
      if (!(await db.users.get(name)))
        await db.users.put({ name, hash: hashes[name], salt: "rmsb-" + name });
  });
}
export async function passwordHash(password: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
interface SessionState {
  user: Role | null;
  login: (user: Role, password: string) => Promise<void>;
  logout: () => void;
}
const stored = sessionStorage.getItem("rmsb-user");
export const useSession = create<SessionState>((set) => ({
  user: ["ADMIN", "SUPERVISER", "CONSULTANT"].includes(stored || "") ? (stored as Role) : null,
  login: async (name, password) => {
    const user = await db.users.get(name);
    if (!user || user.hash !== (await passwordHash(password, user.salt)))
      throw new Error("Identifiant ou mot de passe incorrect.");
    sessionStorage.setItem("rmsb-user", name);
    set({ user: name });
  },
  logout: () => {
    sessionStorage.removeItem("rmsb-user");
    set({ user: null });
  },
}));
export function requireWrite(admin = false) {
  const user = useSession.getState().user;
  if (!user || user === "CONSULTANT" || (admin && user !== "ADMIN"))
    throw new Error("Votre profil ne permet pas cette modification.");
  return user;
}
export async function resetImports() {
  requireWrite(true);
  await db.transaction("rw", [db.transactions, db.ops, db.imports, db.opsImportRows], async () => {
    await db.transactions.clear();
    await db.ops.clear();
    await db.imports.clear();
    await db.opsImportRows.clear();
  });
}
export async function resetFuelStock() {
  requireWrite(true);
  await db.transaction("rw", [db.reservations, db.fuelOpening], async () => {
    await db.reservations.clear();
    await db.fuelOpening.clear();
  });
}
export function category(t: Transaction): Category {
  return t.special
    ? "Opérations Spéciales"
    : t.transporter.trim().toUpperCase() === "DANTRANS"
      ? "Reverse Logistics"
      : "3rd Party";
}
export async function reclassify() {
  const references = new Map((await db.ops.toArray()).map((r) => [r.atc, r]));
  await db.transactions.toCollection().modify((t) => {
    const ref = references.get(t.atc);
    t.special = !!ref;
    t.assignedAt = ref?.importedAt || "";
    t.assignedBy = ref ? "Automatique — " + ref.importedBy : "";
    t.comment = ref ? "ATC présent dans N° ATC WB — " + ref.filename : "";
  });
}
export const fmt = (n: number, digits = 0) =>
  n
    .toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .replace(/[  ]/g, " ");
export const day = (iso: string) => iso.slice(0, 10);
export const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
export function dateISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function plusDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return dateISO(d);
}
export function weekStart(date: string) {
  const d = new Date(date + "T12:00:00");
  return plusDays(date, -((d.getDay() + 6) % 7));
}
export function isoWeek(date: string) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const year = d.getFullYear();
  const first = new Date(year, 0, 4, 12);
  return { year, week: 1 + Math.round((d.getTime() - first.getTime()) / 604800000) };
}
export function weekDate(year: number, week: number) {
  return plusDays(weekStart(`${year}-01-04`), (week - 1) * 7);
}
export function tripDistance(t: Transaction, settings: Settings) {
  if (category(t) === "3rd Party") return 0;
  return settingAt(
    settings,
    t.product === "POUZZOLANE" ? "pozzolanaDistance" : "graniteDistance",
    t.exit,
  );
}
export function totals(
  rows: Transaction[],
  settings: Settings,
  fuelAmounts: Map<string, number | null> = new Map(),
) {
  return {
    tonnage: rows.reduce((s, t) => s + t.net, 0),
    trips: rows.length,
    // Actual fuel only: Ops Spe litres + Reverse Log coefficient per ATC. 3rd Party never counted.
    fuel: rows.reduce(
      (s, t) => s + (category(t) === "3rd Party" ? 0 : fuelAmounts.get(t.atc) || 0),
      0,
    ),
    // Distance = Reverse Log + Ops Spe only, with the distance in force at each exit date.
    distance: rows.reduce((s, t) => s + tripDistance(t, settings), 0),
  };
}
export function planned(plans: Plan[], settings: Settings, product?: Product) {
  return plans.reduce(
    (s, p) =>
      s +
      (product === "GRANITE" ? 0 : p.pozzolana * settingAt(settings, "pozzolanaCapacity", p.date)) +
      (product === "POUZZOLANE" ? 0 : p.granite * settingAt(settings, "graniteCapacity", p.date)),
    0,
  );
}
export const rateColor = (rate: number) => (rate < 50 ? "red" : rate < 90 ? "orange" : "green");
const nonnegative = z.number().finite().nonnegative();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !Number.isNaN(Date.parse(s + "T12:00:00")) && dateISO(new Date(s + "T12:00:00")) === s,
  );
const timestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Date invalide");
export const transactionSchema = z
  .object({
    atc: z.string().trim().min(1),
    entry: timestamp,
    exit: timestamp,
    truck: z.string().trim().min(1),
    product: z.enum(products),
    driver: z.string(),
    sender: z.string(),
    receiver: z.string(),
    transporter: z.string().trim().min(1),
    tare: nonnegative,
    gross: nonnegative,
    net: z.number().finite().positive(),
    special: z.boolean(),
    assignedAt: z.string(),
    assignedBy: z.string(),
    comment: z.string(),
    importedAt: timestamp,
    importIds: z.array(z.string()).default([]),
  })
  .refine(
    (t) => t.gross >= t.tare && Math.abs(t.gross - t.tare - t.net) <= 0.02,
    "Poids incohérents",
  );
export const settingsSchema = z.object({
  id: z.literal("main"),
  pozzolanaCapacity: z.number().positive(),
  graniteCapacity: z.number().positive(),
  pozzolanaFuel: nonnegative,
  graniteFuel: nonnegative,
  pozzolanaDistance: nonnegative,
  graniteDistance: nonnegative,
  organization: z.string().min(1),
  dutPrice: nonnegative.default(2500),
  dutCurrency: z.string().trim().min(1).default("FCFA"),
  reverseFuel: nonnegative.default(50),
});
export const reservationSchema = z.object({
  id: z.string().min(1),
  number: z.string().trim().min(1),
  date: timestamp,
  quantity: z.number().finite().positive(),
  pozzolana: nonnegative.int(),
  granite: nonnegative.int(),
  comment: z.string(),
  createdBy: z.string(),
  createdAt: timestamp,
  pozzolanaLitres: nonnegative.nullable().default(null),
  graniteLitres: nonnegative.nullable().default(null),
});
const fuelOpeningSchema = z.object({
  id: z.literal("main"),
  date: timestamp,
  quantity: nonnegative,
});
export const dutReceiptSchema = z.object({
  id: z.string().min(1),
  date: dateSchema,
  quantity: z.number().int().positive().safe(),
  comment: z.string(),
  createdBy: z.string(),
  createdAt: timestamp,
});
export const dutOpeningSchema = z.object({
  id: z.literal("main"),
  date: dateSchema,
  quantity: nonnegative.int().safe(),
});
export const fuelEntrySchema = z
  .object({
    id: z.string().min(1),
    atc: z.string().min(1),
    kind: z.enum(["ops", "reverse"]),
    litres: nonnegative.nullable(),
    updatedBy: z.string(),
    updatedAt: timestamp,
    history: z
      .array(
        z.object({
          litres: nonnegative.nullable(),
          previous: nonnegative.nullable(),
          by: z.string(),
          at: z.string(),
        }),
      )
      .default([]),
  })
  .refine((r) => r.id === `${r.kind}:${r.atc}`, "Clé litrage invalide");
export const backupSchema = z.object({
  version: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  settingsHistory: z
    .array(
      z.object({
        id: z.string().min(1),
        effectiveDate: dateSchema.or(z.literal("1900-01-01")),
        createdAt: z.string(),
        createdBy: z.string(),
        values: z.record(z.enum(versionedKeys), nonnegative),
        base: z.boolean().optional(),
      }),
    )
    .default([]),
  opsImportRows: z
    .array(
      z.object({
        importId: z.string().min(1),
        atc: z.string().trim().min(1),
        dut: z.string().default(""),
        importedFuel: nonnegative.nullable().default(null),
        date: z.string(),
        filename: z.string(),
        importedAt: timestamp,
        importedBy: z.string(),
      }),
    )
    .default([]),
  fuelEntries: z.array(fuelEntrySchema).default([]),
  dutReceipts: z.array(dutReceiptSchema).default([]),
  dutOpening: dutOpeningSchema.nullable().default(null),
  reservations: z.array(reservationSchema).default([]),
  fuelOpening: fuelOpeningSchema.nullable().default(null),
  ops: z
    .array(
      z.object({
        atc: z.string().trim().min(1),
        dut: z.string().default(""),
        importedFuel: nonnegative.nullable().default(null),
        date: z.string(),
        filename: z.string(),
        importedAt: timestamp,
        importedBy: z.string(),
      }),
    )
    .default([]),
  transactions: z.array(transactionSchema),
  plans: z.array(
    z.object({
      date: dateSchema,
      pozzolana: nonnegative.int(),
      granite: nonnegative.int(),
      comment: z.string().default(""),
    }),
  ),
  settings: settingsSchema,
  users: z.array(
    z.object({
      name: z.enum(["ADMIN", "SUPERVISER", "CONSULTANT"]),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      salt: z.string().min(1),
    }),
  ),
  imports: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      opsFilename: z.string().optional(),
      opsCount: nonnegative.int().optional(),
      date: timestamp,
      accepted: nonnegative.int(),
      duplicates: nonnegative.int(),
      rejected: nonnegative.int(),
      user: z.string(),
      ddsDeleted: z.boolean().optional(),
      opsDeleted: z.boolean().optional(),
      legacy: z.boolean().optional(),
    }),
  ),
});
function mainOnly(s: Settings): Settings {
  const copy = { ...s };
  delete copy.history;
  return copy;
}
export async function snapshot() {
  return {
    version: 6 as const,
    settingsHistory: await db.settingsHistory.toArray(),
    opsImportRows: await db.opsImportRows.toArray(),
    fuelEntries: await db.fuelEntries.toArray(),
    dutReceipts: await db.dutReceipts.toArray(),
    dutOpening: (await db.dutOpening.get("main")) || null,
    reservations: await db.reservations.toArray(),
    fuelOpening: (await db.fuelOpening.get("main")) || null,
    ops: await db.ops.toArray(),
    transactions: await db.transactions.toArray(),
    plans: await db.plans.toArray(),
    settings: mainOnly((await db.settings.get("main")) || defaults),
    users: await db.users.toArray(),
    imports: await db.imports.toArray(),
  };
}
export async function restoreBackup(input: unknown) {
  requireWrite(true);
  const backup = backupSchema.parse(input);
  await db.transaction(
    "rw",
    [
      db.transactions,
      db.plans,
      db.settings,
      db.users,
      db.imports,
      db.ops,
      db.reservations,
      db.fuelOpening,
      db.dutReceipts,
      db.dutOpening,
      db.fuelEntries,
      db.settingsHistory,
      db.opsImportRows,
    ],
    async () => {
      for (const t of backup.transactions)
        if (!t.importIds.length) t.importIds = (await db.transactions.get(t.atc))?.importIds || [];
      await db.transactions.bulkPut(backup.transactions);
      if (backup.version < 3) {
        for (const r of backup.ops) r.dut = (await db.ops.get(r.atc))?.dut || r.dut;
        for (const p of backup.plans)
          p.comment = (await db.plans.get(p.date))?.comment || p.comment;
        const current = await db.settings.get("main");
        backup.settings.dutPrice = current?.dutPrice ?? backup.settings.dutPrice;
        backup.settings.dutCurrency = current?.dutCurrency || backup.settings.dutCurrency;
      }
      if (backup.version < 5) {
        for (const r of backup.ops)
          r.importedFuel = (await db.ops.get(r.atc))?.importedFuel ?? r.importedFuel;
      }
      await db.ops.bulkPut(backup.ops);
      await reclassify();
      await db.plans.bulkPut(backup.plans);
      if (backup.version >= 6 && backup.settingsHistory.length) {
        await db.settingsHistory.clear();
        await db.settingsHistory.bulkPut(backup.settingsHistory);
      } else {
        // Legacy backup: its settings become the base version for all history.
        await db.settingsHistory.clear();
        await db.settingsHistory.put(baseVersion(backup.settings));
      }
      await db.settings.put(mainOnly(backup.settings));
      await db.users.bulkPut(backup.users);
      await db.imports.bulkPut(backup.imports);
      await db.reservations.bulkPut(backup.reservations);
      if (backup.fuelOpening) await db.fuelOpening.put(backup.fuelOpening);
      await db.dutReceipts.bulkPut(backup.dutReceipts);
      if (backup.dutOpening) await db.dutOpening.put(backup.dutOpening);
      await db.fuelEntries.bulkPut(
        backup.fuelEntries.map((e) => ({
          ...e,
          history: e.history.length
            ? e.history
            : [{ litres: e.litres, previous: null, by: e.updatedBy, at: e.updatedAt }],
        })),
      );
      await db.opsImportRows.bulkPut(backup.opsImportRows);
      await backfillProvenance(db.transactions, db.ops, db.imports, db.opsImportRows);
    },
  );
  await syncMainSettings();
  return backup.transactions.length;
}

// Removes only what came from one import. DDS: the import id is removed from
// each transaction; transactions left without any import are deleted. Ops Spe:
// the import's rows are removed and each affected reference is rebuilt from
// the remaining imports (or deleted). Manual fuel corrections are kept.
export async function deleteImport(id: string, part: "dds" | "ops" | "all") {
  requireWrite();
  await db.transaction("rw", [db.transactions, db.ops, db.imports, db.opsImportRows], async () => {
    const log = await db.imports.get(id);
    if (!log) throw new Error("Cet import n’existe plus.");
    const dds = part !== "ops" && !log.ddsDeleted;
    const ops = part !== "dds" && !log.opsDeleted;
    if (dds) {
      const linked = await db.transactions.where("importIds").equals(id).toArray();
      for (const t of linked) {
        const ids = (t.importIds || []).filter((v) => v !== id);
        if (ids.length) await db.transactions.update(t.atc, { importIds: ids });
        else await db.transactions.delete(t.atc);
      }
    }
    if (ops) {
      const rows = await db.opsImportRows.where("importId").equals(id).toArray();
      await db.opsImportRows.where("importId").equals(id).delete();
      for (const atc of new Set(rows.map((r) => r.atc))) {
        const remaining = (await db.opsImportRows.where("atc").equals(atc).toArray()).sort((a, b) =>
          a.importedAt.localeCompare(b.importedAt),
        );
        if (!remaining.length) {
          await db.ops.delete(atc);
          continue;
        }
        const first = remaining[0];
        const merged: OpsReference = {
          atc,
          dut: "",
          importedFuel: null,
          date: first.date,
          filename: first.filename,
          importedAt: first.importedAt,
          importedBy: first.importedBy,
        };
        for (const r of remaining) {
          if (r.dut) merged.dut = r.dut;
          if (r.importedFuel !== undefined && r.importedFuel !== null)
            merged.importedFuel = r.importedFuel;
          if (r.date) merged.date = merged.date || r.date;
        }
        await db.ops.put(merged);
      }
    }
    await reclassify();
    const ddsDeleted = log.ddsDeleted || part !== "ops";
    const opsDeleted = log.opsDeleted || part !== "dds";
    if (ddsDeleted && opsDeleted) await db.imports.delete(id);
    else await db.imports.update(id, { ddsDeleted, opsDeleted });
  });
}
