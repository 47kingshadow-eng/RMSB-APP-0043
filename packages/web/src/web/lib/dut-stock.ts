import {
  db,
  requireWrite,
  dutReceiptSchema,
  dutOpeningSchema,
  type DutReceipt,
  type DutOpening,
  type OpsReference,
  type Transaction,
} from "./database";
import { normalizeDUT } from "./operations";

type ReceiptInput = Pick<DutReceipt, "date" | "quantity" | "comment">;
export async function saveDutReceipt(input: ReceiptInput, initial: number, id?: string) {
  const user = requireWrite();
  await db.transaction("rw", [db.dutReceipts, db.dutOpening], async () => {
    const current = id ? await db.dutReceipts.get(id) : undefined;
    if (id && !current) throw new Error("Cette réception n’existe plus.");
    const receipt = dutReceiptSchema.parse({
      ...input,
      id: current?.id || crypto.randomUUID(),
      createdBy: current?.createdBy || user,
      createdAt: current?.createdAt || new Date().toISOString(),
    });
    const opening = await db.dutOpening.get("main");
    if (opening && receipt.date < opening.date)
      throw new Error("La réception ne peut pas précéder la date du stock initial.");
    if (!opening)
      await db.dutOpening.put(
        dutOpeningSchema.parse({ id: "main", date: receipt.date, quantity: initial }),
      );
    await db.dutReceipts.put(receipt);
  });
}
export async function deleteDutReceipt(id: string) {
  requireWrite();
  await db.transaction("rw", db.dutReceipts, async () => {
    if (!(await db.dutReceipts.get(id))) throw new Error("Cette réception n’existe plus.");
    await db.dutReceipts.delete(id);
  });
}

// A physical sheet is used once globally, at its first known use date, not once
// per reporting period or per linked ATC. Undated DUTs cannot be placed in stock.
export function dutStockLedger(
  receipts: DutReceipt[],
  opening: DutOpening | undefined | null,
  refs: OpsReference[],
  rows: Transaction[],
  until = "9999-12-31",
) {
  const dds = new Map(rows.map((r) => [r.atc, r]));
  const unique = new Map<string, { dut: string; date: string; atcs: string[] }>();
  for (const r of refs) {
    const dut = normalizeDUT(r.dut || "");
    if (!dut) continue;
    const rawDate = dds.get(r.atc)?.exit.slice(0, 10) || r.date?.slice(0, 10) || "";
    const date =
      /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(rawDate)) ? rawDate : "";
    const entry = unique.get(dut) || { dut, date: "", atcs: [] };
    if (date && (!entry.date || date < entry.date)) entry.date = date;
    if (!entry.atcs.includes(r.atc)) entry.atcs.push(r.atc);
    unique.set(dut, entry);
  }
  const all = [...unique.values()];
  const unknown = all.filter((r) => !r.date);
  const eligible = opening
    ? all
        .filter((r) => r.date && r.date >= opening.date)
        .sort((a, b) => a.date.localeCompare(b.date) || a.dut.localeCompare(b.dut))
    : [];
  const usage = eligible.filter((r) => r.date <= until);
  const sorted = receipts
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  let receivedBefore = 0;
  const history = sorted.map((r) => {
    const usedBefore = eligible.filter((u) => u.date < r.date).length;
    const before = (opening?.quantity || 0) + receivedBefore - usedBefore;
    receivedBefore += r.quantity;
    return { ...r, before, after: before + r.quantity };
  });
  const active = !!opening && opening.date <= until;
  const initial = active ? opening.quantity : 0;
  const received = sorted.filter((r) => r.date <= until).reduce((s, r) => s + r.quantity, 0);
  const available = initial + received - usage.length;
  const events = [
    ...sorted
      .filter((r) => r.date <= until)
      .map((r) => ({ date: r.date, change: r.quantity, order: 0 })),
    ...usage.map((r) => ({ date: r.date, change: -1, order: 1 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let balance = initial,
    lowest = initial;
  for (const e of events) {
    balance += e.change;
    lowest = Math.min(lowest, balance);
  }
  return {
    history,
    usage,
    unknown,
    initial,
    received,
    used: usage.length,
    available,
    historicalDeficit: Math.max(0, -lowest),
    excludedBeforeStart: opening ? all.filter((r) => r.date && r.date < opening.date).length : 0,
  };
}
