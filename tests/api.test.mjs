import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
let proc, base, master, admin, operator, buyer;
async function call(route, { cookie, body } = {}) {
  const r = await fetch(`${base}/${route}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const command = (cookie, type, data, operationId = randomUUID()) =>
  call(`commands/${type}`, { cookie, body: { operationId, data } });
const state = async (cookie) => (await call("state", { cookie })).body;
before(async () => {
  const url = process.env.TEST_DATABASE_URL || "";
  if (url) {
    process.env.DATABASE_URL = url;
    const { migrate, db } = await import("../server/db.mjs");
    const { seed } = await import("../server/seed.mjs");
    await migrate();
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM users")).rows[0].n,
      0,
      "TEST_DATABASE_URL deve apontar para um banco descartável vazio",
    );
    await seed("Nordeschina2026!");
    await db.end();
  }
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  base = `http://127.0.0.1:${port}/api`;
  proc = spawn(process.execPath, ["server/app.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: url,
      DEMO_DB: "memory://",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  proc.stderr.on("data", (x) => (logs += x));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Servidor não subiu: ${logs}`)),
      15000,
    );
    proc.stdout.on("data", (x) => {
      if (String(x).includes("pronta")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      reject(new Error(logs));
    });
  });
  [master, admin, operator, buyer] = await Promise.all(
    ["master", "admin", "operador", "comprador"].map(async (name) => {
      const r = await call("login", {
        body: {
          email: `${name}@nordeschina.demo`,
          password: "Nordeschina2026!",
        },
      });
      assert.equal(r.status, 200);
      return r.cookie;
    }),
  );
});
after(() => proc?.kill());
test("sessão, seed e controle de acesso no servidor", async () => {
  assert.equal((await call("state")).status, 401);
  const m = await state(master);
  assert.equal(m.users.length, 4);
  assert.equal(m.items.length, 20);
  assert.equal(m.locations.length, 5);
  assert.ok(m.history.length > 40);
  const o = await state(operator);
  assert.deepEqual(o.audit, []);
  assert.deepEqual(o.history, []);
  assert.equal(
    (
      await command(buyer, "deduct", {
        itemId: "i0",
        quantity: 1,
        notes: "Teste",
      })
    ).status,
    403,
  );
  assert.equal((await command(admin, "user", {})).status, 403);
});
test("contagem física, fila idempotente e evento SSE", async () => {
  const ac = new AbortController();
  const r = await fetch(`${base}/events`, {
    headers: { cookie: buyer },
    signal: ac.signal,
  });
  const reader = r.body.getReader();
  try {
    await reader.read();
    const operationId = randomUUID();
    const data = {
      itemId: "i5",
      remaining: 2.125,
      urgent: true,
      notes: "Conferência",
    };
    assert.equal(
      (await command(operator, "request", data, operationId)).status,
      200,
    );
    assert.match(
      Buffer.from((await reader.read()).value).toString(),
      /event: change/,
    );
    assert.equal(
      (await command(operator, "request", data, operationId)).status,
      200,
    );
    const s = await state(buyer);
    assert.equal(s.requests.filter((r) => r.item_id === "i5").length, 1);
    assert.equal(
      Number(s.items.find((i) => i.id === "i5").current_stock),
      2.125,
    );
    assert.equal(
      Number(s.requests.find((r) => r.item_id === "i5").suggested_qty),
      197.875,
    );
  } finally {
    ac.abort();
  }
});
test("reserva exclusiva, checkout em centavos e atualização atômica", async () => {
  const s = await state(buyer);
  const r = s.requests.find((r) => r.item_id === "i5");
  assert.equal(
    (await command(buyer, "claim", { id: r.id, claimed: true })).status,
    200,
  );
  assert.equal(
    (await command(admin, "claim", { id: r.id, claimed: true })).status,
    409,
  );
  const line = {
    requestId: r.id,
    quantity: 1.5,
    unitPrice: 667,
    total: 1000,
    priceBasis: "total",
  };
  const invalid = {
    locationId: "l0",
    lines: [line],
    discount: 1001,
    fee: 0,
    updateStock: true,
  };
  assert.equal((await command(buyer, "purchase", invalid)).status, 400);
  const body = { ...invalid, discount: 10, fee: 5 };
  const key = randomUUID();
  assert.equal((await command(buyer, "purchase", body, key)).status, 200);
  assert.equal((await command(buyer, "purchase", body, key)).status, 200);
  const v = await state(buyer);
  assert.equal(v.requests.find((x) => x.id === r.id).status, "BOUGHT");
  assert.equal(Number(v.items.find((i) => i.id === "i5").current_stock), 3.625);
  assert.equal(v.purchases[0].total_cents, 995);
  assert.equal(v.history[0].unit_price_cents, 667);
  assert.equal((await command(buyer, "purchase", body)).status, 409);
});
test("prévia Consumer, AUTO/MANUAL, duplicata e saldo insuficiente", async () => {
  const body = {
    channel: "iFood",
    externalId: "TESTE-001",
    lines: [{ code: "YAK-FRANGO", quantity: 2 }],
  };
  const preview = await call("preview-sale", { cookie: operator, body });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.length, 3);
  assert.equal(preview.body.find((x) => x.item.id === "i0").quantity, 0.36);
  assert.equal((await command(operator, "sale", body)).status, 200);
  assert.equal((await command(operator, "sale", body)).status, 409);
  assert.equal(
    (
      await command(operator, "deduct", {
        itemId: "i0",
        quantity: 100,
        notes: "Teste de saldo",
      })
    ).status,
    409,
  );
  const s = await state(master);
  assert.equal(Number(s.items.find((x) => x.id === "i0").current_stock), 3.14);
  assert.ok(s.audit.some((x) => x.action === "STOCK_DEDUCTION"));
});

test("configurações Master e segregação da auditoria", async () => {
  const data = { autoMinRequests: false, allowManualInSales: false };
  assert.equal((await command(admin, "settings", data)).status, 403);
  assert.equal((await command(master, "settings", data)).status, 200);
  assert.equal((await state(master)).settings.auto_min_requests, false);
  assert.ok(
    (await state(master)).audit.some(
      (x) => x.entity_type === "operation_settings",
    ),
  );
  assert.ok(
    !(await state(admin)).audit.some(
      (x) => x.entity_type === "operation_settings",
    ),
  );
  const r = await call("preview-sale", {
    cookie: operator,
    body: {
      channel: "MenuDino",
      externalId: "PREVIA-MANUAL",
      includeManual: true,
      lines: [{ code: "YAK-FRANGO", quantity: 1 }],
    },
  });
  assert.equal(r.status, 403);
});

test("cadastro exige aprovação Master e aplica as permissões do perfil escolhido", async () => {
  const email = "nova@nordeschina.demo",
    password = "SenhaExemplo123!";
  assert.equal(
    (
      await call("register", {
        body: { name: "Nova Operadora", email, password },
      })
    ).status,
    202,
  );
  assert.equal(
    (await call("login", { body: { email, password } })).status,
    401,
  );
  assert.deepEqual((await state(admin)).registrations, []);
  const registration = (await state(master)).registrations.find(
    (r) => r.email === email,
  );
  assert.equal(registration.status, "PENDING");
  assert.equal(registration.password_hash, undefined);
  const data = { id: registration.id, decision: "approve", role: "OPERADOR" };
  assert.equal((await command(admin, "reviewRegistration", data)).status, 403);
  assert.equal(
    (
      await command(master, "reviewRegistration", {
        ...data,
        role: "ADM_MASTER",
      })
    ).status,
    400,
  );
  assert.equal((await command(master, "reviewRegistration", data)).status, 200);
  const result = await call("login", { body: { email, password } });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, "OPERADOR");
  assert.equal(
    (await command(result.cookie, "reviewRegistration", data)).status,
    403,
  );
  assert.equal((await command(master, "reviewRegistration", data)).status, 409);
  const rejected = "recusada@nordeschina.demo";
  assert.equal(
    (
      await call("register", {
        body: { name: "Cadastro Recusado", email: rejected, password },
      })
    ).status,
    202,
  );
  const pending = (await state(master)).registrations.find(
    (r) => r.email === rejected,
  );
  assert.equal(
    (
      await command(master, "reviewRegistration", {
        id: pending.id,
        decision: "reject",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("login", { body: { email: rejected, password } })).status,
    401,
  );
});

test("exclusão de usuário revoga sessões e preserva auditoria", async () => {
  const email = `exclusao-${randomUUID()}@example.com`;
  assert.equal((await command(master, "user", { name: "Conta removível", email, password: "SenhaMuitoSegura123!", role: "OPERADOR", active: true })).status, 200);
  const target = (await state(master)).users.find((u) => u.email === email);
  assert.ok(target);
  const login = await call("login", { body: { email, password: "SenhaMuitoSegura123!" } });
  assert.equal(login.status, 200);
  assert.equal((await command(operator, "deleteUser", { id: target.id })).status, 403);
  assert.equal((await command(master, "deleteUser", { id: (await state(master)).user.id })).status, 400);
  assert.equal((await command(master, "deleteUser", { id: target.id })).status, 200);
  assert.equal((await call("state", { cookie: login.cookie })).status, 401);
  assert.equal((await call("login", { body: { email, password: "SenhaMuitoSegura123!" } })).status, 401);
  const updated = await state(master);
  assert.equal(updated.users.some((u) => u.id === target.id), false);
  assert.ok(updated.audit.some((a) => a.entity_id === target.id && a.action === "DELETE"));
  assert.equal((await command(master, "user", { id: target.id, name: "Reativação", email, role: "OPERADOR", active: true })).status, 404);
});

test("versão disponível do desktop é pública e ignora valores inválidos", async () => {
  const r = await call("desktop-version");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { version: null });
});

test("comparação de versões de desktop", async () => {
  const { newerVersion, shouldNotify } = await import("../desktop/update.cjs");
  assert.equal(newerVersion("1.10.0", "1.9.0"), true);
  assert.equal(newerVersion("2.0.0", "1.99.99"), true);
  assert.equal(newerVersion("1.0.0", "1.0.0"), false);
  assert.equal(newerVersion("0.9.0", "1.0.0"), false);
  assert.equal(newerVersion("1.0.1-beta", "1.0.0"), false);
  assert.equal(newerVersion("1.00.1", "1.0.0"), false);
  const previous = { version: "1.0.2", origin: "https://example.com", at: 1000 };
  assert.equal(shouldNotify("1.0.2", "1.0.2", previous.origin, null), false);
  assert.equal(shouldNotify("1.0.2", "1.0.1", previous.origin, previous, 2000), false);
  assert.equal(shouldNotify("1.0.3", "1.0.1", previous.origin, previous, 2000), true);
  assert.equal(shouldNotify("1.0.2", "1.0.1", previous.origin, previous, 86401000), true);
});

test("categorias personalizadas validam permissão e preservam itens vinculados", async () => {
  const name = `Categoria ${randomUUID()}`;
  assert.equal((await command(operator, "categoryCreate", { name })).status, 403);
  assert.equal((await command(admin, "categoryCreate", { name })).status, 200);
  assert.equal((await command(admin, "categoryCreate", { name: name.toLowerCase() })).status, 409);
  assert.ok((await state(master)).categories.includes(name));
  assert.equal((await command(admin, "item", { name: "Insumo especial", category: name, unit: "un", current: 5, min: 0, ideal: 1, mode: "MANUAL", active: true })).status, 200);
  assert.equal((await command(master, "categoryDelete", { name })).status, 409);
  const item = (await state(master)).items.find((i) => i.name === "Insumo especial");
  assert.ok(item);
  assert.equal((await command(operator, "deduct", { itemId: item.id, quantity: 2, notes: "Saída direta" })).status, 200);
  assert.equal(Number((await state(master)).items.find((i) => i.id === item.id).current_stock), 3);
  assert.equal((await command(master, "deleteItem", { id: item.id })).status, 200);
  assert.equal((await command(master, "categoryDelete", { name })).status, 200);
  assert.equal((await state(master)).categories.includes(name), false);
});

test("locais aceitam tipo personalizado e coordenadas, rejeitando coordenadas incompletas", async () => {
  const name = `Fornecedor ${randomUUID()}`;
  const location = { name, type: "Feira local", neighborhood: "Recife", address: "Rua Exemplo", latitude: -8.05, longitude: -34.9, notes: "" };
  assert.equal((await command(buyer, "location", { ...location, longitude: null })).status, 400);
  assert.equal((await command(buyer, "location", location)).status, 200);
  const found = (await state(master)).locations.find((l) => l.name === name);
  assert.equal(found.type, location.type);
  assert.equal(found.address, location.address);
  assert.equal(found.latitude, location.latitude);
  assert.equal(found.longitude, location.longitude);
  assert.equal((await command(admin, "location", { id: found.id, name, type: location.type, neighborhood: location.neighborhood, notes: "Editado sem apagar coordenadas" })).status, 200);
  const updated = (await state(master)).locations.find((l) => l.id === found.id);
  assert.equal(updated.latitude, location.latitude);
  assert.equal(updated.address, location.address);
});

test("Consumer permite identificador opcional sem perder idempotência de operação", async () => {
  const itemName = `Ingrediente ${randomUUID()}`;
  const code = `PDV-${randomUUID()}`;
  assert.equal((await command(master, "item", { name: itemName, category: "Mercearia", unit: "un", current: 5, min: 0, ideal: 1, mode: "AUTO", active: true })).status, 200);
  const item = (await state(master)).items.find((i) => i.name === itemName);
  assert.equal((await command(master, "recipe", { name: "Ficha teste", code, items: [{ itemId: item.id, quantity: 1 }] })).status, 200);
  const body = { channel: "Consumer", lines: [{ code, quantity: 1 }] };
  assert.equal((await call("preview-sale", { cookie: operator, body })).status, 200);
  const op = randomUUID();
  assert.equal((await command(operator, "sale", body, op)).status, 200);
  assert.equal((await command(operator, "sale", body, op)).status, 200);
  assert.equal(Number((await state(master)).items.find((i) => i.id === item.id).current_stock), 4);
});

test("painel de segurança é restrito ao Master e registra acessos sem senhas ou e-mails de falha", async () => {
  assert.equal((await call("security")).status, 401);
  assert.equal((await call("security", { cookie: admin })).status, 403);
  assert.equal((await call("login", { body: { email: "nao-existe@example.com", password: "senha-invalida" } })).status, 401);
  const response = await call("security", { cookie: master });
  assert.equal(response.status, 200);
  assert.ok(response.body.summary.failed_logins >= 1);
  assert.ok(response.body.events.some((e) => e.kind === "LOGIN_FAILURE"));
  assert.equal(JSON.stringify(response.body).includes("senha-invalida"), false);
  assert.equal(JSON.stringify(response.body).includes("nao-existe@example.com"), false);
});

test("compra parcial atualiza somente insumos confirmados", async () => {
  const make = async (name) => {
    assert.equal((await command(master, "item", { name, category: "Mercearia", unit: "un", current: 2, min: 0, ideal: 3, mode: "MANUAL", active: true })).status, 200);
    const item = (await state(master)).items.find((i) => i.name === name);
    assert.equal((await command(operator, "request", { itemId: item.id, urgent: false, notes: "Compra parcial" })).status, 200);
    const request = (await state(master)).requests.find((r) => r.item_id === item.id && r.status === "PENDING");
    return { item, request };
  };
  const first = await make(`Comprado ${randomUUID()}`), second = await make(`Pendente ${randomUUID()}`);
  const location = (await state(master)).locations[0];
  const purchase = { locationId: location.id, discount: 0, fee: 0, updateStock: true, lines: [{ requestId: first.request.id, quantity: 3, unitPrice: 100, total: 300, priceBasis: "unit" }] };
  assert.equal((await command(buyer, "purchase", purchase)).status, 200);
  const result = await state(master);
  assert.equal(Number(result.items.find((i) => i.id === first.item.id).current_stock), 5);
  assert.equal(Number(result.items.find((i) => i.id === second.item.id).current_stock), 2);
  assert.equal(result.requests.find((r) => r.id === first.request.id).status, "BOUGHT");
  assert.equal(result.requests.find((r) => r.id === second.request.id).status, "PENDING");
});

test("importação de estoque cria e soma por vínculo, é transacional e idempotente", async () => {
  const code = `COD-${randomUUID()}`;
  const name = `Item importado ${randomUUID()}`;
  const create = { itemId: null, name, pdvCode: code, quantity: 3, unit: "kg", category: "Mercearia" };
  assert.equal((await command(operator, "importStock", { rows: [create] })).status, 403);
  const operationId = randomUUID();
  assert.equal((await command(master, "importStock", { rows: [create] }, operationId)).status, 200);
  assert.equal((await command(master, "importStock", { rows: [create] }, operationId)).status, 200);
  let item = (await state(master)).items.find((i) => i.pdv_code === code);
  assert.ok(item);
  assert.equal(Number(item.current_stock), 3);
  const increment = { ...create, itemId: item.id, quantity: 2 };
  assert.equal((await command(admin, "importStock", { rows: [increment] })).status, 200);
  item = (await state(master)).items.find((i) => i.pdv_code === code);
  assert.equal(Number(item.current_stock), 5);
  assert.equal((await command(admin, "importStock", { rows: [increment, { ...increment, unit: "un", pdvCode: "" }] })).status, 400);
  assert.equal((await command(admin, "importStock", { rows: [{ ...increment, unit: "un" }] })).status, 409);
  assert.equal((await command(admin, "importStock", { rows: [{ ...create, name: "Código duplicado" }] })).status, 409);
  assert.equal(Number((await state(master)).items.find((i) => i.id === item.id).current_stock), 5);
});

test("lote com vários canais registra apenas uma baixa e bloqueia repetição em canal sobreposto", async () => {
  const itemName = `Ingrediente multicanal ${randomUUID()}`;
  const code = `MULTI-${randomUUID()}`;
  assert.equal((await command(master, "item", { name: itemName, category: "Mercearia", unit: "un", current: 8, min: 0, ideal: 1, mode: "AUTO", active: true })).status, 200);
  const item = (await state(master)).items.find((i) => i.name === itemName);
  assert.equal((await command(master, "recipe", { name: "Ficha múltiplos canais", code, items: [{ itemId: item.id, quantity: 1 }] })).status, 200);
  const externalId = `PEDIDO-${randomUUID()}`;
  const sale = { channel: "Consumer", channels: ["Consumer", "iFood"], externalId, lines: [{ code, quantity: 2 }] };
  assert.equal((await command(operator, "sale", sale)).status, 200);
  assert.equal(Number((await state(master)).items.find((i) => i.id === item.id).current_stock), 6);
  assert.equal((await command(operator, "sale", { ...sale, channel: "iFood", channels: ["iFood"] })).status, 409);
  assert.equal(Number((await state(master)).items.find((i) => i.id === item.id).current_stock), 6);
});

test("comprador pode solicitar insumo cadastrado, mas não alterar saldo por contagem", async () => {
  const name = `Item do comprador ${randomUUID()}`;
  assert.equal((await command(master, "item", { name, category: "Mercearia", unit: "un", current: 5, min: 0, ideal: 10, mode: "MANUAL", active: true })).status, 200);
  const item = (await state(master)).items.find((i) => i.name === name);
  assert.equal((await command(buyer, "request", { itemId: item.id, urgent: false, notes: "Compra" })).status, 200);
  assert.equal((await command(buyer, "request", { itemId: item.id, remaining: 1, urgent: false, notes: "Não permitido" })).status, 403);
  assert.equal(Number((await state(master)).items.find((i) => i.id === item.id).current_stock), 5);
});
