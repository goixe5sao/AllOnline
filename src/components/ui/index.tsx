"use client";

import { cloneElement, useId, useRef, useEffect, type ReactNode, type ReactElement, type HTMLAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { LoaderCircle, X, Inbox } from "lucide-react";

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" ");
type Box = HTMLAttributes<HTMLDivElement>;
type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function Button({ variant = "secondary", size = "md", loading, icon, children, className, disabled, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)}>{loading ? <LoaderCircle className="ui-spin" aria-hidden /> : icon}{children}{loading && <span className="ui-sr-only">Đang xử lý</span>}</button>;
}

/** One native control per field. Explicit control ids are preserved. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactElement<HTMLAttributes<HTMLElement> & { id?: string; disabled?: boolean }>; className?: string }) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const describedBy = [children.props["aria-describedby"], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return <div className={cx("ui-field", className)}><label htmlFor={id}>{label}</label>{cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : children.props["aria-invalid"] })}{hint && <small id={`${id}-hint`}>{hint}</small>}{error && <small className="ui-error" id={`${id}-error`} role="alert">{error}</small>}</div>;
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={cx("ui-input", className)} />; }
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cx("ui-input", className)} />; }
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={cx("ui-input", className)} />; }
export function Checkbox({ children, className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <label className={cx("ui-choice", className)}><input {...props} type="checkbox" />{children}</label>; }
export function RadioCard({ children, className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <label className={cx("ui-radio-card", className)}><input {...props} type="radio" /><span>{children}</span></label>; }
export function Card({ className, ...props }: Box) { return <div {...props} className={cx("ui-card", className)} />; }
export function CardHeader(props: Box) { return <div {...props} className={cx("ui-card-header", props.className)} />; }
export function CardBody(props: Box) { return <div {...props} className={cx("ui-card-body", props.className)} />; }
export function CardFooter(props: Box) { return <div {...props} className={cx("ui-card-footer", props.className)} />; }
export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: string; subtitle?: string; actions?: ReactNode; breadcrumb?: ReactNode }) { return <header className="ui-page-header">{breadcrumb && <nav aria-label="Đường dẫn">{breadcrumb}</nav>}<div className="ui-header-row"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="ui-actions">{actions}</div>}</div></header>; }
export function Section({ title, children, ...props }: Omit<HTMLAttributes<HTMLElement>, "title"> & { title: string }) { const id = useId(); return <section {...props} className={cx("ui-section", props.className)} aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>; }
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) { return <span className={`ui-badge ui-tone-${tone}`}>{children}</span>; }
export function Stepper({ steps, current }: { steps: string[]; current: number }) { return <ol className="ui-stepper" aria-label="Tiến trình">{steps.map((step, i) => <li key={step} aria-current={i === current ? "step" : undefined} data-complete={i < current}><span>{i + 1}</span>{step}</li>)}</ol>; }
export function Tabs({ items, value, onChange, label }: { items: { value: string; label: string; content: ReactNode; disabled?: boolean }[]; value: string; onChange: (value: string) => void; label: string }) {
  const id = useId();
  return <div><div className="ui-tabs" role="tablist" aria-label={label}>{items.map((item, index) => <button key={item.value} id={`${id}-tab-${index}`} type="button" role="tab" disabled={item.disabled} aria-selected={value === item.value} aria-controls={`${id}-panel-${index}`} tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={e => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault(); const enabled = items.filter(t => !t.disabled); const at = enabled.findIndex(t => t.value === item.value);
    const next = enabled[e.key === "Home" ? 0 : e.key === "End" ? enabled.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    onChange(next.value); document.getElementById(`${id}-tab-${items.indexOf(next)}`)?.focus();
  }}>{item.label}</button>)}</div>{items.map((item, index) => <div key={item.value} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={item.value !== value} tabIndex={0}>{item.content}</div>)}</div>;
}
export function EmptyState({ title, description, action, icon = <Inbox aria-hidden /> }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) { return <div className="ui-empty">{icon}<h3>{title}</h3>{description && <p>{description}</p>}{action}</div>; }
export function Skeleton({ className, ...props }: Box) { return <div {...props} role="status" className={cx("ui-skeleton", className)}><span className="ui-sr-only">Đang tải…</span></div>; }
export function Toast({ children, tone = "info", onClose }: { children: ReactNode; tone?: Tone; onClose?: () => void }) { return <div className={`ui-toast ui-tone-${tone}`} role={tone === "danger" ? "alert" : "status"}><span>{children}</span>{onClose && <Button variant="ghost" aria-label="Đóng thông báo" onClick={onClose} icon={<X aria-hidden />} />}</div>; }

/** Native dialog provides focus trapping, Escape and inert background. */
export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null;
    if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); if (open) previous?.focus(); };
  }, [open]);
  return <dialog ref={ref} className="ui-modal" aria-labelledby={titleId} onKeyDown={e => {
    if (e.key !== "Tab") return;
    const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}><div className="ui-card-header ui-header-row"><h2 id={titleId}>{title}</h2><Button variant="ghost" onClick={onClose} aria-label="Đóng hộp thoại" icon={<X aria-hidden />} /></div><div className="ui-card-body">{children}</div>{actions && <div className="ui-card-footer">{actions}</div>}</dialog>;
}
export const Sheet = Modal;
export function DataList<T>({ columns, rows, rowKey, caption, empty }: { columns: { key: string; label: string; render: (row: T) => ReactNode }[]; rows: T[]; rowKey: (row: T) => string; caption: string; empty?: ReactNode }) {
  if (!rows.length) return empty ?? <EmptyState title="Chưa có dữ liệu" />;
  return <table className="ui-data-list"><caption>{caption}</caption><thead><tr>{columns.map(c => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(c => <td key={c.key} data-label={c.label}>{c.render(row)}</td>)}</tr>)}</tbody></table>;
}
export function Price({ amount, className }: { amount: number; className?: string }) { return <span className={cx("ui-price", className)}>{new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount)}</span>; }
export function StickyActionBar({ className, ...props }: Box) { return <div {...props} className={cx("ui-sticky-actions", className)} />; }
