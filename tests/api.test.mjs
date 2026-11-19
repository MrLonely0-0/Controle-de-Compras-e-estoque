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
