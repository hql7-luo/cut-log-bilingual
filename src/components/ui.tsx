"use client";

import { useLanguage } from "./language";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

const paths = {
  pulse: <path d="M2 12h5l3-7 4 14 3-7h5"/>,
  home: <><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></>,
  food: <><path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M19 3v18M19 3c-4 2-5 6-5 10h5"/></>,
  lift: <><path d="M6.5 17.5l11-11M3 14l7 7M14 3l7 7M2 18l4 4M18 2l4 4M4 15l-2 3M9 20l-3 2M15 4l3-2M20 9l2-3"/></>,
  chart: <><path d="M3 4v16h18M6 15l4-4 4 2 5-6"/></>,
  settings: <><path d="m10 3-.7 2.1-1.5.8-2.2-.4-2 3.5L5 10.7v2.6l-1.4 1.7 2 3.5 2.2-.4 1.5.8.7 2.1h4l.7-2.1 1.5-.8 2.2.4 2-3.5-1.4-1.7v-2.6l1.4-1.7-2-3.5-2.2.4-1.5-.8L14 3z"/><circle cx="12" cy="12" r="2.7"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"/></>,
  moon: <path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14z"/>,
  coffee: <><path d="M4 8h12v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM16 9h2a2 2 0 1 1 0 4h-2M3 21h17M8 3v2m4-2v2"/></>,
  bowl: <><path d="M3 11h18a9 9 0 0 1-18 0Zm6 9h6M8 4c2 1-1 3 1 4m4-5c2 1-1 3 1 4"/></>,
  snack: <><path d="M13 5c1.2-1.4 3.5-.9 4.4.3 2.1 2.9-.6 7.5-2.1 10.1-1.5 2.6-4 2.5-5 0-1.2 2.5-3.6 2.6-5.1 0-1.5-2.6-4.2-7.2-2.1-10.1 1.3-1.8 3.6-1.5 5.6.5M10 6c.1-2 1-3.4 2.6-4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="m9 18 6-6-6-6"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  ball: <><circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6m0-12.6L5.7 18.3M3.3 10a12 12 0 0 1 10.7 10.7M10 3.3A12 12 0 0 0 20.7 14"/></>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7z"/>,
  scale: <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 9a6 6 0 0 1 10 0l-2.6 3H9.6zM12 11l1.2-3"/></>,
  edit: <><path d="m15 5 4 4M4 20l5-1 11-11-4-4L5 15z"/></>,
  trash: <><path d="M3 6h18M6 6l1 14h10l1-14M9 6V3h6v3m-5 4v6m4-6v6"/></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  star: <path d="m12 2 3 6 6.5 1-4.8 4.8 1.2 6.7-5.9-3.2-5.9 3.2 1.2-6.7L2.5 9 9 8z"/>,
  sparkle: <><path d="M12 2c.7 6.4 3.6 9.3 10 10-6.4.7-9.3 3.6-10 10C11.3 15.6 8.4 12.7 2 12c6.4-.7 9.3-3.6 10-10Z"/><path d="M17 4h4m-2-2v4"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 5 5"/></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></>,
  cloud: <path d="M7.5 19a5.5 5.5 0 1 1 1-10.9 6.5 6.5 0 0 1 12.4 2.3 4.3 4.3 0 0 1-2.2 8.6Z"/>,
  device: <><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.1"/></>,
  microphone: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6"/></>,
  dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className}>{paths[name]}</svg>;
}

export function Button({ icon, variant = "secondary", className = "", children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button type="button" {...props} className={`button ${variant} ${className}`}>
    {icon && <Icon name={icon} size={18}/>}
    {children}
  </button>;
}

export function IconButton({ icon, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>
    <Icon name={icon} size={17}/>
  </button>;
}

export function CardHead({ title, icon, children }: { title: string; icon?: IconName; children?: ReactNode }) {
  return <div className="card-head">
    <h2>{icon && <Icon name={icon} size={19}/>} {title}</h2>
    {children}
  </div>;
}

export function Empty({ icon, title, action }: { icon: IconName; title: string; action?: ReactNode }) {
  return <div className="empty">
    <span className="tile-icon"><Icon name={icon}/></span>
    <p>{title}</p>
    {action}
  </div>;
}

export function Modal({ title, close, children, wide = false, footer }:
  { title: string; close: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const { t } = useLanguage();
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = element.current;
    dialog?.showModal();
    document.body.classList.add("dialog-open");
    return () => { dialog?.close(); document.body.classList.remove("dialog-open"); };
  }, []);
  return <dialog ref={element} className={`dialog ${wide ? "wide" : ""}`} aria-label={title}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <div className="dialog-head"><h2>{title}</h2><IconButton icon="close" label={t("关闭")} onClick={close}/></div>
    <div className="dialog-content">{children}</div>
    {footer && <div className="dialog-footer">{footer}</div>}
  </dialog>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  const { t } = useLanguage();
  return children ? <p className="error-text" role="alert">{typeof children === "string" ? t(children) : children}</p> : null;
}
