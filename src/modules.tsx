import { useEffect, useState } from "react";
import readXlsxFile from "read-excel-file";
import type { FormEvent, ReactNode } from "react";
import {
  Plus,
  ShoppingCart,
  MapPin,
  ArrowRight,
  Trash2,
  Package,
  TrendingDown,
  FileUp,
  Pencil,
  ReceiptText,
  Search,
} from "lucide-react";
import {
  api,
  units,
  roleNames,
  money,
  num,
  date,
  minimum,
  readMoney,
  forms,
  read,
  store,
} from "./model";
import type {
  State,
  Item,
  Location,
  Req,
  Line,
  Recipe,
  User,
  Price,
} from "./model";
import { Badge, Button, CategoryIcon, Empty, Field, Modal } from "./ui";
export type Command = (type: string, data: unknown) => Promise<boolean>;
const names = [
  "Atacarejo",
  "Supermercado",
  "Distribuidora",
  "Açougue",
  "Embalagens",
  "Hortifrúti",
];
const isAdmin = (s: State) => ["ADM", "ADM_MASTER"].includes(s.user.role);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const qty = (f: FormData, k: string) => forms.quantity.parse(str(f, k));
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
function explain(e: unknown) {
  if (e && typeof e === "object" && "issues" in e)
    return (e.issues as { message: string }[])
      .map((x) => x.message)
      .join(" · ");
  return (e as Error).message;
}
function Form({
  children,
  save,
  label = "Salvar",
  close,
  extra,
}: {
  children: ReactNode;
  save: (f: FormData) => Promise<void>;
  label?: string;
  close?: () => void;
  extra?: ReactNode;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await save(new FormData(e.currentTarget));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      {children}
      <ErrorText error={error} />
      <div className="form-actions">
        {extra}
        {close && <Button onClick={close}>Cancelar</Button>}
        <Button type="submit" kind="primary" disabled={busy}>
          {busy ? "Salvando…" : label}
        </Button>
      </div>
    </form>
  );
}
function QtyInput({
  name,
  value,
  required = true,
}: {
  name: string;
  value?: string | number;
  required?: boolean;
}) {
  return (
    <input
      name={name}
      type="number"
      min="0"
      max="1000000"
      step="0.001"
      inputMode="decimal"
      defaultValue={value}
      required={required}
    />
  );
}
export function SecurityPanel() {
  const [report, setReport] = useState<{ summary: { active_users: number; active_sessions: number; failed_logins: number; throttled_logins: number; pending_registrations: number }; events: { kind: string; created_at: string; name: string | null }[] } | null>(null);
  const [error, setError] = useState("");
  const load = () => { setError(""); void api<typeof report>("security").then(setReport).catch((e) => setError(explain(e))); };
  useEffect(() => { load(); }, []);
  const labels: Record<string, string> = { LOGIN_SUCCESS: "Login realizado", LOGIN_FAILURE: "Tentativa de login inválida", LOGIN_THROTTLED: "Limite de tentativas atingido" };
  return <section className="panel padded stack">
    <div className="panel-header"><div><h2>Painel de segurança</h2><p>Indicadores de acesso disponíveis apenas para o ADM Master.</p></div><Button onClick={load}>Atualizar</Button></div>
    <ErrorText error={error} />
    {!report && !error && <p>Carregando indicadores…</p>}
    {report && <>
      <div className="form-grid">
        <p>Usuários ativos: <strong>{report.summary.active_users}</strong></p>
        <p>Sessões ativas: <strong>{report.summary.active_sessions}</strong></p>
        <p>Logins inválidos (24h): <strong>{report.summary.failed_logins}</strong></p>
        <p>Limites atingidos (24h): <strong>{report.summary.throttled_logins}</strong></p>
        <p>Cadastros pendentes: <strong>{report.summary.pending_registrations}</strong></p>
      </div>
      <p className="muted">Eventos são removidos periodicamente após 30 dias; falhas não registram e-mail, senha ou IP. O limite é local a cada processo e pode ser reiniciado ou variar entre instâncias. Este painel não detecta todas as ameaças.</p>
      <h3>Últimos eventos de acesso</h3>
      <div className="list">{report.events.map((event, i) => <div className="list-row" key={i}><span>{labels[event.kind] || event.kind}{event.name ? ` · ${event.name}` : ""}</span><small>{date(event.created_at)}</small></div>)}</div>
      {!report.events.length && <Empty>Ainda não há eventos registrados.</Empty>}
    </>}
  </section>;
}
type StockImportRow = { name: string; pdvCode: string; quantity: number; category: string; unit: string; itemId: string | null | "review" };
export function StockImport({ data, cmd }: { data: State; cmd: Command }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [filename, setFilename] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [codeCol, setCodeCol] = useState("");
  const [qtyCol, setQtyCol] = useState("");
  const [unitCol, setUnitCol] = useState("");
  const [categoryCol, setCategoryCol] = useState("");
  const [category, setCategory] = useState(data.categories?.[0] || "");
  const [defaultUnit, setDefaultUnit] = useState("un");
  const [review, setReview] = useState<StockImportRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const columns = rows?.[0] || [];
  const options = columns.map((label, index) => <option key={index} value={String(index)}>{label || `Coluna ${index + 1}`}</option>);
  function prepare() {
    try {
      if (!rows || nameCol === "" || qtyCol === "" || nameCol === qtyCol) throw new Error("Selecione colunas diferentes para nome e quantidade.");
      if (!category) throw new Error("Escolha a categoria para novos insumos.");
      const values = rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
        const name = (row[Number(nameCol)] || "").trim();
        const pdvCode = codeCol === "" ? "" : (row[Number(codeCol)] || "").trim();
        const rawQty = (row[Number(qtyCol)] || "").trim().replace(",", ".");
        const quantity = Number(rawQty);
        const unit = unitCol === "" ? defaultUnit : (row[Number(unitCol)] || "").trim();
        const rowCategory = categoryCol === "" ? category : (row[Number(categoryCol)] || "").trim();
        if (!name || name.length > 150 || pdvCode.length > 150 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001 || !units.includes(unit) || !data.categories.includes(rowCategory)) throw new Error(`Revise nome, código, categoria, unidade e quantidade da linha ${index + 2}.`);
        const byCode = pdvCode ? data.items.find((item) => item.pdv_code === pdvCode) : undefined;
        const byName = data.items.filter((item) => item.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
        return { name, pdvCode, quantity, category: rowCategory, unit, itemId: byCode?.id || (byName.length ? "review" as const : null) };
      });
      if (!values.length) throw new Error("Não há linhas de dados na planilha.");
      setReview(values); setError("");
    } catch (e) { setError(explain(e)); }
  }
  return <section className="panel padded stack">
    <h2>Importar insumos do Excel</h2>
    <p className="muted">Selecione as colunas na primeira aba, revise os vínculos e confirme. As quantidades serão somadas, não substituídas.</p>
    <Field label="Arquivo Excel (.xlsx)"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={async (event) => {
      setRows(null); setReview(null); setError(""); setFilename(""); setNameCol(""); setCodeCol(""); setQtyCol(""); setUnitCol(""); setCategoryCol("");
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (!/\.xlsx$/i.test(file.name) || file.size > 256000) throw new Error("Selecione um arquivo .xlsx de até 256 KB.");
        const loaded = await readXlsxFile(file);
        if (loaded.length < 2 || loaded.length > 201 || loaded[0].length > 100) throw new Error("Use cabeçalho e até 200 linhas de dados e 100 colunas.");
        setRows(loaded.map((row) => row.map((cell) => cell == null ? "" : String(cell).trim()))); setFilename(file.name);
      } catch (e) { setError(explain(e)); }
    }} /></Field>
    {rows && <>
      <p>{filename}</p>
      <div className="form-grid">
        <Field label="Coluna do nome"><select value={nameCol} onChange={(event) => { setNameCol(event.target.value); setReview(null); }}><option value="">Selecione</option>{options}</select></Field>
        <Field label="Coluna de quantidade"><select value={qtyCol} onChange={(event) => { setQtyCol(event.target.value); setReview(null); }}><option value="">Selecione</option>{options}</select></Field>
        <Field label="Coluna do código PDV (opcional)"><select value={codeCol} onChange={(event) => { setCodeCol(event.target.value); setReview(null); }}><option value="">Sem código</option>{options}</select></Field>
        <Field label="Coluna da unidade (opcional)"><select value={unitCol} onChange={(event) => { setUnitCol(event.target.value); setReview(null); }}><option value="">Usar unidade padrão</option>{options}</select></Field>
        <Field label="Coluna da categoria (opcional)"><select value={categoryCol} onChange={(event) => { setCategoryCol(event.target.value); setReview(null); }}><option value="">Usar categoria padrão</option>{options}</select></Field>
        <Field label="Unidade padrão"><select value={defaultUnit} onChange={(event) => { setDefaultUnit(event.target.value); setReview(null); }}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></Field>
        <Field label="Categoria para novos insumos"><select value={category} onChange={(event) => { setCategory(event.target.value); setReview(null); }}><option value="">Selecione</option>{(data.categories || []).map((name) => <option key={name}>{name}</option>)}</select></Field>
      </div>
      <small>Para manter zeros à esquerda, salve os códigos como texto no Excel. Valores aceitos de unidade: {units.join(", ")}.</small>
      <Button onClick={prepare}>Preparar revisão</Button>
    </>}
    {review && <>
      <h3>Revise cada vínculo antes de importar</h3>
      {review.map((row, index) => <div className="list-row" key={index}>
        <div><strong>{row.name}</strong><small>{row.pdvCode || "Sem código"} · +{num(row.quantity)} {row.unit}</small></div>
        <Field label={`Destino de ${row.name}`}><select value={row.itemId ?? "__new"} onChange={(event) => setReview((old) => old!.map((value, i) => i === index ? { ...value, itemId: event.target.value === "__new" ? null : event.target.value } : value))}>
          {row.itemId === "review" && <option value="review" disabled>Confirme o vínculo por nome</option>}
          <option value="__new">Cadastrar novo insumo</option>
          {data.items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.pdv_code || "sem código"} · {item.unit}</option>)}
        </select></Field>
      </div>)}
      <Button kind="primary" disabled={busy || review.some((row) => row.itemId === "review")} onClick={async () => {
        setError(""); setBusy(true);
        try {
          if (await cmd("importStock", { rows: review })) { setRows(null); setReview(null); setFilename(""); }
        } catch (e) { setError(explain(e)); } finally { setBusy(false); }
      }}>Confirmar importação</Button>
    </>}
    <ErrorText error={error} />
  </section>;
}
export function CategoryManager({ categories, cmd }: { categories: string[]; cmd: Command }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return <section className="panel padded">
    <h2>Categorias de insumos</h2>
    <p className="muted">Categorias vinculadas a insumos não podem ser excluídas.</p>
    <form className="form" onSubmit={async (event) => {
      event.preventDefault(); setError("");
      try { if (await cmd("categoryCreate", { name: forms.text.parse(name) })) setName(""); }
      catch (e) { setError(explain(e)); }
    }}>
      <Field label="Nova categoria"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} required /></Field>
      <Button type="submit">Criar categoria</Button>
    </form>
    <ErrorText error={error} />
    <div className="list">{categories.map((category) => <div className="list-row" key={category}>
      <strong>{category}</strong>
      <Button onClick={async () => {
        if (!window.confirm(`Excluir a categoria ${category}?`)) return;
        setError("");
        try { await cmd("categoryDelete", { name: category }); } catch (e) { setError(explain(e)); }
      }}><Trash2 size={15} /> Excluir</Button>
    </div>)}</div>
  </section>;
}
export function ItemForm({
  item,
  master,
  categories,
  cmd,
  close,
}: {
  item?: Item;
  master: boolean;
  categories: string[];
  cmd: Command;
  close: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Modal title={item ? "Editar insumo" : "Novo insumo"} onClose={close}>
      <Form
        close={close}
        save={async (f) => {
          if (
            await cmd("item", {
              id: item?.id,
              version: item?.updated_at,
              name: forms.text.parse(str(f, "name")),
              pdvCode: str(f, "pdvCode"),
              category: str(f, "category"),
              unit: str(f, "unit"),
              current: qty(f, "current"),
              min: qty(f, "min"),
              ideal: qty(f, "ideal"),
              mode: str(f, "mode"),
              active: f.get("active") === "on",
            })
          )
            close();
        }}
        extra={
          item &&
          master && (
            <Button
              kind="danger"
              onClick={async () => {
                if (!confirm(`Excluir ${item.name} definitivamente?`)) return;
                try {
                  if (await cmd("deleteItem", { id: item.id })) close();
                } catch (e) {
                  setError(explain(e));
                }
              }}
            >
              <Trash2 size={16} /> Excluir
            </Button>
          )
        }
      >
        <Field label="Nome do insumo">
          <input
            name="name"
            required
            maxLength={150}
            defaultValue={item?.name}
          />
        </Field>
        <Field label="Código PDV / Consumer (opcional)"><input name="pdvCode" maxLength={150} defaultValue={item?.pdv_code || ""} /></Field>
        <div className="form-grid">
          <Field label="Categoria">
            <select name="category" defaultValue={item?.category}>
              {categories.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="Unidade">
            <select name="unit" defaultValue={item?.unit}>
              {units.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-grid thirds">
          <Field label="Saldo atual">
            <QtyInput name="current" value={item?.current_stock ?? 0} />
          </Field>
          <Field label="Estoque mínimo">
            <QtyInput name="min" value={item?.min_stock ?? 0} />
          </Field>
          <Field label="Estoque ideal">
            <QtyInput name="ideal" value={item?.ideal_stock ?? 0} />
          </Field>
        </div>
        <Field label="Regra de baixa">
          <select name="mode" defaultValue={item?.deduction_mode || "MANUAL"}>
            <option value="MANUAL">Manual</option>
            <option value="AUTO">Automático (Consumer)</option>
          </select>
        </Field>
        <label className="check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={item?.active ?? true}
          />{" "}
          Insumo ativo
        </label>
        <ErrorText error={error} />
      </Form>
    </Modal>
  );
}
export function StockAction({
  item,
  type,
  cmd,
  close,
}: {
  item: Item;
  type: "buy" | "count" | "deduct";
  cmd: Command;
  close: () => void;
}) {
  const [remaining, setRemaining] = useState(item.current_stock);
  return (
    <Modal
      title={
        type === "buy"
          ? "Comprar esse item"
          : type === "count"
            ? "Só temos X desse item"
            : "Registrar baixa manual"
      }
      onClose={close}
    >
      <div className="list-row">
        <CategoryIcon category={item.category} />
        <div>
          <strong>{item.name}</strong>
          <small>
            Saldo atual: {num(item.current_stock)} {item.unit}
          </small>
        </div>
      </div>
      <Form
        close={close}
        label={type === "deduct" ? "Confirmar baixa" : "Enviar para compras"}
        save={async (f) => {
          if (
            await cmd(
              type === "deduct" ? "deduct" : "request",
              type === "deduct"
                ? {
                    itemId: item.id,
                    quantity: qty(f, "quantity"),
                    notes: forms.text.parse(str(f, "notes")),
                  }
                : {
                    itemId: item.id,
                    remaining:
                      type === "count" ? qty(f, "quantity") : undefined,
                    urgent: f.get("urgent") === "on",
                    notes: str(f, "notes"),
                  },
            )
          )
            close();
        }}
      >
        {type === "count" && (
          <>
            <Field label={`Quantidade restante (${item.unit})`}>
              <input
                type="number"
                min="0"
                max="1000000"
                step="0.001"
                inputMode="decimal"
                name="quantity"
                value={remaining}
                onChange={(e) => setRemaining(e.target.value)}
                required
              />
            </Field>
            <p className="info-box">
              Sugestão de compra:{" "}
              <strong>
                {num(Math.max(0, Number(item.ideal_stock) - Number(remaining)))}{" "}
                {item.unit}
              </strong>
              . A contagem atualiza o saldo do estoque.
            </p>
          </>
        )}
        {type === "deduct" && (
          <Field label={`Quantidade de saída (${item.unit})`}>
            <QtyInput name="quantity" />
          </Field>
        )}
        <Field label={type === "deduct" ? "Motivo da saída" : "Observações"}>
          <textarea name="notes" maxLength={500} required={type === "deduct"} />
        </Field>
        {type !== "deduct" && (
          <label className="check">
            <input type="checkbox" name="urgent" /> Marcar como urgente
          </label>
        )}
      </Form>
    </Modal>
  );
}
function LocationForm({
  item,
  cmd,
  close,
  types = [],
}: {
  item?: Location;
  cmd: Command;
  close: () => void;
  types?: string[];
}) {
  const [type, setType] = useState(item?.type || names[0]);
  const [latitude, setLatitude] = useState(item?.latitude == null ? "" : String(item.latitude));
  const [longitude, setLongitude] = useState(item?.longitude == null ? "" : String(item.longitude));
  const [geoError, setGeoError] = useState("");
  return (
    <Modal
      title={item ? "Editar local" : "Novo local de compra"}
      onClose={close}
    >
      <Form
        close={close}
        save={async (f) => {
          if (
            await cmd("location", {
              id: item?.id,
              name: forms.text.parse(str(f, "name")),
              type: type === "__new" ? forms.text.parse(str(f, "newType")) : type,
              neighborhood: forms.text.parse(str(f, "neighborhood")),
              address: str(f, "address"),
              latitude: latitude.trim() ? Number(latitude) : null,
              longitude: longitude.trim() ? Number(longitude) : null,
              notes: str(f, "notes"),
            })
          )
            close();
        }}
      >
        <Field label="Nome do local">
          <input name="name" required defaultValue={item?.name} />
        </Field>
        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {[...new Set([...names, ...types, ...(item ? [item.type] : [])])].map((n) => <option key={n}>{n}</option>)}
            <option value="__new">Criar novo tipo</option>
          </select>
        </Field>
        {type === "__new" && <Field label="Nome do novo tipo"><input name="newType" required maxLength={150} /></Field>}
        <Field label="Endereço (opcional)"><input name="address" maxLength={300} defaultValue={item?.address || ""} /></Field>
        <div className="form-grid">
          <Field label="Latitude (opcional)"><input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></Field>
          <Field label="Longitude (opcional)"><input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></Field>
        </div>
        <Button onClick={() => {
          if (!navigator.geolocation) { setGeoError("Localização indisponível neste dispositivo."); return; }
          setGeoError("");
          navigator.geolocation.getCurrentPosition((position) => {
            setLatitude(String(position.coords.latitude));
            setLongitude(String(position.coords.longitude));
          }, () => setGeoError("Não foi possível obter sua localização. Confira a permissão do navegador e o GPS."), { timeout: 15000 });
        }}>Usar minha localização atual</Button>
        <ErrorText error={geoError} />
        <Field label="Bairro / cidade">
          <input
            name="neighborhood"
            required
            defaultValue={item?.neighborhood_city}
          />
        </Field>
        <Field label="Observações">
          <textarea name="notes" defaultValue={item?.notes} />
        </Field>
      </Form>
    </Modal>
  );
}
export function Locations({ data, cmd }: { data: State; cmd: Command }) {
  const [edit, setEdit] = useState<Location | true | null>(null),
    [search, setSearch] = useState("");
  const list = data.locations.filter((l) =>
    `${l.name} ${l.neighborhood_city}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Locais cadastrados</h2>
            <p>Mercados, distribuidores e fornecedores.</p>
          </div>
          <Button kind="primary" onClick={() => setEdit(true)}>
            <Plus size={17} /> Novo local
          </Button>
        </div>
        <div className="table-controls">
          <label className="search">
            <Search size={17} />
            <input
              placeholder="Buscar local..."
              aria-label="Buscar local"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="list padded">
          {list.map((l) => (
            <div className="list-row" key={l.id}>
              <span className="item-icon green">
                <MapPin size={18} />
              </span>
              <div>
                <strong>{l.name}</strong>
                <small>
                  {l.type} · {l.neighborhood_city}
                  {l.address && ` · ${l.address}`}
                  {l.latitude != null && l.longitude != null && ` · ${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`}
                  {l.notes && ` · ${l.notes}`}
                </small>
              </div>
              {isAdmin(data) && (
                <Button onClick={() => setEdit(l)}>
                  <Pencil size={15} /> Editar
                </Button>
              )}
            </div>
          ))}
        </div>
        {!list.length && <Empty>Nenhum local encontrado.</Empty>}
      </section>
      {edit && (
        <LocationForm
          item={edit === true ? undefined : edit}
          cmd={cmd}
          types={data.locations.map((location) => location.type)}
          close={() => setEdit(null)}
        />
      )}
    </>
  );
}
function LineForm({
  req,
  item,
  history,
  line,
  close,
  save,
}: {
  req: Req;
  item: Item;
  history: Price[];
  line?: Line;
  close: () => void;
  save: (v: Line) => Promise<void>;
}) {
  const initial = line?.quantity ?? (Number(req.suggested_qty) || 1);
  const [quantity, setQuantity] = useState(String(initial)),
    [basis, setBasis] = useState<"unit" | "total">(line?.priceBasis || "unit"),
    [price, setPrice] = useState(
      line
        ? String(
            (line.priceBasis === "unit" ? line.unitPrice : line.total) / 100,
          )
        : "",
    );
  const amount = readMoney(price);
  const milli = Math.round(Number(quantity) * 1000);
  const unitPrice =
    basis === "unit" ? amount : Math.round((amount * 1000) / milli);
  const total =
    basis === "total" ? amount : Math.round((amount * milli) / 1000);
  const min = minimum(history),
    last = history[0],
    avg = history.length
      ? Math.round(
          history.reduce((s, p) => s + p.unit_price_cents, 0) / history.length,
        )
      : 0;
  const signal =
    price && Number.isFinite(unitPrice) && min && last
      ? unitPrice <= min.unit_price_cents
        ? ["green", "Abaixo ou igual ao menor preço histórico"]
        : unitPrice > last.unit_price_cents
          ? [
              "red",
              `${money(unitPrice - last.unit_price_cents)} acima da última compra`,
            ]
          : unitPrice <= avg
            ? ["amber", "Dentro da média histórica"]
            : ["amber", "Acima da média, sem superar a última compra"]
      : null;
  const display = (v: number) =>
    Number.isFinite(v) ? (v / 100).toFixed(2).replace(".", ",") : "";
  return (
    <Modal
      title={line ? "Editar item no carrinho" : "Adicionar ao carrinho"}
      onClose={close}
    >
      <div className="list-row">
        <CategoryIcon category={item.category} />
        <div>
          <strong>{item.name}</strong>
          <small>
            Sugestão: {num(req.suggested_qty)} {item.unit}
          </small>
        </div>
      </div>
      <Form
        close={close}
        label={line ? "Salvar item" : "Adicionar ao carrinho"}
        save={async () => {
          const q = forms.quantity.parse(quantity);
          if (q <= 0 || !price)
            throw new Error("Preencha uma quantidade positiva e um preço.");
          await save({
            requestId: req.id,
            quantity: q,
            unitPrice: forms.price.parse(unitPrice),
            total: forms.price.parse(total),
            priceBasis: basis,
          });
        }}
      >
        <Field label={`Quantidade pega (${item.unit})`}>
          <input
            type="number"
            min="0.001"
            step="0.001"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        <div className="form-grid">
          <Field label="Preço unitário (R$)">
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={basis === "unit" ? price : price ? display(unitPrice) : ""}
              onChange={(e) => {
                setBasis("unit");
                setPrice(e.target.value);
              }}
            />
          </Field>
          <Field label="Preço total (R$)">
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={basis === "total" ? price : price ? display(total) : ""}
              onChange={(e) => {
                setBasis("total");
                setPrice(e.target.value);
              }}
            />
          </Field>
        </div>
        {signal && <Badge tone={signal[0]}>{signal[1]}</Badge>}
        {min && <p className="muted">Menor preço registrado: {money(min.unit_price_cents)} / {item.unit} em {min.location_name}.</p>}
        {last && (
          <p className="muted">
            Última compra: {money(last.unit_price_cents)} / {item.unit} em{" "}
            {last.location_name}.
          </p>
        )}
      </Form>
    </Modal>
  );
}
export function Cart({
  data,
  cmd,
  go,
}: {
  data: State;
  cmd: Command;
  go: (p: string) => void;
}) {
  const k = `cart:${data.user.id}`;
  const saved = read(k, { lines: [] as Line[], locationId: "" });
  const [lines, setLines] = useState<Line[]>(saved.lines),
    [locationId, setLocationId] = useState(saved.locationId),
    [locationModal, setLocationModal] = useState(false),
    [newRequestItem, setNewRequestItem] = useState(""),
    [requestBusy, setRequestBusy] = useState(false),
    [edit, setEdit] = useState<Req | null>(null),
    [checkout, setCheckout] = useState(false),
    [confirmed, setConfirmed] = useState<string[]>([]),
    [discount, setDiscount] = useState(""),
    [fee, setFee] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("pending");
  const canBuy = data.user.role !== "OPERADOR";
  const pending = data.requests.filter(
    (r) =>
      r.status === "PENDING" ||
      (r.status === "IN_CART" && r.claimed_by_user_id === data.user.id),
  );
  const getItem = (r?: Req) => data.items.find((i) => i.id === r?.item_id);
  const getReq = (id: string) => data.requests.find((r) => r.id === id);
  const sum = lines.reduce((a, l) => a + l.total, 0);
  const confirmedLines = lines.filter((line) => confirmed.includes(line.requestId));
  const confirmedSum = confirmedLines.reduce((sum, line) => sum + line.total, 0);
  const disc = readMoney(discount),
    extra = readMoney(fee);
  const total = sum - (disc || 0) + (extra || 0);
  useEffect(() => {
    store(k, { lines, locationId });
  }, [k, lines, locationId]);
  const apply = async (v: Line) => {
    const r = getReq(v.requestId);
    if (
      !lines.some((l) => l.requestId === v.requestId) &&
      r?.status === "PENDING"
    )
      await cmd("claim", { id: v.requestId, claimed: true });
    setLines((old) => [...old.filter((l) => l.requestId !== v.requestId), v]);
    setEdit(null);
  };
  return (
    <>
      <div className="tabs">
        <button
          className={tab === "pending" ? "selected" : ""}
          onClick={() => setTab("pending")}
        >
          Lista pendente <span>{pending.length}</span>
        </button>
        {canBuy && (
          <>
            <button
              className={tab === "cart" ? "selected" : ""}
              onClick={() => setTab("cart")}
            >
              Carrinho <span>{lines.length}</span>
            </button>
            <button
              className={tab === "history" ? "selected" : ""}
              onClick={() => setTab("history")}
            >
              Compras realizadas
            </button>
          </>
        )}
      </div>
      {canBuy && tab !== "history" && (
        <section className="panel location-strip">
          <span className="item-icon orange">
            <MapPin size={19} />
          </span>
          <Field label="Local da compra">
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Selecione um local</option>
              {data.locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={() => setLocationModal(true)}>
            <Plus size={17} /> Novo local
          </Button>
        </section>
      )}
      <ErrorText error={error} />
      {tab === "pending" && (
        <>
          {canBuy && <section className="panel padded stack">
            <h2>Adicionar insumo à lista</h2>
            <p className="muted">Escolha um insumo cadastrado para adicioná-lo à lista de compras.</p>
            <Field label="Insumo cadastrado"><select value={newRequestItem} onChange={(event) => setNewRequestItem(event.target.value)}>
              <option value="">Selecione</option>{data.items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}
            </select></Field>
            <Button disabled={!newRequestItem || requestBusy} onClick={async () => {
              setRequestBusy(true); setError("");
              try { if (await cmd("request", { itemId: newRequestItem, urgent: false, notes: "Adicionado pelo comprador" })) setNewRequestItem(""); }
              catch (e) { setError(explain(e)); } finally { setRequestBusy(false); }
            }}>Adicionar à lista</Button>
          </section>}
          <div className="section-title">
            <h2>Itens para comprar</h2>
            {canBuy && (
              <button className="link" onClick={() => go("prices")}>
                Comparar locais <ArrowRight size={16} />
              </button>
            )}
          </div>
          {!pending.length && (
            <section className="panel">
              <Empty>Não há solicitações disponíveis.</Empty>
            </section>
          )}
          {(data.categories || []).map((cat) => {
            const list = pending.filter((r) => getItem(r)?.category === cat);
            return (
              list.length > 0 && (
                <section key={cat} className="panel request-group">
                  <div className="panel-header">
                    <div className="item-cell">
                      <CategoryIcon category={cat} />
                      <h2>{cat}</h2>
                    </div>
                    <Badge>
                      {list.length} {list.length === 1 ? "item" : "itens"}
                    </Badge>
                  </div>
                  <div className="list padded">
                    {list.map((r) => {
                      const i = getItem(r)!;
                      const best = minimum(
                        data.history.filter((p) => p.item_id === i.id),
                      );
                      const line = lines.find((l) => l.requestId === r.id);
                      return (
                        <div className="request-row" key={r.id}>
                          <div>
                            <div className="request-title">
                              <strong>{i.name}</strong>
                              {r.priority === "URGENTE" && (
                                <Badge tone="red">Urgente</Badge>
                              )}
                              {line && <Badge tone="green">No carrinho</Badge>}
                            </div>
                            <small>
                              {num(r.suggested_qty)} {i.unit} sugeridos ·{" "}
                              {r.requested_by || "Automático"}
                              {r.reported_remaining_qty !== null &&
                                ` · Só restam ${num(r.reported_remaining_qty)} ${i.unit}`}
                            </small>
                            {r.notes && <p>{r.notes}</p>}
                            {best && (
                              <span className="best">
                                <TrendingDown size={14} />
                                {money(best.unit_price_cents)} / {i.unit} ·{" "}
                                {best.location_name}
                              </span>
                            )}
                          </div>
                          <div className="request-actions">
                            {canBuy && (
                              <Button
                                kind={line ? "secondary" : "primary"}
                                onClick={() => setEdit(r)}
                              >
                                {line ? (
                                  <Pencil size={16} />
                                ) : (
                                  <Plus size={16} />
                                )}{" "}
                                {line ? "Editar" : "Adicionar"}
                              </Button>
                            )}
                            {isAdmin(data) && !line && (
                              <Button
                                kind="icon"
                                aria-label={`Cancelar ${i.name}`}
                                onClick={async () => {
                                  if (!confirm("Cancelar esta solicitação?"))
                                    return;
                                  try {
                                    await cmd("cancel", { id: r.id });
                                  } catch (e) {
                                    setError(explain(e));
                                  }
                                }}
                              >
                                <Trash2 size={16} />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )
            );
          })}
        </>
      )}
      {tab === "cart" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Seu carrinho</h2>
              <p>Confira quantidades e preços antes de finalizar.</p>
            </div>
          </div>
          <div className="list padded">
            {lines.map((l) => {
              const r = getReq(l.requestId),
                i = getItem(r);
              return (
                <div className="list-row" key={l.requestId}>
                  <CategoryIcon category={i?.category || ""} />
                  <div>
                    <strong>{i?.name || "Solicitação indisponível"}</strong>
                    <small>
                      {num(l.quantity)} {i?.unit} × {money(l.unitPrice)}
                    </small>
                  </div>
                  <strong>{money(l.total)}</strong>
                  {r && (
                    <Button
                      kind="icon"
                      aria-label="Editar item"
                      onClick={() => setEdit(r)}
                    >
                      <Pencil size={16} />
                    </Button>
                  )}
                  <Button
                    kind="icon"
                    aria-label="Remover item"
                    onClick={async () => {
                      try {
                        if (
                          r &&
                          (r.status === "PENDING" ||
                            (r.status === "IN_CART" &&
                              r.claimed_by_user_id === data.user.id))
                        )
                          await cmd("claim", { id: r.id, claimed: false });
                        setLines((o) =>
                          o.filter((x) => x.requestId !== l.requestId),
                        );
                      } catch (e) {
                        setError(explain(e));
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              );
            })}
          </div>
          {!lines.length && <Empty>Seu carrinho está vazio.</Empty>}
        </section>
      )}
      {tab === "history" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Histórico de compras</h2>
              <p>Compras finalizadas pela equipe.</p>
            </div>
          </div>
          <div className="list padded">
            {data.purchases.map((p) => (
              <div key={p.id} className="list-row">
                <span className="item-icon orange">
                  <ReceiptText size={17} />
                </span>
                <div>
                  <strong>{p.location_name}</strong>
                  <small>
                    {date(p.completed_at)} ·{" "}
                    {p.stock_updated
                      ? "Entrada no estoque"
                      : "Sem entrada no estoque"}
                  </small>
                </div>
                <strong>{money(p.total_cents)}</strong>
              </div>
            ))}
          </div>
          {!data.purchases.length && <Empty>Nenhuma compra realizada.</Empty>}
        </section>
      )}
      {canBuy && tab !== "history" && (
        <div className="checkout-bar">
          <div>
            <small>
              PRÉVIA DO CAIXA · {lines.length}{" "}
              {lines.length === 1 ? "ITEM" : "ITENS"}
            </small>
            <strong>{money(total)}</strong>
          </div>
          <Button
            kind="primary"
            disabled={!lines.length}
            onClick={() => {
              setError("");
              setConfirmed([]);
              setCheckout(true);
            }}
          >
            <ShoppingCart size={18} /> Finalizar compra
          </Button>
        </div>
      )}
      {locationModal && (
        <LocationForm cmd={cmd} types={data.locations.map((location) => location.type)} close={() => setLocationModal(false)} />
      )}{" "}
      {edit && getItem(edit) && (
        <LineForm
          req={edit}
          item={getItem(edit)!}
          history={data.history.filter((p) => p.item_id === edit.item_id)}
          line={lines.find((l) => l.requestId === edit.id)}
          close={() => setEdit(null)}
          save={apply}
        />
      )}{" "}
      {checkout && (
        <Modal title="Finalizar compra" onClose={() => setCheckout(false)}>
          <Form
            close={() => setCheckout(false)}
            label="Confirmar compra"
            save={async (f) => {
              if (!locationId) throw new Error("Selecione um local de compra.");
              forms.price.parse(disc);
              forms.price.parse(extra);
              if (!confirmedLines.length) throw new Error("Selecione os itens que foram comprados.");
              if (disc > confirmedSum)
                throw new Error("O desconto não pode superar o subtotal dos itens confirmados.");
              if (
                await cmd("purchase", {
                  locationId,
                  lines: confirmedLines,
                  discount: disc,
                  fee: extra,
                  updateStock: true,
                })
              ) {
                setLines((old) => old.filter((line) => !confirmed.includes(line.requestId)));
                setDiscount("");
                setFee("");
                setCheckout(false);
                setTab("history");
              }
            }}
          >
            <p className="muted">
              Local:{" "}
              {data.locations.find((l) => l.id === locationId)?.name ||
                "não selecionado"}
            </p>
            <div className="form-grid">
              <Field label="Desconto (R$)">
                <input
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0,00"
                />
              </Field>
              <Field label="Taxa / sacola (R$)">
                <input
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="0,00"
                />
              </Field>
            </div>
            <h3>Confirme os itens comprados</h3>
            <p className="muted">Somente os itens marcados entrarão no estoque; os demais permanecem no carrinho.</p>
            {lines.map((line) => {
              const item = getItem(getReq(line.requestId));
              return <label className="check" key={line.requestId}>
                <input type="checkbox" checked={confirmed.includes(line.requestId)} onChange={(event) => setConfirmed((current) => event.target.checked ? [...current, line.requestId] : current.filter((id) => id !== line.requestId))} />
                {item?.name || "Solicitação indisponível"} · {num(line.quantity)} {item?.unit} · {money(line.total)}
              </label>;
            })}
            <div className="checkout-total">
              <span>Subtotal confirmado: {money(confirmedSum)}</span>
              <strong>Total {money(confirmedSum - (disc || 0) + (extra || 0))}</strong>
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
export function Prices({ data }: { data: State }) {
  const [item, setItem] = useState(data.items[0]?.id || "");
  const active = data.items.find((i) => i.id === item);
  const rows = data.locations
    .flatMap((l) => {
      const h = data.history.filter(
        (p) => p.item_id === item && p.location_id === l.id,
      );
      const low = minimum(h);
      return low
        ? [
            {
              l,
              low: low.unit_price_cents,
              last: h[0],
              avg: Math.round(
                h.reduce((s, p) => s + p.unit_price_cents, 0) / h.length,
              ),
            },
          ]
        : [];
    })
    .sort((a, b) => a.low - b.low);
  const req = data.requests.filter(
    (r) => r.status === "PENDING" && Number(r.suggested_qty) > 0,
  );
  const estimate = (r: Req, p: Price) =>
    Math.round(
      (Math.round(Number(r.suggested_qty) * 1000) * p.unit_price_cents) / 1000,
    );
  const split = req.map((r) => ({
    r,
    p: minimum(data.history.filter((p) => p.item_id === r.item_id)),
  }));
  const covered = split.filter((x) => x.p).length;
  const splitTotal = split.reduce(
    (sum, x) => sum + (x.p ? estimate(x.r, x.p) : 0),
    0,
  );
  const single = data.locations
    .flatMap((l) => {
      const list = req.map((r) =>
        minimum(
          data.history.filter(
            (p) => p.item_id === r.item_id && p.location_id === l.id,
          ),
        ),
      );
      return req.length && list.every(Boolean)
        ? [{ l, total: list.reduce((s, p, i) => s + estimate(req[i], p!), 0) }]
        : [];
    })
    .sort((a, b) => a.total - b.total)[0];
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recomendação para a lista atual</h2>
            <p>
              Estimativas pelo menor preço histórico, sem deslocamento, frete ou
              garantia de disponibilidade.
            </p>
          </div>
          <span className="item-icon green">
            <TrendingDown size={19} />
          </span>
        </div>
        <div className="recommendations">
          <article>
            <span>MELHOR LOCAL ÚNICO</span>
            <h3>{single?.l.name || "Sem cobertura completa"}</h3>
            <strong>{single ? money(single.total) : "—"}</strong>
            <small>
              {single
                ? `${req.length} solicitações com referência neste local`
                : "Nenhum local tem histórico para toda a lista."}
            </small>
          </article>
          <article>
            <span>ESTRATÉGIA DIVIDIDA</span>
            <h3>Economia máxima</h3>
            <strong>{covered ? money(splitTotal) : "—"}</strong>
            <small>
              {covered}/{req.length} solicitações com referência
              {single
                ? ` · Economia de ${money(single.total - splitTotal)}`
                : ""}
            </small>
          </article>
        </div>
        <div className="list padded">
          {split.map(({ r, p }) => (
            <div key={r.id} className="list-row">
              <span className="item-icon violet">
                <MapPin size={16} />
              </span>
              <div>
                <strong>
                  {data.items.find((i) => i.id === r.item_id)?.name}
                </strong>
                <small>{p?.location_name || "Sem histórico de preço"}</small>
              </div>
              <strong>{p ? money(estimate(r, p)) : "—"}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Ranking de locais por insumo</h2>
            <p>Menor preço, média e valor da última compra.</p>
          </div>
        </div>
        <div className="table-controls">
          <Field label="Selecione o insumo">
            <select value={item} onChange={(e) => setItem(e.target.value)}>
              {data.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Local</th>
                <th>Menor preço</th>
                <th>Último preço</th>
                <th>Média</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, low, last, avg }) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.name}</strong>
                    <small>{l.neighborhood_city}</small>
                  </td>
                  <td>
                    <strong>{money(low)}</strong> / {active?.unit}
                  </td>
                  <td>
                    {money(last.unit_price_cents)}
                    <small>{date(last.created_at)}</small>
                  </td>
                  <td>{money(avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty>Não há preços registrados para este insumo.</Empty>
        )}
      </section>
    </div>
  );
}
function importSales(raw: string) {
  if (raw.trim().startsWith("<")) {
    const doc = new DOMParser().parseFromString(raw, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML inválido.");
    const nodes = [...doc.querySelectorAll("vendas > linha")];
    if (!nodes.length)
      throw new Error(
        "XML esperado: vendas com elementos linha e atributos codigo e quantidade.",
      );
    return nodes.map((n) => ({
      code: n.getAttribute("codigo") || "",
      quantity: Number(n.getAttribute("quantidade")),
    }));
  }
  const lines = raw
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (/^(codigo|código|consumer_code)[;,]/i.test(lines[0] || "")) lines.shift();
  return lines.map((l) => {
    const [code, quantity, ...other] = l
      .split(l.includes(";") ? ";" : ",")
      .map((x) => x.trim().replace(/^"|"$/g, ""));
    if (!code || !quantity || other.length)
      throw new Error("CSV inválido. Use duas colunas: codigo;quantidade.");
    return { code, quantity: Number(quantity) };
  });
}
export function Sales({ data, cmd }: { data: State; cmd: Command }) {
  const [directItemId, setDirectItemId] = useState(""),
    [directItem, setDirectItem] = useState<Item | null>(null),
    [channels, setChannels] = useState<string[]>(["Consumer"]),
    [externalId, setExternal] = useState(""),
    [code, setCode] = useState(data.recipes[0]?.consumer_code || ""),
    [count, setCount] = useState("1"),
    [includeManual, setManual] = useState(false),
    [imported, setImported] = useState<
      { code: string; quantity: number }[] | null
    >(null),
    [filename, setFilename] = useState(""),
    [excelRows, setExcelRows] = useState<string[][] | null>(null),
    [codeColumn, setCodeColumn] = useState(""),
    [quantityColumn, setQuantityColumn] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{ item: Item; quantity: number }[] | null>(
      null,
    );
  const allowManual = data.settings?.allow_manual_in_sales ?? true;
  const body = {
    channel: channels[0],
    channels,
    externalId,
    includeManual: allowManual && includeManual,
    lines: imported || [{ code, quantity: Number(count) }],
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Registrar saída do Consumer</h2>
          <p>
            Revise as quantidades calculadas pelas fichas técnicas antes de
            aplicar.
          </p>
        </div>
      </div>
      <div className="padded stack">
        <h3>Saída direta de insumo</h3>
        <p className="muted">Para baixar um insumo sem ficha técnica, selecione-o e confirme a quantidade e o motivo.</p>
        <Field label="Insumo do estoque">
          <select value={directItemId} onChange={(e) => setDirectItemId(e.target.value)}>
            <option value="">Selecione um insumo</option>
            {data.items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {num(item.current_stock)} {item.unit}</option>)}
          </select>
        </Field>
        <Button disabled={!directItemId} onClick={() => setDirectItem(data.items.find((item) => item.id === directItemId) || null)}>Registrar saída de insumo</Button>
      </div>
      {directItem && <StockAction item={directItem} type="deduct" cmd={cmd} close={() => setDirectItem(null)} />}
      <form
        className="form padded"
        onChange={() => setPreview(null)}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (preview) {
              if (await cmd("sale", body)) {
                setPreview(null);
                setExternal("");
                setImported(null);
                setExcelRows(null);
                setFilename("");
              }
            } else setPreview(await api("preview-sale", body));
          } catch (e) {
            setError(explain(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <fieldset>
            <legend>Canal(is) de venda</legend>
            {["Consumer", "MenuDino", "99Food", "iFood"].map((channel) => <label className="check" key={channel}>
              <input type="checkbox" checked={channels.includes(channel)} disabled={channels.length === 1 && channels.includes(channel)} onChange={(event) => setChannels((current) => event.target.checked ? [...current, channel] : current.filter((value) => value !== channel))} /> {channel}
            </label>)}
            <small className="muted">Os canais identificam o mesmo lote; não importe as mesmas vendas novamente por outro canal.</small>
          </fieldset>
          <Field label="Identificador único do pedido ou lote (opcional)">
            <input
              value={externalId}
              onChange={(e) => setExternal(e.target.value)}
              maxLength={150}
              placeholder="Ex.: IFD-20261119-001"
            />
          </Field>
        </div>
        {!externalId.trim() && <p className="muted">Sem identificador, uma nova confirmação do mesmo pedido não será reconhecida como duplicada.</p>}
        {!imported && !excelRows && (
          <div className="form-grid">
            <Field label="Produto / ficha técnica">
              <select
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {data.recipes.map((r) => (
                  <option key={r.id} value={r.consumer_code}>
                    {r.name} · {r.consumer_code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantidade vendida">
              <input
                type="number"
                min="1"
                max="10000"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                required
              />
            </Field>
          </div>
        )}
        <Field label="Importar Excel (.xlsx), CSV ou XML">
          <input
            key={filename ? "loaded" : "fresh"}
            type="file"
            accept=".xlsx,.csv,.xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/xml,application/xml"
            onChange={async (e) => {
              setError("");
              setPreview(null);
              setImported(null);
              setExcelRows(null);
              setCodeColumn("");
              setQuantityColumn("");
              setFilename("");
              const f = e.target.files?.[0];
              if (f)
                try {
                  if (f.size > 256000)
                    throw new Error("Use arquivos de até 256 KB.");
                  if (/\.xlsx$/i.test(f.name)) {
                    const rows = await readXlsxFile(f);
                    if (rows.length < 2 || rows.length > 201 || rows[0].length > 100) throw new Error("Use uma planilha com cabeçalho e até 200 linhas de dados e 100 colunas.");
                    setExcelRows(rows.map((row) => row.map((cell) => cell == null ? "" : String(cell).trim())));
                  } else setImported(importSales(await f.text()));
                  setFilename(f.name);
                } catch (e) {
                  setError(explain(e));
                }
            }}
          />
        </Field>
        {excelRows && !imported && <div className="stack info-box">
          <p>{filename}: escolha as colunas na primeira aba da planilha.</p>
          <Field label="Coluna do código PDV / ficha técnica"><select value={codeColumn} onChange={(event) => setCodeColumn(event.target.value)}><option value="">Selecione</option>{excelRows[0].map((name, index) => <option key={index} value={String(index)}>{name || `Coluna ${index + 1}`}</option>)}</select></Field>
          <Field label="Coluna de quantidade"><select value={quantityColumn} onChange={(event) => setQuantityColumn(event.target.value)}><option value="">Selecione</option>{excelRows[0].map((name, index) => <option key={index} value={String(index)}>{name || `Coluna ${index + 1}`}</option>)}</select></Field>
          <Button onClick={() => {
            try {
              if (codeColumn === "" || quantityColumn === "" || codeColumn === quantityColumn) throw new Error("Selecione colunas diferentes para código e quantidade.");
              const parsed = excelRows.slice(1).filter((row) => row.some((value) => value !== "")).map((row, index) => {
                const code = row[Number(codeColumn)]?.trim() || "";
                const quantity = Number(row[Number(quantityColumn)]?.trim() || "");
                if (!code || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error(`Código ou quantidade inválida na linha ${index + 2}.`);
                return { code, quantity };
              });
              if (!parsed.length) throw new Error("A planilha não contém linhas de dados.");
              setImported(parsed); setError("");
            } catch (e) { setError(explain(e)); }
          }}>Usar colunas selecionadas</Button>
          <small>Para preservar zeros à esquerda, formate o código como texto no Excel.</small>
          <Button onClick={() => { setExcelRows(null); setFilename(""); setError(""); }}>Cancelar importação</Button>
        </div>}
        {imported ? (
          <div className="info-box">
            {filename} · {imported.length} linha(s){" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                setImported(null);
                setExcelRows(null);
                setFilename("");
                setPreview(null);
              }}
            >
              Remover
            </button>
          </div>
        ) : (
          <small className="muted">
            CSV: <code>codigo;quantidade</code> · XML:{" "}
            <code>
              {'<vendas><linha codigo="YAK-FRANGO" quantidade="2"/></vendas>'}
            </code>
          </small>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={allowManual && includeManual}
            disabled={!allowManual}
            onChange={(e) => setManual(e.target.checked)}
          />{" "}
          Incluir também os insumos configurados para baixa manual neste lote
        </label>
        {preview && (
          <div className="preview">
            <h3>Prévia de baixa</h3>
            {preview.map((p) => (
              <div key={p.item.id} className="list-row">
                <CategoryIcon category={p.item.category} />
                <div>
                  <strong>{p.item.name}</strong>
                  <small>
                    Saldo atual: {num(p.item.current_stock)} {p.item.unit}
                  </small>
                </div>
                <Badge
                  tone={
                    p.quantity > Number(p.item.current_stock) ? "red" : "blue"
                  }
                >
                  −{num(p.quantity)} {p.item.unit}
                </Badge>
              </div>
            ))}
            {!preview.length && (
              <p className="muted">
                Nenhum insumo elegível. A confirmação registra o lote sem
                alterar o estoque.
              </p>
            )}
          </div>
        )}
        <ErrorText error={error} />
        <div className="form-actions">
          <Button type="submit" kind="primary" disabled={busy || (!!excelRows && !imported)}>
            <FileUp size={17} />{" "}
            {preview ? "Confirmar e baixar estoque" : "Calcular prévia"}
          </Button>
        </div>
      </form>
    </section>
  );
}
export function Recipes({ data, cmd }: { data: State; cmd: Command }) {
  const [edit, setEdit] = useState<Recipe | true | null>(null);
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Fichas técnicas Delivery</h2>
            <p>Consumo unitário por produto vendido.</p>
          </div>
          <Button kind="primary" onClick={() => setEdit(true)}>
            <Plus size={18} /> Nova ficha
          </Button>
        </div>
        <div className="list padded">
          {data.recipes.map((r) => (
            <div className="list-row" key={r.id}>
              <span className="item-icon violet">
                <Package size={17} />
              </span>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.consumer_code} · {r.items.length} insumos
                </small>
              </div>
              <Button onClick={() => setEdit(r)}>
                <Pencil size={15} /> Editar
              </Button>
            </div>
          ))}
        </div>
        {!data.recipes.length && <Empty>Nenhuma ficha cadastrada.</Empty>}
      </section>
      {edit && (
        <RecipeForm
          data={data}
          recipe={edit === true ? undefined : edit}
          cmd={cmd}
          close={() => setEdit(null)}
        />
      )}
    </>
  );
}
function RecipeForm({
  data,
  recipe,
  cmd,
  close,
}: {
  data: State;
  recipe?: Recipe;
  cmd: Command;
  close: () => void;
}) {
  const [lines, setLines] = useState(
    (recipe?.items || [{ item_id: "", quantity: 1 }]).map((v, i) => ({
      ...v,
      key: i,
    })),
  );
  return (
    <Modal
      title={recipe ? "Editar ficha técnica" : "Nova ficha técnica"}
      onClose={close}
    >
      <Form
        close={close}
        save={async (f) => {
          const items = lines.map((l) => ({
            itemId: str(f, `item${l.key}`),
            quantity: qty(f, `qty${l.key}`),
          }));
          if (
            !items.length ||
            new Set(items.map((l) => l.itemId)).size !== items.length
          )
            throw new Error("Informe pelo menos um insumo, sem duplicatas.");
          if (
            await cmd("recipe", {
              id: recipe?.id,
              name: forms.text.parse(str(f, "name")),
              code: forms.text.parse(str(f, "code")),
              items,
            })
          )
            close();
        }}
      >
        <Field label="Produto vendido">
          <input name="name" defaultValue={recipe?.name} required />
        </Field>
        <Field label="Código do Consumer">
          <input name="code" defaultValue={recipe?.consumer_code} required />
        </Field>
        {lines.map((l, i) => (
          <div className="form-grid recipe-line" key={l.key}>
            <Field label={`Insumo ${i + 1}`}>
              <select name={`item${l.key}`} defaultValue={l.item_id} required>
                <option value="">Selecione</option>
                {data.items.map((it) => (
                  <option value={it.id} key={it.id}>
                    {it.name} ({it.unit})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Consumo por venda">
              <QtyInput name={`qty${l.key}`} value={l.quantity} />
            </Field>
            <Button
              kind="icon"
              aria-label="Remover insumo"
              onClick={() => setLines((o) => o.filter((x) => x.key !== l.key))}
            >
              <Trash2 size={17} />
            </Button>
          </div>
        ))}
        <Button
          onClick={() =>
            setLines((o) => [
              ...o,
              {
                item_id: "",
                quantity: 1,
                key: Math.max(-1, ...o.map((x) => x.key)) + 1,
              },
            ])
          }
        >
          <Plus size={16} /> Adicionar insumo
        </Button>
      </Form>
    </Modal>
  );
}
const actions: Record<string, string> = {
  CREATE: "Criou",
  UPDATE: "Editou",
  DELETE: "Excluiu",
  REQUEST_PURCHASE: "Solicitou compra",
  REPORT_STOCK_X: "Informou saldo",
  STOCK_DEDUCTION: "Baixou estoque",
  COMPLETE_PURCHASE: "Finalizou compra",
};
const entities: Record<string, string> = {
  registrations: "Solicitações de acesso",
  items: "Estoque",
  purchase_requests: "Lista de compras",
  purchases: "Compras",
  purchase_items: "Preços de compra",
  locations: "Locais e fornecedores",
  recipes: "Fichas técnicas",
  sales_deductions: "Saída de pedidos",
  users: "Usuários",
  operation_settings: "Configurações",
};
const labels: Record<string, string> = {
  current_stock: "Saldo",
  min_stock: "Estoque mínimo",
  ideal_stock: "Estoque ideal",
  name: "Nome",
  unit: "Unidade",
  category: "Categoria",
  deduction_mode: "Regra de baixa",
  active: "Ativo",
  unit_price_cents: "Preço unitário",
  total_cents: "Total",
  notes: "Observações",
  status: "Status",
  reported_remaining_qty: "Saldo informado",
  priority: "Prioridade",
  suggested_qty: "Quantidade sugerida",
  role: "Perfil",
  email: "E-mail",
  consumer_code: "Código Consumer",
  neighborhood_city: "Bairro / cidade",
  type: "Tipo",
  discount_cents: "Desconto",
  extra_fee_cents: "Taxa",
  stock_updated: "Entrada no estoque",
  auto_min_requests: "Reposição automática",
  allow_manual_in_sales: "Baixa manual no Consumer",
};
export function AuditView({ data }: { data: State }) {
  const [actor, setActor] = useState(""),
    [action, setAction] = useState(""),
    [entity, setEntity] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [limit, setLimit] = useState(30);
  const list = data.audit.filter(
    (a) =>
      (!actor || a.user_name === actor) &&
      (!action || a.action === action) &&
      (!entity || a.entity_type === entity) &&
      (!from || new Date(a.created_at) >= new Date(from + "T00:00:00")) &&
      (!to || new Date(a.created_at) <= new Date(to + "T23:59:59.999")),
  );
  const fmt = (key: string, val: unknown) =>
    val == null
      ? "—"
      : key.endsWith("_cents")
        ? money(Number(val))
        : key.endsWith("_stock") || key.endsWith("_qty")
          ? num(Number(val))
          : typeof val === "boolean"
            ? val
              ? "Sim"
              : "Não"
            : typeof val === "object"
              ? JSON.stringify(val)
              : String(val);
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Linha do tempo</h2>
          <p>
            {list.length} registros encontrados · trilha de auditoria imutável.
          </p>
        </div>
      </div>
      <div className="table-controls filters">
        <Field label="Usuário">
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Todos</option>
            {[...new Set(data.audit.map((a) => a.user_name))].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Ação">
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(actions).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Módulo">
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(entities).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="De">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Até">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      <div className="list padded">
        {list.slice(0, limit).map((a) => {
          const fields = [
            ...new Set([
              ...Object.keys(a.old_data || {}),
              ...Object.keys(a.new_data || {}),
            ]),
          ].filter(
            (k) =>
              !["id", "updated_at", "created_at", "password_hash"].includes(
                k,
              ) &&
              JSON.stringify(a.old_data?.[k]) !==
                JSON.stringify(a.new_data?.[k]),
          );
          return (
            <details className="audit-row" key={a.id}>
              <summary>
                <span className="item-icon blue">
                  <ReceiptText size={17} />
                </span>
                <div>
                  <strong>
                    {a.user_name} · {actions[a.action] || a.action} ·{" "}
                    {a.entity_name}
                  </strong>
                  <small>
                    {roleNames[a.user_role]} ·{" "}
                    {entities[a.entity_type] || a.entity_type} ·{" "}
                    {date(a.created_at)} ·{" "}
                    {a.device_type === "DESKTOP" ? "Desktop" : "Mobile"}
                  </small>
                </div>
              </summary>
              <div className="diff">
                {fields.length ? (
                  fields.map((k) => (
                    <div key={k}>
                      <b>{labels[k] || k}</b>
                      <span>
                        {fmt(k, a.old_data?.[k])} → {fmt(k, a.new_data?.[k])}
                      </span>
                    </div>
                  ))
                ) : (
                  <span>Nenhum campo alterado.</span>
                )}
              </div>
            </details>
          );
        })}
      </div>
      {!list.length && <Empty>Nenhum evento corresponde aos filtros.</Empty>}
      {list.length > limit && (
        <div className="panel-footer">
          <Button onClick={() => setLimit((n) => n + 30)}>Mostrar mais</Button>
        </div>
      )}
    </section>
  );
}
export function UsersView({ data, cmd }: { data: State; cmd: Command }) {
  const [edit, setEdit] = useState<User | true | null>(null);
  const u = edit && edit !== true ? edit : undefined;
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Contas da equipe</h2>
            <p>
              O perfil determina as operações disponíveis para cada usuário.
            </p>
          </div>
          <Button kind="primary" onClick={() => setEdit(true)}>
            <Plus size={17} /> Novo usuário
          </Button>
        </div>
        <div className="list padded">
          {data.users.map((u) => (
            <div className="list-row" key={u.id}>
              <span className="avatar">
                {u.name
                  .split(" ")
                  .slice(0, 2)
                  .map((k) => k[0])
                  .join("")}
              </span>
              <div>
                <strong>{u.name}</strong>
                <small>
                  {u.email} · {roleNames[u.role]}
                </small>
              </div>
              <Badge tone={u.active ? "green" : "gray"}>
                {u.active ? "Ativo" : "Inativo"}
              </Badge>
              <Button onClick={() => setEdit(u)}>
                <Pencil size={15} /> Editar
              </Button>
              {u.id !== data.user.id && (
                <Button onClick={() => {
                  if (window.confirm(`Excluir o acesso de ${u.name}? O histórico será preservado.`))
                    void cmd("deleteUser", { id: u.id });
                }}>
                  <Trash2 size={15} /> Excluir
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      {edit && (
        <Modal
          title={u ? "Editar conta" : "Nova conta"}
          onClose={() => setEdit(null)}
        >
          <Form
            close={() => setEdit(null)}
            save={async (f) => {
              if (
                await cmd("user", {
                  id: u?.id,
                  name: forms.text.parse(str(f, "name")),
                  email: str(f, "email"),
                  role: str(f, "role"),
                  active: f.get("active") === "on",
                  password: String(f.get("password") || "") || undefined,
                })
              )
                setEdit(null);
            }}
          >
            <Field label="Nome">
              <input name="name" required defaultValue={u?.name} />
            </Field>
            <Field label="E-mail">
              <input
                name="email"
                type="email"
                required
                defaultValue={u?.email}
              />
            </Field>
            <Field label="Perfil">
              <select name="role" defaultValue={u?.role || "OPERADOR"}>
                {Object.entries(roleNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                u
                  ? "Nova senha (opcional)"
                  : "Senha inicial (mínimo 12 caracteres)"
              }
            >
              <input
                type="password"
                name="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required={!u}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                name="active"
                defaultChecked={u?.active ?? true}
              />{" "}
              Conta ativa
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}

export function SettingsForm({ data, cmd }: { data: State; cmd: Command }) {
  return (
    <Form
      label="Salvar regras"
      save={async (f) => {
        await cmd("settings", {
          autoMinRequests: f.get("auto") === "on",
          allowManualInSales: f.get("manual") === "on",
        });
      }}
    >
      <h3>Regras da operação</h3>
      <label className="check">
        <input
          type="checkbox"
          name="auto"
          defaultChecked={data.settings?.auto_min_requests ?? true}
        />{" "}
        Solicitar reposição quando o saldo ficar abaixo do mínimo
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="manual"
          defaultChecked={data.settings?.allow_manual_in_sales ?? true}
        />{" "}
        Permitir incluir insumos manuais ao confirmar vendas
      </label>
    </Form>
  );
}

export function RegistrationReview({
  data,
  cmd,
}: {
  data: State;
  cmd: Command;
}) {
  const [review, setReview] = useState<State["registrations"][number] | null>(
    null,
  );
  const requests = data.registrations ?? [];
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Solicitações de acesso</h2>
          <p>Escolha o perfil ao aprovar. Até lá, a pessoa não pode entrar.</p>
        </div>
        <Badge tone="amber">
          {requests.filter((r) => r.status === "PENDING").length} pendente(s)
        </Badge>
      </div>
      <div className="list padded">
        {requests.map((r) => (
          <div className="list-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                {r.email} · {date(r.created_at)}
              </small>
            </div>
            <Badge
              tone={
                r.status === "PENDING"
                  ? "amber"
                  : r.status === "APPROVED"
                    ? "green"
                    : "red"
              }
            >
              {r.status === "PENDING"
                ? "Pendente"
                : r.status === "APPROVED"
                  ? `Aprovada · ${r.approved_role ? roleNames[r.approved_role] : ""}`
                  : "Recusada"}
            </Badge>
            {r.status === "PENDING" && (
              <Button onClick={() => setReview(r)}>Revisar</Button>
            )}
          </div>
        ))}
      </div>
      {!requests.length && <Empty>Nenhuma solicitação recebida.</Empty>}
      {review && (
        <Modal title="Revisar solicitação" onClose={() => setReview(null)}>
          <p>
            {review.name} · {review.email}
          </p>
          <Form
            label="Confirmar decisão"
            close={() => setReview(null)}
            save={async (f) => {
              const role = str(f, "role");
              await cmd(
                "reviewRegistration",
                role === "reject"
                  ? { id: review.id, decision: "reject" }
                  : { id: review.id, decision: "approve", role },
              );
              setReview(null);
            }}
          >
            <Field label="Decisão">
              <select name="role" defaultValue="" required>
                <option value="" disabled>
                  Selecione uma opção
                </option>
                <option value="OPERADOR">Aprovar como Operador</option>
                <option value="COMPRADOR">Aprovar como Comprador</option>
                <option value="ADM">Aprovar como Administrador</option>
                <option value="reject">Recusar cadastro</option>
              </select>
            </Field>
          </Form>
        </Modal>
      )}
    </section>
  );
}
