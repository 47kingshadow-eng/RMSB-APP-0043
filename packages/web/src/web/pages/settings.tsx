import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Save,
  Database,
  Download,
  Upload,
  ShieldCheck,
  KeyRound,
  HardDrive,
  WifiOff,
  RotateCcw,
  Fuel,
  History,
  Trash2,
} from "lucide-react";
import { type PageProps, Panel, Badge, Modal } from "../components/shared";
import {
  db,
  requireWrite,
  backupSchema,
  dateISO,
  settingsAt,
  addSettingsVersion,
  deleteSettingsVersion,
  versionedKeys,
  versionedLabels,
  type SettingsVersion,
  type VersionedKey,
  restoreBackup,
  resetImports,
  resetFuelStock,
  passwordHash,
  type Role,
} from "../lib/database";
import { exportBackup, readBackup } from "../lib/exports";
function pick(s: Record<VersionedKey, number>) {
  return Object.fromEntries(versionedKeys.map((k) => [k, s[k]])) as Record<VersionedKey, number>;
}
export default function SettingsPage(p: PageProps) {
  // Versioned parameters are edited at an effective date; only the values that
  // differ from those in force at that date create a new version.
  const [effectiveDate, setEffectiveDate] = useState(dateISO(new Date()));
  const inForce = useMemo(
    () => settingsAt(p.settings, effectiveDate || dateISO(new Date())),
    [p.settings, effectiveDate],
  );
  const [draft, setDraft] = useState<Record<VersionedKey, number>>(() => pick(inForce));
  const [organization, setOrganization] = useState(p.settings.organization);
  const [currency, setCurrency] = useState(p.settings.dutCurrency);
  const [deletingVersion, setDeletingVersion] = useState<SettingsVersion | null>(null);
  const history = useMemo(
    () =>
      (p.settings.history || [])
        .slice()
        .sort(
          (a, b) =>
            b.effectiveDate.localeCompare(a.effectiveDate) ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [p.settings.history],
  );
  const [busy, setBusy] = useState("");
  const [restore, setRestore] = useState<ReturnType<typeof backupSchema.parse> | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetError, setResetError] = useState("");
  const [fuelResetOpen, setFuelResetOpen] = useState(false);
  const [fuelResetError, setFuelResetError] = useState("");
  const fuelState = useLiveQuery(
    async () => ({
      reservations: await db.reservations.count(),
      opening: await db.fuelOpening.get("main"),
      entries: await db.fuelEntries.count(),
    }),
    [],
  );
  const [target, setTarget] = useState<Role>("ADMIN");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const admin = p.user === "ADMIN";
  useEffect(() => setDraft(pick(inForce)), [inForce]);
  useEffect(() => {
    setOrganization(p.settings.organization);
    setCurrency(p.settings.dutCurrency);
  }, [p.settings.organization, p.settings.dutCurrency]);
  const changed = versionedKeys.filter((k) => draft[k] !== inForce[k]);
  async function save() {
    setBusy("settings");
    try {
      requireWrite(true);
      if (!organization.trim()) throw new Error("L’organisation est obligatoire.");
      if (!currency.trim()) throw new Error("La devise DUT est obligatoire.");
      for (const k of changed)
        if (!Number.isFinite(draft[k]) || draft[k] < 0)
          throw new Error(versionedLabels[k] + " : valeur positive ou nulle requise.");
      const messages: string[] = [];
      if (organization !== p.settings.organization || currency !== p.settings.dutCurrency) {
        // Not versioned: organization and currency apply everywhere.
        const main = await db.settings.get("main");
        if (main)
          await db.settings.put({
            ...main,
            organization: organization.trim(),
            dutCurrency: currency.trim(),
          });
        messages.push("organisation / devise mises à jour");
      }
      if (changed.length) {
        await addSettingsVersion(
          effectiveDate,
          Object.fromEntries(changed.map((k) => [k, draft[k]])),
        );
        messages.push(
          `${changed.length} paramètre(s) versionné(s) à compter du ${new Date(effectiveDate + "T12:00:00Z").toLocaleDateString("fr-FR")}`,
        );
      }
      p.notify(
        messages.length
          ? "Paramètres enregistrés : " +
              messages.join(" ; ") +
              ". Les opérations antérieures gardent leurs valeurs."
          : "Aucune modification à enregistrer.",
      );
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy("");
    }
  }
  async function removeVersion() {
    if (!deletingVersion) return;
    setBusy("version");
    try {
      await deleteSettingsVersion(deletingVersion.id);
      setDeletingVersion(null);
      p.notify("Version supprimée. Les calculs concernés sont recalculés.");
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusy("");
    }
  }
  async function backup(format: "json" | "xlsx") {
    setBusy(format);
    try {
      requireWrite(true);
      await exportBackup(format);
      p.notify("Sauvegarde exportée. Conservez-la hors de cet appareil.");
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy("");
    }
  }
  async function prepare(file: File) {
    setBusy("restore");
    try {
      requireWrite(true);
      const parsed = backupSchema.safeParse(await readBackup(file));
      if (!parsed.success)
        throw new Error("Sauvegarde invalide : " + parsed.error.issues[0]?.message);
      setRestore(parsed.data);
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Sauvegarde illisible");
    } finally {
      setBusy("");
    }
  }
  async function confirmRestore() {
    if (!restore) return;
    setBusy("restore");
    try {
      const count = await restoreBackup(restore);
      p.notify(`Sauvegarde restaurée : ${count} transaction(s) fusionnées.`);
      setRestore(null);
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Échec de restauration");
    } finally {
      setBusy("");
    }
  }
  async function confirmReset() {
    setBusy("reset");
    setResetError("");
    try {
      await resetImports();
      setResetOpen(false);
      p.notify(
        "Imports réinitialisés : DDS, Ops Spe et historique à zéro. Comptes, paramètres et objectifs conservés.",
      );
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Échec de la réinitialisation.");
    } finally {
      setBusy("");
    }
  }
  async function confirmFuelReset() {
    setBusy("fuel-reset");
    setFuelResetError("");
    try {
      await resetFuelStock();
      setFuelResetOpen(false);
      p.notify(
        "Gestion Carburant réinitialisée : réservations et stock initial supprimés. Litrages par ATC conservés.",
      );
    } catch (e) {
      setFuelResetError(e instanceof Error ? e.message : "Échec de la réinitialisation carburant.");
    } finally {
      setBusy("");
    }
  }
  async function changePassword() {
    setBusy("password");
    try {
      requireWrite(true);
      const adminUser = await db.users.get("ADMIN");
      if (!adminUser || (await passwordHash(oldPassword, adminUser.salt)) !== adminUser.hash)
        throw new Error("Le mot de passe administrateur actuel est incorrect.");
      if (newPassword.length < 8)
        throw new Error("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      const salt = crypto.randomUUID();
      await db.users.put({ name: target, salt, hash: await passwordHash(newPassword, salt) });
      setNewPassword("");
      setOldPassword("");
      p.notify(`Mot de passe du compte ${target} modifié.`);
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">VOTRE ENVIRONNEMENT DE TRAVAIL</div>
        <h1>Paramètres</h1>
        <p>Personnalisez vos coefficients et sécurisez vos données locales.</p>
        <button className="button primary title-action" disabled={!admin || !!busy} onClick={save}>
          <Save size={16} />
          Enregistrer les paramètres
        </button>
      </div>
      <div className="settings-grid">
        <Panel
          title="Coefficients de transport"
          subtitle="Versionnés par date d’effet : chaque opération utilise la valeur en vigueur à sa date"
          action={<Badge type="blue">ADMIN uniquement</Badge>}
        >
          <label className="organization-label">
            Date d’effet des modifications
            <input
              aria-label="Date d’effet"
              type="date"
              value={effectiveDate}
              disabled={!admin || !!busy}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </label>
          <div className="table-scroll">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Capacité / camion (t)</th>
                  <th>Carburant prévisionnel / voyage (L)</th>
                  <th>Aller-retour (km)</th>
                </tr>
              </thead>
              <tbody>
                {(["pozzolana", "granite"] as const).map((product) => (
                  <tr key={product}>
                    <td>
                      <Badge type={product === "pozzolana" ? "green" : "blue"}>
                        {product === "pozzolana" ? "Pouzzolane" : "Granite"}
                      </Badge>
                    </td>
                    {(["Capacity", "Fuel", "Distance"] as const).map((suffix) => {
                      const key = (product + suffix) as VersionedKey;
                      return (
                        <td key={key}>
                          <input
                            type="number"
                            min={suffix === "Capacity" ? "0.01" : "0"}
                            step="0.01"
                            value={draft[key]}
                            disabled={!admin}
                            className={draft[key] !== inForce[key] ? "changed" : ""}
                            aria-label={product + " " + suffix}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td>
                    <Badge type="orange">Reverse Log</Badge>
                  </td>
                  <td>—</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.reverseFuel}
                      disabled={!admin}
                      className={draft.reverseFuel !== inForce.reverseFuel ? "changed" : ""}
                      aria-label="reverse Fuel"
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, reverseFuel: Number(e.target.value) }))
                      }
                    />
                  </td>
                  <td>Distance par produit</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">
            Valeurs affichées : celles en vigueur au{" "}
            {effectiveDate
              ? new Date(effectiveDate + "T12:00:00Z").toLocaleDateString("fr-FR")
              : "—"}
            .
            {changed.length
              ? ` ${changed.length} modification(s) en attente d’enregistrement.`
              : " Aucune modification en attente."}
          </p>
          <div className="settings-explanation">
            <p>
              <strong>Tonnage prévu</strong> = camions prévus × capacité en vigueur à la date du
              plan
            </p>
            <p>
              <strong>Carburant prévisionnel</strong> = valeur proposée par défaut dans les
              Paramètres de Consommation d’une nouvelle réservation (chaque réservation garde ses
              propres L/voyage)
            </p>
            <p>
              <strong>Carburant réel</strong> = Ops Spe : colonne Carburant ou correction (vide = 0
              L) ; Reverse Log : coefficient en vigueur à la date du voyage. Les 3rd Party ne sont
              jamais comptés.
            </p>
            <p>
              <strong>Distance estimée</strong> = voyages Reverse Log et Ops Spe × distance
              aller-retour en vigueur (3rd Party exclus)
            </p>
          </div>
          <label className="organization-label">
            Organisation / intitulé des rapports (non versionné)
            <input
              aria-label="Organisation"
              value={organization}
              disabled={!admin}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </label>
        </Panel>
        <Panel title="Stockage local" subtitle="Vos données restent sur cet appareil">
          <div className="storage-hero">
            <HardDrive size={30} />
            <strong>IndexedDB</strong>
            <Badge>Offline first</Badge>
          </div>
          <div className="storage-lines">
            <div>
              <span>Transactions enregistrées</span>
              <strong>{p.allRows.length}</strong>
            </div>
            <div>
              <span>Base cloud obligatoire</span>
              <strong>Aucune</strong>
            </div>
            <div>
              <span>Date utilisée pour les analyses</span>
              <strong>Sortie DDS</strong>
            </div>
            <div>
              <span>Unité de travail</span>
              <strong>Tonnes</strong>
            </div>
          </div>
          <div className="info-box">
            <WifiOff size={18} />
            Après la première mise en cache, imports, analyses et exports fonctionnent hors
            connexion. Installez depuis Chrome ou Edge sur Windows.
          </div>
        </Panel>
      </div>
      <Panel
        title="Paramètres DUT"
        subtitle="Chaque DUT unique officiel génère un coût, même si son ATC est Manquant DDS."
        action={<Badge type="blue">ADMIN uniquement</Badge>}
      >
        <div className="reservation-form">
          <label>
            Prix unitaire DUT (versionné, date d’effet ci-dessus)
            <input
              aria-label="Prix unitaire DUT"
              type="number"
              min="0"
              step="1"
              value={draft.dutPrice}
              disabled={!admin}
              className={draft.dutPrice !== inForce.dutPrice ? "changed" : ""}
              onChange={(e) => setDraft((d) => ({ ...d, dutPrice: Number(e.target.value) }))}
            />
          </label>
          <label>
            Devise (non versionnée)
            <input
              aria-label="Devise DUT"
              value={currency}
              disabled={!admin}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Chaque DUT est valorisé au prix en vigueur à sa date. Un nouveau prix ne modifie pas les
          coûts des DUT antérieurs à sa date d’effet.
        </p>
      </Panel>
      <Panel
        title="Historique des versions de paramètres"
        subtitle="Une version ne contient que les valeurs modifiées à sa date d’effet"
        action={<History size={20} />}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date d’effet</th>
                <th>Paramètres</th>
                <th>Créée par</th>
                <th>Créée le</th>
                <th>Statut</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((v) => {
                const today = dateISO(new Date());
                const status = v.base ? "Base" : v.effectiveDate > today ? "Future" : "Appliquée";
                return (
                  <tr key={v.id}>
                    <td>
                      {v.base
                        ? "Origine"
                        : new Date(v.effectiveDate + "T12:00:00Z").toLocaleDateString("fr-FR")}
                    </td>
                    <td style={{ whiteSpace: "normal", maxWidth: 420 }}>
                      {versionedKeys
                        .filter((k) => v.values[k] !== undefined)
                        .map(
                          (k) => `${versionedLabels[k]} : ${v.values[k]!.toLocaleString("fr-FR")}`,
                        )
                        .join(" • ")}
                    </td>
                    <td>{v.createdBy}</td>
                    <td>{new Date(v.createdAt).toLocaleString("fr-FR")}</td>
                    <td>
                      <Badge
                        type={status === "Base" ? "gray" : status === "Future" ? "orange" : "green"}
                      >
                        {status}
                      </Badge>
                    </td>
                    <td>
                      {v.base ? (
                        "—"
                      ) : (
                        <button
                          className="button danger"
                          aria-label={`Supprimer la version du ${v.effectiveDate}`}
                          disabled={!admin || !!busy}
                          onClick={() => setDeletingVersion(v)}
                        >
                          <Trash2 size={15} />
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {deletingVersion && (
        <Modal
          title="Supprimer cette version ?"
          close={() => {
            if (!busy) setDeletingVersion(null);
          }}
        >
          <p>
            Version du{" "}
            <strong>
              {new Date(deletingVersion.effectiveDate + "T12:00:00Z").toLocaleDateString("fr-FR")}
            </strong>{" "}
            :{" "}
            {versionedKeys
              .filter((k) => deletingVersion.values[k] !== undefined)
              .map((k) => versionedLabels[k])
              .join(", ")}
            .
          </p>
          <div className="error-box">
            Les opérations à partir de cette date reprendront la version précédente pour ces
            paramètres. Tonnages prévus, distances, carburant Reverse Log et coûts DUT seront
            recalculés. Les L/voyage enregistrés dans les réservations ne changent pas.
          </div>
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={() => setDeletingVersion(null)}>
              Annuler
            </button>
            <button
              className="button danger"
              disabled={!!busy}
              onClick={() => void removeVersion()}
            >
              {busy === "version" ? "Suppression…" : "Confirmer la suppression"}
            </button>
          </div>
        </Modal>
      )}
      <Panel
        title="Sauvegarde & restauration"
        subtitle="Exportez votre projet complet avant tout changement d’appareil"
        action={<Database size={21} />}
      >
        <div className="backup-grid">
          <div>
            <h4>Exporter toutes les données</h4>
            <p>
              Transactions, DUT, réceptions de feuilles DUT et leur stock initial, réservations
              carburant, stock initial, litrages carburant par ATC (Ops Spe et Reverse Log),
              objectifs, commentaires, coefficients, comptes locaux et historique. Les mots de passe
              sont hachés, jamais exportés en clair.
            </p>
            <div className="button-row">
              <button className="button" disabled={!admin || !!busy} onClick={() => backup("json")}>
                <Download size={16} />
                Sauvegarder JSON
              </button>
              <button className="button" disabled={!admin || !!busy} onClick={() => backup("xlsx")}>
                <Download size={16} />
                Sauvegarder Excel
              </button>
            </div>
          </div>
          <div>
            <h4>Restaurer un projet</h4>
            <p>
              Fusion par ATC et date. Les enregistrements existants ayant la même clé, les
              coefficients et les comptes seront remplacés par ceux de la sauvegarde. Le référentiel
              Ops Spe est fusionné par ATC ; les catégories sont recalculées à partir de ce
              référentiel, jamais des anciennes affectations manuelles.
            </p>
            <input
              aria-label="Fichier sauvegarde RM-SB"
              className="hidden"
              ref={ref}
              type="file"
              accept=".json,.xlsx"
              onChange={(e) => {
                if (e.target.files?.[0]) void prepare(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <button
              className="button"
              disabled={!admin || !!busy}
              onClick={() => ref.current?.click()}
            >
              <Upload size={16} />
              Importer une sauvegarde
            </button>
          </div>
        </div>
        <div className="warning-note">
          Effacer les données du navigateur ou changer de profil Windows peut supprimer l’accès au
          projet local. Gardez une sauvegarde sur un autre support.
        </div>
      </Panel>
      <Panel
        title="Comptes & droits locaux"
        subtitle="Aucune authentification cloud obligatoire"
        action={<ShieldCheck size={22} />}
      >
        <div className="account-grid">
          <table>
            <thead>
              <tr>
                <th>Compte</th>
                <th>Accès</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Badge type="blue">ADMIN</Badge>
                </td>
                <td>Accès complet, paramètres et restauration</td>
              </tr>
              <tr>
                <td>
                  <Badge>SUPERVISER</Badge>
                </td>
                <td>Imports DDS + Ops Spe, transactions et objectifs</td>
              </tr>
              <tr>
                <td>
                  <Badge type="orange">CONSULTANT</Badge>
                </td>
                <td>Consultation et exports de rapports uniquement</td>
              </tr>
            </tbody>
          </table>
          <div>
            <h4>
              <KeyRound size={16} className="inline-icon" />
              Modifier un mot de passe
            </h4>
            <label>
              Compte
              <select
                disabled={!admin}
                value={target}
                onChange={(e) => setTarget(e.target.value as Role)}
              >
                {["ADMIN", "SUPERVISER", "CONSULTANT"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Mot de passe ADMIN actuel
              <input
                aria-label="Mot de passe ADMIN actuel"
                type="password"
                value={oldPassword}
                autoComplete="current-password"
                disabled={!admin}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </label>
            <label>
              Nouveau mot de passe (8 caractères minimum)
              <input
                aria-label="Nouveau mot de passe"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                disabled={!admin}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button
              className="button"
              onClick={changePassword}
              disabled={!admin || !!busy || !newPassword || !oldPassword}
            >
              Mettre à jour
            </button>
          </div>
        </div>
        <div className="warning-note">
          Les rôles locaux ne remplacent pas la sécurité du poste : une personne ayant accès au
          profil navigateur peut accéder à IndexedDB. Protégez votre session Windows et vos
          sauvegardes.
        </div>
      </Panel>
      {admin && (
        <Panel
          title="Réinitialiser Gestion Carburant"
          subtitle="Action réservée au profil ADMIN"
          action={<Badge type="red">Action destructive</Badge>}
        >
          <p>
            Supprime uniquement les réservations carburant et le stock initial carburant, pour
            pouvoir ressaisir un premier stock correct.
          </p>
          <div className="warning-note">
            Conservés : imports DDS et Ops Spe, litrages Ops Spe et Reverse Log par ATC et leurs
            corrections, stock et coûts DUT, comptes, paramètres et planification.
          </div>
          <button
            className="button"
            disabled={!!busy}
            onClick={() => {
              setFuelResetError("");
              setFuelResetOpen(true);
            }}
          >
            <Fuel size={16} />
            Réinitialiser Gestion Carburant
          </button>
        </Panel>
      )}
      {admin && fuelResetOpen && (
        <Modal
          title="Réinitialiser la Gestion Carburant ?"
          close={() => {
            if (!busy) setFuelResetOpen(false);
          }}
        >
          <div className="error-box">
            Cette action supprime définitivement les données suivantes sur cet appareil :
          </div>
          <ul>
            <li>{fuelState?.reservations ?? 0} réservation(s) carburant supprimée(s).</li>
            <li>
              Stock initial carburant{" "}
              {fuelState?.opening
                ? `(${fuelState.opening.quantity.toLocaleString("fr-FR")} L) supprimé.`
                : "(non renseigné)."}
            </li>
          </ul>
          <div className="info-box">
            Conservés : {fuelState?.entries ?? 0} saisie(s) / correction(s) de litres par ATC, les
            litres importés du fichier Ops Spe, les imports DDS et Ops Spe, le stock DUT, les
            comptes, paramètres et objectifs. La prochaine réservation redemandera le stock initial.
          </div>
          {fuelResetError && (
            <div className="error-box" role="alert">
              {fuelResetError}
            </div>
          )}
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={() => setFuelResetOpen(false)}>
              Annuler
            </button>
            <button className="button primary" disabled={!!busy} onClick={confirmFuelReset}>
              {busy === "fuel-reset"
                ? "Réinitialisation…"
                : "Confirmer la réinitialisation carburant"}
            </button>
          </div>
        </Modal>
      )}
      {admin && (
        <Panel
          title="Réinitialisation des imports"
          subtitle="Action réservée au profil ADMIN"
          action={<Badge type="red">Action destructive</Badge>}
        >
          <p>
            Remettez tous les imports à zéro, sur toutes les périodes : transactions DDS, liste
            officielle Ops Spe et historique des imports.
          </p>
          <div className="warning-note">
            Les comptes, mots de passe, paramètres et objectifs de planification seront conservés.
            Exportez une sauvegarde avant de continuer.
          </div>
          <button
            className="button"
            disabled={!!busy}
            onClick={() => {
              setResetError("");
              setResetOpen(true);
            }}
          >
            <RotateCcw size={16} />
            Réinitialiser
          </button>
        </Panel>
      )}
      {admin && resetOpen && (
        <Modal
          title="Réinitialiser tous les imports ?"
          close={() => {
            if (!busy) setResetOpen(false);
          }}
        >
          <div className="error-box">
            Cette action supprime définitivement toutes les données importées sur cet appareil, pour
            tous les mois.
          </div>
          <ul>
            <li>{p.allRows.length} transaction(s) DDS supprimée(s).</li>
            <li>Toute la liste Ops Spe et ses correspondances supprimées.</li>
            <li>Tout l’historique des imports supprimé.</li>
          </ul>
          <div className="info-box">
            Les comptes, mots de passe, paramètres et objectifs sont conservés. Les réservations, le
            stock initial carburant et les corrections de litres par ATC restent enregistrés ; leur
            consommation dérivée est recalculée à zéro. Une sauvegarde exportée peut être restaurée
            ensuite. Les réceptions et le stock initial de feuilles DUT sont aussi conservés ; les
            utilisations dérivées des imports reviennent à zéro.
          </div>
          {resetError && (
            <div className="error-box" role="alert">
              {resetError}
            </div>
          )}
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={() => setResetOpen(false)}>
              Annuler
            </button>
            <button className="button primary" disabled={!!busy} onClick={confirmReset}>
              {busy === "reset" ? "Réinitialisation…" : "Confirmer la réinitialisation"}
            </button>
          </div>
        </Modal>
      )}
      {restore && (
        <Modal title="Confirmer la restauration" close={() => setRestore(null)}>
          <div className="info-box">
            {restore.transactions.length} transactions • {restore.plans.length} journées planifiées
            • {restore.users.length} comptes • {restore.ops.length} ATC Ops Spe •{" "}
            {restore.reservations.length} réservations carburant • {restore.fuelEntries.length}{" "}
            litrages ATC saisis • {restore.dutReceipts.length} réceptions DUT
          </div>
          <p>
            Les données seront fusionnées. Les clés existantes et les paramètres seront remplacés.
            Exportez une sauvegarde actuelle avant de continuer.
            {restore.version === 1 &&
              " Sauvegarde v1 : aucun référentiel officiel inclus ; les anciennes affectations manuelles ne seront pas rétablies."}
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setRestore(null)}>
              Annuler
            </button>
            <button className="button primary" disabled={!!busy} onClick={confirmRestore}>
              {busy ? "Restauration…" : "Restaurer le projet"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
