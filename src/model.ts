import { z } from "zod";
export type Role = "ADM_MASTER" | "ADM" | "OPERADOR" | "COMPRADOR";
export type User = {
  id: string;
  name: string;
  role: Role;
  email?: string;
  active?: boolean;
};
export type Item = {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: string;
  min_stock: string;
  ideal_stock: string;
  deduction_mode: "AUTO" | "MANUAL";
  active: boolean;
  updated_at: string;
};
export type Req = {
  id: string;
  item_id: string;
  priority: string;
  status: string;
  requested_by: string;
  claimed_by_user_id: string | null;
  reported_remaining_qty: string | null;
  suggested_qty: string;
  notes: string;
  created_at: string;
};
export type Location = {
  id: string;
  name: string;
  type: string;
  neighborhood_city: string;
  notes: string;
};
export type Price = {
  id: string;
  item_id: string;
  location_id: string;
  location_name: string;
  unit_price_cents: number;
  created_at: string;
};
export type Purchase = {
  id: string;
  location_name: string;
  total_cents: number;
  completed_at: string;
  stock_updated: boolean;
};
export type Recipe = {
  id: string;
  name: string;
  consumer_code: string;
  items: { item_id: string; quantity: number }[];
};
export type Audit = {
  id: string;
  user_name: string;
  user_role: Role;
  action: string;
  entity_type: string;
  entity_name: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  device_type: string;
  created_at: string;
};
export type State = {
  user: User;
  settings: { auto_min_requests: boolean; allow_manual_in_sales: boolean };
  items: Item[];
  requests: Req[];
  locations: Location[];
  history: Price[];
  purchases: Purchase[];
  recipes: Recipe[];
  audit: Audit[];
  users: User[];
};
export type Line = {
  requestId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  priceBasis: "unit" | "total";
};
export type Operation = {
  type: string;
  data: unknown;
  operationId: string;
  userId: string;
};
export const categories = [
  "Embalagens",
  "Proteínas",
  "Hortifrúti",
  "Mercearia",
  "Bebidas",
  "Molhos",
  "Limpeza",
  "Descartáveis",
];
export const units = ["un", "kg", "g", "L", "ml", "cx", "pct"];
export const roleNames: Record<Role, string> = {
  ADM_MASTER: "ADM Master",
  ADM: "Administrador",
  OPERADOR: "Operador",
  COMPRADOR: "Comprador",
};
export const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
export const num = (v: string | number) =>
  Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
export const date = (v: string) =>
  new Date(v).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
export const readMoney = (s: string) => {
  const m = s.trim().match(/^(\d+)(?:[,.](\d{1,2}))?$/);
  return m
    ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"))
    : s.trim() === ""
      ? 0
      : NaN;
};
export const status = (i: Item) =>
  !i.active
    ? "Inativo"
    : Number(i.current_stock) === 0
      ? "Zerado"
      : Number(i.current_stock) < Number(i.min_stock)
        ? "Abaixo do mínimo"
        : "Normal";
export const minimum = (history: Price[]) =>
  history.reduce<Price | undefined>(
    (a, b) => (!a || b.unit_price_cents < a.unit_price_cents ? b : a),
    undefined,
  );
export const forms = {
  text: z.string().trim().min(1, "Preencha os campos obrigatórios."),
  quantity: z.coerce
    .number()
    .min(0, "Quantidade inválida.")
    .max(1000000)
    .refine(
      (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001,
      "Use até três casas decimais.",
    ),
  price: z.number().int().min(0).max(100000000),
};
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(
    `/api/${url}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw Object.assign(new Error(j?.error || "Servidor indisponível."), {
      status: r.status,
    });
  }
  return r.json();
}
export function read<T>(k: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(k) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export const store = (k: string, v: unknown) =>
  localStorage.setItem(k, JSON.stringify(v));
