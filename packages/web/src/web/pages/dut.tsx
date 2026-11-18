import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Receipt, Coins, Truck, Search, Download } from "lucide-react";
import { db, fmt, settingAt, type Settings } from "../lib/database";
import { dutSummary } from "../lib/operations";
import { exportOperational } from "../lib/operational-exports";
import { type PageProps, Panel, Kpi, Badge, Empty } from "../components/shared";
import DutStock from "./dut-stock";
import { dutStockLedger } from "../lib/dut-stock";

// DUT price in force at the DUT's first use date (versioned parameter); undated DUT use the period end.
export function dutPrice(g: { dates: string[] }, settings: Settings, fallback: string) {
  const date = [...g.dates].sort()[0] || fallback;
  return settingAt(settings, "dutPrice", date);
}
export function dutTotal(groups: { dates: string[] }[], settings: Settings, fallback: string) {
  return groups.reduce((s, g) => s + dutPrice(g, settings, fallback), 0);
}

export function DutCosts(p: PageProps) {
  const refs = useLiveQuery(() => db.ops.toArray(), []) || [];
  const data = dutSummary(refs, p.allRows, p.from, p.to);
  return (
    <Panel
      title="Coûts opérations spéciales"
      subtitle="DUT uniques du référentiel officiel, y compris ATC Manquant DDS"
    >
      <div className="kpi-grid module-kpis">
        <Kpi
          label="NOMBRE DE DUT"
          value={data.groups.length}
          icon={Receipt}
          caption="Identifiants uniques sur la période"
        />
        <Kpi
          label="COÛT DUT"
          value={dutTotal(data.groups, p.settings, p.to)}
          unit={p.settings.dutCurrency}
          icon={Coins}
          caption={fmt(settingAt(p.settings, "dutPrice", p.to)) + " par DUT (tarif en vigueur)"}
          color="blue"
        />
        <Kpi
          label="ROTATIONS OPS SPE"
          value={data.references}
          icon={Truck}
          caption={`${data.matched} trouvées DDS • ${data.references - data.matched} manquantes`}
        />
      </div>
    </Panel>
  );
}

