import { useMemo, useState } from "react";
import {
  Search,
  Download,
  ArrowDownUp,
  Truck,
  Weight,
  Layers,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { type PageProps, Kpi, Panel, Empty, Badge, Modal } from "../components/shared";
import {
  category,
  fmt,
  shortDate,
  products,
  type Transaction,
  type Category,
} from "../lib/database";
import { exportTransactions } from "../lib/exports";
export default function Transactions(p: PageProps & { module?: Category }) {
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("Tous les produits");
  const [cat, setCat] = useState("Toutes les catégories");
  const [sort, setSort] = useState<keyof Transaction>("exit");
  const [direction, setDirection] = useState(-1);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const base = useMemo(
    () => p.rows.filter((t) => !p.module || category(t) === p.module),
    [p.rows, p.module],
  );
  const rows = useMemo(
    () =>
      base
        .filter(
          (t) =>
            (product === "Tous les produits" || t.product === product) &&
            (cat === "Toutes les catégories" || category(t) === cat) &&
            [t.atc, t.truck, t.driver, t.transporter, t.product]
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => {
          const aa = a[sort],
            bb = b[sort];
          return (
            direction *
            (typeof aa === "number" && typeof bb === "number"
              ? aa - bb
              : String(aa).localeCompare(String(bb)))
          );
        }),
    [base, product, cat, search, sort, direction],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  const visible = rows.slice(currentPage * 20, (currentPage + 1) * 20);
  const readOnly = p.user === "CONSULTANT";
  function changeSort(field: keyof Transaction) {
    setDirection(field === sort ? -direction : 1);
    setSort(field);
  }
  return (
    <>
      <div className="page-title">
        <div className="eyebrow">SUIVI DES RÉCEPTIONS</div>
        <h1>{p.module || "Transactions"}</h1>
        <p>
          {p.module === "Reverse Logistics"
            ? "Les transports DANTRANS, hors opérations spéciales."
            : p.module === "3rd Party"
              ? "Les transporteurs externes, hors opérations spéciales."
              : p.module === "Opérations Spéciales"
                ? "ATC présents dans la liste officielle Ops Spe, prioritaires sur le transporteur."
                : "Retrouvez vos opérations de transport, classées automatiquement."}
        </p>
        <button
          className="button title-action"
          onClick={() => exportTransactions(rows)}
          disabled={!rows.length}
        >
          <Download size={16} />
          Exporter Excel
        </button>
      </div>
      {p.module && (
        <div className="kpi-grid module-kpis">
          <Kpi
            label="TONNAGE TOTAL"
            value={base.reduce((s, t) => s + t.net, 0)}
            unit="t"
            icon={Weight}
            caption="Sur la période sélectionnée"
          />
          <Kpi
            label="NOMBRE DE VOYAGES"
            value={base.length}
            icon={Truck}
            caption="Sur la période sélectionnée"
            color="blue"
          />
          {products.map((product) => {
            const group = base.filter((t) => t.product === product);
            return (
              <Kpi
                key={product}
                label={product}
                value={group.reduce((s, t) => s + t.net, 0)}
                unit="t"
                icon={Layers}
                caption={`${fmt(group.length)} voyage(s)`}
                color={product === "GRANITE" ? "blue" : "green"}
              />
            );
          })}
        </div>
      )}
      <Panel
        title="Registre des transactions"
        subtitle={`${fmt(rows.length)} transaction(s) • poids en tonnes`}
        action={<Badge type="blue">{p.module || "Toutes opérations"}</Badge>}
      >
        <div className="table-tools">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Rechercher les transactions"
              placeholder="Rechercher ATC, camion, chauffeur…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              setPage(0);
            }}
            aria-label="Filtrer par produit"
          >
            <option>Tous les produits</option>
            {products.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          {!p.module && (
            <select
              value={cat}
              onChange={(e) => {
                setCat(e.target.value);
                setPage(0);
              }}
              aria-label="Filtrer par catégorie"
            >
              <option>Toutes les catégories</option>
              {["Reverse Logistics", "Opérations Spéciales", "3rd Party"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          )}
        </div>
        {!rows.length ? (
          <Empty
            title={
              base.length
                ? "Aucun résultat pour ces filtres"
                : "Aucune transaction pour cette période"
            }
            text={
              base.length
                ? "Modifiez votre recherche ou vos filtres."
                : "Importez une extraction DDS ou ajustez les dates."
            }
            action={!readOnly ? () => p.navigate("Import DDS") : undefined}
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    ["Sortie", "exit"],
                    ["ATC / Camion", "atc"],
                    ["Produit", "product"],
                    ["Transporteur", "transporter"],
                    ["Poids net (t)", "net"],
                  ].map(([name, field]) => (
                    <th key={field}>
                      <button
                        className="sort-button"
                        onClick={() => changeSort(field as keyof Transaction)}
                      >
                        {name}
                        <ArrowDownUp size={12} />
                      </button>
                    </th>
                  ))}
                  <th>Catégorie</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.atc}>
                    <td>
                      {shortDate(t.exit)}
                      <small className="subtext">
                        {new Date(t.exit).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Africa/Abidjan",
                        })}
                      </small>
                    </td>
                    <td>
                      <strong>{t.atc}</strong>
                      <small className="subtext">{t.truck}</small>
                    </td>
                    <td>
                      <Badge type={t.product === "GRANITE" ? "blue" : "green"}>
                        {t.product === "GRANITE" ? "Granite" : "Pouzzolane"}
                      </Badge>
                    </td>
                    <td>
                      {t.transporter}
                      <small className="subtext">{t.driver.slice(0, 25)}</small>
                    </td>
                    <td className="numeric">
                      <strong>{fmt(t.net, 2)}</strong>
                    </td>
                    <td>
                      <Badge
                        type={
                          t.special
                            ? "orange"
                            : category(t) === "Reverse Logistics"
                              ? "green"
                              : "blue"
                        }
                      >
                        {category(t)}
                      </Badge>
                    </td>
                    <td>
                      <button className="text-button" onClick={() => setDetail(t)}>
                        Détails
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {rows.length ? currentPage * 20 + 1 : 0}–{Math.min((currentPage + 1) * 20, rows.length)}{" "}
            sur {rows.length} transactions
          </span>
          <div>
            <button
              className="icon-button"
              disabled={currentPage === 0}
              aria-label="Page précédente"
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Page {currentPage + 1} / {Math.max(1, Math.ceil(rows.length / 20))}
            </span>
            <button
              className="icon-button"
              disabled={(currentPage + 1) * 20 >= rows.length}
              aria-label="Page suivante"
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </Panel>
      {p.module === "3rd Party" && base.length > 0 && (
        <Panel title="Performance par transporteur" subtitle="Hors DANTRANS">
          <table>
            <thead>
              <tr>
                <th>Transporteur</th>
                <th>Voyages</th>
                <th>Pouzzolane (t)</th>
                <th>Granite (t)</th>
                <th>Total (t)</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set(base.map((t) => t.transporter))].map((name) => {
                const group = base.filter((t) => t.transporter === name);
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{group.length}</td>
                    {products.map((product) => (
                      <td key={product}>
                        {fmt(
                          group.filter((t) => t.product === product).reduce((s, t) => s + t.net, 0),
                          2,
                        )}
                      </td>
                    ))}
                    <td>
                      {fmt(
                        group.reduce((s, t) => s + t.net, 0),
                        2,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
      {detail && (
        <Modal title={"Transaction " + detail.atc} close={() => setDetail(null)}>
          <div className="detail-grid">
            {[
              ["Camion", detail.truck],
              ["Produit", detail.product],
              ["Transporteur", detail.transporter],
              ["Chauffeur", detail.driver],
              [
                "Entrée",
                new Date(detail.entry).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }),
              ],
              [
                "Sortie",
                new Date(detail.exit).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }),
              ],
              ["Expéditeur", detail.sender],
              ["Destinataire", detail.receiver],
              ["Poids tare", fmt(detail.tare, 2) + " t"],
              ["Poids brut", fmt(detail.gross, 2) + " t"],
              ["Poids net", fmt(detail.net, 2) + " t"],
              ["Catégorie", category(detail)],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value || "—"}</strong>
              </div>
            ))}
          </div>
          {detail.assignedAt && (
            <div className="info-box">
              Classification automatique : {shortDate(detail.assignedAt)} — {detail.assignedBy}
              <p>{detail.comment || "Sans commentaire"}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
