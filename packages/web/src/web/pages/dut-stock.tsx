import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FilePlus, Files, CheckCircle, Save, Pencil, Trash2 } from "lucide-react";
import { db, dateISO, fmt, shortDate, type DutReceipt } from "../lib/database";
import { dutStockLedger, saveDutReceipt, deleteDutReceipt } from "../lib/dut-stock";
import { Panel, Kpi, Empty, Modal, type PageProps } from "../components/shared";

export default function DutStock(p: PageProps) {
  const receipts = useLiveQuery(() => db.dutReceipts.toArray(), []);
  const opening = useLiveQuery(async () => (await db.dutOpening.get("main")) || null, []);
  const refs = useLiveQuery(() => db.ops.toArray(), []) || [];
  const [tab, setTab] = useState("Historique des réceptions");
  const [date, setDate] = useState(dateISO(new Date()));
  const [quantity, setQuantity] = useState("");
  const [initial, setInitial] = useState("0");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<DutReceipt | null>(null);
  const [deleting, setDeleting] = useState<DutReceipt | null>(null);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const readOnly = p.user === "CONSULTANT";
  const loaded = receipts !== undefined && opening !== undefined;
  const stock = dutStockLedger(receipts || [], opening, refs, p.allRows, p.to);
  const draftReceipt: DutReceipt = {
    id: editing?.id || "preview",
    date,
    quantity: Number(quantity || 0),
    comment,
    createdBy: p.user,
    createdAt: editing?.createdAt || new Date().toISOString(),
  };
  const preview = dutStockLedger(
    [...(receipts || []).filter((r) => r.id !== editing?.id), draftReceipt],
    opening || { id: "main", date, quantity: Number(initial || 0) },
    refs,
    p.allRows,
  ).history.find((r) => r.id === draftReceipt.id);
  const history = stock.history.filter((r) => r.date >= p.from && r.date <= p.to).reverse();
  const usage = stock.usage.filter((r) => r.date >= p.from);
  const count = tab === "Feuilles utilisées" ? usage.length : history.length;
  const current = Math.min(page, Math.max(0, Math.ceil(count / 20) - 1));
  function reset() {
    setEditing(null);
    setDate(dateISO(new Date()));
    setQuantity("");
    setComment("");
    setError("");
  }
  function edit(r: DutReceipt) {
    setEditing(r);
    setDate(r.date);
    setQuantity(String(r.quantity));
    setComment(r.comment);
    setError("");
    setTab("Nouvelle réception");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!loaded || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveDutReceipt(
        { date, quantity: Number(quantity), comment },
        Number(initial),
        editing?.id,
      );
      p.notify(
        editing
          ? "Réception DUT modifiée. Stock recalculé."
          : "Réception DUT enregistrée. Stock recalculé.",
      );
      reset();
      setTab("Historique des réceptions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réception invalide");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      await deleteDutReceipt(deleting.id);
      setDeleting(null);
      p.notify("Réception DUT supprimée. Stock initial conservé et soldes recalculés.");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Erreur de suppression");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Stock de feuilles DUT"
      subtitle={`Situation cumulée au ${shortDate(p.to)}. Réceptions disponibles au début de leur journée ; une feuille par DUT unique.`}
    >
      <div className="kpi-grid">
        <Kpi
          label="FEUILLES REÇUES"
          value={stock.received}
          icon={FilePlus}
          caption="Cumul des réceptions, hors stock initial"
        />
        <Kpi
          label="FEUILLES UTILISÉES"
          value={stock.used}
          icon={Files}
          color="blue"
          caption="DUT uniques depuis le démarrage du stock"
        />
        <Kpi
          label="FEUILLES DISPONIBLES"
          value={stock.available}
          icon={CheckCircle}
          caption="Stock initial + reçues − utilisées"
        />
        <Kpi
          label="STOCK INITIAL DUT"
          value={stock.initial}
          icon={Files}
          caption={
            opening
              ? `Au ${shortDate(opening.date)}`
              : "À saisir une seule fois à la première réception"
          }
        />
      </div>
      {!opening && loaded && (
        <div className="info-box">
          Commencez par une nouvelle réception. Le stock initial correspond au disponible au début
          de cette date ; les DUT utilisés avant cette date ne seront pas déduits.
        </div>
      )}
      {stock.available < 0 && (
        <div className="error-box">
          Stock insuffisant : {fmt(-stock.available)} feuille(s) manquante(s). Vérifiez les
          réceptions et les dates d’utilisation.
        </div>
      )}
      {stock.historicalDeficit > 0 && stock.available >= 0 && (
        <div className="error-box">
          Le stock a présenté un déficit historique allant jusqu’à {fmt(stock.historicalDeficit)}{" "}
          feuille(s). Une réception ultérieure ne change pas le disponible à une date passée.
        </div>
      )}
      {stock.unknown.length > 0 && (
        <div className="info-box">
          {stock.unknown.length} DUT unique(s) sans date d’utilisation connue : non déduits du
          stock. Renseignez la date Ops Spe ou importez le DDS correspondant.
        </div>
      )}
      <div className="module-tabs">
        {["Nouvelle réception", "Historique des réceptions", "Feuilles utilisées"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            disabled={busy || !loaded}
            onClick={() => {
              if (editing && !window.confirm("Quitter la modification sans enregistrer ?")) return;
              reset();
              setTab(t);
              setPage(0);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Nouvelle réception" ? (
        <form onSubmit={save}>
          <h3>{editing ? "Modifier la réception DUT" : "Nouvelle réception de feuilles DUT"}</h3>
          <div className="reservation-form">
            <label>
              Date de réception
              <input
                aria-label="Date de réception DUT"
                type="date"
                required
                value={date}
                disabled={readOnly || busy}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Nombre de feuilles reçues
              <input
                aria-label="Nombre de feuilles DUT reçues"
                type="number"
                min="1"
                step="1"
                required
                value={quantity}
                disabled={readOnly || busy}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            {!opening && !editing && (
              <label>
                Stock initial disponible
                <input
                  aria-label="Stock initial de feuilles DUT"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={initial}
                  disabled={readOnly || busy}
                  onChange={(e) => setInitial(e.target.value)}
                />
              </label>
            )}
            <label>
              Disponible avant réception
              <input
                aria-label="Feuilles DUT disponibles avant réception"
                readOnly
                value={fmt(preview?.before || 0)}
              />
            </label>
            <label>
              Disponible après réception
              <input
                aria-label="Feuilles DUT disponibles après réception"
                readOnly
                value={fmt(preview?.after || 0)}
              />
            </label>
            <label>
              Commentaire
              <textarea
                aria-label="Commentaire réception DUT"
                value={comment}
                disabled={readOnly || busy}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </div>
          <div className="info-box">
            Soldes avant/après calculés au moment de la réception, avant les utilisations de la même
            journée. Le stock initial et sa date restent conservés après modification ou suppression
            d’une réception.
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="button-row">
            <button className="button primary" disabled={readOnly || busy || !loaded}>
              <Save size={16} />
              {busy
                ? "Enregistrement…"
                : editing
                  ? "Enregistrer les modifications DUT"
                  : "Enregistrer la réception DUT"}
            </button>
            {editing && (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => {
                  reset();
                  setTab("Historique des réceptions");
                }}
              >
                Annuler la modification DUT
              </button>
            )}
          </div>
          {readOnly && <p className="muted">CONSULTANT : consultation uniquement.</p>}
        </form>
      ) : tab === "Historique des réceptions" ? (
        !history.length ? (
          <Empty
            title="Aucune réception DUT pour cette période"
            text="Ajoutez une réception ou ajustez la période d’analyse."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Actions</th>
                  <th>Date de réception</th>
                  <th>Nombre reçu</th>
                  <th>Disponible avant</th>
                  <th>Disponible après</th>
                  <th>Commentaire</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(current * 20, (current + 1) * 20).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="button-row">
                        <button
                          className="button"
                          aria-label={`Modifier réception DUT ${r.id}`}
                          disabled={readOnly || busy}
                          onClick={() => edit(r)}
                        >
                          <Pencil size={15} />
                          Modifier
                        </button>
                        <button
                          className="button danger"
                          aria-label={`Supprimer réception DUT ${r.id}`}
                          disabled={readOnly || busy}
                          onClick={() => {
                            setDeleting(r);
                            setDeleteError("");
                          }}
                        >
                          <Trash2 size={15} />
                          Supprimer
                        </button>
                      </div>
                    </td>
                    <td>{shortDate(r.date)}</td>
                    <td>{fmt(r.quantity)}</td>
                    <td>{fmt(r.before)}</td>
                    <td>{fmt(r.after)}</td>
                    <td style={{ maxWidth: 260, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      {r.comment || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : !usage.length ? (
        <Empty
          title="Aucune feuille DUT utilisée pour cette période"
          text="Une seule déduction par DUT, à sa première date connue, à partir du démarrage du stock."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Première utilisation</th>
                <th>DUT unique</th>
                <th>ATC associés</th>
                <th>Feuilles utilisées</th>
              </tr>
            </thead>
            <tbody>
              {usage.slice(current * 20, (current + 1) * 20).map((r) => (
                <tr key={r.dut}>
                  <td>{shortDate(r.date)}</td>
                  <td>{r.dut}</td>
                  <td style={{ maxWidth: 300, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    {r.atcs.join(", ")}
                  </td>
                  <td>1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab !== "Nouvelle réception" && (
        <div className="pagination">
          <span>
            Page {current + 1} / {Math.max(1, Math.ceil(count / 20))}
          </span>
          <div>
            <button className="button" disabled={!current} onClick={() => setPage(current - 1)}>
              Précédent
            </button>
            <button
              className="button"
              disabled={(current + 1) * 20 >= count}
              onClick={() => setPage(current + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      )}
      <p className="muted">
        Utilisation = première date connue du DUT (Exit Time DDS, sinon Date Ops Spe), même sans
        correspondance DDS. {stock.excludedBeforeStart} DUT antérieur(s) au démarrage non déduits.
        Les filtres ne remettent pas le stock à zéro ; un DUT partagé entre plusieurs ATC ou
        périodes n’est déduit qu’une fois. Le stock physique est indépendant du prix DUT.
      </p>
      {deleting && (
        <Modal
          title="Supprimer la réception DUT ?"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            Supprimer la réception du <strong>{shortDate(deleting.date)}</strong> de{" "}
            <strong>{fmt(deleting.quantity)} feuilles</strong> ?
          </p>
          <div className="error-box">
            Suppression définitive. Les soldes seront recalculés et peuvent devenir négatifs. Le
            stock initial et sa date, les autres réceptions et les DUT importés restent conservés.
          </div>
          {deleteError && (
            <div className="error-box" role="alert">
              {deleteError}
            </div>
          )}
          <div className="button-row">
            <button className="button" disabled={busy} onClick={() => setDeleting(null)}>
              Annuler
            </button>
            <button
              className="button danger"
              disabled={readOnly || busy}
              onClick={() => void remove()}
            >
              {busy ? "Suppression…" : "Confirmer la suppression DUT"}
            </button>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
