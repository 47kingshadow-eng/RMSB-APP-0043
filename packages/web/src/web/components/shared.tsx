import { X, FileUp, ArrowUpRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { fmt, type Transaction, type Plan, type Settings, type Role } from "../lib/database";
export interface PageProps {
  rows: Transaction[];
  allRows: Transaction[];
  plans: Plan[];
  settings: Settings;
  from: string;
  to: string;
  user: Role;
  navigate: (page: string) => void;
  notify: (message: string) => void;
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={close} aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Fermer">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Empty({
  title = "Aucune transaction pour cette période",
  text = "Importez une extraction DDS pour commencer à suivre vos opérations.",
  action,
}: {
  title?: string;
  text?: string;
  action?: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileUp size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="button primary" onClick={action}>
          <FileUp size={16} />
          Importer une extraction
        </button>
      )}
    </div>
  );
}
export function Kpi({
  label,
  value,
  unit,
  icon: Icon,
  caption,
  onClick,
  color = "green",
}: {
  label: string;
  value: number;
  unit?: string;
  icon: LucideIcon;
  caption: string;
  onClick?: () => void;
  color?: string;
}) {
  return (
    <button className={"kpi " + (!onClick ? "static" : "")} onClick={onClick} disabled={!onClick}>
      <div className="kpi-top">
        <span>{label}</span>
        <span className={"kpi-icon " + color}>
          <Icon size={19} />
        </span>
      </div>
      <div className="kpi-value">
        {fmt(value, unit === "t" ? 2 : 0)} <small>{unit}</small>
      </div>
      <div className="kpi-caption">
        {caption}
        {onClick && <ArrowUpRight size={15} />}
      </div>
    </button>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Badge({ children, type = "green" }: { children: ReactNode; type?: string }) {
  return <span className={"badge " + type}>{children}</span>;
}
