import "@fontsource-variable/inter/wght.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ChartNoAxesCombined,
  MapPin,
  ClipboardList,
  Utensils,
  Users,
  Settings,
  ChevronDown,
  ChevronRight,
  Bell,
  Plus,
  Menu,
  PanelLeftClose,
  LogOut,
  WifiOff,
  CheckCircle2,
  TriangleAlert,
  CalendarDays,
  ArrowUpRight,
  ArrowRight,
  Boxes,
  Store,
  Search,
  SlidersHorizontal,
  MoreHorizontal,
  ShoppingBasket,
  BarChart3,
  ShieldCheck,
  FileDown,
} from "lucide-react";
import { api, read, store, roleNames, status, num, categories } from "./model";
import type { State, Operation, Item, Role } from "./model";
import { Button, Badge, CategoryIcon, Empty, Field, Modal } from "./ui";
import {
  ItemForm,
  StockAction,
  Cart,
  Prices,
  Locations,
  Sales,
  Recipes,
  AuditView,
  UsersView,
  SettingsForm,
} from "./modules";
import type { Command } from "./modules";
import "./style.css";
const demoPassword = "Nordeschina2026!";
const manager: Role[] = ["ADM_MASTER", "ADM"];
const buyer: Role[] = [...manager, "COMPRADOR"];
const stock: Role[] = [...manager, "OPERADOR"];
const nav = [
  {
    group: "OPERAÇÃO",
    links: [
      ["home", "Visão geral", LayoutDashboard, []],
      ["inventory", "Estoque", Package, stock],
      ["shopping", "Lista de compras", ShoppingCart, []],
      ["sales", "Saída de pedidos", FileDown, stock],
    ],
  },
  {
    group: "INTELIGÊNCIA",
    links: [
      ["prices", "Comparador de preços", ChartNoAxesCombined, buyer],
      ["locations", "Locais e fornecedores", MapPin, buyer],
      ["recipes", "Fichas técnicas", Utensils, manager],
    ],
  },
  {
    group: "ADMINISTRAÇÃO",
    links: [
      ["audit", "Log de auditoria", ShieldCheck, manager],
      ["users", "Usuários e acesso", Users, ["ADM_MASTER"]],
    ],
  },
] as const;
type Dialog = {
  type: "item" | "buy" | "count" | "deduct" | "alerts" | "settings";
  item?: Item;
};
const visible = (rs: readonly string[], r: Role) =>
  !rs.length || rs.includes(r);
