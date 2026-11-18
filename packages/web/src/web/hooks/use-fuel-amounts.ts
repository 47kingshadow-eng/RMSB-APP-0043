import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Settings, type Transaction } from "../lib/database";
import { fuelByAtc } from "../lib/fuel-atc";

// Actual litres per ATC: Ops Spe Carburant column (or correction), Reverse Log versioned coefficient.
export function useFuelAmounts(rows: Transaction[], settings: Settings) {
  const refs = useLiveQuery(() => db.ops.toArray(), []);
  const entries = useLiveQuery(() => db.fuelEntries.toArray(), []);
  return useMemo(
    () => fuelByAtc(rows, refs || [], entries || [], settings),
    [rows, refs, entries, settings],
  );
}
