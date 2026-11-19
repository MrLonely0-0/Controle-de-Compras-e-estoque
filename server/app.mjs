import express from "express";
import { randomUUID as id, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  query,
  tx,
  migrate,
  embedded,
  verify,
  hash,
  listenChanges,
} from "./db.mjs";
import { seed } from "./seed.mjs";
import { resolve } from "node:path";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
const prod = process.env.NODE_ENV === "production",
  secure = prod || process.env.SECURE_COOKIE === "1";
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use((_r, s, n) => {
  s.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  if (prod)
    s.set({
      "Content-Security-Policy":
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
      "Strict-Transport-Security": "max-age=31536000",
    });
  n();
});
const roles = ["ADM_MASTER", "ADM", "OPERADOR", "COMPRADOR"];
const managers = roles.slice(0, 2),
  stock = [...managers, "OPERADOR"],
  buyers = [...managers, "COMPRADOR"];
const category = z.enum([
  "Embalagens",
  "Proteínas",
  "Hortifrúti",
  "Mercearia",
  "Bebidas",
  "Molhos",
  "Limpeza",
  "Descartáveis",
]);
const unit = z.enum(["un", "kg", "g", "L", "ml", "cx", "pct"]);
const qty = z
  .number()
  .min(0)
  .max(1000000)
  .refine(
    (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001,
    "Use até três casas decimais",
  );
const positive = qty.refine((n) => n > 0, "Informe uma quantidade positiva");
const cents = z.number().int().min(0).max(100000000);
const text = z.string().trim().min(1).max(150);
const key = z.string().min(1).max(100);
const notes = z.string().max(500).default("");
const sale = z.object({
  channel: z.enum(["MenuDino", "99Food", "iFood"]),
  externalId: text,
  lines: z
    .array(
      z.object({ code: text, quantity: z.number().int().min(1).max(10000) }),
    )
    .min(1)
    .max(200),
  includeManual: z.boolean().default(false),
});
const schemas = {
  reviewRegistration: z.discriminatedUnion("decision", [
    z.object({
      id: key,
      decision: z.literal("approve"),
      role: z.enum(["ADM", "OPERADOR", "COMPRADOR"]),
    }),
    z.object({ id: key, decision: z.literal("reject") }),
  ]),
  item: z
    .object({
      id: key.optional(),
      version: z.iso.datetime().optional(),
      name: text,
      category,
      unit,
      current: qty,
      min: qty,
      ideal: qty,
      mode: z.enum(["AUTO", "MANUAL"]),
      active: z.boolean().default(true),
    })
    .refine(
      (a) => a.ideal >= a.min,
      "O estoque ideal deve ser igual ou maior que o mínimo",
    ),
  request: z.object({
    itemId: key,
    remaining: qty.optional(),
    urgent: z.boolean(),
    notes,
  }),
  deduct: z.object({ itemId: key, quantity: positive, notes: text }),
  location: z.object({
    id: key.optional(),
    name: text,
    type: z.enum([
      "Atacarejo",
      "Supermercado",
      "Distribuidora",
      "Açougue",
      "Embalagens",
      "Hortifrúti",
    ]),
    neighborhood: text,
    notes,
  }),
  purchase: z.object({
    locationId: key,
    discount: cents,
    fee: cents,
    updateStock: z.boolean(),
    lines: z
      .array(
        z.object({
          requestId: key,
          quantity: positive,
          unitPrice: cents,
          total: cents,
          priceBasis: z.enum(["unit", "total"]),
        }),
      )
      .min(1)
      .max(100),
  }),
  sale,
  recipe: z.object({
    id: key.optional(),
    name: text,
    code: text,
    items: z
      .array(z.object({ itemId: key, quantity: positive }))
      .min(1)
      .max(100),
  }),
  user: z.object({
    id: key.optional(),
    name: text,
    email: z.string().email().max(150),
    role: z.enum(roles),
    active: z.boolean(),
    password: z.string().min(12).max(128).optional(),
  }),
  settings: z.object({
    autoMinRequests: z.boolean(),
    allowManualInSales: z.boolean(),
  }),
  deleteItem: z.object({ id: key }),
  claim: z.object({ id: key, claimed: z.boolean() }),
  cancel: z.object({ id: key }),
};
const permissions = {
  reviewRegistration: ["ADM_MASTER"],
  item: managers,
  request: stock,
  deduct: stock,
  location: buyers,
  purchase: buyers,
  sale: stock,
  recipe: managers,
  user: ["ADM_MASTER"],
  settings: ["ADM_MASTER"],
  deleteItem: ["ADM_MASTER"],
  claim: buyers,
  cancel: managers,
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const one = async (c, s, p = []) => {
  const r = (await c.query(s, p)).rows[0];
  if (!r) throw fail("Registro não encontrado.", 404);
  return r;
};
const signature = (token) => createHash("sha256").update(token).digest("hex");
const cookie = (r) =>
  r.headers.cookie?.match(/(?:^|; )session=([a-f0-9]{64})(?:;|$)/)?.[1];
const sessionCookie = { httpOnly: true, sameSite: "lax", secure, path: "/" };
app.use("/api", (r, s, n) => {
  s.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(r.method)) {
    const origin = r.get("origin");
    const host = r.get("host");
    if (origin && (!URL.canParse(origin) || new URL(origin).host !== host))
      return n(fail("Origem inválida.", 403));
    if (!r.is("application/json")) return n(fail("Use application/json.", 415));
  }
  n();
});
const attempts = new Map();
app.post("/api/login", async (r, s) => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const ip = r.ip || "";
  const a = attempts.get(ip) || { count: 0, until: now + 60000 };
  if (a.count++ >= 10) throw fail("Muitas tentativas. Aguarde um minuto.", 429);
  attempts.set(ip, a);
  const b = z
    .object({
      email: z.string().email().max(150),
      password: z.string().min(1).max(128),
    })
    .parse(r.body);
  const u = (
    await query("SELECT * FROM users WHERE email=$1 AND active", [
      b.email.toLowerCase(),
    ])
  ).rows[0];
  if (!u || !verify(b.password, u.password_hash))
    throw fail("E-mail ou senha inválidos.", 401);
  attempts.delete(ip);
  const raw = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')", [
    signature(raw),
    u.id,
  ]);
  s.cookie("session", raw, { ...sessionCookie, maxAge: 604800000 });
  s.json({ id: u.id, name: u.name, role: u.role });
});
const registrationAttempts = new Map();
app.post("/api/register", async (r, s) => {
  const now = Date.now();
  for (const [k, v] of registrationAttempts)
    if (v.until < now) registrationAttempts.delete(k);
  const ip = r.ip || "";
  const attempt = registrationAttempts.get(ip) || {
    count: 0,
    until: now + 60000,
  };
  if (attempt.count++ >= 5)
    throw fail("Muitas solicitações. Tente novamente em um minuto.", 429);
  registrationAttempts.set(ip, attempt);
  const b = z
    .object({
      name: z.string().trim().min(2).max(150),
      email: z.email().max(150),
      password: z.string().min(12).max(128),
    })
    .strict()
    .parse(r.body);
  const email = b.email.toLowerCase();
  const result = await query(
    `INSERT INTO registrations(id,name,email,password_hash)
    SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM users WHERE email=$3)
    ON CONFLICT DO NOTHING RETURNING id`,
    [id(), b.name, email, hash(b.password)],
  );
  if (result.rows.length) await query("SELECT pg_notify('changes','{}')");
  s.status(202).json({
    message:
      "Se o e-mail estiver disponível, a solicitação ficará aguardando aprovação do ADM Master.",
  });
});
app.get("/api/environment", (_r, s) => s.json({ demo: !!embedded }));
app.use("/api", async (r, _s, n) => {
  const raw = cookie(r);
  if (!raw) throw fail("Entre para continuar.", 401);
  r.user = await oneOrUnauthorized(raw);
  n();
});
async function oneOrUnauthorized(raw) {
  const u = (
    await query(
      "SELECT u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=$1 AND expires_at>now() AND u.active",
      [signature(raw)],
    )
  ).rows[0];
  if (!u) throw fail("Sessão expirada.", 401);
  return u;
}
app.post("/api/logout", async (r, s) => {
  await query("DELETE FROM sessions WHERE token=$1", [signature(cookie(r))]);
  s.clearCookie("session", sessionCookie).json({ ok: true });
});
const streams = new Set();
await migrate();
if (embedded) await seed("Nordeschina2026!");
await listenChanges(() => {
  for (const s of streams) s.write("event: change\ndata: {}\n\n");
});
app.get("/api/events", (r, s) => {
  s.set({
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  s.flushHeaders();
  s.write("event: change\ndata: {}\n\n");
  streams.add(s);
  const timer = setInterval(async () => {
    try {
      await oneOrUnauthorized(cookie(r));
      s.write(": ping\n\n");
    } catch {
      s.end();
    }
  }, 20000);
  s.on("close", () => {
    streams.delete(s);
    clearInterval(timer);
  });
});
app.get("/api/state", async (r, s) => {
  const role = r.user.role;
  const data = await tx(async (c) => {
    const q = async (sql, p = []) => (await c.query(sql, p)).rows;
    return {
      user: r.user,
      settings: (
        await q(
          "SELECT auto_min_requests,allow_manual_in_sales FROM operation_settings",
        )
      )[0],
      items: await q(
        "SELECT * FROM items ORDER BY CASE WHEN id LIKE 'i%' THEN length(id) ELSE 999 END,id",
      ),
      locations: buyers.includes(role)
        ? await q("SELECT * FROM locations ORDER BY name")
        : [],
      requests: await q(
        `SELECT p.*,u.name requested_by FROM purchase_requests p LEFT JOIN users u ON u.id=p.requested_by_user_id ORDER BY p.created_at DESC,p.id`,
      ),
      history: buyers.includes(role)
        ? await q(
            `SELECT pi.*,l.name location_name FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id JOIN locations l ON l.id=pi.location_id WHERE p.status='COMPLETED' ORDER BY pi.created_at DESC,pi.id`,
          )
        : [],
      purchases: buyers.includes(role)
        ? await q(
            "SELECT p.*,l.name location_name FROM purchases p JOIN locations l ON l.id=p.location_id ORDER BY completed_at DESC",
          )
        : [],
      recipes: stock.includes(role)
        ? await q(
            "SELECT r.*,coalesce((SELECT jsonb_agg(to_jsonb(ri)) FROM recipe_items ri WHERE ri.recipe_id=r.id),'[]') items FROM recipes r ORDER BY name",
          )
        : [],
      audit: managers.includes(role)
        ? await q(
            "SELECT * FROM audit_logs WHERE ($1='ADM_MASTER' OR user_role<>'ADM_MASTER') ORDER BY created_at DESC",
            [role],
          )
        : [],
      registrations:
        role === "ADM_MASTER"
          ? await q(
              "SELECT id,name,email,status,created_at,reviewed_at,approved_role FROM registrations ORDER BY created_at DESC",
            )
          : [],
      users:
        role === "ADM_MASTER"
          ? await q("SELECT id,name,email,role,active FROM users ORDER BY name")
          : [],
    };
  });
  s.json(data);
});
async function plan(c, b, lock = false) {
  if (
    b.includeManual &&
    !(await one(c, "SELECT allow_manual_in_sales FROM operation_settings"))
      .allow_manual_in_sales
  )
    throw fail(
      "A operação não permite incluir insumos manuais ao lançar vendas.",
      403,
    );
  const map = {};
  for (const line of b.lines) {
    const recipe = await one(
      c,
      "SELECT * FROM recipes WHERE consumer_code=$1",
      [line.code],
    );
    const rows = (
      await c.query(
        "SELECT i.*,ri.quantity FROM recipe_items ri JOIN items i ON i.id=ri.item_id WHERE ri.recipe_id=$1 AND i.active AND ($2 OR i.deduction_mode='AUTO')",
        [recipe.id, b.includeManual],
      )
    ).rows;
    for (const i of rows) {
      map[i.id] ??= 0;
      map[i.id] += Math.round(Number(i.quantity) * 1000) * line.quantity;
    }
  }
  const out = [];
  for (const k of Object.keys(map).sort()) {
    const i = await one(
      c,
      "SELECT * FROM items WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
      [k],
    );
    out.push({ item: i, quantity: map[k] / 1000 });
  }
  return out;
}
app.post("/api/preview-sale", async (r, s) => {
  if (!stock.includes(r.user.role)) throw fail("Sem permissão.", 403);
  s.json(await plan({ query }, sale.parse(r.body)));
});
app.post("/api/commands/:type", async (r, s) => {
  const t = r.params.type;
  if (!Object.hasOwn(schemas, t)) throw fail("Operação desconhecida.", 404);
  if (!permissions[t].includes(r.user.role)) throw fail("Sem permissão.", 403);
  const { operationId, data } = z
    .object({ operationId: z.string().uuid(), data: z.unknown() })
    .parse(r.body);
  const b = schemas[t].parse(data);
  const u = r.user;
  await tx(async (c) => {
    const q = (sql, p = []) => c.query(sql, p);
    if (
      !(
        await q(
          "INSERT INTO operations VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
          [u.id, operationId],
        )
      ).rows.length
    )
      return;
    const audit = (action, entity, eid, name, old, next) =>
      q(
        "INSERT INTO audit_logs(id,user_id,user_name,user_role,action,entity_type,entity_id,entity_name,old_data,new_data,device_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          id(),
          u.id,
          u.name,
          u.role,
          action,
          entity,
          eid,
          name,
          old == null ? null : JSON.stringify(old),
          next == null ? null : JSON.stringify(next),
          /Android|iPhone|Mobile/i.test(r.get("user-agent") || "")
            ? "MOBILE_WEB"
            : "DESKTOP",
        ],
      );
    const getItem = (k) =>
      one(c, "SELECT * FROM items WHERE id=$1 FOR UPDATE", [k]);
    const newRequest = async (i, type, remaining, urgent, note) => {
      const k = id();
      const result = (
        await q(
          `INSERT INTO purchase_requests(id,item_id,request_type,reported_remaining_qty,suggested_qty,priority,notes,status,requested_by_user_id) VALUES($1,$2,$3,$4,greatest(0,$5::numeric-$6::numeric),$7,$8,'PENDING',$9) ON CONFLICT DO NOTHING RETURNING *`,
          [
            k,
            i.id,
            type,
            remaining,
            i.ideal_stock,
            remaining ?? i.current_stock,
            urgent ? "URGENTE" : "NORMAL",
            note,
            u.id,
          ],
        )
      ).rows[0];
      if (result)
        await audit(
          type === "LOW_STOCK_X" ? "REPORT_STOCK_X" : "REQUEST_PURCHASE",
          "purchase_requests",
          k,
          i.name,
          null,
          result,
        );
    };
    const auto = async (i) => {
      if (
        i.active &&
        Number(i.current_stock) < Number(i.min_stock) &&
        (await one(c, "SELECT auto_min_requests FROM operation_settings"))
          .auto_min_requests &&
        !(
          await q(
            "SELECT 1 FROM purchase_requests WHERE item_id=$1 AND status IN ('PENDING','IN_CART') LIMIT 1",
            [i.id],
          )
        ).rows.length
      )
        await newRequest(
          i,
          "AUTO_MIN_STOCK",
          null,
          false,
          "Estoque abaixo do mínimo.",
        );
    };
    const change = async (i, value, action, note) => {
      if (value < 0 && !i.active) throw fail("Insumo inativo.");
      const n = await one(
        c,
        "UPDATE items SET current_stock=round(current_stock+$2::numeric,3),updated_at=now() WHERE id=$1 AND current_stock+$2::numeric>=0 RETURNING *",
        [i.id, value],
      ).catch((e) => {
        if (e.status === 404) throw fail(`Saldo insuficiente: ${i.name}.`, 409);
        throw e;
      });
      await audit(action, "items", i.id, i.name, i, { ...n, notes: note });
      return n;
    };
    if (t === "item") {
      const k = b.id || id(),
        old = b.id ? await getItem(k) : null;
      if (
        old &&
        b.version &&
        new Date(old.updated_at).toISOString() !== b.version
      )
        throw fail(
          "O insumo mudou em outro dispositivo. Reabra a edição para carregar o saldo atual.",
          409,
        );
      if (
        old &&
        old.unit !== b.unit &&
        (await q("SELECT 1 FROM purchase_items WHERE item_id=$1 LIMIT 1", [k]))
          .rows.length
      )
        throw fail(
          "Não é possível alterar a unidade de insumos com histórico.",
        );
      const n = await one(
        c,
        `INSERT INTO items VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT(id) DO UPDATE SET name=$2,category=$3,unit=$4,current_stock=$5,min_stock=$6,ideal_stock=$7,deduction_mode=$8,active=$9,updated_at=now() RETURNING *`,
        [
          k,
          b.name,
          b.category,
          b.unit,
          b.current,
          b.min,
          b.ideal,
          b.mode,
          b.active,
        ],
      );
      await audit(old ? "UPDATE" : "CREATE", "items", k, b.name, old, n);
      await auto(n);
    }
    if (t === "deleteItem") {
      const i = await getItem(b.id);
      await q("DELETE FROM items WHERE id=$1", [i.id]);
      await audit("DELETE", "items", i.id, i.name, i, null);
    }
    if (t === "request") {
      const i = await getItem(b.itemId);
      if (!i.active) throw fail("Insumo inativo.");
      if (b.remaining !== undefined) {
        const next = await one(
          c,
          "UPDATE items SET current_stock=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [i.id, b.remaining],
        );
        await audit("REPORT_STOCK_X", "items", i.id, i.name, i, next);
      }
      await newRequest(
        i,
        b.remaining === undefined ? "BUY_ITEM" : "LOW_STOCK_X",
        b.remaining ?? null,
        b.urgent,
        b.notes,
      );
    }
    if (t === "deduct")
      await auto(
        await change(
          await getItem(b.itemId),
          -b.quantity,
          "STOCK_DEDUCTION",
          b.notes,
        ),
      );
    if (t === "location") {
      if (b.id && !managers.includes(u.role))
        throw fail("Sem permissão para editar locais.", 403);
      const k = b.id || id(),
        old = b.id
          ? await one(c, "SELECT * FROM locations WHERE id=$1 FOR UPDATE", [k])
          : null;
      const n = await one(
        c,
        `INSERT INTO locations(id,name,type,neighborhood_city,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$2,type=$3,neighborhood_city=$4,notes=$5 RETURNING *`,
        [k, b.name, b.type, b.neighborhood, b.notes],
      );
      await audit(old ? "UPDATE" : "CREATE", "locations", k, b.name, old, n);
    }
    if (t === "claim" || t === "cancel") {
      const old = await one(
        c,
        "SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE",
        [b.id],
      );
      if (t === "claim" && !b.claimed && old.status === "PENDING") return;
      if (
        t === "claim" &&
        (old.status !== (b.claimed ? "PENDING" : "IN_CART") ||
          (!b.claimed && old.claimed_by_user_id !== u.id))
      )
        throw fail("A solicitação mudou em outro dispositivo.", 409);
      if (t === "cancel" && !["PENDING", "IN_CART"].includes(old.status))
        throw fail("Solicitação já encerrada.", 409);
      const n = await one(
        c,
        "UPDATE purchase_requests SET status=$2,claimed_by_user_id=$3 WHERE id=$1 RETURNING *",
        [
          b.id,
          t === "cancel" ? "CANCELED" : b.claimed ? "IN_CART" : "PENDING",
          t === "claim" && b.claimed ? u.id : null,
        ],
      );
      const item = await one(c, "SELECT name FROM items WHERE id=$1", [
        old.item_id,
      ]);
      await audit("UPDATE", "purchase_requests", b.id, item.name, old, n);
    }
    if (t === "purchase") {
      await one(c, "SELECT * FROM locations WHERE id=$1", [b.locationId]);
      const keys = new Set(b.lines.map((l) => l.requestId));
      if (keys.size !== b.lines.length)
        throw fail("Itens duplicados no carrinho.");
      let subtotal = 0;
      for (const l of b.lines) {
        const milli = Math.round(l.quantity * 1000);
        if (
          (l.priceBasis === "unit" &&
            Math.round((milli * l.unitPrice) / 1000) !== l.total) ||
          (l.priceBasis === "total" &&
            Math.round((l.total * 1000) / milli) !== l.unitPrice)
        )
          throw fail("Preço e quantidade inconsistentes.");
        subtotal += l.total;
      }
      const total = subtotal - b.discount + b.fee;
      if (b.discount > subtotal || total > 2147483647 || subtotal > 2147483647)
        throw fail("Totais inválidos.");
      const k = id();
      const purchase = await one(
        c,
        "INSERT INTO purchases VALUES($1,$2,$3,$4,$5,$6,$7,$8,'COMPLETED',now()) RETURNING *",
        [
          k,
          b.locationId,
          u.id,
          subtotal,
          b.discount,
          b.fee,
          total,
          b.updateStock,
        ],
      );
      const requests = [];
      for (const l of [...b.lines].sort((a, b) =>
        a.requestId.localeCompare(b.requestId),
      )) {
        const req = await one(
          c,
          "SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE",
          [l.requestId],
        );
        if (
          req.status !== "PENDING" &&
          (req.status !== "IN_CART" || req.claimed_by_user_id !== u.id)
        )
          throw fail("Uma solicitação já foi assumida ou finalizada.", 409);
        requests.push({ l, req });
      }
      for (const { l, req } of requests.sort((a, b) =>
        a.req.item_id.localeCompare(b.req.item_id),
      )) {
        const i = await getItem(req.item_id);
        if (!i.active) throw fail(`Insumo inativo: ${i.name}.`, 409);
        const line = await one(
          c,
          "INSERT INTO purchase_items(id,purchase_id,item_id,location_id,quantity,unit,unit_price_cents,total_price_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            id(),
            k,
            i.id,
            b.locationId,
            l.quantity,
            i.unit,
            l.unitPrice,
            l.total,
          ],
        );
        await audit("CREATE", "purchase_items", line.id, i.name, null, line);
        if (b.updateStock)
          await change(i, l.quantity, "UPDATE", "Entrada de compra");
        const n = await one(
          c,
          "UPDATE purchase_requests SET status='BOUGHT',claimed_by_user_id=$2 WHERE id=$1 RETURNING *",
          [req.id, u.id],
        );
        await audit("UPDATE", "purchase_requests", req.id, i.name, req, n);
      }
      await audit(
        "COMPLETE_PURCHASE",
        "purchases",
        k,
        "Compra finalizada",
        null,
        { ...purchase, lines: b.lines },
      );
    }
    if (t === "sale") {
      const results = await plan(c, b, true);
      const k = id();
      const n = await one(
        c,
        "INSERT INTO sales_deductions(id,channel,external_id,lines,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [k, b.channel, b.externalId, JSON.stringify(b.lines), u.id],
      );
      for (const l of results)
        await auto(
          await change(
            l.item,
            -l.quantity,
            "STOCK_DEDUCTION",
            `${b.channel} • ${b.externalId}`,
          ),
        );
      await audit("CREATE", "sales_deductions", k, b.externalId, null, n);
    }
    if (t === "recipe") {
      const k = b.id || id();
      const before = b.id
        ? await one(c, "SELECT * FROM recipes WHERE id=$1 FOR UPDATE", [k])
        : null;
      const old = before
        ? {
            ...before,
            items: (
              await q("SELECT * FROM recipe_items WHERE recipe_id=$1", [k])
            ).rows,
          }
        : null;
      const n = await one(
        c,
        "INSERT INTO recipes VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=$2,consumer_code=$3 RETURNING *",
        [k, b.name, b.code],
      );
      await q("DELETE FROM recipe_items WHERE recipe_id=$1", [k]);
      for (const i of b.items)
        await q("INSERT INTO recipe_items VALUES($1,$2,$3)", [
          k,
          i.itemId,
          i.quantity,
        ]);
      await audit(old ? "UPDATE" : "CREATE", "recipes", k, b.name, old, {
        ...n,
        items: b.items,
      });
    }
    if (t === "settings") {
      const old = await one(c, "SELECT * FROM operation_settings FOR UPDATE");
      const n = await one(
        c,
        "UPDATE operation_settings SET auto_min_requests=$1,allow_manual_in_sales=$2 RETURNING *",
        [b.autoMinRequests, b.allowManualInSales],
      );
      await audit(
        "UPDATE",
        "operation_settings",
        "global",
        "Regras da operação",
        old,
        n,
      );
    }
    if (t === "reviewRegistration") {
      const pending = await one(
        c,
        "SELECT * FROM registrations WHERE id=$1 FOR UPDATE",
        [b.id],
      );
      if (pending.status !== "PENDING")
        throw fail("Esta solicitação já foi revisada.", 409);
      const approve = b.decision === "approve";
      if (approve) {
        const created = await q(
          "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(email) DO NOTHING RETURNING id",
          [id(), pending.name, pending.email, pending.password_hash, b.role],
        );
        if (!created.rows.length)
          throw fail(
            "Já há uma conta com esse e-mail. Use a gestão de usuários ou recuse esta solicitação.",
            409,
          );
      }
      const next = await one(
        c,
        "UPDATE registrations SET status=$2,approved_role=$3,password_hash=NULL,reviewed_at=now(),reviewed_by=$4 WHERE id=$1 RETURNING id,status,approved_role,reviewed_at",
        [
          b.id,
          approve ? "APPROVED" : "REJECTED",
          approve ? b.role : null,
          u.id,
        ],
      );
      await audit(
        "UPDATE",
        "registrations",
        b.id,
        pending.name,
        { status: pending.status, email: pending.email },
        next,
      );
    }
    if (t === "user") {
      const k = b.id || id(),
        old = b.id
          ? await one(
              c,
              "SELECT id,name,email,role,active FROM users WHERE id=$1 FOR UPDATE",
              [k],
            )
          : null;
      if (k === u.id && (!b.active || b.role !== "ADM_MASTER"))
        throw fail("Você não pode remover o seu próprio acesso Master.");
      if (!b.id && !b.password) throw fail("Informe a senha inicial.");
      const n = await one(
        c,
        "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,email=$3,password_hash=COALESCE($7,users.password_hash),role=$5,active=$6 RETURNING id,name,email,role,active",
        [
          k,
          b.name,
          b.email.toLowerCase(),
          b.password ? hash(b.password) : "",
          b.role,
          b.active,
          b.password ? hash(b.password) : null,
        ],
      );
      if (b.password || !b.active)
        await q("DELETE FROM sessions WHERE user_id=$1", [k]);
      await audit(old ? "UPDATE" : "CREATE", "users", k, b.name, old, {
        ...n,
        password_changed: !!b.password,
      });
    }
    await q("SELECT pg_notify('changes','{}')");
  });
  s.json({ ok: true });
});
app.use("/api", (_r, _s, n) => n(fail("Rota inexistente.", 404)));
if (prod || process.env.SERVE_DIST === "1") {
  app.use(express.static(resolve("dist")));
  app.get(/.*/, (_r, s) => s.sendFile(resolve("dist/index.html")));
}
app.use((e, _r, s, _n) => {
  const msg =
    e instanceof z.ZodError
      ? e.issues.map((x) => x.message).join(" • ")
      : e.code === "23505"
        ? "Já existe um registro com esse identificador."
        : e.code === "23503"
          ? "Este registro está vinculado a outros dados."
          : e.status
            ? e.message
            : "Não foi possível concluir a operação.";
  if (!e.status && !e.code && !(e instanceof z.ZodError)) console.error(e);
  s.status(
    e.status ||
      (e instanceof z.ZodError ? 400 : e.code?.startsWith("23") ? 409 : 500),
  ).json({ error: msg });
});
app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log("API de Controle de Compras pronta"),
);
