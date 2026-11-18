import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  LayoutDashboard,
  FileUp,
  List,
  RotateCcw,
  Layers,
  Truck,
  CalendarDays,
  FileText,
  Settings,
  Download,
  Wifi,
  WifiOff,
  Bell,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  ArrowRight,
  LockKeyhole,
  CheckCircle2,
  CircleHelp,
  ChevronRight,
  Fuel,
  Receipt,
} from "lucide-react";
import {
  initialize,
  db,
  defaults,
  useSession,
  dateISO,
  type Role,
  type Category,
  type Transaction,
} from "../lib/database";
import { Modal } from "../components/shared";
import { usePWA } from "../hooks/use-pwa";
import Dashboard from "./dashboard";
import Transactions from "./transactions";
import ImportDDS from "./import-dds";
import OpsMatching from "./ops-matching";
import Planning from "./planning";
import Reports from "./reports";
import SettingsPage from "./settings";
import FuelManagement from "./fuel";
import Duties from "./dut";

const items = [
  { name: "Dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { name: "Import DDS", label: "Import DDS", icon: FileUp },
  { name: "Correspondance Ops Spe", label: "Correspondance Ops Spe", icon: ShieldCheck },
  { name: "Transactions", label: "Transactions", icon: List },
  { name: "Reverse Logistics", label: "Reverse Logistics", icon: RotateCcw },
  { name: "Opérations Spéciales", label: "Opérations Spéciales", icon: Layers },
  { name: "3rd Party", label: "3rd Party", icon: Truck },
  { name: "Gestion Carburant", label: "Gestion Carburant", icon: Fuel },
  { name: "Gestion DUT", label: "Gestion DUT", icon: Receipt },
  { name: "Planification Hebdomadaire", label: "Planification", icon: CalendarDays },
  { name: "Rapports", label: "Rapports", icon: FileText },
  { name: "Paramètres", label: "Paramètres", icon: Settings },
];
function Login({ install }: { install: () => void }) {
  const login = useSession((s) => s.login);
  const [name, setName] = useState("ADMIN");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(name.trim().toUpperCase() as Role, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <img src="/images/logo.png" alt="Logo RM-SB" />
          <div>
            <strong>RM-SB</strong>
            <span>RAW MATERIAL STOCK BUILDING</span>
          </div>
        </div>
        <div className="login-pitch">
          <span className="eyebrow">FROM QUARRY TO STOCK, WITH INSIGHT.</span>
          <h1>
            Chaque voyage.
            <br />
            Chaque tonne.
            <br />
            <em>Sous contrôle.</em>
          </h1>
          <p>
            Votre espace de pilotage pour la réception, le suivi et l’analyse des matières
            premières.
          </p>
          <div className="login-materials">
            <span>
              <i className="dot green-dot" />
              POUZZOLANE
            </span>
            <span>
              <i className="dot white-dot" />
              GRANITE
            </span>
          </div>
          <div className="login-visual">
            <div className="login-bars">
              {[28, 43, 51, 65, 83, 96, 119].map((h, i) => (
                <i key={i} style={{ height: h, background: i > 4 ? "#b8d99d" : "#2a694c" }} />
              ))}
            </div>
            <div>
              <strong>
                De la carrière
                <br />à votre stock.
              </strong>
              <span>Track. Control. Analyze. Report.</span>
            </div>
          </div>
        </div>
        <footer>
          <ShieldCheck size={16} />
          Une application locale, pensée pour fonctionner hors connexion.
        </footer>
      </section>
      <section className="login-form-side">
        <button className="button login-install" onClick={install}>
          <Download size={16} />
          Installer
        </button>
        <form className="login-form" onSubmit={submit}>
          <span className="login-lock">
            <LockKeyhole size={25} />
          </span>
          <div className="eyebrow">BIENVENUE DANS VOTRE ESPACE</div>
          <h2>Connexion à RM-SB</h2>
          <p>Connectez-vous avec votre compte local pour accéder à vos opérations.</p>
          <label>
            Nom d’utilisateur
            <input
              aria-label="Nom d’utilisateur"
              autoComplete="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ADMIN, SUPERVISER ou CONSULTANT"
              required
            />
          </label>
          <label>
            Mot de passe
            <input
              aria-label="Mot de passe"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Votre mot de passe"
              required
            />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="button primary login-submit" disabled={busy}>
            {busy ? "Connexion…" : "Accéder à mon espace"}
            <ArrowRight size={18} />
          </button>
          <div className="login-local-note">
            <ShieldCheck size={16} />
            <span>
              Aucun compte cloud requis.
              <br />
              Vos données restent sur cet appareil.
            </span>
          </div>
        </form>
        <div className="login-form-footer">
          RM-SB • Raw Material STOCK BUILDING <span>Version 1.0</span>
        </div>
      </section>
    </div>
  );
}
export default function Workspace() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState("");
  const [page, setPage] = useState("Dashboard");
  const today = dateISO(new Date());
  const monthStart = today.slice(0, 7) + "-01";
  const monthEnd = dateISO(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 12));
  const [from, setFrom] = useState(localStorage.getItem("rmsb-from") || monthStart);
  const [to, setTo] = useState(localStorage.getItem("rmsb-to") || monthEnd);
  const [menu, setMenu] = useState(false);
  const [installModal, setInstallModal] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState("");
  const [alerts, setAlerts] = useState(false);
  const { user, logout } = useSession();
  useEffect(() => {
    setPage("Dashboard");
    setMenu(false);
  }, [user]);
  const pwa = usePWA();
  useEffect(() => {
    initialize()
      .then(() => setReady(true))
      .catch((e) => setInitError("Le stockage local est indisponible : " + String(e)));
  }, []);
  useEffect(() => {
    localStorage.setItem("rmsb-from", from);
    localStorage.setItem("rmsb-to", to);
  }, [from, to]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  const allRows = useLiveQuery(() => db.transactions.toArray(), []) as Transaction[] | undefined;
  const mainSettings = useLiveQuery(() => db.settings.get("main"), []);
  const settingsHistory = useLiveQuery(() => db.settingsHistory.toArray(), []);
  // Calculation parameters are time-versioned; history travels with settings
  // and is memoized so derived computations keep a stable input.
  const settings = useMemo(
    () => ({ ...(mainSettings || defaults), history: settingsHistory || [] }),
    [mainSettings, settingsHistory],
  );
  const plans = useLiveQuery(
    () => db.plans.where("date").between(from, to, true, true).toArray(),
    [from, to],
  );
  const notify = (message: string) => setToast(message);
  const navigate = (name: string) => {
    setPage(name);
    setMenu(false);
    window.scrollTo({ top: 0 });
  };
  async function install() {
    if (pwa.installed) {
      setInstallModal(true);
      return;
    }
    if (!(await pwa.prompt())) setInstallModal(true);
  }
  if (initError)
    return (
      <div className="fatal-error">
        <h2>Stockage local indisponible</h2>
        <p>{initError}</p>
        <p>
          Autorisez le stockage du navigateur et ouvrez l’application dans un onglet Chrome ou Edge.
        </p>
        <button className="button" onClick={() => location.reload()}>
          Réessayer
        </button>
      </div>
    );
  if (!ready || !allRows || !plans)
    return (
      <div className="loading-screen">
        <img src="/images/logo.png" alt="RM-SB" />
        <span>Ouverture de votre espace local…</span>
      </div>
    );
  const installation = (
    <Modal
      title={pwa.installed ? "RM-SB est installé" : "Installer RM-SB sur votre Desktop"}
      close={() => setInstallModal(false)}
    >
      <div className="install-intro">
        <img src="/images/icon-192.png" alt="Logo RM-SB" />
        <div>
          <h3>Raw Material STOCK BUILDING</h3>
          <p>Votre application, dans une fenêtre dédiée sur Windows.</p>
        </div>
      </div>
      {pwa.installed ? (
        <div className="info-box">L’application fonctionne déjà en mode installé.</div>
      ) : (
        <>
          <ol className="install-steps">
            <li>
              Ouvrez l’application publiée dans un <strong>onglet Chrome ou Microsoft Edge</strong>{" "}
              (pas dans l’aperçu intégré).
            </li>
            <li>
              Cliquez sur <strong>Installer</strong>, ou sur le menu du navigateur →{" "}
              <strong>Installer cette page en tant qu’application</strong>.
            </li>
            <li>
              Confirmez l’installation. Choisissez l’épinglage à la barre des tâches ou au bureau si
              proposé.
            </li>
          </ol>
          <div className="info-box">
            L’installation nécessite HTTPS et une première ouverture en ligne. Aucun fichier .exe
            n’est nécessaire. Le navigateur décide de la disponibilité du dialogue d’installation.
          </div>
        </>
      )}
      <div className="install-status">
        <ShieldCheck size={18} />
        {pwa.offlineReady
          ? "Cache hors ligne prêt"
          : navigator.serviceWorker.controller
            ? "Service worker actif — cache disponible après le chargement"
            : "Chargement initial : le cache sera préparé à l’ouverture"}
        {pwa.error && <small className="red">{pwa.error}</small>}
      </div>
      <button className="button primary" onClick={() => setInstallModal(false)}>
        Compris
      </button>
    </Modal>
  );
  if (!user)
    return (
      <>
        <Login install={install} />
        {installModal && installation}
      </>
    );
  const rows = allRows.filter((t) => t.exit.slice(0, 10) >= from && t.exit.slice(0, 10) <= to);
  const props = {
    rows,
    allRows,
    plans,
    settings,
    from,
    to,
    user,
    navigate,
    notify,
  };
  return (
    <div className="workspace">
      {menu && (
        <button
          aria-label="Fermer la navigation"
          className="sidebar-shade"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <div className="sidebar-brand">
          <img src="/images/logo.png" alt="Logo RM-SB" />
          <div>
            <strong>RM-SB</strong>
            <span>
              RAW MATERIAL
              <br />
              STOCK BUILDING
            </span>
          </div>
        </div>
        <div className="workspace-tag">
          <span className="status-dot" />
          ESPACE LOGISTIQUE
        </div>
        <span className="nav-label">PILOTAGE</span>
        <nav>
          {items.map(({ name, label, icon: Icon }, i) => (
            <div key={name}>
              {i === 7 && <span className="nav-label lower">ANALYSE & GESTION</span>}
              <button
                className={"nav-item " + (page === name ? "active" : "")}
                onClick={() => navigate(name)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {name === "Transactions" && <small>{allRows.length}</small>}
                {page === name && name !== "Transactions" && (
                  <ChevronRight size={14} className="nav-chevron" />
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={22} />
            <div>
              <strong>Vos données, chez vous.</strong>
              <span>Stockage local • Offline first</span>
            </div>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            Guide de prise en main
            <ArrowRight size={14} />
          </button>
          <div className="sidebar-version">
            <span>RM-SB v1.6</span>
            <span>LOCAL</span>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Ouvrir la navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={21} />
            </button>
            <span>Espace logistique</span>
            <ChevronRight size={14} />
            <strong>{items.find((i) => i.name === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className={"connection " + (!pwa.online ? "offline" : "")}>
              {pwa.online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{pwa.online ? "Mode local" : "Hors connexion"}</span>
            </span>
            <button className="button install-button" onClick={install}>
              {pwa.installed ? <CheckCircle2 size={15} /> : <Download size={15} />}{" "}
              {pwa.installed ? "Installé" : "Installer"}
            </button>
            <button
              className="icon-button notification-button"
              aria-label="État et notifications"
              onClick={() => setAlerts(true)}
            >
              <Bell size={19} />
              <i />
            </button>
            <div className="user-profile">
              <div className="avatar">{user.slice(0, 2)}</div>
              <div>
                <strong>
                  {user === "ADMIN"
                    ? "Administrateur"
                    : user === "SUPERVISER"
                      ? "Superviseur"
                      : "Consultant"}
                </strong>
                <span>Compte local</span>
              </div>
              <button
                className="icon-button"
                onClick={logout}
                title="Déconnexion"
                aria-label="Se déconnecter"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>
        <main className="content">
          <div className="period-toolbar">
            <div>
              <CalendarDays size={16} />
              <span>Période d’analyse</span>
            </div>
            <div className="date-range">
              <input
                type="date"
                value={from}
                aria-label="Date de début"
                onChange={(e) => {
                  if (e.target.value) {
                    setFrom(e.target.value);
                    if (e.target.value > to) setTo(e.target.value);
                  }
                }}
              />
              <span>au</span>
              <input
                type="date"
                value={to}
                aria-label="Date de fin"
                onChange={(e) => {
                  if (e.target.value) {
                    setTo(e.target.value);
                    if (e.target.value < from) setFrom(e.target.value);
                  }
                }}
              />
            </div>
            <div className="period-presets">
              <button
                onClick={() => {
                  setFrom(today);
                  setTo(today);
                }}
              >
                Aujourd’hui
              </button>
              <button
                onClick={() => {
                  setFrom(monthStart);
                  setTo(monthEnd);
                }}
              >
                Ce mois
              </button>
              <button
                onClick={() => {
                  if (allRows.length) {
                    setFrom(
                      allRows.reduce(
                        (a, t) => (t.exit.slice(0, 10) < a ? t.exit.slice(0, 10) : a),
                        allRows[0].exit.slice(0, 10),
                      ),
                    );
                    setTo(
                      allRows.reduce(
                        (a, t) => (t.exit.slice(0, 10) > a ? t.exit.slice(0, 10) : a),
                        allRows[0].exit.slice(0, 10),
                      ),
                    );
                  } else notify("Importez des transactions pour afficher toute la période.");
                }}
              >
                Tout
              </button>
            </div>
          </div>
          {page === "Dashboard" ? (
            <Dashboard {...props} />
          ) : page === "Import DDS" ? (
            <ImportDDS {...props} />
          ) : page === "Correspondance Ops Spe" ? (
            <OpsMatching {...props} />
          ) : page === "Gestion Carburant" ? (
            <FuelManagement {...props} />
          ) : page === "Gestion DUT" ? (
            <Duties {...props} />
          ) : page === "Planification Hebdomadaire" ? (
            <Planning {...props} />
          ) : page === "Rapports" ? (
            <Reports {...props} />
          ) : page === "Paramètres" ? (
            <SettingsPage {...props} />
          ) : (
            <Transactions
              key={page}
              {...props}
              module={page === "Transactions" ? undefined : (page as Category)}
            />
          )}
        </main>
      </div>
      {toast && (
        <output className="toast" aria-live="polite">
          <CheckCircle2 size={19} />
          <span>{toast}</span>
          <button aria-label="Fermer la notification" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </output>
      )}
      {installModal && installation}
      {alerts && (
        <Modal title="État de votre espace" close={() => setAlerts(false)}>
          <div className="info-box">
            {allRows.length} transactions enregistrées sur cet appareil.
          </div>
          <p>
            Connexion réseau : {pwa.online ? "disponible" : "hors connexion"}. Les données métier
            sont locales, sans synchronisation cloud.
          </p>
          <p>
            Cache PWA :{" "}
            {pwa.offlineReady
              ? "prêt"
              : navigator.serviceWorker.controller
                ? "service worker actif"
                : "en cours de préparation"}
            .
          </p>
          <button
            className="button"
            onClick={() => {
              navigate("Import DDS");
              setAlerts(false);
            }}
          >
            Voir l’historique des imports
          </button>
        </Modal>
      )}
      {help && (
        <Modal title="Guide de prise en main" close={() => setHelp(false)}>
          <ol className="install-steps">
            <li>
              <strong>Import DDS</strong> : fournissez les deux fichiers DDS et Ops Spe à chaque
              import, vérifiez l’unité, analysez puis confirmez la paire.
            </li>
            <li>
              <strong>Correspondance Ops Spe</strong> : contrôlez les ATC officiels importés et les
              ATC Manquant DDS. Les transactions sont classées automatiquement.
            </li>
            <li>
              <strong>Gestion Carburant</strong> : saisissez le stock initial une seule fois, puis
              les réservations horodatées avec leurs Paramètres de Consommation (L/voyage Pouzzolane
              et Granite, propres à chaque réservation). La consommation réelle Ops Spe provient de
              la colonne Carburant (vide = 0 L) ou d’une correction tracée, et consomme les lots en
              FIFO. Reverse Log utilise un coefficient versionné (50 L/voyage par défaut) et n’est
              jamais déduit du stock ; 3rd Party n’est jamais comptabilisé.
            </li>
            <li>
              <strong>Gestion DUT</strong> : contrôlez les DUT officiels uniques et leurs ATC, y
              compris les ATC Manquant DDS. Le prix unitaire se configure dans Paramètres. Gérez les
              réceptions de feuilles dans Stock de feuilles DUT : disponible avant/après calculé,
              stock initial unique et déduction automatique d’une feuille par DUT à sa première
              utilisation connue depuis le démarrage. Les réceptions sont modifiables et
              supprimables.
            </li>
            <li>
              <strong>Planification</strong> : sélectionnez le mois et sa semaine. S1 = du 1er au 7,
              S2 = 8–14, S3 = 15–21, S4 = 22–28, S5 = du 29 à la fin du mois. Renseignez les camions
              prévus et les commentaires.
            </li>
            <li>
              <strong>Rapports</strong> : choisissez votre période et exportez la synthèse PDF,
              Excel ou Word.
            </li>
            <li>
              <strong>Paramètres</strong> : chaque coefficient (capacités, distances, carburant,
              prix DUT) est versionné par date d’effet ; l’historique n’est jamais recalculé.
              Sauvegardez régulièrement le projet.
            </li>
          </ol>
          <div className="info-box">
            ATC présent dans N° ATC WB : Opérations Spéciales, prioritaire sur le transporteur.
            Sinon DANTRANS : Reverse Logistics ; autres : 3rd Party. Aucun classement manuel.
            L’historique des mois précédents est conservé, avec un ATC unique.
          </div>
          <p className="muted">
            Les mots de passe initiaux sont ceux de votre cahier des charges (incluant le caractère
            « : » final). L’administrateur peut les modifier dans Paramètres.
          </p>
        </Modal>
      )}
    </div>
  );
}
