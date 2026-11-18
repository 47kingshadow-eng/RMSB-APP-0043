import { useState } from "react";
import { History, Fuel, Download, Save, Trash2, Undo2 } from "lucide-react";
import {
  category,
  fmt,
  shortDate,
  dateISO,
  settingAt,
  addSettingsVersion,
  deleteSettingsVersion,
  type SettingsVersion,
} from "../lib/database";
import { setAtcFuel, clearAtcFuel, type OpsFuelItem } from "../lib/fuel-atc";
import { useFuelAmounts } from "../hooks/use-fuel-amounts";
import { exportOperational } from "../lib/operational-exports";
import { Panel, Kpi, Empty, Modal, Badge, type PageProps } from "../components/shared";

const stamp = (iso: string) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) : "—";
const inPeriod = (iso: string, from: string, to: string) =>
  iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

function Pager({
  current,
  total,
  set,
}: {
  current: number;
  total: number;
  set: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        Page {current + 1} / {Math.max(1, Math.ceil(total / 20))}
      </span>
      <div>
        <button className="button" disabled={!current} onClick={() => set(current - 1)}>
          Précédent
        </button>
        <button
          className="button"
          disabled={(current + 1) * 20 >= total}
          onClick={() => set(current + 1)}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

export function OpsFuel(p: PageProps) {
  const fuel = useFuelAmounts(p.allRows, p.settings);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [audit, setAudit] = useState<OpsFuelItem | null>(null);
  const readOnly = p.user === "CONSULTANT";
  const period = fuel.opsItems.filter((r) => inPeriod(r.exit, p.from, p.to));
  const total = period.reduce((s, r) => s + r.litres, 0);
  const corrected = period.filter((r) => r.correction !== null).length;
  const outside = period.filter((r) => !r.inDds).length;
  const rows = period
    .filter((r) =>
      (r.atc + " " + r.truck + " " + r.dut).toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.exit.localeCompare(a.exit) || a.atc.localeCompare(b.atc));
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  async function commit(r: OpsFuelItem) {
    const draft = drafts[r.atc];
    if (draft === undefined || busy) return;
    const clear = () =>
      setDrafts((d) => {
        const next = { ...d };
        delete next[r.atc];
        return next;
      });
    const value = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(value) || value < 0) {
      p.notify("Litrage invalide : nombre positif ou zéro.");
      clear();
      return;
    }
    if (value === r.litres) return clear();
    setBusy(r.atc);
    try {
      await setAtcFuel(r.atc, value);
      p.notify(`${r.atc} : ${fmt(r.litres, 2)} → ${fmt(value, 2)} L. FIFO et stock recalculés.`);
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      clear();
      setBusy("");
    }
  }
  async function restore(r: OpsFuelItem) {
    if (!window.confirm(`Retirer la correction de ${r.atc} et reprendre la valeur du fichier ?`))
      return;
    setBusy(r.atc);
    try {
      await clearAtcFuel(r.atc);
      setAudit(null);
      p.notify("Correction retirée : valeur du fichier Ops Spe appliquée.");
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy("");
    }
  }
  async function report(format: "pdf" | "xlsx" | "docx") {
    setBusy(format);
    try {
      await exportOperational(
        format,
        "RM-SB — Consommation Carburant Ops Spe",
        `${p.from} au ${p.to} • Correction manuelle prioritaire, sinon colonne Carburant, vide = 0 L • 3rd Party exclus`,
        [
          {
            name: "Synthèse",
            headers: ["Voyages Ops Spe", "Hors DDS", "Corrections", "Consommation (L)"],
            rows: [[period.length, outside, corrected, total]],
          },
          {
            name: "Litrages ATC",
            headers: [
              "Date",
              "ATC",
              "DUT",
              "Produit",
              "Net (t)",
              "Fichier (L)",
              "Carburant (L)",
              "Source",
            ],
            rows: rows.map((r) => [
              r.exit.slice(0, 10),
              r.atc,
              r.dut,
              r.inDds ? r.product : "Hors DDS",
              r.net,
              r.imported ?? 0,
              r.litres,
              r.source,
            ]),
          },
          {
            name: "Audit corrections",
            headers: ["ATC", "Date modification", "Utilisateur", "Ancien (L)", "Nouveau (L)"],
            rows: period.flatMap((r) =>
              r.history.map((h) => [
                r.atc,
                h.at,
                h.by,
                h.previous ?? "Fichier",
                h.litres ?? "Retour fichier",
              ]),
            ),
          },
        ],
        "RM-SB-carburant-ops-spe",
      );
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur export");
    } finally {
      setBusy("");
    }
  }
  return (
    <Panel
      title="Consommation Carburant Ops Spe"
      subtitle="Litres lus dans la colonne Carburant du fichier Ops Spe. Cellule vide ou 0 = 0 L. Une correction manuelle reste prioritaire après réimport."
    >
      <div className="kpi-grid module-kpis">
        <Kpi
          label="CONSOMMATION OPS SPE"
          value={total}
          unit="L"
          icon={Fuel}
          caption={`${period.length} voyages • ${corrected} correction(s) • ${outside} hors DDS`}
        />
      </div>
      {fuel.undated.length > 0 && (
        <div className="error-box">
          {fuel.undated.length} référence(s) Ops Spe sans date et absentes du DDS sont exclues du
          stock carburant : {fuel.undated.map((r) => r.atc).join(", ")}. Importez le DDS
          correspondant ou une date Ops Spe.
        </div>
      )}
      <div className="table-tools">
        <input
          aria-label="Rechercher Ops Spe carburant"
          placeholder="ATC, camion ou DUT…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <div className="button-row">
          {(["pdf", "xlsx", "docx"] as const).map((f) => (
            <button className="button" key={f} disabled={!!busy} onClick={() => void report(f)}>
              <Download size={15} />
              Exporter {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <Empty
          title="Aucun ATC Ops Spe pour cette période"
          text="Ajustez la période ou importez les fichiers DDS et Ops Spe."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>ATC / Camion</th>
                <th>Produit</th>
                <th>Net (t)</th>
                <th>Fichier (L)</th>
                <th>Carburant (L)</th>
                <th>Source</th>
                <th>Historique</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(current * 20, (current + 1) * 20).map((r) => (
                <tr key={r.atc}>
                  <td>{r.inDds ? stamp(r.exit) : shortDate(r.exit)}</td>
                  <td>
                    <strong>{r.atc}</strong>
                    <small className="subtext">
                      {r.inDds ? r.truck : "Absent du DDS — date Ops Spe"}
                    </small>
                  </td>
                  <td>{r.inDds ? r.product : <Badge type="orange">Hors DDS</Badge>}</td>
                  <td>{r.inDds ? fmt(r.net, 2) : "—"}</td>
                  <td>{fmt(r.imported ?? 0, 2)}</td>
                  <td>
                    {readOnly ? (
                      <strong>{fmt(r.litres, 2)}</strong>
                    ) : (
                      <input
                        className="inline-number"
                        aria-label={`Carburant ${r.atc} (L)`}
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={busy === r.atc}
                        value={drafts[r.atc] ?? String(r.litres)}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.atc]: e.target.value }))}
                        onBlur={() => void commit(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape")
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[r.atc];
                              return next;
                            });
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {r.source === "Correction manuelle" ? (
                      <Badge type="blue">Correction manuelle</Badge>
                    ) : (
                      r.source
                    )}
                  </td>
                  <td>
                    <button
                      className="button"
                      aria-label={`Historique ${r.atc}`}
                      disabled={!r.history.length}
                      onClick={() => setAudit(r)}
                    >
                      <History size={15} />
                      {r.history.length || "—"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager current={current} total={rows.length} set={setPage} />
      <p className="muted">
        Valeur retenue = correction manuelle, sinon colonne Carburant, sinon 0 L. Saisie directe
        dans la colonne Carburant (Entrée pour valider, Échap pour annuler). Un réimport met à jour
        la valeur du fichier sans écraser une correction. Les références officielles absentes du DDS
        sont datées par la date Ops Spe.
      </p>
      {audit && (
        <Modal title={`Historique ${audit.atc}`} close={() => setAudit(null)}>
          <p>
            Valeur du fichier : <strong>{fmt(audit.imported ?? 0, 2)} L</strong> • Valeur retenue :{" "}
            <strong>{fmt(audit.litres, 2)} L</strong>
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Utilisateur</th>
                  <th>Ancien (L)</th>
                  <th>Nouveau (L)</th>
                </tr>
              </thead>
              <tbody>
                {audit.history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <tr key={i}>
                      <td>{stamp(h.at)}</td>
                      <td>{h.by}</td>
                      <td>{h.previous === null ? "Fichier" : fmt(h.previous, 2)}</td>
                      <td>{h.litres === null ? "Retour au fichier" : fmt(h.litres, 2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="button-row">
            <button className="button" onClick={() => setAudit(null)}>
              Fermer
            </button>
            {audit.correction !== null && !readOnly && (
              <button
                className="button danger"
                disabled={!!busy}
                onClick={() => void restore(audit)}
              >
                <Undo2 size={15} />
                Reprendre la valeur du fichier
              </button>
            )}
          </div>
        </Modal>
      )}
    </Panel>
  );
}

export function ReverseFuel(p: PageProps) {
  const today = dateISO(new Date());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [litres, setLitres] = useState("");
  const [effective, setEffective] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<SettingsVersion | null>(null);
  const admin = p.user === "ADMIN";
  const base = p.rows.filter((r) => category(r) === "Reverse Logistics");
  const coef = (exit: string) => settingAt(p.settings, "reverseFuel", exit);
  const total = base.reduce((s, r) => s + coef(r.exit), 0);
  const rows = base
    .filter((r) => (r.atc + " " + r.truck).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.exit.localeCompare(a.exit));
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  const versions = (p.settings.history || [])
    .filter((v) => v.values.reverseFuel !== undefined)
    .sort(
      (a, b) =>
        b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.localeCompare(a.createdAt),
    );
  const byCoef = new Map<number, number>();
  for (const r of base) byCoef.set(coef(r.exit), (byCoef.get(coef(r.exit)) || 0) + 1);
  const breakdown = [...byCoef.entries()].map(([c, n]) => `${n} × ${fmt(c)} L`).join(" + ");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = Number(litres);
      if (litres.trim() === "" || !Number.isFinite(value) || value < 0)
        throw new Error("Coefficient invalide : nombre positif ou zéro.");
      await addSettingsVersion(effective, { reverseFuel: value });
      setLitres("");
      p.notify(
        `Coefficient Reverse Log ${fmt(value)} L/voyage appliqué à partir du ${shortDate(effective + "T12:00:00")}. Historique antérieur inchangé.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteSettingsVersion(deleting.id);
      setDeleting(null);
      p.notify("Version supprimée. Les voyages concernés reprennent la version précédente.");
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }
  async function report(format: "pdf" | "xlsx" | "docx") {
    setBusy(true);
    try {
      await exportOperational(
        format,
        "RM-SB — Carburant Reverse Log",
        `${p.from} au ${p.to} • Calcul automatique : voyages × coefficient en vigueur à la date du voyage • Suivi séparé du stock Ops Spe`,
        [
          {
            name: "Synthèse",
            headers: ["Voyages", "Tonnage (t)", "Détail", "Carburant (L)"],
            rows: [[base.length, base.reduce((s, r) => s + r.net, 0), breakdown || "—", total]],
          },
          {
            name: "Voyages",
            headers: ["Exit Time", "ATC", "Camion", "Produit", "Net (t)", "Carburant (L)"],
            rows: rows.map((r) => [r.exit, r.atc, r.truck, r.product, r.net, coef(r.exit)]),
          },
          {
            name: "Versions coefficient",
            headers: ["Date d’effet", "L/voyage", "Créée le", "Par"],
            rows: versions.map((v) => [
              v.base ? "Origine" : v.effectiveDate,
              v.values.reverseFuel ?? 0,
              v.createdAt,
              v.createdBy,
            ]),
          },
        ],
        "RM-SB-carburant-reverse-log",
      );
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur export");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel
        title="Carburant Reverse Log"
        subtitle="Calcul automatique : chaque voyage reçoit le coefficient L/voyage en vigueur à sa date de sortie. Jamais déduit du stock Ops Spe."
      >
        <div className="kpi-grid module-kpis">
          <Kpi
            label="TOTAL REVERSE LOG"
            value={total}
            unit="L"
            icon={Fuel}
            caption={`${base.length} voyages${breakdown ? " • " + breakdown : ""}`}
          />
          <Kpi
            label="COEFFICIENT EN VIGUEUR"
            value={coef(today)}
            unit="L/voyage"
            icon={Fuel}
            color="blue"
            caption={`Au ${shortDate(today + "T12:00:00")}`}
          />
        </div>
        <div className="table-tools">
          <input
            aria-label="Rechercher Reverse Log carburant"
            placeholder="ATC ou camion…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <div className="button-row">
            {(["pdf", "xlsx", "docx"] as const).map((f) => (
              <button className="button" key={f} disabled={busy} onClick={() => void report(f)}>
                <Download size={15} />
                Exporter {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {!rows.length ? (
          <Empty title="Aucun voyage Reverse Log pour cette période" text="Ajustez la période." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Exit Time</th>
                  <th>ATC / Camion</th>
                  <th>Produit</th>
                  <th>Net (t)</th>
                  <th>Carburant (L)</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(current * 20, (current + 1) * 20).map((r) => (
                  <tr key={r.atc}>
                    <td>{stamp(r.exit)}</td>
                    <td>
                      <strong>{r.atc}</strong>
                      <small className="subtext">{r.truck}</small>
                    </td>
                    <td>{r.product}</td>
                    <td>{fmt(r.net, 2)}</td>
                    <td>{fmt(coef(r.exit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager current={current} total={rows.length} set={setPage} />
      </Panel>
      <Panel
        title="Paramétrage du carburant Reverse Log"
        subtitle="Chaque modification crée une version datée. Elle s’applique aux voyages à partir de sa date d’effet, jamais rétroactivement."
      >
        {admin ? (
          <form onSubmit={save}>
            <div className="reservation-form">
              <label>
                Litres par voyage (L)
                <input
                  aria-label="Coefficient Reverse Log (L/voyage)"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  placeholder={String(coef(today))}
                  value={litres}
                  disabled={busy}
                  onChange={(e) => setLitres(e.target.value)}
                />
              </label>
              <label>
                Date d’effet
                <input
                  aria-label="Date d’effet Reverse Log"
                  type="date"
                  required
                  value={effective}
                  disabled={busy}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </label>
            </div>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              <Save size={16} />
              Créer la version
            </button>
          </form>
        ) : (
          <p className="muted">Seul l’ADMIN peut créer une nouvelle version du coefficient.</p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date d’effet</th>
                <th>L/voyage</th>
                <th>Date de création</th>
                <th>Créée par</th>
                <th>Statut</th>
                {admin && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.base
                      ? "Origine (tout l’historique)"
                      : shortDate(v.effectiveDate + "T12:00:00")}
                  </td>
                  <td>{fmt(v.values.reverseFuel ?? 0, 2)}</td>
                  <td>{stamp(v.createdAt)}</td>
                  <td>{v.createdBy}</td>
                  <td>
                    {v.effectiveDate > today ? (
                      <Badge type="orange">Planifiée</Badge>
                    ) : versions.find((x) => x.effectiveDate <= today) === v ? (
                      <Badge>En vigueur</Badge>
                    ) : (
                      <Badge type="gray">Historique</Badge>
                    )}
                  </td>
                  {admin && (
                    <td>
                      {!v.base && (
                        <button
                          className="button danger"
                          aria-label={`Supprimer version ${v.effectiveDate}`}
                          disabled={busy}
                          onClick={() => setDeleting(v)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {deleting && (
        <Modal title="Supprimer cette version ?" close={() => !busy && setDeleting(null)}>
          <p>
            Version du {shortDate(deleting.effectiveDate + "T12:00:00")} :{" "}
            {Object.entries(deleting.values)
              .map(([k, v]) => `${k === "reverseFuel" ? "Reverse Log" : k} ${fmt(v ?? 0, 2)}`)
              .join(", ")}
            .
          </p>
          <div className="error-box">
            Les voyages à partir de cette date reprendront la version précédente. Les totaux seront
            recalculés.
          </div>
          <div className="button-row">
            <button className="button" disabled={busy} onClick={() => setDeleting(null)}>
              Annuler
            </button>
            <button className="button danger" disabled={busy} onClick={() => void remove()}>
              Confirmer la suppression
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