function Inventory({
  items,
  compact = false,
  onView,
  onAction,
  role,
}: {
  items: Item[];
  compact?: boolean;
  onView?: (filter?: string) => void;
  onAction: (v: Dialog) => void;
  role: Role;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [filter, setFilter] = useState(""),
    [menu, setMenu] = useState("");
  const [limit, setLimit] = useState(20);
  const all = items.filter(
    (i) =>
      (!compact || i.active) &&
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (!category || i.category === category) &&
      (!filter || status(i) === filter),
  );
  const listed = all.slice(0, compact ? 5 : limit);
  return (
    <section className="panel inventory-panel">
      <div className="panel-header">
        <div>
          <h2>
            {compact ? "Monitoramento de estoque" : "Catálogo de insumos"}
          </h2>
          <p>
            {compact
              ? "Acompanhe o saldo dos seus principais insumos."
              : `${all.length} insumo(s) encontrado(s)`}
          </p>
        </div>
        {compact && (
          <Button onClick={() => onView?.()}>
            Ver estoque <ArrowRight size={15} />
          </Button>
        )}
      </div>
      <div className="table-controls">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Buscar insumo"
            placeholder="Buscar insumo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="select-icon">
          <SlidersHorizontal size={16} />
          <select
            aria-label="Filtrar por categoria"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Categorias</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {!compact && (
          <select
            aria-label="Filtrar por status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todos os status</option>
            {["Normal", "Abaixo do mínimo", "Zerado", "Inativo"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Insumo</th>
              <th>Saldo atual</th>
              <th>Mínimo</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listed.map((i) => {
              const ss = status(i);
              return (
                <tr key={i.id}>
                  <td>
                    <div className="item-cell">
                      <CategoryIcon category={i.category} />
                      <div>
                        <strong>{i.name}</strong>
                        <small>
                          {i.category}
                          {!compact &&
                            ` · ${i.deduction_mode === "AUTO" ? "Automático" : "Manual"}`}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{num(i.current_stock)}</strong>{" "}
                    <span className="muted">{i.unit}</span>
                  </td>
                  <td className="muted">
                    {num(i.min_stock)} {i.unit}
                  </td>
                  <td>
                    <Badge
                      tone={
                        ss === "Normal"
                          ? "green"
                          : ss === "Zerado"
                            ? "red"
                            : ss === "Inativo"
                              ? "gray"
                              : "amber"
                      }
                    >
                      {ss}
                    </Badge>
                  </td>
                  <td className="row-actions">
                    <Button
                      kind="icon"
                      aria-label={`Ações de ${i.name}`}
                      aria-expanded={menu === i.id}
                      onClick={() => setMenu(menu === i.id ? "" : i.id)}
                    >
                      <MoreHorizontal size={19} />
                    </Button>
                    {menu === i.id && (
                      <>
                        <button
                          className="menu-scrim"
                          aria-label="Fechar ações"
                          onClick={() => setMenu("")}
                        />
                        <div className="dropdown row-menu">
                          {[
                            ...(i.active && stock.includes(role)
                              ? [
                                  ["buy", "Comprar esse item"],
                                  ["count", "Só temos X desse item"],
                                  ["deduct", "Registrar baixa"],
                                ]
                              : []),
                            ...(manager.includes(role)
                              ? [["item", "Editar insumo"]]
                              : []),
                          ].map(([type, label]) => (
                            <button
                              key={type}
                              onClick={() => {
                                setMenu("");
                                onAction({
                                  type: type as Dialog["type"],
                                  item: i,
                                });
                              }}
                            >
                              {label}
                            </button>
                          ))}
                          {!i.active && !manager.includes(role) && (
                            <span>Sem ações disponíveis</span>
                          )}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!listed.length && <Empty>Nenhum insumo encontrado.</Empty>}
      <div className="panel-footer">
        <span>
          Mostrando {listed.length} de {all.length} insumos
        </span>
        {compact ? (
          <button className="link" onClick={() => onView?.()}>
            Ver todos <ArrowRight size={14} />
          </button>
        ) : (
          all.length > limit && (
            <button className="link" onClick={() => setLimit((n) => n + 20)}>
              Mostrar mais <ArrowRight size={14} />
            </button>
          )
        )}
      </div>
    </section>
  );
}
function App() {
  const [data, setData] = useState<State | null>(() => read("state", null));
  const [loading, setLoading] = useState(!data),
    [startupError, setStartupError] = useState(""),
    [demo, setDemo] = useState(false);
  const [page, setPage] = useState(location.hash.slice(1) || "home"),
    [side, setSide] = useState(false),
    [profile, setProfile] = useState(false),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [online, setOnline] = useState(navigator.onLine),
    [live, setLive] = useState(false),
    [queue, setQueue] = useState<Operation[]>(() => read("operations", [])),
    [toast, setToast] = useState(""),
    [syncError, setSyncError] = useState(""),
    [busy, setBusy] = useState(false);
  const queueRef = useRef(queue),
    syncRef = useRef(false),
    toastTimer = useRef(0);
  const userId = data?.user.id;
  const note = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 4200);
  };
  const refresh = useCallback(async () => {
    const v = await api<State>("state");
    setData(v);
    store("state", { ...v, audit: [], users: [] });
    return v;
  }, []);
  const clear = () => {
    setData(null);
    localStorage.removeItem("state");
  };
  const sync = useCallback(async () => {
    if (!userId || syncRef.current || !navigator.onLine) return;
    syncRef.current = true;
    try {
      for (const o of queueRef.current.filter((o) => o.userId === userId)) {
        try {
          await api(`commands/${o.type}`, {
            data: o.data,
            operationId: o.operationId,
          });
          queueRef.current = queueRef.current.filter(
            (x) => x.operationId !== o.operationId,
          );
          store("operations", queueRef.current);
          setQueue(queueRef.current);
          setSyncError("");
        } catch (e) {
          setSyncError((e as Error).message);
          break;
        }
      }
      await refresh();
    } catch {
    } finally {
      syncRef.current = false;
    }
  }, [userId, refresh]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const env = await api<{ demo: boolean }>("environment");
        if (!live) return;
        setDemo(env.demo);
        try {
          await refresh();
        } catch (e) {
          if ((e as { status?: number }).status !== 401) throw e;
          clear();
          if (env.demo && !read("signedOut", false)) {
            await api("login", {
              email: "master@nordeschina.demo",
              password: demoPassword,
            });
            await refresh();
          }
        }
      } catch (e) {
        if (!read("state", null)) setStartupError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [refresh]);
  useEffect(() => {
    const net = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync();
    };
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, [sync]);
  useEffect(() => {
    if (!userId || !online) return;
    void sync();
    const stream = new EventSource("/api/events");
    stream.onopen = () => setLive(true);
    stream.onerror = () => {
      setLive(false);
      void refresh().catch((e) => {
        if (e.status === 401) clear();
      });
    };
    stream.addEventListener("change", () => {
      if (queueRef.current.some((o) => o.userId === userId)) void sync();
      else
        void refresh().catch((e) => {
          if (e.status === 401) clear();
        });
    });
    return () => {
      stream.close();
      setLive(false);
    };
  }, [userId, online, sync, refresh]);
  useEffect(() => {
    const h = () => setPage(location.hash.slice(1) || "home");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const go = (p: string) => {
    location.hash = p;
    setPage(p);
    setSide(false);
    setProfile(false);
    window.scrollTo(0, 0);
  };
  const cmd: Command = async (type, payload) => {
    if (!data) return false;
    const o = {
      type,
      data: payload,
      operationId: crypto.randomUUID(),
      userId: data.user.id,
    };
    try {
      if (!navigator.onLine) throw new TypeError();
      await api(`commands/${type}`, {
        data: payload,
        operationId: o.operationId,
      });
      void refresh().catch(() => {});
      note("Alteração salva com sucesso.");
      return true;
    } catch (e) {
      if (
        !(e instanceof TypeError) &&
        ![502, 503, 504].includes((e as { status?: number }).status || 0)
      )
        throw e;
      if (
        !["request", "deduct", "purchase", "location", "claim"].includes(type)
      )
        throw new Error("Esta ação precisa de conexão.");
      queueRef.current = [...queueRef.current, o];
      store("operations", queueRef.current);
      setQueue(queueRef.current);
      note("Salvo neste dispositivo. Sincronizaremos ao reconectar.");
      return true;
    }
  };
  if (loading)
    return (
      <div className="login">
        <div className="login-card">
          <Brand />
          <p>Carregando seu painel operacional…</p>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="login">
        <div className="login-card">
          <Brand />
          <h1>Entre na sua conta</h1>
          <p>Gerencie o estoque e as compras do seu restaurante.</p>
          {startupError && (
            <p className="form-error">
              {startupError}{" "}
              <button className="link" onClick={() => location.reload()}>
                Recarregar
              </button>
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setStartupError("");
              try {
                await api("login", {
                  email: f.get("email"),
                  password: f.get("password"),
                });
                store("signedOut", false);
                await refresh();
                go("home");
              } catch (e) {
                setStartupError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="E-mail">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </Field>
            <Field label="Senha">
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" kind="primary" disabled={busy}>
              Entrar <ArrowRight size={17} />
            </Button>
          </form>
          {demo && (
            <div className="demo-options">
              <small>CONTAS DE DEMONSTRAÇÃO</small>
              {["master", "admin", "operador", "comprador"].map((k, i) => (
                <Button
                  key={k}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setStartupError("");
                    try {
                      await api("login", {
                        email: `${k}@nordeschina.demo`,
                        password: demoPassword,
                      });
                      store("signedOut", false);
                      await refresh();
                      go("home");
                    } catch (e) {
                      setStartupError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {Object.values(roleNames)[i]}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  const me = data.user;
  const links = nav.flatMap((g) =>
    g.links.filter((l) => visible(l[3], me.role)),
  );
  const current = links.find((l) => l[0] === page) || links[0];
  const view = current[0];
  const pending = data.requests.filter((r) => r.status === "PENDING");
  const low = data.items.filter(
    (i) => i.active && Number(i.current_stock) < Number(i.min_stock),
  );
  const queued = queue.filter((o) => o.userId === me.id);
  const initials = me.name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
  const captions: Record<string, string> = {
    home: "Aqui está o panorama da sua operação hoje.",
    inventory:
      "Consulte saldos, movimente insumos e acompanhe os níveis de estoque.",
    shopping:
      "Organize as necessidades de compra e confira o total antes de passar no caixa.",
    sales:
      "Importe ou registre pedidos do Consumer e revise as baixas de estoque.",
    prices: "Entenda quanto você pagou e onde vale a pena comprar.",
    locations: "Gerencie os estabelecimentos e fornecedores da sua operação.",
    recipes: "Vincule os produtos vendidos aos insumos da cozinha.",
    audit: "Consulte o histórico de alterações da operação.",
    users: "Gerencie contas, perfis e permissões de acesso.",
  };
  const logout = async () => {
    try {
      await api("logout", {});
      store("signedOut", true);
      clear();
      setProfile(false);
      setDialog(null);
    } catch (e) {
      note((e as Error).message);
    }
  };
  return (
    <div className="shell">
      <aside className={`sidebar ${side ? "open" : ""}`}>
        <div className="brand-area">
          <Brand />
          <Button
            kind="icon"
            className="close-side"
            aria-label="Fechar menu"
            onClick={() => setSide(false)}
          >
            <PanelLeftClose size={19} />
          </Button>
        </div>
        <div className="workspace">
          <span className="workspace-icon">
            <Store size={18} />
          </span>
          <div>
            <strong>Nordeschina Delivery</strong>
            <small>Unidade Recife</small>
          </div>
        </div>
        <nav>
          {nav.map((g) => {
            const available = g.links.filter((l) => visible(l[3], me.role));
            return (
              !!available.length && (
                <div className="nav-group" key={g.group}>
                  <span>{g.group}</span>
                  {available.map(([p, l, Icon]) => (
                    <button
                      key={p}
                      className={view === p ? "active" : ""}
                      aria-current={view === p ? "page" : undefined}
                      onClick={() => go(p)}
                    >
                      <Icon size={18} />
                      <b>{l}</b>
                      {p === "shopping" && !!pending.length && (
                        <i>{pending.length}</i>
                      )}
                    </button>
                  ))}
                </div>
              )
            );
          })}
        </nav>
        <div className="side-bottom">
          <button onClick={() => setDialog({ type: "settings" })}>
            <Settings size={18} /> Configurações
          </button>
          <div className="side-status">
            <span className={online ? "dot" : "dot offline"} />
            {online ? "Sistema operacional" : "Modo offline"}
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>
      {side && (
        <button
          className="mobile-overlay"
          aria-label="Fechar menu"
          onClick={() => setSide(false)}
        />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="crumb">
            <Button
              kind="icon"
              className="mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setSide(true)}
            >
              <Menu size={23} />
            </Button>
            <span>Operação</span>
            <ChevronRight size={14} />
            <strong>{current[1]}</strong>
          </div>
          <div className="top-tools">
            <span className={`live ${!live ? "disconnected" : ""}`}>
              <i />
              {live ? "Em tempo real" : online ? "Reconectando" : "Offline"}
            </span>
            <Button
              kind="icon"
              className="bell"
              aria-label="Notificações"
              onClick={() => setDialog({ type: "alerts" })}
            >
              <Bell size={19} />
              {!!low.length && <i />}
            </Button>
            <div className="top-divider" />
            <div className="profile">
              <button
                onClick={() => setProfile(!profile)}
                aria-expanded={profile}
              >
                <span className="avatar">{initials}</span>
                <span className="profile-label">
                  <strong>{me.name}</strong>
                  <small>{roleNames[me.role]}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {profile && (
                <div className="dropdown">
                  <button
                    onClick={() => {
                      setProfile(false);
                      setDialog({ type: "settings" });
                    }}
                  >
                    <Settings size={16} /> Minha conta
                  </button>
                  <button onClick={logout}>
                    <LogOut size={16} /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                {view === "home"
                  ? "PAINEL OPERACIONAL"
                  : "NORDESCHINA DELIVERY"}
              </div>
              <h1>
                {view === "home"
                  ? `Olá, ${me.name.split(" ")[0]}!`
                  : current[1]}
              </h1>
              <p>{captions[view]}</p>
            </div>
            <div className="heading-actions">
              {view === "home" && (
                <span className="date-chip">
                  <CalendarDays size={16} />
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(new Date())}
                </span>
              )}
              {manager.includes(me.role) &&
                (view === "home" || view === "inventory") && (
                  <Button
                    kind="primary"
                    onClick={() => setDialog({ type: "item" })}
                  >
                    <Plus size={18} /> Novo insumo
                  </Button>
                )}
            </div>
          </div>
          {(!online || queued.length > 0) && (
            <div className="offline-banner">
              <WifiOff size={17} />
              <span>
                {online ? "Fila local" : "Sem conexão"}
                {queued.length
                  ? ` · ${queued.length} alteração(ões) aguardando sincronização`
                  : ""}
                {syncError && ` · ${syncError}`}
              </span>
              {online && !!queued.length && (
                <Button onClick={() => void sync()}>Tentar novamente</Button>
              )}
              {syncError && !!queued.length && (
                <Button
                  onClick={() => {
                    if (
                      !confirm(
                        "Descartar a primeira operação da fila deste usuário?",
                      )
                    )
                      return;
                    queueRef.current = queueRef.current.filter(
                      (x) => x.operationId !== queued[0].operationId,
                    );
                    store("operations", queueRef.current);
                    setQueue(queueRef.current);
                    setSyncError("");
                    void sync();
                  }}
                >
                  Descartar primeira
                </Button>
              )}
            </div>
          )}
          {view === "home" && (
            <>
              <section className="hero">
                <div className="hero-content">
                  <div className="hero-tag">
                    <span /> GESTÃO INTEGRADA
                  </div>
                  <h2>
                    Controle de compras
                    <br className="hero-break" /> e estoque
                  </h2>
                  <p>Da cozinha ao mercado, tudo em um só lugar.</p>
                  <Button className="hero-btn" onClick={() => go("shopping")}>
                    Abrir lista de compras <ArrowRight size={16} />
                  </Button>
                </div>
                <img src="/hero.svg" alt="" />
              </section>
              <div className="stats">
                {[
                  {
                    icon: Boxes,
                    tone: "blue",
                    label: "Insumos ativos",
                    value: data.items.filter((i) => i.active).length,
                    sub: "Cadastrados no estoque",
                    target: stock.includes(me.role) ? "inventory" : "shopping",
                  },
                  {
                    icon: TriangleAlert,
                    tone: "orange",
                    label: "Estoque crítico",
                    value: low.length,
                    sub: "Abaixo do mínimo ou zerados",
                    target: "alerts",
                  },
                  {
                    icon: ShoppingBasket,
                    tone: "violet",
                    label: "Compras pendentes",
                    value: pending.length,
                    sub: "Na lista de compras",
                    target: "shopping",
                  },
                  {
                    icon: Store,
                    tone: "green",
                    label: buyer.includes(me.role)
                      ? "Locais cadastrados"
                      : "Fichas técnicas",
                    value: buyer.includes(me.role)
                      ? data.locations.length
                      : data.recipes.length,
                    sub: buyer.includes(me.role)
                      ? "Fornecedores e mercados"
                      : "Produtos do Consumer",
                    target: buyer.includes(me.role) ? "locations" : "sales",
                  },
                ].map((x) => (
                  <button
                    className="stat"
                    key={x.label}
                    onClick={() =>
                      x.target === "alerts"
                        ? setDialog({ type: "alerts" })
                        : go(x.target)
                    }
                  >
                    <div>
                      <span className={`stat-icon ${x.tone}`}>
                        <x.icon size={19} />
                      </span>
                      <ArrowUpRight className="stat-arrow" size={16} />
                    </div>
                    <span>{x.label}</span>
                    <strong>{x.value}</strong>
                    <small>{x.sub}</small>
                  </button>
                ))}
              </div>
              <div className="dashboard-grid">
                {stock.includes(me.role) && (
                  <Inventory
                    compact
                    items={data.items}
                    role={me.role}
                    onAction={setDialog}
                    onView={() => go("inventory")}
                  />
                )}
                <section className="panel quick">
                  <div className="panel-header">
                    <div>
                      <h2>Ações rápidas</h2>
                      <p>Atalhos para a sua rotina.</p>
                    </div>
                  </div>
                  <div className="quick-links">
                    {[
                      {
                        icon: ShoppingCart,
                        tone: "orange",
                        title: "Lista de compras",
                        detail: "Veja o que precisa ser comprado",
                        page: "shopping",
                      },
                      {
                        icon: BarChart3,
                        tone: "violet",
                        title: "Comparar preços",
                        detail: "Encontre o melhor lugar para comprar",
                        page: "prices",
                      },
                      {
                        icon: ClipboardList,
                        tone: "blue",
                        title: "Registrar saída",
                        detail: "Lance pedidos e baixe o estoque",
                        page: "sales",
                      },
                    ]
                      .filter((x) => links.some((l) => l[0] === x.page))
                      .map((x) => (
                        <button key={x.page} onClick={() => go(x.page)}>
                          <span className={`item-icon ${x.tone}`}>
                            <x.icon size={18} />
                          </span>
                          <span>
                            <strong>{x.title}</strong>
                            <small>{x.detail}</small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                  </div>
                  <div className="quick-divider" />
                  <div className="quick-info">
                    <div>
                      <span className="pulse-dot" />
                      <strong>
                        {online ? "Sincronização ativa" : "Modo offline"}
                      </strong>
                    </div>
                    <p>
                      {online
                        ? "As alterações da equipe aparecem em tempo real."
                        : "Alterações compatíveis ficam na fila local."}
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "inventory" && (
            <Inventory items={data.items} role={me.role} onAction={setDialog} />
          )}
          {view === "shopping" && <Cart data={data} cmd={cmd} go={go} />}
          {view === "prices" && <Prices data={data} />}
          {view === "locations" && <Locations data={data} cmd={cmd} />}
          {view === "sales" && <Sales data={data} cmd={cmd} />}
          {view === "recipes" && <Recipes data={data} cmd={cmd} />}
          {view === "audit" && <AuditView data={data} />}
          {view === "users" && <UsersView data={data} cmd={cmd} />}
          <footer className="main-footer">
            <span>Estoque & Compras · Nordeschina Delivery</span>
            <span>
              {demo ? "Ambiente de demonstração" : "Operação · Recife, PE"}
            </span>
          </footer>
        </main>
      </div>
      {dialog?.type === "item" && (
        <ItemForm
          item={dialog.item}
          master={me.role === "ADM_MASTER"}
          cmd={cmd}
          close={() => setDialog(null)}
        />
      )}
      {dialog?.item && ["buy", "count", "deduct"].includes(dialog.type) && (
        <StockAction
          item={dialog.item}
          type={dialog.type as "buy" | "count" | "deduct"}
          cmd={cmd}
          close={() => setDialog(null)}
        />
      )}
      {dialog?.type === "alerts" && (
        <Modal title="Alertas de estoque" onClose={() => setDialog(null)}>
          {low.length ? (
            <div className="list">
              {low.map((i) => (
                <div className="list-row" key={i.id}>
                  <CategoryIcon category={i.category} />
                  <div>
                    <strong>{i.name}</strong>
                    <small>
                      {num(i.current_stock)} {i.unit} em estoque · mínimo{" "}
                      {num(i.min_stock)}
                    </small>
                  </div>
                  <Badge tone="amber">{status(i)}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Nenhum alerta de estoque.</Empty>
          )}
        </Modal>
      )}
      {dialog?.type === "settings" && (
        <Modal title="Minha conta" onClose={() => setDialog(null)}>
          <div className="list-row">
            <span className="avatar">{initials}</span>
            <div>
              <strong>{me.name}</strong>
              <small>{roleNames[me.role]} · Nordeschina Delivery</small>
            </div>
          </div>
          <p className="muted">
            A sessão é compartilhada apenas neste dispositivo. Para instalar a
            PWA, use a opção “Instalar app” ou “Adicionar à tela inicial” no
            menu do seu navegador.
          </p>
          {me.role === "ADM_MASTER" && <SettingsForm data={data} cmd={cmd} />}
          <Button onClick={logout}>
            <LogOut size={16} /> Sair da conta
          </Button>
        </Modal>
      )}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="Fechar aviso" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span>
        <Package size={22} strokeWidth={2.1} />
      </span>
      <div>
        <strong>
          Estoque<span> & </span>Compras
        </strong>
        <small>GESTÃO OPERACIONAL</small>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(console.error);
  });