export default function Duties(p: PageProps) {
  const refs = useLiveQuery(() => db.ops.toArray(), []) || [];
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const data = dutSummary(refs, p.allRows, p.from, p.to);
  const rows = data.groups.filter((g) =>
    (g.dut + " " + g.atcs.join(" ")).toLowerCase().includes(search.toLowerCase()),
  );
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  async function exportReport(format: "pdf" | "xlsx" | "docx") {
    setBusy(format);
    try {
      const stock = dutStockLedger(
        await db.dutReceipts.toArray(),
        await db.dutOpening.get("main"),
        refs,
        p.allRows,
        p.to,
      );
      await exportOperational(
        format,
        "RM-SB — Gestion DUT",
        `${p.from} au ${p.to} • Prix unitaire versionné (au ${p.to} : ${fmt(settingAt(p.settings, "dutPrice", p.to))} ${p.settings.dutCurrency})`,
        [
          {
            name: "Stock feuilles DUT",
            headers: [
              "Date clôture",
              "Stock initial",
              "Feuilles reçues",
              "Feuilles utilisées",
              "Feuilles disponibles",
              "DUT sans date",
            ],
            rows: [
              [
                p.to,
                stock.initial,
                stock.received,
                stock.used,
                stock.available,
                stock.unknown.length,
              ],
            ],
          },
          {
            name: "Réceptions DUT",
            headers: [
              "Date réception",
              "Nombre reçu",
              "Disponible avant",
              "Disponible après",
              "Commentaire",
            ],
            rows: stock.history
              .filter((r) => r.date >= p.from && r.date <= p.to)
              .map((r) => [r.date, r.quantity, r.before, r.after, r.comment]),
          },
          {
            name: "Feuilles utilisées",
            headers: ["Première utilisation", "DUT unique", "ATC associés", "Feuilles utilisées"],
            rows: stock.usage
              .filter((r) => r.date >= p.from)
              .map((r) => [r.date, r.dut, r.atcs.join(", "), 1]),
          },
          {
            name: "Synthèse DUT",
            headers: [
              "DUT uniques",
              "Montant total",
              "Devise",
              "ATC Ops Spe",
              "Manquant DDS",
              "ATC sans DUT",
            ],
            rows: [
              [
                data.groups.length,
                dutTotal(data.groups, p.settings, p.to),
                p.settings.dutCurrency,
                data.references,
                data.references - data.matched,
                data.missingDut,
              ],
            ],
          },
          {
            name: "DUT uniques",
            headers: ["DUT N°UNIQUE", "ATC associés", "Rotations", "Trouvés DDS", "Montant"],
            rows: rows.map((g) => [
              g.dut,
              g.atcs.join(", "),
              g.atcs.length,
              g.matched,
              dutPrice(g, p.settings, p.to),
            ]),
          },
        ],
        "RM-SB-DUT",
      );
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur d’export DUT");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">SUIVI FINANCIER OPS SPE</div>
        <h1>Gestion DUT</h1>
        <p>Une feuille DUT, un identifiant, un seul coût — même si plusieurs ATC y sont liés.</p>
      </div>
      <DutStock {...p} />
      <DutCosts {...p} />
      <div className="info-box">
        Lecture de <strong>DUT N°UNIQUE</strong> dans Ops Spe. Tous les DUT officiels sont comptés,
        même sans correspondance DDS. {data.missingDut} ATC sans DUT renseigné : non facturés. Un
        même DUT compte une seule fois dans la période ; les totaux de périodes différentes ne
        doivent pas être additionnés si ce DUT les traverse.
      </div>
      <Panel
        title="Registre des DUT uniques"
        subtitle="La période suit Exit Time DDS, sinon Date Ops Spe ; sans date, l’ATC reste visible."
        action={
          <Badge type="blue">
            {fmt(settingAt(p.settings, "dutPrice", p.to))} {p.settings.dutCurrency} / DUT au {p.to}
          </Badge>
        }
      >
        <div className="table-tools">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Rechercher DUT ou ATC"
              placeholder="DUT, numéro ATC…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="button-row">
            {(["pdf", "xlsx", "docx"] as const).map((f) => (
              <button
                className="button"
                key={f}
                disabled={!!busy}
                onClick={() => void exportReport(f)}
              >
                <Download size={15} />
                Exporter {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {!rows.length ? (
          <Empty
            title="Aucun DUT pour cette période"
            text="Importez DDS et Ops Spe avec la colonne DUT N°UNIQUE, ou modifiez les filtres."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>DUT N°UNIQUE</th>
                  <th>ATC associés</th>
                  <th>Rotations Ops Spe</th>
                  <th>Trouvé dans DDS</th>
                  <th>Coût DUT</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(current * 20, (current + 1) * 20).map((g) => (
                  <tr key={g.dut}>
                    <td>
                      <strong>{g.dut}</strong>
                    </td>
                    <td>{g.atcs.join(", ")}</td>
                    <td>{g.atcs.length}</td>
                    <td>
                      {g.matched} / {g.atcs.length}
                    </td>
                    <td>
                      {fmt(dutPrice(g, p.settings, p.to))} {p.settings.dutCurrency}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL FILTRÉ</td>
                  <td>{rows.length} DUT uniques</td>
                  <td>{rows.reduce((s, g) => s + g.atcs.length, 0)}</td>
                  <td>{rows.reduce((s, g) => s + g.matched, 0)}</td>
                  <td>
                    {fmt(dutTotal(rows, p.settings, p.to))} {p.settings.dutCurrency}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            Page {current + 1} / {Math.max(1, Math.ceil(rows.length / 20))}
          </span>
          <div>
            <button className="button" disabled={!current} onClick={() => setPage(current - 1)}>
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
