import { randomUUID } from "node:crypto";
import { z } from "zod";
if (!process.env.DATABASE_URL)
  throw new Error("Defina DATABASE_URL para inicializar a operação.");
const input = z
  .object({
    name: z.string().trim().min(1).max(150),
    email: z.email(),
    password: z.string().min(12).max(128),
  })
  .parse({
    name: process.env.MASTER_NAME,
    email: process.env.MASTER_EMAIL,
    password: process.env.MASTER_PASSWORD,
  });
const { db, tx, migrate, hash } = await import("./db.mjs");
try {
  await migrate();
  await tx(async (c) => {
    await c.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    if ((await c.query("SELECT 1 FROM users LIMIT 1")).rows.length)
      throw new Error("Já existem contas no banco. Use a gestão de usuários.");
    const userId = randomUUID(),
      email = input.email.toLowerCase();
    await c.query(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'ADM_MASTER')",
      [userId, input.name, email, hash(input.password)],
    );
    await c.query(
      "INSERT INTO audit_logs(id,user_id,user_name,user_role,action,entity_type,entity_id,entity_name,new_data,device_type) VALUES($1,$2,$3,'ADM_MASTER','CREATE','users',$2,$3,$4,'DESKTOP')",
      [
        randomUUID(),
        userId,
        input.name,
        JSON.stringify({ email, role: "ADM_MASTER", active: true }),
      ],
    );
  });
  console.log("Conta ADM Master criada.");
} finally {
  await db.end();
}
