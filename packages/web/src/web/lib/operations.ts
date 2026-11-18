import {
  db,
  requireWrite,
  reservationSchema,
  settingAt,
  plusDays,
  type FuelReservation,
  type FuelOpening,
  type Transaction,
  type Settings,
  type OpsReference,
  type Plan,
} from "./database";

export const normalizeDUT = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
export function dutSummary(refs: OpsReference[], rows: Transaction[], from: string, to: string) {
  const dds = new Map(rows.map((r) => [r.atc, r]));
  const groups = new Map<
    string,
    { dut: string; atcs: string[]; matched: number; dates: string[] }
  >();
  const scoped = refs.filter((r) => {
    const date = dds.get(r.atc)?.exit.slice(0, 10) || r.date;
    return !date || (date >= from && date <= to);
  });
  for (const r of scoped) {
    const dut = normalizeDUT(r.dut || "");
    if (!dut) continue;
    const g = groups.get(dut) || { dut, atcs: [], matched: 0, dates: [] };
    g.atcs.push(r.atc);
    if (dds.has(r.atc)) g.matched++;
    const date = dds.get(r.atc)?.exit.slice(0, 10) || r.date;
    if (date) g.dates.push(date);
    groups.set(dut, g);
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.dut.localeCompare(b.dut)),
    references: scoped.length,
    matched: scoped.filter((r) => dds.has(r.atc)).length,
    missingDut: scoped.filter((r) => !normalizeDUT(r.dut || "")).length,
  };
}

