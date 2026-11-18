import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  FileText,
  Download,
  CalendarDays,
  FileSpreadsheet,
  FileCheck,
  LoaderCircle,
} from "lucide-react";
import { type PageProps, Panel, Badge } from "../components/shared";
import { db, fmt, totals, rateColor } from "../lib/database";
import { monthlyWeek, monthWeekStart, monthWeekEnd } from "../lib/operations";
import { useFuelAmounts } from "../hooks/use-fuel-amounts";
import { exportReport, summary } from "../lib/exports";
export default function Reports(p: PageProps) {
  const [type, setType] = useState("Rapport Mensuel");
  const [from, setFrom] = useState(p.from);
  const [to, setTo] = useState(p.to);
  const [busy, setBusy] = useState("");
  const plans =
    useLiveQuery(
      () => db.plans.where("date").between(from, to, true, true).toArray(),
      [from, to],
    ) || [];
  const rows = p.allRows.filter((t) => t.exit.slice(0, 10) >= from && t.exit.slice(0, 10) <= to);
  const sums = summary(rows, plans, p.settings);
  const fuel = useFuelAmounts(p.allRows, p.settings);
  const outsideFuel = fuel.opsItems
    .filter((o) => !o.inDds && o.exit.slice(0, 10) >= from && o.exit.slice(0, 10) <= to)
    .reduce((s, o) => s + o.litres, 0);
  const base = totals(rows, p.settings, fuel.amounts);
  const total = { ...base, fuel: base.fuel + outsideFuel };
  function choose(value: string) {
    setType(value);
    if (value === "Rapport Journalier") setFrom(to);
    if (value === "Rapport Hebdomadaire") {
      // Monthly calendar weeks: S1 = 1–7 … S5 = 29–fin de mois.
      const w = monthlyWeek(to);
      setFrom(monthWeekStart(w.month, w.week));
      setTo(monthWeekEnd(w.month, w.week));
    }
    if (value === "Rapport Mensuel") {
      setFrom(to.slice(0, 7) + "-01");
      const d = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0, 12);
      setTo(to.slice(0, 7) + "-" + String(d.getDate()).padStart(2, "0"));
    }
  }
  async function generate(format: "pdf" | "xlsx" | "docx") {
    setBusy(format);
    try {
      if (!from || !to || from > to) throw new Error("La période de rapport est invalide.");
      await exportReport(
        format,
        rows,
        plans,
        p.settings,
        from,
        to,
        type,
        fuel.amounts,
        outsideFuel,
      );
      p.notify("Rapport " + format.toUpperCase() + " généré.");
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Impossible de générer le rapport.");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">ANALYSE & REPORTING</div>
        <h1>Rapports</h1>
        <p>Des synthèses professionnelles, prêtes à partager et à archiver.</p>
      </div>
      <div className="report-types">
        {[
          "Rapport Journalier",
          "Rapport Hebdomadaire",
          "Rapport Mensuel",
          "Rapport Personnalisé",
        ].map((name, i) => (
          <button
            className={"report-type " + (type === name ? "active" : "")}
            key={name}
            onClick={() => choose(name)}
          >
            <span>{i === 3 ? <FileText size={22} /> : <CalendarDays size={22} />}</span>
            <strong>{name.replace("Rapport ", "")}</strong>
            <small>
              {
                [
                  "Une journée d’opérations",
                  "Semaine du mois (S1 = 1–7 … S5 = 29–fin)",
                  "Le bilan de votre mois",
                  "La période de votre choix",
                ][i]
              }
            </small>
          </button>
        ))}
      </div>
      <Panel title="Configurer votre rapport" subtitle="La synthèse se met à jour automatiquement">
        <div className="report-config">
          <label>
            Date de début
            <input
              aria-label="Date de début du rapport"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setType("Rapport Personnalisé");
              }}
            />
          </label>
          <label>
            Date de fin
            <input
              aria-label="Date de fin du rapport"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setType("Rapport Personnalisé");
              }}
            />
          </label>
          <div>
            <span className="muted">Périmètre</span>
            <strong>Tous produits • toutes catégories</strong>
            <small>{rows.length} transactions • date de sortie DDS</small>
          </div>
        </div>
        {from > to && (
          <div className="error-box">La date de début doit précéder la date de fin.</div>
        )}
      </Panel>
      <Panel
        title="Aperçu de la synthèse"
        subtitle={type + " • " + from + " au " + to}
        action={<Badge type="green">Calculé sur vos données</Badge>}
      >
        <div className="report-preview-brand">
          <img src="/images/logo.png" alt="Logo RM-SB" />
          <div>
            <strong>RM-SB</strong>
            <span>{p.settings.organization}</span>
          </div>
          <FileCheck size={30} />
        </div>
        <div className="table-scroll">
          <table className="report-summary">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Voyages</th>
                <th>Prévu (t)</th>
                <th>Réalisé (t)</th>
                <th>Écart (t)</th>
                <th>Taux de réalisation</th>
              </tr>
            </thead>
            <tbody>
              {sums.map((s) => (
                <tr className={s.product === "TOTAL" ? "total-row" : ""} key={s.product}>
                  <td>
                    <strong>{s.product}</strong>
                  </td>
                  <td>{fmt(s.trips)}</td>
                  <td>{fmt(s.target, 2)}</td>
                  <td>
                    <strong>{fmt(s.actual, 2)}</strong>
                  </td>
                  <td className={s.gap < 0 ? "red" : ""}>
                    {s.gap > 0 ? "+" : ""}
                    {fmt(s.gap, 2)}
                  </td>
                  <td>
                    {s.rate === null ? (
                      <span className="muted">Non planifié</span>
                    ) : (
                      <Badge type={rateColor(s.rate)}>{fmt(s.rate, 1)} %</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="report-estimates">
          <div>
            <small>CONSO. CARBURANT TOTALE</small>
            <strong>
              {fmt(total.fuel)} <span>L</span>
            </strong>
          </div>
          <div>
            <small>DISTANCE ESTIMÉE</small>
            <strong>
              {fmt(total.distance)} <span>km</span>
            </strong>
          </div>
          <p>
            Les rapports incluent la répartition par catégorie et le détail des transactions.
            Carburant réel : litres Ops Spe (fichier ou correction) + coefficient Reverse Log
            versionné ; 3rd Party exclu du carburant et de la distance.
          </p>
        </div>
      </Panel>
      <div className="export-grid">
        {[
          {
            format: "pdf" as const,
            title: "Document PDF",
            text: "Mise en page professionnelle avec logo.",
            icon: FileText,
          },
          {
            format: "xlsx" as const,
            title: "Classeur Excel",
            text: "Synthèse, transactions et planification.",
            icon: FileSpreadsheet,
          },
          {
            format: "docx" as const,
            title: "Document Word",
            text: "Rapport modifiable pour vos équipes.",
            icon: FileText,
          },
        ].map(({ format, title, text, icon: Icon }) => (
          <section key={format}>
            <span className={"export-icon " + format}>
              <Icon size={24} />
            </span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
            <button
              className="button"
              disabled={!!busy || !from || !to || from > to}
              onClick={() => generate(format)}
            >
              {busy === format ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Download size={16} />
              )}
              Exporter {format.toUpperCase()}
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
