import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Box,
  Beef,
  Carrot,
  CookingPot,
  Wine,
  Droplets,
  SprayCan,
  ShoppingBag,
  X,
  Inbox,
} from "lucide-react";
export const catIcons: Record<string, typeof Box> = {
  Embalagens: Box,
  Proteínas: Beef,
  Hortifrúti: Carrot,
  Mercearia: CookingPot,
  Bebidas: Wine,
  Molhos: Droplets,
  Limpeza: SprayCan,
  Descartáveis: ShoppingBag,
};
export function CategoryIcon({ category }: { category: string }) {
  const Icon = catIcons[category] || Box;
  return (
    <span
      className={`item-icon ${category === "Proteínas" ? "rose" : category === "Embalagens" ? "violet" : category === "Molhos" ? "orange" : category === "Mercearia" ? "gold" : category === "Bebidas" ? "blue" : "green"}`}
    >
      <Icon size={17} />
    </span>
  );
}
export function Button({
  children,
  kind = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: string }) {
  return (
    <button type="button" {...props} className={`btn ${kind} ${className}`}>
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={26} />
      <div>{children}</div>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2>{title}</h2>
          <Button aria-label="Fechar" kind="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