export function sundayStart(date: string) {
  return plusDays(date, -new Date(date + "T12:00:00Z").getUTCDay());
}
export function monthWeekStart(month: string, week: number) {
  return `${month}-${String(1 + (week - 1) * 7).padStart(2, "0")}`;
}
export function monthWeeks(month: string) {
  const [year, m] = month.split("-").map(Number);
  return Math.ceil(new Date(Date.UTC(year, m, 0)).getUTCDate() / 7);
}
export function monthWeekEnd(month: string, week: number) {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(week * 7, last)).padStart(2, "0")}`;
}
export function monthWeekDays(month: string, week: number) {
  const first = 1 + (week - 1) * 7;
  const last = Number(monthWeekEnd(month, week).slice(8, 10));
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, i) => `${month}-${String(first + i).padStart(2, "0")}`,
  );
}
// Monthly blocks never overlap: W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–28, W5 = 29–end.
export function shiftMonthWeek(month: string, week: number, offset: number) {
  let [year, m] = month.split("-").map(Number);
  let w = week + offset;
  const key = () => `${year}-${String(m).padStart(2, "0")}`;
  while (w > monthWeeks(key())) {
    w -= monthWeeks(key());
    m += 1;
    if (m > 12) {
      m = 1;
      year += 1;
    }
  }
  while (w < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      year -= 1;
    }
    w += monthWeeks(key());
  }
  return { month: key(), week: w };
}
export function weekdayIndex(date: string) {
  return new Date(date + "T12:00:00Z").getUTCDay();
}
export function monthlyWeek(date: string) {
  return { month: date.slice(0, 7), week: Math.ceil(Number(date.slice(8, 10)) / 7) };
}
export function weeklyMetrics(plans: Plan[], rows: Transaction[], settings: Settings) {
  return plans.map((p) => ({
    date: p.date,
    comment: p.comment || "",
    products: (["pozzolana", "granite"] as const).map((field) => {
      const actual = rows.filter(
        (r) =>
          r.exit.slice(0, 10) === p.date &&
          r.product === (field === "pozzolana" ? "POUZZOLANE" : "GRANITE"),
      );
      const capacity = settingAt(
        settings,
        field === "pozzolana" ? "pozzolanaCapacity" : "graniteCapacity",
        p.date,
      );
      return {
        field,
        plannedRotations: p[field],
        actualRotations: actual.length,
        plannedTonnage: p[field] * capacity,
        actualTonnage: actual.reduce((s, r) => s + r.net, 0),
      };
    }),
  }));
}

export async function addReservation(
  input: Omit<FuelReservation, "id" | "createdBy" | "createdAt">,
  initial: number,
) {
  const user = requireWrite();
  const reservation = reservationSchema.parse({
    ...input,
    number: input.number.trim().toUpperCase(),
    id: crypto.randomUUID(),
    createdBy: user,
    createdAt: new Date().toISOString(),
  });
  if (!Number.isFinite(initial) || initial < 0) throw new Error("Stock initial invalide.");
  await db.transaction("rw", [db.reservations, db.fuelOpening], async () => {
    if (await db.reservations.where("number").equals(reservation.number).count())
      throw new Error("Ce numéro de réservation existe déjà.");
    const opening = await db.fuelOpening.get("main");
    if (opening && reservation.date < opening.date)
      throw new Error("La réservation ne peut pas précéder la date du stock initial.");
    if (!opening)
      await db.fuelOpening.put({ id: "main", date: reservation.date, quantity: initial });
    await db.reservations.add(reservation);
  });
}

// Updating or deleting a reservation does not change the once-entered opening
// stock. The ledger is derived from current reservations and recalculates FIFO.
export async function updateReservation(
  id: string,
  input: Omit<FuelReservation, "id" | "createdBy" | "createdAt">,
) {
  requireWrite();
  await db.transaction("rw", [db.reservations, db.fuelOpening], async () => {
    const current = await db.reservations.get(id);
    if (!current) throw new Error("Cette réservation n’existe plus.");
    const reservation = reservationSchema.parse({
      ...current,
      ...input,
      id: current.id,
      createdBy: current.createdBy,
      createdAt: current.createdAt,
      number: input.number.trim().toUpperCase(),
    });
    const duplicate = await db.reservations.where("number").equals(reservation.number).first();
    if (duplicate && duplicate.id !== id) throw new Error("Ce numéro de réservation existe déjà.");
    const opening = await db.fuelOpening.get("main");
    if (opening && Date.parse(reservation.date) < Date.parse(opening.date))
      throw new Error("La réservation ne peut pas précéder la date du stock initial.");
    await db.reservations.put(reservation);
  });
}

export async function deleteReservation(id: string) {
  requireWrite();
  await db.transaction("rw", db.reservations, async () => {
    if (!(await db.reservations.get(id))) throw new Error("Cette réservation n’existe plus.");
    await db.reservations.delete(id);
  });
}

export interface FuelLot {
  id: string;
  number: string;
  date: string;
  quantity: number;
  remaining: number;
  consumed: number;
  atcs: string[];
}
export interface FuelConsumption {
  atc: string;
  date: string;
  product: string;
  litres: number;
  allocations: { number: string; litres: number }[];
  uncovered: number;
}
// Pure chronological FIFO: no later deposit can cover an earlier exit; a split
// across lots is recorded explicitly, and each ATC is charged exactly once.
export function fuelLedger(
  reservations: FuelReservation[],
  opening: FuelOpening | null | undefined,
  rows: Pick<Transaction, "atc" | "exit" | "product" | "special">[],
  _settings: Settings,
  until = "9999-12-31T23:59:59Z",
  fuelAmounts: Map<string, number | null> = new Map(),
) {
  const sorted = reservations
    .filter((r) => Date.parse(r.date) <= Date.parse(until))
    .slice()
    .sort(
      (a, b) =>
        Date.parse(a.date) - Date.parse(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const lots: FuelLot[] = sorted.map((r) => ({
    id: r.id,
    number: r.number,
    date: r.date,
    quantity: r.quantity,
    remaining: r.quantity,
    consumed: 0,
    atcs: [],
  }));
  if (opening && Date.parse(opening.date) <= Date.parse(until))
    lots.unshift({
      id: "opening",
      number: "Stock initial",
      date: opening.date,
      quantity: opening.quantity,
      remaining: opening.quantity,
      consumed: 0,
      atcs: [],
    });
  lots.sort(
    (a, b) =>
      Date.parse(a.date) - Date.parse(b.date) ||
      (a.id === "opening" ? -1 : b.id === "opening" ? 1 : 0),
  );
  const seen = new Set<string>();
  const consumption: FuelConsumption[] = [];
  for (const t of rows
    .slice()
    .sort((a, b) => Date.parse(a.exit) - Date.parse(b.exit) || a.atc.localeCompare(b.atc))) {
    if (!t.special || Date.parse(t.exit) > Date.parse(until) || seen.has(t.atc)) continue;
    seen.add(t.atc);
    // Every Ops Spe trip is consumed, including those before the first lot
    // (then uncovered). Blank / missing litres count as 0 L.
    const litres = fuelAmounts.get(t.atc) ?? 0;
    let need = litres;
    const allocations: FuelConsumption["allocations"] = [];
    for (const lot of lots) {
      if (Date.parse(lot.date) >= Date.parse(t.exit) || lot.remaining <= 0 || need <= 0) continue;
      const used = Math.min(need, lot.remaining);
      lot.remaining -= used;
      lot.consumed += used;
      need -= used;
      if (!lot.atcs.includes(t.atc)) lot.atcs.push(t.atc);
      allocations.push({ number: lot.number, litres: used });
    }
    consumption.push({
      atc: t.atc,
      date: t.exit,
      product: t.product,
      litres,
      allocations,
      uncovered: Math.max(0, need),
    });
  }
  const reserved = sorted.reduce((s, r) => s + r.quantity, 0);
  const initial = lots.find((l) => l.id === "opening")?.quantity || 0;
  const consumed = consumption.reduce((s, r) => s + r.litres, 0);
  return {
    lots,
    consumption,
    reserved,
    initial,
    consumed,
    balance: reserved + initial - consumed,
    uncovered: consumption.reduce((s, r) => s + r.uncovered, 0),
    count: sorted.length,
  };
}

export interface ReservationTheory {
  pozzolanaLitres: number | null;
  graniteLitres: number | null;
  // Planned: rotations entered on the reservation × its own litres per trip.
  plannedPozzolana: number;
  plannedGranite: number;
  planned: number;
  // Realised: trips actually charged to this reservation (first FIFO lot, or the
  // reservation in force at the exit when uncovered) × its own litres per trip.
  tripsPozzolana: number;
  tripsGranite: number;
  realisedTheory: number;
  consumed: number;
  gap: number;
  configured: boolean;
}
// Indicative only: the real stock movement stays the FIFO consumption. Each
// reservation keeps its own L/trip, so later changes never alter history.
export function reservationTheory(
  reservations: FuelReservation[],
  ledger: { lots: FuelLot[]; consumption: FuelConsumption[] },
) {
  const byNumber = new Map(ledger.lots.map((l) => [l.number, l]));
  const lots = ledger.lots
    .filter((l) => l.id !== "opening")
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const trips = new Map<string, { pozzolana: number; granite: number }>();
  for (const c of ledger.consumption) {
    let lot = c.allocations.length ? byNumber.get(c.allocations[0].number) : undefined;
    if (!lot || lot.id === "opening") {
      if (c.allocations.length && lot?.id === "opening") continue;
      lot = lots.filter((l) => Date.parse(l.date) < Date.parse(c.date)).slice(-1)[0];
    }
    if (!lot) continue;
    const t = trips.get(lot.id) || { pozzolana: 0, granite: 0 };
    if (c.product === "GRANITE") t.granite++;
    else t.pozzolana++;
    trips.set(lot.id, t);
  }
  const result = new Map<string, ReservationTheory>();
  for (const r of reservations) {
    const pl = r.pozzolanaLitres ?? null;
    const gl = r.graniteLitres ?? null;
    const t = trips.get(r.id) || { pozzolana: 0, granite: 0 };
    const plannedPozzolana = r.pozzolana * (pl || 0);
    const plannedGranite = r.granite * (gl || 0);
    const realisedTheory = t.pozzolana * (pl || 0) + t.granite * (gl || 0);
    const consumed = ledger.lots.find((l) => l.id === r.id)?.consumed || 0;
    result.set(r.id, {
      pozzolanaLitres: pl,
      graniteLitres: gl,
      plannedPozzolana,
      plannedGranite,
      planned: plannedPozzolana + plannedGranite,
      tripsPozzolana: t.pozzolana,
      tripsGranite: t.granite,
      realisedTheory,
      consumed,
      gap: consumed - realisedTheory,
      configured: pl !== null || gl !== null,
    });
  }
  return result;
}
