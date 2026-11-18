import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Fuel, Droplets, ClipboardList, Download, Save, Pencil, Trash2 } from "lucide-react";
import { db, fmt, dateISO, shortDate, settingAt, type FuelReservation } from "../lib/database";
import {
  addReservation,
  updateReservation,
  deleteReservation,
  fuelLedger,
  reservationTheory,
} from "../lib/operations";
import { exportOperational } from "../lib/operational-exports";
import { type PageProps, Panel, Kpi, Badge, Empty, Modal } from "../components/shared";
import { OpsFuel, ReverseFuel } from "./fuel-atc";
import { useFuelAmounts } from "../hooks/use-fuel-amounts";

const tabs = [
  "Nouvelle Réservation",
  "Historique des Réservations",
  "Consommation Carburant",
  "Consommation Carburant Ops Spe",
  "Carburant Reverse Log",
  "Stock Carburant",
  "Rapports Carburant",
];
export default function FuelManagement(p: PageProps) {
  const reservations = useLiveQuery(() => db.reservations.toArray(), []) || [];
  const opening = useLiveQuery(() => db.fuelOpening.get("main"), []);
  const fuel = useFuelAmounts(p.allRows, p.settings);
  const [tab, setTab] = useState("Stock Carburant");
  const [date, setDate] = useState(dateISO(new Date()) + "T15:00");
  const [number, setNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [initial, setInitial] = useState("0");
  const [pozzolana, setPozzolana] = useState("0");
  const [granite, setGranite] = useState("0");
  const [pozzolanaLitres, setPozzolanaLitres] = useState("");
  const [graniteLitres, setGraniteLitres] = useState("");
  const [litresTouched, setLitresTouched] = useState(false);
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FuelReservation | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const readOnly = p.user === "CONSULTANT";
  const end = p.to + "T23:59:59.999Z";
  const ledger = fuelLedger(reservations, opening, fuel.opsItems, p.settings, end, fuel.amounts);
  const theory = reservationTheory(reservations, ledger);
  const parsedDate = new Date(date + "Z");
  const reservationDate =
    date && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : "";
  const before = opening
    ? fuelLedger(
        reservations.filter((r) => r.id !== editing),
        opening,
        fuel.opsItems,
        p.settings,
        reservationDate,
        fuel.amounts,
      ).balance
    : Number(initial || 0);
  // Litres per trip belong to the reservation. New reservations are prefilled
  // with the forecast in force at their date until the user types a value.
  const forecastDate = reservationDate || new Date().toISOString();
  const shownPozzolanaLitres =
    editing || litresTouched
      ? pozzolanaLitres
      : String(settingAt(p.settings, "pozzolanaFuel", forecastDate));
  const shownGraniteLitres =
    editing || litresTouched
      ? graniteLitres
      : String(settingAt(p.settings, "graniteFuel", forecastDate));
  const litresValue = (v: string) => (v.trim() === "" ? null : Number(v));
  const consumptionPozzolana = Number(pozzolana || 0) * Number(shownPozzolanaLitres || 0);
  const consumptionGranite = Number(granite || 0) * Number(shownGraniteLitres || 0);
  const expected = consumptionPozzolana + consumptionGranite;
  const filtered = reservations
    .filter(
      (r) =>
        r.date.slice(0, 10) >= p.from &&
        r.date.slice(0, 10) <= p.to &&
        r.number.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const consumption = ledger.consumption.filter(
    (r) =>
      r.date.slice(0, 10) >= p.from &&
      (r.atc + " " + r.allocations.map((a) => a.number).join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const current = Math.min(
    page,
    Math.max(
      0,
      Math.ceil((tab === "Consommation Carburant" ? consumption.length : filtered.length) / 20) - 1,
    ),
  );
  function resetForm() {
    setEditing(null);
    setNumber("");
    setQuantity("");
    setComment("");
    setPozzolana("0");
    setGranite("0");
    setPozzolanaLitres("");
    setGraniteLitres("");
    setLitresTouched(false);
    setDate(dateISO(new Date()) + "T15:00");
    setError("");
  }
  function edit(r: FuelReservation) {
    setEditing(r.id);
    setDate(r.date.slice(0, 23));
    setNumber(r.number);
    setQuantity(String(r.quantity));
    setPozzolana(String(r.pozzolana));
    setGranite(String(r.granite));
    setPozzolanaLitres(r.pozzolanaLitres == null ? "" : String(r.pozzolanaLitres));
    setGraniteLitres(r.graniteLitres == null ? "" : String(r.graniteLitres));
    setLitresTouched(true);
    setComment(r.comment);
    setError("");
    setTab("Nouvelle Réservation");
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy("delete");
    setDeleteError("");
    try {
      await deleteReservation(deleting.id);
      setDeleting(null);
      p.notify("Réservation supprimée. FIFO et solde recalculés ; stock initial conservé.");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Erreur de suppression");
    } finally {
      setBusy("");
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError("");
    try {
      const input = {
        number,
        date: reservationDate,
        quantity: Number(quantity),
        pozzolana: Number(pozzolana),
        granite: Number(granite),
        pozzolanaLitres: litresValue(shownPozzolanaLitres),
        graniteLitres: litresValue(shownGraniteLitres),
        comment,
      };
      for (const v of [input.pozzolanaLitres, input.graniteLitres])
        if (v !== null && (!Number.isFinite(v) || v < 0))
          throw new Error("Les litres par voyage doivent être positifs ou vides.");
      if (editing) await updateReservation(editing, input);
      else await addReservation(input, Number(initial));
      const wasEditing = !!editing;
      resetForm();
      setTab("Historique des Réservations");
      p.notify(
        wasEditing
          ? "Réservation modifiée. FIFO et solde recalculés."
          : "Réservation carburant enregistrée. FIFO et solde recalculés.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réservation invalide");
    } finally {
      setBusy("");
    }
  }
  async function report(format: "pdf" | "xlsx" | "docx") {
    setBusy(format);
    try {
      await exportOperational(
        format,
        "RM-SB — Gestion Carburant",
        `${p.from} au ${p.to} • Stock Ops Spe uniquement • FIFO strict • Litres du fichier Ops Spe ou corrigés par ATC • 3rd Party jamais comptabilisé`,
        [
          {
            name: "Stock à clôture",
            headers: [
              "Stock initial (L)",
              "Total réservé (L)",
              "Consommé calculé (L)",
              "Solde net (L)",
              "Non couvert à sortie (L)",
            ],
            rows: [
              [ledger.initial, ledger.reserved, ledger.consumed, ledger.balance, ledger.uncovered],
            ],
          },
          {
            name: "Réservations",
            headers: [
              "Date",
              "N° Réservation",
              "Quantité (L)",
              "Rot. Pozz.",
              "Rot. Gran.",
              "L/voyage Pozz.",
              "L/voyage Gran.",
              "Conso. théorique prévue Pozz. (L)",
              "Conso. théorique prévue Gran. (L)",
              "Conso. théorique prévue totale (L)",
              "Voyages effectués Pozz.",
              "Voyages effectués Gran.",
              "Conso. théorique réalisée (L)",
              "Consommé réel FIFO (L)",
              "Écart réel − théorique (L)",
              "Commentaires",
            ],
            rows: filtered.map((r) => {
              const t = theory.get(r.id);
              const configured = !!t?.configured;
              return [
                r.date,
                r.number,
                r.quantity,
                r.pozzolana,
                r.granite,
                t?.pozzolanaLitres ?? "Non renseigné",
                t?.graniteLitres ?? "Non renseigné",
                configured ? t!.plannedPozzolana : "Non renseigné",
                configured ? t!.plannedGranite : "Non renseigné",
                configured ? t!.planned : "Non renseigné",
                t?.tripsPozzolana || 0,
                t?.tripsGranite || 0,
                configured ? t!.realisedTheory : "Non renseigné",
                t?.consumed || 0,
                configured ? t!.gap : "Non renseigné",
                r.comment,
              ];
            }),
          },
          {
            name: "Consommation",
            headers: [
              "ATC",
              "Exit Time",
              "Produit",
              "Litres",
              "Affectation FIFO",
              "Non couvert (L)",
            ],
            rows: consumption.map((r) => [
              r.atc,
              r.date,
              r.product,
              r.litres,
              r.allocations.map((a) => `${a.number}: ${a.litres} L`).join(" / "),
              r.uncovered,
            ]),
          },
        ],
        "RM-SB-carburant",
      );
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur d’export carburant");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">RÉSERVATIONS ET CONSOMMATION OPS SPE</div>
        <h1>Gestion Carburant</h1>
        <p>Réserves horodatées, consommation calculée par voyage et rapprochement FIFO.</p>
      </div>
      <div className="module-tabs">
        {tabs.map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            disabled={!!busy}
            onClick={() => {
              if (editing) {
                if (!window.confirm("Quitter la modification sans enregistrer ?")) return;
                resetForm();
              }
              setTab(t);
              setPage(0);
              setSearch("");
              setError("");
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="kpi-grid">
        <Kpi
          label="QUANTITÉ TOTALE RÉSERVÉE"
          value={ledger.reserved}
          unit="L"
          icon={Fuel}
          caption="Σ des réservations à la date de situation, hors stock initial"
        />
        <Kpi
          label="QUANTITÉ CONSOMMÉE"
          value={ledger.consumed}
          unit="L"
          icon={Droplets}
          color="blue"
          caption="Tous les voyages Ops Spe jusqu’à la date de situation (fichier ou correction)"
        />
        <Kpi
          label="QUANTITÉ DISPONIBLE"
          value={ledger.balance}
          unit="L"
          icon={Fuel}
          caption={`Réservé + stock initial (${fmt(ledger.initial)} L) − consommé`}
        />
        <Kpi
          label="NOMBRE DE RÉSERVATIONS"
          value={ledger.count}
          icon={ClipboardList}
          caption={`Situation arrêtée au ${shortDate(p.to)}`}
        />
      </div>
      {ledger.uncovered > 0 && (
        <div className="error-box">
          {fmt(ledger.uncovered)} L de consommation n’étaient pas couverts par une réserve
          disponible au moment de la sortie. Une réservation ultérieure ne couvre pas
          rétroactivement ces voyages.
        </div>
      )}
      {tab === "Consommation Carburant Ops Spe" ? (
        <OpsFuel {...p} />
      ) : tab === "Carburant Reverse Log" ? (
        <ReverseFuel {...p} />
      ) : tab === "Nouvelle Réservation" ? (
        <Panel
          title={editing ? "Modifier la réservation" : "Nouvelle réservation"}
          subtitle="Date et heure Côte d’Ivoire (UTC). Stock initial saisi uniquement au démarrage."
        >
          <form onSubmit={save}>
            <div className="reservation-form">
              <label>
                Date et heure de réservation
                <input
                  aria-label="Date et heure de réservation"
                  type="datetime-local"
                  step="0.001"
                  value={date}
                  disabled={readOnly || !!busy}
                  required
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                N° Réservation
                <input
                  aria-label="N° Réservation"
                  value={number}
                  required
                  disabled={readOnly || !!busy}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="RES-001"
                />
              </label>
              <label>
                Quantité réservée (L)
                <input
                  aria-label="Quantité réservée (L)"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  disabled={readOnly || !!busy}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              {!opening && !editing && (
                <label>
                  Stock initial disponible (L)
                  <input
                    aria-label="Stock initial disponible (L)"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    disabled={readOnly || !!busy}
                    value={initial}
                    onChange={(e) => setInitial(e.target.value)}
                  />
                </label>
              )}
              <label>
                Quantité disponible avant réservation (L)
                <input
                  aria-label="Quantité disponible avant réservation (L)"
                  value={fmt(before, 2)}
                  readOnly
                />
              </label>
              <label>
                Nb rotations Pouzzolane
                <input
                  aria-label="Nb rotations Pouzzolane"
                  type="number"
                  min="0"
                  step="1"
                  required
                  disabled={readOnly || !!busy}
                  value={pozzolana}
                  onChange={(e) => setPozzolana(e.target.value)}
                />
              </label>
              <label>
                Nb rotations Granite
                <input
                  aria-label="Nb rotations Granite"
                  type="number"
                  min="0"
                  step="1"
                  required
                  disabled={readOnly || !!busy}
                  value={granite}
                  onChange={(e) => setGranite(e.target.value)}
                />
              </label>
              <label>
                Commentaire
                <textarea
                  aria-label="Commentaire réservation"
                  value={comment}
                  disabled={readOnly || !!busy}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <fieldset className="consumption-params" aria-label="Paramètres de Consommation">
                <legend>Paramètres de Consommation</legend>
                <div className="params-grid">
                  <label>
                    L/voyage Pouzzolane
                    <input
                      aria-label="L/voyage Pouzzolane"
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={readOnly || !!busy}
                      value={shownPozzolanaLitres}
                      onChange={(e) => {
                        if (!litresTouched) setGraniteLitres(shownGraniteLitres);
                        setLitresTouched(true);
                        setPozzolanaLitres(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    L/voyage Granite
                    <input
                      aria-label="L/voyage Granite"
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={readOnly || !!busy}
                      value={shownGraniteLitres}
                      onChange={(e) => {
                        if (!litresTouched) setPozzolanaLitres(shownPozzolanaLitres);
                        setLitresTouched(true);
                        setGraniteLitres(e.target.value);
                      }}
                    />
                  </label>
                </div>
                <div className="params-result" data-testid="conso-pouzzolane">
                  <span>Consommation Pouzzolane</span>
                  <strong>{fmt(consumptionPozzolana, 2)} L</strong>
                </div>
                <div className="params-result" data-testid="conso-granite">
                  <span>Consommation Granite</span>
                  <strong>{fmt(consumptionGranite, 2)} L</strong>
                </div>
                <div className="params-result total" data-testid="conso-totale">
                  <span>Consommation Totale</span>
                  <strong>{fmt(expected, 2)} L</strong>
                </div>
                <small className="muted">
                  {editing
                    ? "Valeurs propres à cette réservation. Vide = Non renseigné."
                    : "Préremplies avec la prévision en vigueur à la date de réservation, modifiables. Enregistrées avec la réservation : un changement ultérieur des paramètres ne la modifie pas."}
                </small>
              </fieldset>
            </div>
            <div className="info-box">
              Consommation théorique prévue : <strong>{fmt(expected, 2)} L</strong> • Nouveau solde
              après réservation : <strong>{fmt(before + Number(quantity || 0), 2)} L</strong>. Les
              rotations prévues ne sont pas une consommation réelle.
              {editing &&
                " La modification recalcule toutes les affectations FIFO et peut créer un déficit. Le stock initial et sa date restent inchangés."}
            </div>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={readOnly || !!busy}>
              <Save size={16} />
              {busy
                ? "Enregistrement…"
                : editing
                  ? "Enregistrer les modifications"
                  : "Enregistrer la réservation"}
            </button>
            {editing && (
              <button
                type="button"
                className="button"
                disabled={!!busy}
                onClick={() => {
                  resetForm();
                  setTab("Historique des Réservations");
                }}
              >
                Annuler la modification
              </button>
            )}
            {readOnly && <p className="muted">CONSULTANT : consultation uniquement.</p>}
          </form>
        </Panel>
      ) : tab === "Historique des Réservations" || tab === "Consommation Carburant" ? (
        <Panel
          title={tab}
          subtitle="Filtres date, mois et année : utilisez la période d’analyse en haut de page."
        >
          <div className="table-tools">
            <input
              aria-label="Rechercher carburant"
              placeholder={
                tab === "Consommation Carburant" ? "ATC ou réservation…" : "N° réservation…"
              }
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {tab === "Historique des Réservations" ? (
            !filtered.length ? (
              <Empty
                title="Aucune réservation pour cette période"
                text="Ajoutez une réservation ou ajustez les dates."
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Actions</th>
                      <th>Date / heure</th>
                      <th>Réservation</th>
                      <th>Quantité (L)</th>
                      <th>Rot. Pozz.</th>
                      <th>Rot. Gran.</th>
                      <th>L/voy. Pozz.</th>
                      <th>L/voy. Gran.</th>
                      <th>Théorique prévue (L)</th>
                      <th>Voyages effectués P / G</th>
                      <th>Théorique réalisée (L)</th>
                      <th>Réel FIFO (L)</th>
                      <th>Écart (L)</th>
                      <th>Rotations couvertes</th>
                      <th>Commentaires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(current * 20, (current + 1) * 20).map((r) => {
                      const lot = ledger.lots.find((l) => l.id === r.id);
                      const t = theory.get(r.id);
                      const nr = <span className="muted">Non renseigné</span>;
                      return (
                        <tr key={r.id}>
                          <td>
                            <div className="button-row">
                              <button
                                className="button"
                                aria-label={`Modifier ${r.number}`}
                                disabled={readOnly || !!busy}
                                onClick={() => edit(r)}
                              >
                                <Pencil size={15} />
                                Modifier
                              </button>
                              <button
                                className="button danger"
                                aria-label={`Supprimer ${r.number}`}
                                disabled={readOnly || !!busy}
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
                          <td>
                            {new Date(r.date).toLocaleString("fr-FR", {
                              timeZone: "Africa/Abidjan",
                            })}
                          </td>
                          <td>
                            <strong>{r.number}</strong>
                          </td>
                          <td>{fmt(r.quantity, 2)}</td>
                          <td>{r.pozzolana}</td>
                          <td>{r.granite}</td>
                          <td>{t?.pozzolanaLitres == null ? nr : fmt(t.pozzolanaLitres, 2)}</td>
                          <td>{t?.graniteLitres == null ? nr : fmt(t.graniteLitres, 2)}</td>
                          <td>{t?.configured ? fmt(t.planned, 2) : nr}</td>
                          <td>
                            {t?.tripsPozzolana || 0} / {t?.tripsGranite || 0}
                          </td>
                          <td>{t?.configured ? fmt(t.realisedTheory, 2) : nr}</td>
                          <td>{fmt(lot?.consumed || 0, 2)}</td>
                          <td>
                            {t?.configured ? (
                              <Badge
                                type={
                                  Math.abs(t.gap) < 0.005 ? "green" : t.gap > 0 ? "red" : "blue"
                                }
                              >
                                {(t.gap > 0 ? "+" : "") + fmt(t.gap, 2)} L
                              </Badge>
                            ) : (
                              nr
                            )}
                          </td>
                          <td
                            style={{
                              maxWidth: 280,
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {lot?.atcs.join(", ") || "—"}
                          </td>
                          <td
                            style={{
                              maxWidth: 260,
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {r.comment || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : !consumption.length ? (
            <Empty
              title="Aucune consommation Ops Spe éligible"
              text="Aucun voyage Ops Spe sur la période sélectionnée."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ATC</th>
                    <th>Exit Time</th>
                    <th>Produit</th>
                    <th>Consommation (L)</th>
                    <th>Réserves FIFO</th>
                    <th>Couverture</th>
                  </tr>
                </thead>
                <tbody>
                  {consumption.slice(current * 20, (current + 1) * 20).map((r) => (
                    <tr key={r.atc}>
                      <td>{r.atc}</td>
                      <td>
                        {new Date(r.date).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}
                      </td>
                      <td>{r.product}</td>
                      <td>{fmt(r.litres, 2)}</td>
                      <td>
                        {r.allocations.map((a) => `${a.number} : ${fmt(a.litres)} L`).join(" / ") ||
                          "—"}
                      </td>
                      <td>
                        <Badge type={r.uncovered > 0 ? "red" : "green"}>
                          {r.uncovered > 0 ? `${fmt(r.uncovered)} L non couverts` : "Couvert"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <span>Page {current + 1}</span>
            <div>
              <button className="button" disabled={!current} onClick={() => setPage(current - 1)}>
                Précédent
              </button>
              <button
                className="button"
                disabled={
                  (current + 1) * 20 >=
                  (tab === "Consommation Carburant" ? consumption.length : filtered.length)
                }
                onClick={() => setPage(current + 1)}
              >
                Suivant
              </button>
            </div>
          </div>
        </Panel>
      ) : tab === "Stock Carburant" ? (
        <Panel
          title="Stock carburant et couverture FIFO"
          subtitle={`Situation cumulée jusqu’au ${shortDate(p.to)}, indépendante du début de la période.`}
        >
          {!ledger.lots.length ? (
            <Empty
              title="Aucune réserve enregistrée"
              text="Saisissez le stock initial et votre première réservation."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Réserve</th>
                    <th>Disponible à partir de</th>
                    <th>Quantité (L)</th>
                    <th>Consommé (L)</th>
                    <th>Reste lot (L)</th>
                    <th>Voyages couverts, au moins partiellement</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.lots.map((l) => (
                    <tr key={l.id}>
                      <td>{l.number}</td>
                      <td>
                        {new Date(l.date).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}
                      </td>
                      <td>{fmt(l.quantity)}</td>
                      <td>{fmt(l.consumed)}</td>
                      <td>{fmt(l.remaining)}</td>
                      <td>{l.atcs.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="info-box">
            Le solde net = stock initial + réservations − consommation calculée. Les restes des lots
            et le solde net peuvent différer en présence de consommation non couverte. Un voyage
            réparti sur deux lots n’est jamais consommé deux fois.
          </div>
        </Panel>
      ) : (
        <Panel
          title="Rapports carburant"
          subtitle="Stock cumulé à clôture, réservations et consommation de la période sélectionnée."
        >
          <div className="button-row">
            {(["pdf", "xlsx", "docx"] as const).map((f) => (
              <button className="button" key={f} disabled={!!busy} onClick={() => void report(f)}>
                <Download size={16} />
                Exporter {f.toUpperCase()}
              </button>
            ))}
          </div>
        </Panel>
      )}
      {deleting && (
        <Modal
          title="Supprimer la réservation ?"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            Supprimer <strong>{deleting.number}</strong> ({fmt(deleting.quantity, 2)} L) ?
          </p>
          <div className="error-box">
            Cette suppression est définitive. Les consommations et affectations FIFO seront
            recalculées ; des voyages peuvent devenir non couverts. Le stock initial, sa date et les
            autres réservations restent conservés.
          </div>
          {deleteError && (
            <div className="error-box" role="alert">
              {deleteError}
            </div>
          )}
          <div className="button-row">
            <button className="button" disabled={!!busy} onClick={() => setDeleting(null)}>
              Annuler
            </button>
            <button
              className="button danger"
              disabled={readOnly || !!busy}
              onClick={() => void remove()}
            >
              {busy ? "Suppression…" : "Confirmer la suppression"}
            </button>
          </div>
        </Modal>
      )}
      <p className="muted">
        Consommation réelle = litres de la colonne Carburant du fichier Ops Spe, ou correction
        manuelle par ATC ; une cellule vide vaut 0 L. Tous les voyages Ops Spe sont consommés, y
        compris ceux antérieurs à la première réserve (non couverts). Les paramètres de consommation
        (L/voyage) de chaque réservation sont indicatifs et n’affectent pas le stock FIFO. Reverse
        Log est suivi séparément et n’est jamais déduit de ce stock ; aucun carburant 3rd Party
        n’est comptabilisé. Seule une réserve antérieure à Exit Time peut couvrir le voyage.
      </p>
    </>
  );
}
