import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Weight,
  Truck,
  Fuel,
  Route,
  ArrowRight,
  CalendarDays,
  FileUp,
  ArrowUpRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import { type PageProps, Kpi, Panel, Empty, Badge } from "../components/shared";
import { DutCosts } from "./dut";
import { DashboardDrill, type DrillMetric } from "./dashboard-drill";
import { useFuelAmounts } from "../hooks/use-fuel-amounts";
import { monthlyWeek } from "../lib/operations";
import {
  category,
  totals,
  fmt,
  planned,
  rateColor,
  products,
  plusDays,
  settingAt,
  db,
} from "../lib/database";

// Weekly buckets follow the monthly calendar: S1 = 1–7, S2 = 8–14, S3 = 15–21, S4 = 22–28, S5 = 29–fin.
const weekKey = (date: string) => {
  const w = monthlyWeek(date);
  return `${w.month}-S${w.week}`;
};

export default function Dashboard(p: PageProps) {
  const [detail, setDetail] = useState<DrillMetric | null>(null);
  const [aggregation, setAggregation] = useState("Journalier");
  const [chart, setChart] = useState("Histogramme");
  const allPlans = useLiveQuery(() => db.plans.toArray(), []) || [];
  const fuel = useFuelAmounts(p.allRows, p.settings);
  // Official Ops Spe references absent from the DDS still consumed fuel: dated by their Ops date.
  const outside = fuel.opsItems.filter(
    (o) => !o.inDds && o.exit.slice(0, 10) >= p.from && o.exit.slice(0, 10) <= p.to,
  );
  const base = totals(p.rows, p.settings, fuel.amounts);
  const total = { ...base, fuel: base.fuel + outside.reduce((s, o) => s + o.litres, 0) };
  const target = planned(p.plans, p.settings);
  const rate = target ? (total.tonnage / target) * 100 : null;
  const groups = new Map<
    string,
    { date: string; POUZZOLANE: number; GRANITE: number; prevu: number }
  >();
  let from = p.from;
  let to = p.to;
  let source = p.rows;
  if (aggregation === "YTD") {
    from = p.to.slice(0, 4) + "-01-01";
    source = p.allRows.filter((t) => t.exit.slice(0, 10) >= from && t.exit.slice(0, 10) <= to);
  }
  for (let date = from, n = 0; date <= to && n < 366; date = plusDays(date, 1), n++) {
    const key =
      aggregation === "Mensuel" || aggregation === "YTD"
        ? date.slice(0, 7)
        : aggregation === "Hebdomadaire"
          ? weekKey(date)
          : date;
    if (!groups.has(key)) groups.set(key, { date: key, POUZZOLANE: 0, GRANITE: 0, prevu: 0 });
  }
  allPlans
    .filter((d) => d.date >= from && d.date <= to)
    .forEach((d) => {
      const key =
        aggregation === "Mensuel" || aggregation === "YTD"
          ? d.date.slice(0, 7)
          : aggregation === "Hebdomadaire"
            ? weekKey(d.date)
            : d.date;
      const group = groups.get(key);
      if (group)
        group.prevu +=
          d.pozzolana * settingAt(p.settings, "pozzolanaCapacity", d.date) +
          d.granite * settingAt(p.settings, "graniteCapacity", d.date);
    });
  source.forEach((t) => {
    const date = t.exit.slice(0, 10);
    const key =
      aggregation === "Mensuel" || aggregation === "YTD"
        ? date.slice(0, 7)
        : aggregation === "Hebdomadaire"
          ? weekKey(date)
          : date;
    const group = groups.get(key);
    if (group) group[t.product] += t.net;
  });
  let data = [...groups.values()].map((g) => ({
    ...g,
    realise: g.POUZZOLANE + g.GRANITE,
    label: /-S\d$/.test(g.date)
      ? g.date.slice(-2) +
        " " +
        new Date(g.date.slice(0, 7) + "-01T12:00:00").toLocaleDateString("fr-FR", {
          month: "short",
        })
      : g.date.length === 7
        ? new Date(g.date + "-01T12:00:00").toLocaleDateString("fr-FR", { month: "short" })
        : new Date(g.date + "T12:00:00").toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "short",
          }),
  }));
  if (chart === "Aire cumulée") {
    let po = 0,
      gr = 0;
    data = data.map((d) => ({
      ...d,
      POUZZOLANE: (po += d.POUZZOLANE),
      GRANITE: (gr += d.GRANITE),
    }));
  }
  const split = products.map((product) => ({
    name: product,
    value: p.rows.filter((t) => t.product === product).reduce((s, t) => s + t.net, 0),
  }));
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8edef" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 10, fill: "#8a969e" }}
        axisLine={false}
        tickLine={false}
        minTickGap={25}
      />
      <YAxis
        tick={{ fontSize: 10, fill: "#8a969e" }}
        axisLine={false}
        tickLine={false}
        width={46}
        domain={[0, "auto"]}
        unit=" t"
      />
      <Tooltip
        formatter={(value) => fmt(Number(value), 2) + " t"}
        contentStyle={{ borderRadius: 8, border: "1px solid #e5e9ed", fontSize: 12 }}
      />
    </>
  );
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">VUE D’ENSEMBLE DES OPÉRATIONS</div>
        <h1>Tableau de bord</h1>
        <p>De la carrière au stock, gardez le contrôle de chaque tonne.</p>
        <button
          className="button primary title-action"
          onClick={() => p.navigate("Import DDS")}
          disabled={p.user === "CONSULTANT"}
        >
          <FileUp size={17} />
          Importer DDS
        </button>
      </div>
      {!p.allRows.length && (
        <div className="welcome-strip">
          <span className="welcome-icon">
            <FileUp size={22} />
          </span>
          <div>
            <strong>Votre suivi commence ici.</strong>
            <span>
              Importez votre première extraction DDS. Les indicateurs seront calculés
              automatiquement.
            </span>
          </div>
          <button onClick={() => p.navigate("Import DDS")}>
            Commencer <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="kpi-grid">
        <Kpi
          label="TONNAGE TOTAL"
          value={total.tonnage}
          unit="t"
          icon={Weight}
          caption="Voir la répartition par opération"
          onClick={() => setDetail("tonnage")}
        />
        <Kpi
          label="TOTAL DES VOYAGES"
          value={total.trips}
          icon={Truck}
          caption="Toutes catégories confondues"
          onClick={() => setDetail("trips")}
          color="blue"
        />
        <Kpi
          label="CONSO. CARBURANT TOTALE"
          value={total.fuel}
          unit="L"
          icon={Fuel}
          caption="Reverse Log + Ops Spe (hors 3rd Party)"
          onClick={() => setDetail("fuel")}
          color="orange"
        />
        <Kpi
          label="DISTANCE ESTIMÉE"
          value={total.distance}
          unit="km"
          icon={Route}
          caption="Reverse Log + Ops Spe (hors 3rd Party)"
          onClick={() => setDetail("distance")}
          color="blue"
        />
      </div>
      <DutCosts {...p} />
      <div className="dashboard-grid">
        <Panel
          title="Évolution des réceptions"
          subtitle="Tonnage réceptionné par produit"
          action={
            <select
              value={aggregation}
              onChange={(e) => setAggregation(e.target.value)}
              aria-label="Périodicité du graphique"
            >
              {["Journalier", "Hebdomadaire", "Mensuel", "YTD"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          }
        >
          <div className="chart-legend">
            <span>
              <i className="dot green-dot" />
              {chart === "Prévu vs Réalisé" ? "Réalisé" : "Pouzzolane"}
            </span>
            <span>
              <i className="dot blue-dot" />
              {chart === "Prévu vs Réalisé" ? "Prévu" : "Granite"}
            </span>
            <select
              value={chart}
              onChange={(e) => setChart(e.target.value)}
              aria-label="Type de graphique"
            >
              {["Histogramme", "Courbe", "Aire cumulée", "Prévu vs Réalisé"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              {chart === "Prévu vs Réalisé" ? (
                <BarChart data={data}>
                  {axes}
                  <Bar
                    isAnimationActive={false}
                    dataKey="realise"
                    name="Réalisé"
                    fill="#318a58"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="prevu"
                    name="Prévu"
                    fill="#153d52"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              ) : chart === "Histogramme" ? (
                <BarChart data={data}>
                  {axes}
                  <Bar
                    isAnimationActive={false}
                    dataKey="POUZZOLANE"
                    name="Pouzzolane"
                    fill="#318a58"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="GRANITE"
                    name="Granite"
                    fill="#153d52"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              ) : chart === "Courbe" ? (
                <LineChart data={data}>
                  {axes}
                  <Line
                    isAnimationActive={false}
                    dataKey="POUZZOLANE"
                    stroke="#318a58"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    isAnimationActive={false}
                    dataKey="GRANITE"
                    stroke="#153d52"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              ) : (
                <AreaChart data={data}>
                  {axes}
                  <Area
                    isAnimationActive={false}
                    dataKey="POUZZOLANE"
                    stroke="#318a58"
                    fill="#e3f0e8"
                  />
                  <Area
                    isAnimationActive={false}
                    dataKey="GRANITE"
                    stroke="#153d52"
                    fill="#dce6eb"
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
            {!source.length && <span className="chart-no-data">Aucune réception enregistrée</span>}
          </div>
          <div className="panel-footer">
            {aggregation === "YTD" ? "Cumul annuel jusqu’à la date de fin" : "Période sélectionnée"}
            <span>Unité : tonnes</span>
          </div>
        </Panel>
        <Panel title="Répartition des matières" subtitle="Part des tonnages réceptionnés">
          <div className="donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={total.tonnage ? split : [{ name: "Aucune donnée", value: 1 }]}
                  dataKey="value"
                  innerRadius={70}
                  outerRadius={92}
                  paddingAngle={total.tonnage ? 4 : 0}
                  stroke="none"
                >
                  {(total.tonnage ? split : [1]).map((_, i) => (
                    <Cell
                      key={i}
                      fill={total.tonnage ? (i === 0 ? "#318a58" : "#153d52") : "#edf1f2"}
                    />
                  ))}
                </Pie>
                {total.tonnage > 0 && <Tooltip formatter={(v) => fmt(Number(v), 2) + " t"} />}
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <small>TONNAGE TOTAL</small>
              <strong>{fmt(total.tonnage, 2)}</strong>
              <span>tonnes</span>
            </div>
          </div>
          <div className="material-list">
            {split.map((s, i) => (
              <div key={s.name}>
                <span>
                  <i className={"dot " + (i === 0 ? "green-dot" : "blue-dot")} />
                  {i === 0 ? "Pouzzolane" : "Granite"}
                </span>
                <strong>
                  {fmt(s.value, 2)} <small>t</small>
                </strong>
                <Badge type={i === 0 ? "green" : "blue"}>
                  {total.tonnage ? fmt((s.value / total.tonnage) * 100, 1) : "0"} %
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title="Objectifs & réalisation"
          subtitle="Comparaison des tonnages sur la période"
          action={
            <button
              className="text-button"
              onClick={() => p.navigate("Planification Hebdomadaire")}
            >
              Planification <ArrowUpRight size={15} />
            </button>
          }
        >
          <div className="target-overall">
            <span>Réalisation globale</span>
            <strong className={rate === null ? "" : rateColor(rate)}>
              {rate === null ? "Non planifié" : fmt(rate, 1) + " %"}
            </strong>
          </div>
          {products.map((product) => {
            const actual = split.find((s) => s.name === product)!.value;
            const plannedValue = planned(p.plans, p.settings, product);
            const percent = plannedValue ? (actual / plannedValue) * 100 : null;
            return (
              <div className="target-row" key={product}>
                <div>
                  <strong>{product === "POUZZOLANE" ? "Pouzzolane" : "Granite"}</strong>
                  <span>
                    {fmt(actual, 2)} / {fmt(plannedValue)} t
                  </span>
                </div>
                <div className="progress">
                  <i
                    style={{
                      width: Math.min(percent || 0, 100) + "%",
                      background: product === "POUZZOLANE" ? "#318a58" : "#153d52",
                    }}
                  />
                </div>
                <div className="target-caption">
                  <span>Écart : {fmt(actual - plannedValue, 2)} t</span>
                  <span className={percent === null ? "" : rateColor(percent)}>
                    {percent === null ? "Objectif à définir" : fmt(percent, 1) + " %"}
                  </span>
                </div>
              </div>
            );
          })}
        </Panel>
        <Panel
          title="Dernières réceptions"
          subtitle="Les dernières transactions de la période"
          action={
            <button className="text-button" onClick={() => p.navigate("Transactions")}>
              Tout voir <ArrowRight size={15} />
            </button>
          }
        >
          {!p.rows.length ? (
            <Empty
              title="Vos réceptions apparaîtront ici"
              text="Aucune transaction dans la période sélectionnée."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Camion / ATC</th>
                    <th>Produit</th>
                    <th>Catégorie</th>
                    <th className="numeric">Net (t)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...p.rows]
                    .sort((a, b) => b.exit.localeCompare(a.exit))
                    .slice(0, 5)
                    .map((t) => (
                      <tr key={t.atc}>
                        <td>
                          <strong>{t.truck}</strong>
                          <small className="subtext">{t.atc}</small>
                        </td>
                        <td>
                          <Badge type={t.product === "GRANITE" ? "blue" : "green"}>
                            {t.product === "GRANITE" ? "Granite" : "Pouzzolane"}
                          </Badge>
                        </td>
                        <td className="muted">{category(t)}</td>
                        <td className="numeric">
                          <strong>{fmt(t.net, 2)}</strong>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <div className="page-footnote">
        <span>
          <CalendarDays size={13} />
          Les analyses utilisent la date de sortie DDS.
        </span>
        <span>Données stockées uniquement sur cet appareil.</span>
      </div>
      {detail && (
        <DashboardDrill
          key={detail}
          metric={detail}
          rows={p.rows}
          settings={p.settings}
          amounts={fuel.amounts}
          outside={outside}
          close={() => setDetail(null)}
        />
      )}
    </>
  );
}
