import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FileSpreadsheet, AlertTriangle, Download, Trash2 } from "lucide-react";
import { type PageProps, Panel, Badge, Empty, Modal } from "../components/shared";
import {
  previewImport,
  previewOps,
  workbookSheets,
  commitImport,
  type Preview,
  type OpsPreview,
} from "../lib/importing";
import { db, fmt, category, shortDate, deleteImport, type ImportLog } from "../lib/database";
import { download } from "../lib/exports";

export default function ImportDDS(p: PageProps) {
  const [dds, setDDS] = useState<File | null>(null);
  const [ops, setOps] = useState<File | null>(null);
  const [ddsSheets, setDDSSheets] = useState<string[]>([]);
  const [opsSheets, setOpsSheets] = useState<string[]>([]);
  const [ddsSheet, setDDSSheet] = useState("");
  const [opsSheet, setOpsSheet] = useState("");
  const [unit, setUnit] = useState<"kg" | "t">("kg");
  const [preview, setPreview] = useState<{ dds: Preview; ops: OpsPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logs = useLiveQuery(() => db.imports.orderBy("date").reverse().toArray(), []) || [];
  const references = useLiveQuery(() => db.ops.toArray(), []) || [];
  const readOnly = p.user === "CONSULTANT";
  const [removing, setRemoving] = useState<ImportLog | null>(null);
  const [removePart, setRemovePart] = useState<"dds" | "ops" | "all">("all");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  // Impact preview: transactions only linked to this import are deleted; those
  // also brought by another import are kept. Ops refs are rebuilt from the rest.
  const impact = useLiveQuery(async () => {
    if (!removing) return null;
    const linked = await db.transactions.where("importIds").equals(removing.id).toArray();
    const rows = await db.opsImportRows.where("importId").equals(removing.id).toArray();
    let opsRemoved = 0;
    for (const atc of new Set(rows.map((r) => r.atc)))
      if ((await db.opsImportRows.where("atc").equals(atc).count()) <= 1) opsRemoved++;
    return {
      linked: linked.length,
      removed: linked.filter((t) => (t.importIds || []).length <= 1).length,
      opsRows: new Set(rows.map((r) => r.atc)).size,
      opsRemoved,
    };
  }, [removing?.id]);
  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError("");
    try {
      await deleteImport(removing.id, removePart);
      p.notify(
        removePart === "all"
          ? "Import supprimé : DDS et Ops Spe retirés, catégories et calculs recalculés."
          : removePart === "dds"
            ? "Partie DDS supprimée. Catégories et calculs recalculés."
            : "Partie Ops Spe supprimée. Les ATC concernés sont reclassés ; litres recalculés.",
      );
      setRemoving(null);
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setRemoveBusy(false);
    }
  }
  async function choose(file: File, type: "dds" | "ops") {
    setPreview(null);
    setError("");
    setBusy(true);
    if (type === "dds") setDDS(null);
    else setOps(null);
    try {
      const sheets = await workbookSheets(file);
      if (type === "dds") {
        setDDS(file);
        setDDSSheets(sheets);
        setDDSSheet(sheets[0]);
      } else {
        setOps(file);
        setOpsSheets(sheets);
        setOpsSheet(sheets[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fichier illisible");
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!dds || !ops) {
      setError("Fournissez les deux fichiers pour cet import.");
      return;
    }
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const ddsPreview = await previewImport(dds, unit, ddsSheet);
      const opsPreview = await previewOps(ops, opsSheet);
      const official = new Set([
        ...references.map((r) => r.atc),
        ...opsPreview.references.map((r) => r.atc),
      ]);
      ddsPreview.transactions.forEach((t) => {
        t.special = official.has(t.atc);
      });
      setPreview({ dds: ddsPreview, ops: opsPreview });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’analyse");
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || !dds || !ops) return;
    setBusy(true);
    setError("");
    try {
      const result = await commitImport(preview.dds, preview.ops);
      p.notify(
        `${result.accepted} transaction(s) importée(s). ${result.duplicates} doublon(s) ignoré(s). Correspondance Ops Spe actualisée.`,
      );
      setPreview(null);
      setDDS(null);
      setOps(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l’import");
    } finally {
      setBusy(false);
    }
  }
  const issues = preview
    ? [
        ...preview.dds.issues.map((i) => ({ ...i, source: "DDS" })),
        ...preview.ops.issues.map((i) => ({ ...i, source: "Ops Spe" })),
      ]
    : [];
  const available = new Set([
    ...p.allRows.map((t) => t.atc),
    ...(preview?.dds.transactions.map((t) => t.atc) || []),
  ]);
  const matched = preview?.ops.references.filter((r) => available.has(r.atc)).length || 0;
  function exportIssues() {
    const csv =
      "Source;Ligne;ATC;Type;Motif\n" +
      issues
        .map((i) =>
          [i.source, i.row, i.atc, i.kind, i.reason]
            .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
            .join(";"),
        )
        .join("\n");
    download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), "RM-SB-controle-import.csv");
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">INTÉGRATION DES DONNÉES</div>
        <h1>Import DDS & Ops Spe</h1>
        <p>Deux fichiers obligatoires. Un seul import, un classement automatique.</p>
      </div>
      <div className="import-grid">
        {(["dds", "ops"] as const).map((type) => {
          const file = type === "dds" ? dds : ops;
          const sheets = type === "dds" ? ddsSheets : opsSheets;
          return (
            <Panel
              key={type}
              title={type === "dds" ? "1. Extraction DDS" : "2. Référentiel Ops Spe"}
              subtitle={
                type === "dds"
                  ? "Colonne ATC • poids et dates de réception"
                  : "Colonne officielle N° ATC WB"
              }
            >
              <div className="drop-zone">
                <FileSpreadsheet size={32} />
                <strong>{file?.name || "Aucun fichier sélectionné"}</strong>
                <span>XLSX, XLS ou CSV • obligatoire à chaque import</span>
                <button
                  className="button"
                  disabled={busy || readOnly}
                  onClick={() => document.getElementById("file-" + type)?.click()}
                >
                  {type === "dds" ? "Importer DDS" : "Importer Ops Spe"}
                </button>
                <input
                  id={"file-" + type}
                  className="hidden"
                  type="file"
                  aria-label={
                    type === "dds" ? "Fichier extraction DDS" : "Fichier extraction Ops Spe"
                  }
                  accept=".xlsx,.xls,.csv"
                  disabled={busy || readOnly}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void choose(e.target.files[0], type);
                    e.target.value = "";
                  }}
                />
              </div>
              {file && (
                <div className="import-options">
                  <label>
                    Feuille {type === "dds" ? "DDS" : "Ops Spe"}
                    <select
                      aria-label={"Feuille " + type}
                      value={type === "dds" ? ddsSheet : opsSheet}
                      disabled={busy}
                      onChange={(e) => {
                        (type === "dds" ? setDDSSheet : setOpsSheet)(e.target.value);
                        setPreview(null);
                      }}
                    >
                      {sheets.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {type === "dds" && (
                <label>
                  Unité des poids
                  <select
                    value={unit}
                    disabled={busy || readOnly}
                    onChange={(e) => {
                      setUnit(e.target.value as "kg" | "t");
                      setPreview(null);
                    }}
                  >
                    <option value="kg">Kilogrammes → tonnes</option>
                    <option value="t">Tonnes</option>
                  </select>
                </label>
              )}
            </Panel>
          );
        })}
      </div>
      <Panel
        title="Classification automatique"
        subtitle="Priorité : Ops Spe → DANTRANS → 3rd Party"
      >
        <div className="info-box">
          ATC présent dans <strong>N° ATC WB</strong> → Opérations Spéciales, quel que soit le
          transporteur. Sinon, DANTRANS → Reverse Logistics ; autres → 3rd Party. L’historique des
          mois précédents est conservé, sans doubler les ATC.
        </div>
        <p className="muted">
          Dates DDS : MM/JJ/AAAA. Indicateurs selon Exit Time, heure Côte d’Ivoire. Analyse locale,
          y compris hors connexion. Les deux fichiers sont réinitialisés après validation.
        </p>
        {readOnly && (
          <div className="info-box">Le profil CONSULTANT ne peut pas importer de données.</div>
        )}
        {error && (
          <div className="error-box" role="alert">
            <AlertTriangle size={17} />
            {error}
          </div>
        )}
        <button
          className="button primary"
          disabled={!dds || !ops || busy || readOnly}
          onClick={analyze}
        >
          {busy ? "Traitement des fichiers…" : "Analyser les deux fichiers"}
        </button>
      </Panel>
      {preview && (
        <Panel
          title="Contrôle avant importation"
          subtitle={preview.dds.filename + " + " + preview.ops.filename}
          action={
            <button className="button primary" disabled={busy || readOnly} onClick={commit}>
              Confirmer l’import des deux fichiers
            </button>
          }
        >
          <div className="import-results">
            <div>
              <strong>{preview.dds.transactions.length}</strong>
              <span>Nouveaux voyages DDS</span>
            </div>
            <div>
              <strong>{preview.dds.issues.filter((i) => i.kind === "duplicate").length}</strong>
              <span>Doublons DDS ignorés</span>
            </div>
            <div>
              <strong>{preview.ops.references.length}</strong>
              <span>ATC Ops Spe uniques</span>
            </div>
            <div>
              <strong>
                {matched} / {preview.ops.references.length}
              </strong>
              <span>Trouvés dans le DDS enregistré ou à importer</span>
            </div>
          </div>
          <p className="table-note">
            {fmt(
              preview.dds.transactions.reduce((s, t) => s + t.net, 0),
              2,
            )}{" "}
            t à importer • {preview.ops.references.length - matched} Manquant DDS •{" "}
            {issues.filter((i) => i.kind === "invalid").length} lignes rejetées. Même sans nouveau
            voyage, la paire actualise la correspondance.
          </p>
          {issues.length > 0 && (
            <div className="issue-section">
              <div className="flex-between">
                <h4>Points de contrôle ({issues.length})</h4>
                <button className="text-button" onClick={exportIssues}>
                  <Download size={15} />
                  Exporter les anomalies
                </button>
              </div>
              <div className="table-scroll issue-table">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Ligne</th>
                      <th>ATC</th>
                      <th>Type</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 200).map((i, n) => (
                      <tr key={n}>
                        <td>{i.source}</td>
                        <td>{i.row}</td>
                        <td>{i.atc || "—"}</td>
                        <td>
                          <Badge type={i.kind === "invalid" ? "red" : "orange"}>{i.kind}</Badge>
                        </td>
                        <td>{i.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {preview.dds.transactions.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ATC</th>
                    <th>Camion</th>
                    <th>Transporteur</th>
                    <th>Net (t)</th>
                    <th>Catégorie</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.dds.transactions.slice(0, 8).map((t) => (
                    <tr key={t.atc}>
                      <td>{t.atc}</td>
                      <td>{t.truck}</td>
                      <td>{t.transporter}</td>
                      <td>{fmt(t.net, 2)}</td>
                      <td>{category(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      <Panel title="Historique des imports" subtitle="Paires importées sur cet appareil">
        {!logs.length ? (
          <Empty
            title="Aucun fichier importé pour le moment"
            text="Sélectionnez une extraction DDS et sa liste officielle Ops Spe."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fichiers DDS / Ops Spe</th>
                  <th>Date</th>
                  <th>Utilisateur</th>
                  <th>Voyages ajoutés</th>
                  <th>Doublons DDS</th>
                  <th>ATC Ops Spe</th>
                  <th>Supprimer</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.filename}
                      <small className="subtext">{l.opsFilename || "Ancien import DDS seul"}</small>
                      {(l.ddsDeleted || l.opsDeleted || l.legacy) && (
                        <div className="button-row">
                          {l.ddsDeleted && <Badge type="red">DDS supprimé</Badge>}
                          {l.opsDeleted && <Badge type="red">Ops Spe supprimé</Badge>}
                          {l.legacy && <Badge type="gray">Provenance approximative</Badge>}
                        </div>
                      )}
                    </td>
                    <td>{shortDate(l.date)}</td>
                    <td>{l.user}</td>
                    <td>{l.accepted}</td>
                    <td>{l.duplicates}</td>
                    <td>{l.opsCount ?? "—"}</td>
                    <td>
                      <button
                        className="button danger"
                        aria-label={`Supprimer l’import ${l.filename}`}
                        disabled={readOnly || removeBusy}
                        onClick={() => {
                          setRemoving(l);
                          setRemovePart(l.ddsDeleted ? "ops" : l.opsDeleted ? "dds" : "all");
                          setRemoveError("");
                        }}
                      >
                        <Trash2 size={15} />
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {removing && (
        <Modal
          title="Supprimer cet import ?"
          close={() => {
            if (!removeBusy) setRemoving(null);
          }}
        >
          <p>
            <strong>{removing.filename}</strong>
            {removing.opsFilename ? ` + ${removing.opsFilename}` : ""} — importé le{" "}
            {shortDate(removing.date)} par {removing.user}.
          </p>
          <fieldset className="radio-list" aria-label="Partie à supprimer">
            {(
              [
                ["dds", "DDS uniquement", !!removing.ddsDeleted],
                ["ops", "Ops Spe uniquement", !!removing.opsDeleted || !removing.opsFilename],
                ["all", "Import complet (DDS + Ops Spe)", false],
              ] as const
            ).map(([value, label, disabled]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="remove-part"
                  value={value}
                  checked={removePart === value}
                  disabled={disabled || removeBusy}
                  onChange={() => setRemovePart(value)}
                  aria-label={label}
                />
                {label}
                {disabled && " (déjà supprimé ou absent)"}
              </label>
            ))}
          </fieldset>
          {impact && (
            <ul>
              {removePart !== "ops" && !removing.ddsDeleted && (
                <li>
                  DDS : {impact.removed} voyage(s) supprimé(s)
                  {impact.linked - impact.removed > 0 &&
                    `, ${impact.linked - impact.removed} conservé(s) car aussi présents dans un autre import`}
                  .
                </li>
              )}
              {removePart !== "dds" && !removing.opsDeleted && (
                <li>
                  Ops Spe : {impact.opsRows} ATC concerné(s), dont {impact.opsRemoved} retiré(s) du
                  référentiel ; les autres sont reconstitués à partir des imports restants.
                </li>
              )}
            </ul>
          )}
          <div className="error-box">
            Suppression définitive. Les catégories (Ops Spe / Reverse / 3rd Party), le carburant, le
            FIFO, les DUT et les tableaux de bord sont recalculés. Les corrections manuelles de
            litres, réservations et paramètres sont conservés.
          </div>
          {removing.legacy && (
            <div className="info-box">
              Import antérieur à la v1.6 : sa provenance a été reconstituée d’après les dates
              d’import et peut être approximative.
            </div>
          )}
          {removeError && (
            <div className="error-box" role="alert">
              {removeError}
            </div>
          )}
          <div className="modal-actions">
            <button className="button" disabled={removeBusy} onClick={() => setRemoving(null)}>
              Annuler
            </button>
            <button
              className="button danger"
              disabled={readOnly || removeBusy}
              onClick={() => void confirmRemove()}
            >
              {removeBusy ? "Suppression…" : "Confirmer la suppression"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
