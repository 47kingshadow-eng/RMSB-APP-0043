import { useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Modal, Badge } from "../components/shared";
import {
  category,
  fmt,
  products,
  tripDistance,
  type Category,
  type Product,
  type Settings,
  type Transaction,
} from "../lib/database";
import type { OpsFuelItem } from "../lib/fuel-atc";

export type DrillMetric = "tonnage" | "trips" | "fuel" | "distance";
const titles: Record<DrillMetric, string> = {
  tonnage: "Tonnage total",
  trips: "Total des voyages",
  fuel: "Conso. Carburant Totale",
  distance: "Distance estimée",
};
const units: Record<DrillMetric, string> = { tonnage: "t", trips: "", fuel: "L", distance: "km" };
const digits: Record<DrillMetric, number> = { tonnage: 2, trips: 0, fuel: 0, distance: 0 };
const allCats: Category[] = ["Reverse Logistics", "Opérations Spéciales", "3rd Party"];
const productLabel = (p: Product) => (p === "POUZZOLANE" ? "Pouzzolane" : "Granite");
const OUTSIDE = "HORS_DDS";

// 3-level drill-down: global → category → product. Fuel and distance never count 3rd Party.
export function DashboardDrill({
  metric,
  rows,
  settings,
  amounts,
  outside,
  close,
}: {
  metric: DrillMetric;
  rows: Transaction[];
  settings: Settings;
  amounts: Map<string, number>;
  outside: OpsFuelItem[];
  close: () => void;
}) {
  const [cat, setCat] = useState<Category | null>(null);
  const [product, setProduct] = useState<Product | typeof OUTSIDE | null>(null);
  const cats = metric === "fuel" || metric === "distance" ? allCats.slice(0, 2) : allCats;
  const outsideFuel = outside.reduce((s, o) => s + o.litres, 0);
  const measure = (list: Transaction[], m: DrillMetric) =>
    m === "tonnage"
      ? list.reduce((s, t) => s + t.net, 0)
      : m === "trips"
        ? list.length
        : m === "distance"
          ? list.reduce((s, t) => s + tripDistance(t, settings), 0)
          : list.reduce(
              (s, t) => s + (category(t) === "3rd Party" ? 0 : amounts.get(t.atc) || 0),
              0,
            );
  const ofCat = (c: Category) => rows.filter((t) => category(t) === c);
  const catValue = (c: Category) =>
    measure(ofCat(c), metric) +
    (metric === "fuel" && c === "Opérations Spéciales" ? outsideFuel : 0);
  const total = cats.reduce((s, c) => s + catValue(c), 0);
  const show = (v: number, m: DrillMetric = metric) =>
    fmt(v, digits[m]) + (units[m] ? " " + units[m] : "");
  const share = (v: number) => (total ? fmt((v / total) * 100, 1) + " %" : "—");
  const back = () => (product ? setProduct(null) : setCat(null));
  const level = product ? 3 : cat ? 2 : 1;
  const crumb = [
    titles[metric],
    cat,
    product === OUTSIDE ? "Hors DDS" : product && productLabel(product),
  ]
    .filter(Boolean)
    .join(" › ");
  return (
    <Modal title={titles[metric]} close={close}>
      <div className="drill-head">
        {level > 1 && (
          <button className="button" onClick={back} aria-label="Retour niveau précédent">
            <ArrowLeft size={15} /> Retour
          </button>
        )}
        <span className="drill-crumb" data-testid="drill-crumb">
          {crumb}
        </span>
        <Badge type="blue">Niveau {level} / 3</Badge>
      </div>
      {level === 1 && (
        <table className="drill-table" data-testid="drill-global">
          <thead>
            <tr>
              <th>Catégorie</th>
              <th className="numeric">{titles[metric]}</th>
              <th className="numeric">Part</th>
              <th aria-label="Ouvrir" />
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c} className="clickable" onClick={() => setCat(c)}>
                <td>
                  <button className="link-button" aria-label={`Détail ${c}`}>
                    {c}
                  </button>
                </td>
                <td className="numeric">{show(catValue(c))}</td>
                <td className="numeric">{share(catValue(c))}</td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>TOTAL</td>
              <td className="numeric" data-testid="drill-total">
                {show(total)}
              </td>
              <td className="numeric">{total ? "100 %" : "—"}</td>
              <td aria-label="—" />
            </tr>
          </tfoot>
        </table>
      )}
      {level === 2 && cat && (
        <table className="drill-table" data-testid="drill-category">
          <thead>
            <tr>
              <th>Produit</th>
              <th className="numeric">{titles[metric]}</th>
              <th aria-label="Ouvrir" />
            </tr>
          </thead>
          <tbody>
            {products.map((pr) => {
              const v = measure(
                ofCat(cat).filter((t) => t.product === pr),
                metric,
              );
              return (
                <tr key={pr} className="clickable" onClick={() => setProduct(pr)}>
                  <td>
                    <button className="link-button" aria-label={`Détail ${productLabel(pr)}`}>
                      {productLabel(pr)}
                    </button>
                  </td>
                  <td className="numeric">{show(v)}</td>
                  <td>
                    <ChevronRight size={15} />
                  </td>
                </tr>
              );
            })}
            {metric === "fuel" && cat === "Opérations Spéciales" && outside.length > 0 && (
              <tr className="clickable" onClick={() => setProduct(OUTSIDE)}>
                <td>
                  <button className="link-button" aria-label="Détail Hors DDS">
                    Réf. Ops Spe absentes du DDS
                  </button>
                </td>
                <td className="numeric">{show(outsideFuel)}</td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>TOTAL {cat}</td>
              <td className="numeric">{show(catValue(cat))}</td>
              <td aria-label="—" />
            </tr>
          </tfoot>
        </table>
      )}
      {level === 3 && cat && product && product !== OUTSIDE && (
        <ProductDetail
          list={ofCat(cat).filter((t) => t.product === product)}
          third={cat === "3rd Party"}
          measure={measure}
          show={show}
        />
      )}
      {level === 3 && product === OUTSIDE && (
        <>
          <p className="muted">
            Références Ops Spe officielles sans transaction DDS, datées par la date Ops Spe. Elles
            comptent dans le carburant consommé, pas dans le tonnage ni les voyages.
          </p>
          <table className="drill-table" data-testid="drill-product">
            <tbody>
              <tr>
                <th>Références</th>
                <td className="numeric">{outside.length}</td>
              </tr>
              <tr>
                <th>Carburant</th>
                <td className="numeric">{show(outsideFuel, "fuel")}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

function ProductDetail({
  list,
  third,
  measure,
  show,
}: {
  list: Transaction[];
  third: boolean;
  measure: (l: Transaction[], m: DrillMetric) => number;
  show: (v: number, m?: DrillMetric) => string;
}) {
  const lines: [string, string][] = [
    ["Tonnage", show(measure(list, "tonnage"), "tonnage")],
    ["Voyages", show(measure(list, "trips"), "trips")],
    ["Distance", third ? "Non comptée (3rd Party)" : show(measure(list, "distance"), "distance")],
    ["Carburant", third ? "Non compté (3rd Party)" : show(measure(list, "fuel"), "fuel")],
  ];
  return (
    <table className="drill-table" data-testid="drill-product">
      <tbody>
        {lines.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td className="numeric" data-testid={"drill-" + k.toLowerCase()}>
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
