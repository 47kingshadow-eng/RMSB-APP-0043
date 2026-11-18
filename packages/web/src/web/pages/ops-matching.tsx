import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, Download, CheckCircle2, AlertTriangle, ListChecks } from "lucide-react";
import * as XLSX from "xlsx";
import { db, shortDate } from "../lib/database";
import { type PageProps, Panel, Kpi, Badge, Empty } from "../components/shared";

export default function OpsMatching(p: PageProps) {
  const references = useLiveQuery(() => db.ops.toArray(), []) || [];
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Tous");
  const [page, setPage] = useState(0);
  const dds = new Map(p.allRows.map((t) => [t.atc, t]));
  const base = references
    .map((r) => ({
      ...r,
      found: dds.has(r.atc),
      periodDate: dds.get(r.atc)?.exit.slice(0, 10) || r.date,
    }))
    .filter((r) => !r.periodDate || (r.periodDate >= p.from && r.periodDate <= p.to));
  const rows = base
    .filter(
      (r) =>
        r.atc.includes(search.trim()) &&
        (status === "Tous" || (status === "Importé" ? r.found : !r.found)),
    )
    .sort((a, b) => b.periodDate.localeCompare(a.periodDate) || a.atc.localeCompare(b.atc));
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  function exportRows() {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        "ATC Ops Spe": r.atc,
        "Trouvé dans DDS": r.found ? "Oui" : "Non",
        Statut: r.found ? "Importé" : "Manquant DDS",
        Date: r.periodDate || "Sans date",
        Source: r.filename,
      })),
    );
    sheet["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 55 }];
    if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(wb, sheet, "Correspondance Ops Spe");
    XLSX.writeFile(wb, "RM-SB-correspondance-Ops-Spe.xlsx");
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">CONTRÔLE DU RÉFÉRENTIEL OFFICIEL</div>
        <h1>Correspondance Ops Spe</h1>
        <p>Chaque ATC officiel est rapproché automatiquement de l’ensemble du DDS enregistré.</p>
        <button className="button title-action" onClick={exportRows} disabled={!rows.length}>
          <Download size={16} />
          Exporter Excel
        </button>
      </div>
      <div className="kpi-grid module-kpis">
        <Kpi
          label="ATC OPS SPE"
          value={base.length}
          icon={ListChecks}
          caption="Sur la période sélectionnée"
        />
        <Kpi
          label="IMPORTÉ"
          value={base.filter((r) => r.found).length}
          icon={CheckCircle2}
          caption="ATC trouvé dans DDS"
        />
        <Kpi
          label="MANQUANT DDS"
          value={base.filter((r) => !r.found).length}
          icon={AlertTriangle}
          color="blue"
          caption="À contrôler dans une prochaine paire"
        />
      </div>
      <Panel
        title="Liste officielle et correspondance"
        subtitle="Date de sortie DDS si trouvé, sinon Date Ops Spe. Les ATC sans date restent visibles."
      >
        <div className="table-tools">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Rechercher ATC Ops Spe"
              placeholder="Rechercher un ATC…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            aria-label="Statut de correspondance"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option>Tous</option>
            <option>Importé</option>
            <option>Manquant DDS</option>
          </select>
        </div>
        {!rows.length ? (
          <Empty
            title="Aucune correspondance pour ces filtres"
            text="Importez les deux fichiers ou ajustez la période et le statut."
            action={p.user !== "CONSULTANT" ? () => p.navigate("Import DDS") : undefined}
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ATC Ops Spe</th>
                  <th>Trouvé dans DDS</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th>Fichier Ops Spe</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(current * 20, (current + 1) * 20).map((r) => (
                  <tr key={r.atc}>
                    <td>
                      <strong>{r.atc}</strong>
                    </td>
                    <td>{r.found ? "Oui" : "Non"}</td>
                    <td>
                      <Badge type={r.found ? "green" : "orange"}>
                        {r.found ? "Importé" : "Manquant DDS"}
                      </Badge>
                    </td>
                    <td>{shortDate(r.periodDate)}</td>
                    <td>{r.filename}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {rows.length} ATC • Page {current + 1} / {Math.max(1, Math.ceil(rows.length / 20))}
          </span>
          <div>
            <button
              className="button"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Précédent
            </button>
            <button
              className="button"
              disabled={(current + 1) * 20 >= rows.length}
              onClick={() => setPage(current + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}
