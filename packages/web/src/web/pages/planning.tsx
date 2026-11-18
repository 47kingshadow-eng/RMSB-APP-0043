import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Save, Download, ChevronLeft, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { type PageProps, Panel, Badge } from "../components/shared";
import { db, requireWrite, fmt, rateColor, shortDate, settingAt, type Plan } from "../lib/database";
import {
  monthWeekDays,
  monthWeekEnd,
  monthWeekStart,
  monthWeeks,
  monthlyWeek,
  shiftMonthWeek,
  weekdayIndex,
  weeklyMetrics,
} from "../lib/operations";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const group = (date: string) =>
  weekdayIndex(date) <= 3 ? "Rest of the week" : "From weekend to Monday";
const weekend = (date: string) => [0, 6].includes(weekdayIndex(date));
// Contiguous rows sharing the same weekday group are merged in the left column.
function blocks(dates: string[]) {
  const out: { index: number; span: number; label: string }[] = [];
  dates.forEach((d, i) => {
    const last = out[out.length - 1];
    if (last && last.label === group(d) && last.index + last.span === i) last.span += 1;
    else out.push({ index: i, span: 1, label: group(d) });
  });
  return out;
}
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const frenchMonths = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
export default function Planning(p: PageProps) {
  const [selection, setSelection] = useState(monthlyWeek(p.from));
  const start = monthWeekStart(selection.month, selection.week);
  const end = monthWeekEnd(selection.month, selection.week);
  const dates = monthWeekDays(selection.month, selection.week);
  const [draft, setDraft] = useState<Plan[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const saved = useLiveQuery(
    async () => ({
      start,
      plans: await db.plans.where("date").between(start, end, true, true).toArray(),
    }),
    [start, end],
  );
  useEffect(() => {
    if (!saved || saved.start !== start) return;
    setDraft(
      monthWeekDays(start.slice(0, 7), monthlyWeek(start).week).map(
        (date) =>
          saved.plans.find((p) => p.date === date) || {
            date,
            pozzolana: 0,
            granite: 0,
            comment: "",
          },
      ),
    );
    setDirty(false);
  }, [saved, start]);
  const readOnly = p.user === "CONSULTANT";
  const loaded =
    saved?.start === start && draft[0]?.date === start && draft.length === dates.length;
  const rowBlocks = blocks(dates);
  const data = weeklyMetrics(loaded ? draft : [], p.allRows, p.settings);
  const totals = ([0, 1] as const).map((i) =>
    data.reduce(
      (s, d) => ({
        plannedRotations: s.plannedRotations + d.products[i].plannedRotations,
        actualRotations: s.actualRotations + d.products[i].actualRotations,
        plannedTonnage: s.plannedTonnage + d.products[i].plannedTonnage,
        actualTonnage: s.actualTonnage + d.products[i].actualTonnage,
      }),
      { plannedRotations: 0, actualRotations: 0, plannedTonnage: 0, actualTonnage: 0 },
    ),
  );
  const year = Number(selection.month.slice(0, 4)),
    monthNumber = Number(selection.month.slice(5, 7));
  const heading = `WEEK ${selection.week} - ${months[monthNumber - 1].toUpperCase()} ${year}`;
  function choose(month: string, week: number) {
    if (dirty && !window.confirm("Changer de semaine sans enregistrer les modifications ?")) return;
    setSelection({ month, week: Math.min(week, monthWeeks(month)) });
  }
  function navigate(offset: number) {
    const next = shiftMonthWeek(selection.month, selection.week, offset);
    choose(next.month, next.week);
  }
  function change(date: string, field: "pozzolana" | "granite" | "comment", value: string) {
    setDraft((list) =>
      list.map((d) =>
        d.date === date ? { ...d, [field]: field === "comment" ? value : Number(value || 0) } : d,
      ),
    );
    setDirty(true);
  }
  async function save() {
    if (!loaded || busy) return;
    setBusy(true);
    try {
      requireWrite();
      if (
        draft.some((d) => ![d.pozzolana, d.granite].every((v) => Number.isSafeInteger(v) && v >= 0))
      )
        throw new Error("Les camions prévus doivent être des entiers positifs ou nuls.");
      await db.plans.bulkPut(draft);
      setDirty(false);
      p.notify("Objectifs et commentaires hebdomadaires enregistrés.");
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setBusy(false);
    }
  }
  function metrics(d: typeof totals, tonnage: boolean) {
    const planned = d.map((v) => (tonnage ? v.plannedTonnage : v.plannedRotations));
    const actual = d.map((v) => (tonnage ? v.actualTonnage : v.actualRotations));
    return [
      ...planned,
      ...actual,
      ...actual.map((v, i) => v - planned[i]),
      ...actual.map((v, i) => (planned[i] ? (v / planned[i]) * 100 : null)),
    ];
  }
  function exportExcel() {
    if (!loaded) return;
    const wb = XLSX.utils.book_new();
    const rows: (string | number | null)[][] = [
      ["TRANSPORT SUPPORT FOR POZZOLANA & GRANITE STOCK BUILDING"],
      [heading],
      [shortDate(start) + " - " + shortDate(end)],
    ];
    const merges: XLSX.Range[] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 10 } }));
    for (const tonnage of [false, true]) {
      rows.push([], [tonnage ? "TONNAGE ESTIMÉ" : "NOMBRE DE ROTATIONS / CAMIONS"]);
      const r = rows.length;
      rows.push([
        "",
        "Days",
        "PLANNED",
        "",
        "ACTUAL",
        "",
        "GAP",
        "",
        "Achievement (%)",
        "",
        ...(tonnage ? [] : ["Comments / Actions"]),
      ]);
      for (const c of [2, 4, 6, 8]) merges.push({ s: { r, c }, e: { r, c: c + 1 } });
      rows.push(["", "", ...Array.from({ length: 4 }, () => ["Pozzolana", "Granite"]).flat()]);
      const first = rows.length;
      for (const b of rowBlocks)
        if (b.span > 1)
          merges.push({
            s: { r: first + b.index, c: 0 },
            e: { r: first + b.index + b.span - 1, c: 0 },
          });
      for (let i = 0; i < data.length; i++)
        rows.push([
          rowBlocks.some((b) => b.index === i) ? group(data[i].date) : "",
          days[weekdayIndex(data[i].date)] + " " + data[i].date,
          ...metrics(data[i].products, tonnage).map((v, j) =>
            j >= 6 ? (v === null ? "Non planifié" : v / 100) : v,
          ),
          ...(tonnage ? [] : [data[i].comment]),
        ]);
      rows.push([
        "",
        "TOTAL",
        ...metrics(totals, tonnage).map((v, j) =>
          j >= 6 ? (v === null ? "Non planifié" : v / 100) : v,
        ),
      ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!merges"] = merges;
    sheet["!cols"] = [
      { wch: 25 },
      { wch: 26 },
      ...Array.from({ length: 8 }, () => ({ wch: 17 })),
      { wch: 45 },
    ];
    for (const [a, c] of Object.entries(sheet))
      if (!a.startsWith("!") && c.t === "n")
        c.z = XLSX.utils.decode_cell(a).c >= 8 ? "0.0%" : "#,##0.00";
    XLSX.utils.book_append_sheet(wb, sheet, "Planning Direction");
    XLSX.writeFile(wb, `RM-SB-planning-${selection.month}-W${selection.week}.xlsx`);
  }
  const rate = (value: number | null) =>
    value === null ? (
      <span className="unplanned">Non planifié</span>
    ) : (
      <Badge type={rateColor(value)}>{fmt(value, 1)} %</Badge>
    );
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">DIRECTION LOGISTIQUE</div>
        <h1>Planification hebdomadaire</h1>
        <p>
          Présentation direction : rotations et tonnages par semaine du mois (1–7, 8–14, 15–21,
          22–28, 29–fin).
        </p>
        <div className="button-row">
          <button className="button" disabled={!loaded} onClick={exportExcel}>
            <Download size={16} />
            Exporter planning Excel
          </button>
          <button
            className="button primary"
            disabled={readOnly || busy || !dirty || !loaded}
            onClick={save}
          >
            <Save size={16} />
            {busy ? "Enregistrement…" : "Enregistrer les objectifs"}
          </button>
        </div>
      </div>
      <div className="planning-selector">
        <button className="button" aria-label="Semaine précédente" onClick={() => navigate(-1)}>
          <ChevronLeft size={16} />
          Semaine précédente
        </button>
        <label>
          Mois
          <select
            aria-label="Mois de planification"
            value={monthNumber}
            onChange={(e) => choose(`${year}-${String(e.target.value).padStart(2, "0")}`, 1)}
          >
            {frenchMonths.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Année
          <input
            type="number"
            aria-label="Année de planification"
            min="1900"
            max="9999"
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              if (y >= 1900 && y <= 9999) choose(`${y}-${String(monthNumber).padStart(2, "0")}`, 1);
            }}
          />
        </label>
        <label>
          Semaine
          <select
            aria-label="Semaine de planification"
            value={selection.week}
            onChange={(e) => choose(selection.month, Number(e.target.value))}
          >
            {Array.from({ length: monthWeeks(selection.month) }, (_, i) => (
              <option key={i} value={i + 1}>
                Semaine {i + 1}
              </option>
            ))}
          </select>
        </label>
        <button className="button" aria-label="Semaine suivante" onClick={() => navigate(1)}>
          Semaine suivante
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="direction-heading">
        <strong>
          TRANSPORT SUPPORT FOR
          <br />
          POZZOLANA &amp; GRANITE
          <br />
          STOCK BUILDING
        </strong>
        <div>
          <h2>{heading}</h2>
          <span>
            {shortDate(start)} - {shortDate(end)}
          </span>
        </div>
        <Badge type={!loaded || dirty ? "orange" : "green"}>
          {!loaded
            ? "Chargement…"
            : dirty
              ? "Modifications non enregistrées"
              : "Objectifs enregistrés"}
        </Badge>
      </div>
      {[false, true].map((tonnage) => (
        <Panel
          key={String(tonnage)}
          title={
            tonnage ? "SECTION 2 : TONNAGE ESTIMÉ" : "SECTION 1 : NOMBRE DE ROTATIONS / CAMIONS"
          }
          subtitle={
            tonnage
              ? `Planned = camions × capacité en vigueur à chaque date (paramètre versionné ; au ${p.to} : ${settingAt(p.settings, "pozzolanaCapacity", p.to)} t Pouzzolane / ${settingAt(p.settings, "graniteCapacity", p.to)} t Granite). Actual = poids nets DDS en tonnes.`
              : "Actual alimenté par les ATC DDS uniques, toutes catégories, sans doubler les ATC Ops Spe."
          }
        >
          <div className="table-scroll">
            <table className="direction-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Période</th>
                  <th rowSpan={2}>Days</th>
                  {["PLANNED", "ACTUAL", "GAP", "Achievement (%)"].map((h) => (
                    <th key={h} colSpan={2}>
                      {h}
                    </th>
                  ))}
                  {!tonnage && <th rowSpan={2}>Comments / Actions</th>}
                </tr>
                <tr>
                  {Array.from({ length: 4 }, (_, i) => [
                    <th key={i + "p"}>Pozzolana</th>,
                    <th key={i + "g"}>Granite</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {data.map((d, i) => {
                  const values = metrics(d.products, tonnage);
                  return (
                    <tr
                      key={d.date}
                      className={tonnage && weekend(d.date) ? "weekend-highlight" : ""}
                    >
                      {rowBlocks
                        .filter((b) => b.index === i)
                        .map((b) => (
                          <td key={b.index} rowSpan={b.span} className="week-block">
                            {b.label}
                          </td>
                        ))}
                      <td>
                        <strong>{days[weekdayIndex(d.date)]}</strong>
                        <small className="subtext">{shortDate(d.date)}</small>
                      </td>
                      {values.map((v, j) => (
                        <td
                          key={j}
                          className={
                            j === 4 || j === 5 ? (v !== null && v < 0 ? "negative-gap" : "") : ""
                          }
                        >
                          {j < 2 && !tonnage ? (
                            <input
                              aria-label={`${j === 0 ? "pozzolana" : "granite"} ${d.date} camions`}
                              type="number"
                              min="0"
                              step="1"
                              value={v || 0}
                              disabled={readOnly || busy}
                              onChange={(e) =>
                                change(d.date, j === 0 ? "pozzolana" : "granite", e.target.value)
                              }
                            />
                          ) : j >= 6 ? (
                            rate(v)
                          ) : (
                            fmt(v || 0, tonnage ? 2 : 0)
                          )}
                        </td>
                      ))}
                      {!tonnage && (
                        <td>
                          <textarea
                            aria-label={`Comments / Actions ${d.date}`}
                            value={d.comment}
                            disabled={readOnly || busy}
                            onChange={(e) => change(d.date, "comment", e.target.value)}
                            placeholder="Causes, actions, instructions…"
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>TOTAL</td>
                  {metrics(totals, tonnage).map((v, j) => (
                    <td key={j}>{j >= 6 ? rate(v) : fmt(v || 0, tonnage ? 2 : 0)}</td>
                  ))}
                  {!tonnage && <td>—</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      ))}
      <Panel
        title="Synthèse hebdomadaire automatique"
        subtitle="Pouzzolane, Granite et Total Général"
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Planned Rotations</th>
                <th>Actual Rotations</th>
                <th>Planned Tonnage</th>
                <th>Actual Tonnage</th>
                <th>Achievement rotations %</th>
                <th>Achievement tonnage %</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...totals,
                totals.reduce((a, b) => ({
                  plannedRotations: a.plannedRotations + b.plannedRotations,
                  actualRotations: a.actualRotations + b.actualRotations,
                  plannedTonnage: a.plannedTonnage + b.plannedTonnage,
                  actualTonnage: a.actualTonnage + b.actualTonnage,
                })),
              ].map((t, i) => (
                <tr key={i}>
                  <td>
                    <strong>{["Pouzzolane", "Granite", "Total Général"][i]}</strong>
                  </td>
                  <td>{t.plannedRotations}</td>
                  <td>{t.actualRotations}</td>
                  <td>{fmt(t.plannedTonnage, 2)} t</td>
                  <td>{fmt(t.actualTonnage, 2)} t</td>
                  <td>
                    {rate(
                      t.plannedRotations ? (t.actualRotations / t.plannedRotations) * 100 : null,
                    )}
                  </td>
                  <td>
                    {rate(t.plannedTonnage ? (t.actualTonnage / t.plannedTonnage) * 100 : null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="info-box">
        Semaines du mois sans chevauchement : S1 du 1 au 7, S2 du 8 au 14, S3 du 15 au 21, S4 du 22
        au 28 et S5 du 29 à la fin du mois (5 semaines maximum, la dernière peut être plus courte).
        Le jour réel de chaque date est affiché. Objectifs et commentaires conservés par date. Rouge
        &lt; 50 %, orange 50 % à moins de 90 %, vert ≥ 90 %. Sans objectif : Non planifié.
      </div>
    </>
  );
}
