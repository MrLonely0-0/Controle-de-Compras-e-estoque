import { db, tx, migrate, hash } from "./db.mjs";
export const catalog = [
  ["Filé de frango", "Proteínas", "kg", 3.5, 8, 20, "AUTO", 1690],
  ["Embalagem box 500 ml", "Embalagens", "un", 18, 50, 150, "AUTO", 89],
  ["Molho shoyu", "Molhos", "L", 2, 5, 12, "MANUAL", 1190],
  ["Macarrão yakisoba", "Mercearia", "kg", 14, 8, 25, "AUTO", 790],
  ["Refrigerante cola 350 ml", "Bebidas", "un", 48, 24, 72, "AUTO", 279],
  ["Sacola kraft delivery", "Descartáveis", "un", 85, 40, 200, "MANUAL", 45],
  ["Alcatra bovina", "Proteínas", "kg", 0, 5, 15, "AUTO", 3590],
  ["Brócolis", "Hortifrúti", "kg", 4, 2, 8, "AUTO", 790],
  ["Cenoura", "Hortifrúti", "kg", 6, 3, 12, "AUTO", 399],
  ["Repolho", "Hortifrúti", "kg", 5, 3, 10, "AUTO", 299],
  ["Óleo de soja", "Mercearia", "L", 4, 6, 18, "MANUAL", 659],
  ["Arroz branco", "Mercearia", "kg", 22, 10, 30, "AUTO", 529],
  ["Marmitex alumínio", "Embalagens", "un", 120, 40, 200, "AUTO", 75],
  ["Guardanapo", "Descartáveis", "pct", 16, 5, 20, "MANUAL", 329],
  ["Detergente neutro", "Limpeza", "L", 8, 3, 12, "MANUAL", 549],
  ["Água sanitária", "Limpeza", "L", 7, 3, 12, "MANUAL", 419],
  ["Molho agridoce", "Molhos", "L", 6, 2, 10, "AUTO", 1390],
  ["Água mineral 500 ml", "Bebidas", "un", 36, 15, 60, "AUTO", 115],
  ["Cebola roxa", "Hortifrúti", "kg", 7, 3, 12, "AUTO", 599],
  ["Farinha de trigo", "Mercearia", "kg", 10, 4, 18, "MANUAL", 499],
];
export async function seed(password) {
  await tx(async (c) => {
    const q = (s, p = []) => c.query(s, p);
    if ((await q("SELECT 1 FROM users LIMIT 1")).rows.length) return;
    const roles = [
      ["master", "Camila Andrade", "ADM_MASTER"],
      ["admin", "Mariana Costa", "ADM"],
      ["operador", "Rafael Lima", "OPERADOR"],
      ["comprador", "João Santos", "COMPRADOR"],
    ];
    for (const [id, name, role] of roles)
      await q(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, name, `${id}@nordeschina.demo`, hash(password), role],
      );
    const places = [
      ["Atacadão", "Atacarejo", "Imbiribeira, Recife"],
      ["Assaí Atacadista", "Atacarejo", "Boa Viagem, Recife"],
      ["Distribuidora de Embalagens", "Embalagens", "São José, Recife"],
      ["Açougue Central", "Açougue", "Casa Amarela, Recife"],
      ["Ceasa Recife", "Hortifrúti", "Curado, Recife"],
    ];
    for (const [i, p] of places.entries())
      await q(
        "INSERT INTO locations(id,name,type,neighborhood_city) VALUES($1,$2,$3,$4)",
        [`l${i}`, ...p],
      );
    for (const [i, a] of catalog.entries())
      await q(
        "INSERT INTO items(id,name,category,unit,current_stock,min_stock,ideal_stock,deduction_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [`i${i}`, ...a.slice(0, 7)],
      );
    for (const [i, index] of [0, 1, 2, 6, 10, 8, 13, 18].entries()) {
      const a = catalog[index];
      await q(
        `INSERT INTO purchase_requests(id,item_id,request_type,reported_remaining_qty,suggested_qty,priority,notes,status,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING','operador')`,
        [
          `r${i}`,
          `i${index}`,
          i < 3 ? "LOW_STOCK_X" : "BUY_ITEM",
          i < 3 ? a[3] : null,
          Number(a[5]) - Number(a[3]),
          i < 3 ? "URGENTE" : "NORMAL",
          i === 0 ? "Precisamos para o turno da noite." : "",
        ],
      );
    }
    for (let l = 0; l < 5; l++) {
      for (let d = 0; d < 2; d++) {
        const id = `p${l}-${d}`,
          loc = `l${l}`,
          date = new Date(
            Date.now() - (d * 13 + l + 1) * 86400000,
          ).toISOString();
        const rows = catalog.flatMap((a, i) =>
          l < 2 ||
          (l === 2 && a[1] === "Embalagens") ||
          (l === 3 && a[1] === "Proteínas") ||
          (l === 4 && a[1] === "Hortifrúti")
            ? [
                [
                  i,
                  a[2],
                  Math.max(
                    1,
                    Number(a[7]) +
                      (((i + l * 3 + d) % 7) - 3) *
                        Math.round(Number(a[7]) * 0.025),
                  ),
                ],
              ]
            : [],
        );
        const sum = rows.reduce((s, a) => s + Number(a[2]) * 3, 0);
        await q(
          `INSERT INTO purchases VALUES($1,$2,'comprador',$3,0,0,$3,true,'COMPLETED',$4)`,
          [id, loc, sum, date],
        );
        for (const [i, u, p] of rows)
          await q(
            "INSERT INTO purchase_items VALUES($1,$2,$3,$4,3,$5,$6,$7,$8)",
            [`${id}-${i}`, id, `i${i}`, loc, u, p, Number(p) * 3, date],
          );
      }
    }
    await q(
      "INSERT INTO recipes VALUES ('rec1','Yakisoba de frango','YAK-FRANGO')",
    );
    await q(
      "INSERT INTO recipe_items VALUES ('rec1','i0',0.18),('rec1','i3',0.25),('rec1','i1',1),('rec1','i2',0.03)",
    );
    await q(
      "INSERT INTO audit_logs(id,user_id,user_name,user_role,action,entity_type,entity_id,entity_name,new_data,device_type) VALUES('seed','admin','Mariana Costa','ADM','CREATE','recipes','rec1','Yakisoba de frango','{}','DESKTOP')",
    );
  });
}
if (process.argv[1]?.endsWith("/seed.mjs")) {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12)
    throw new Error("Defina SEED_PASSWORD com pelo menos 12 caracteres.");
  await migrate();
  await seed(password);
  await db.end?.();
  await db.close?.();
}
