CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('ADM_MASTER','ADM','OPERADOR','COMPRADOR')), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS items (id text PRIMARY KEY, name text NOT NULL, category text NOT NULL CHECK(category IN ('Embalagens','Proteínas','Hortifrúti','Mercearia','Bebidas','Molhos','Limpeza','Descartáveis')), unit text NOT NULL CHECK(unit IN ('un','kg','g','L','ml','cx','pct')), current_stock numeric(14,3) NOT NULL CHECK(current_stock>=0), min_stock numeric(14,3) NOT NULL CHECK(min_stock>=0), ideal_stock numeric(14,3) NOT NULL CHECK(ideal_stock>=min_stock), deduction_mode text NOT NULL CHECK(deduction_mode IN ('AUTO','MANUAL')), active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS recipes (id text PRIMARY KEY, name text NOT NULL, consumer_code text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS recipe_items (recipe_id text REFERENCES recipes(id) ON DELETE CASCADE, item_id text REFERENCES items(id), quantity numeric(14,3) NOT NULL CHECK(quantity>0), PRIMARY KEY(recipe_id,item_id));
CREATE TABLE IF NOT EXISTS sales_deductions (id text PRIMARY KEY, channel text NOT NULL CHECK(channel IN ('MenuDino','99Food','iFood')), external_id text NOT NULL, lines jsonb NOT NULL, user_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(channel,external_id));
CREATE TABLE IF NOT EXISTS purchase_requests (id text PRIMARY KEY, item_id text NOT NULL REFERENCES items(id), request_type text NOT NULL CHECK(request_type IN ('BUY_ITEM','LOW_STOCK_X','AUTO_MIN_STOCK')), reported_remaining_qty numeric(14,3) CHECK(reported_remaining_qty>=0), suggested_qty numeric(14,3) NOT NULL CHECK(suggested_qty>=0), priority text NOT NULL CHECK(priority IN ('NORMAL','URGENTE')), notes text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN ('PENDING','IN_CART','BOUGHT','CANCELED')), requested_by_user_id text REFERENCES users(id), claimed_by_user_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS locations (id text PRIMARY KEY, name text NOT NULL, type text NOT NULL CHECK(type IN ('Atacarejo','Supermercado','Distribuidora','Açougue','Embalagens','Hortifrúti')), neighborhood_city text NOT NULL, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS purchases (id text PRIMARY KEY, location_id text NOT NULL REFERENCES locations(id), buyer_user_id text NOT NULL REFERENCES users(id), subtotal_cents integer NOT NULL CHECK(subtotal_cents>=0), discount_cents integer NOT NULL CHECK(discount_cents>=0), extra_fee_cents integer NOT NULL CHECK(extra_fee_cents>=0), total_cents integer NOT NULL CHECK(total_cents=subtotal_cents-discount_cents+extra_fee_cents AND total_cents>=0), stock_updated boolean NOT NULL, status text NOT NULL CHECK(status IN ('DRAFT','COMPLETED')), completed_at timestamptz);
CREATE TABLE IF NOT EXISTS purchase_items (id text PRIMARY KEY, purchase_id text NOT NULL REFERENCES purchases(id), item_id text NOT NULL REFERENCES items(id), location_id text NOT NULL REFERENCES locations(id), quantity numeric(14,3) NOT NULL CHECK(quantity>0), unit text NOT NULL CHECK(unit IN ('un','kg','g','L','ml','cx','pct')), unit_price_cents integer NOT NULL CHECK(unit_price_cents>=0), total_price_cents integer NOT NULL CHECK(total_price_cents>=0), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs (id text PRIMARY KEY, user_id text REFERENCES users(id), user_name text NOT NULL, user_role text NOT NULL CHECK(user_role IN ('ADM_MASTER','ADM','OPERADOR','COMPRADOR')), action text NOT NULL CHECK(action IN ('CREATE','UPDATE','DELETE','REQUEST_PURCHASE','REPORT_STOCK_X','STOCK_DEDUCTION','COMPLETE_PURCHASE')), entity_type text NOT NULL, entity_id text NOT NULL, entity_name text NOT NULL, old_data jsonb, new_data jsonb, device_type text NOT NULL CHECK(device_type IN ('DESKTOP','MOBILE_WEB')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS operations (user_id text REFERENCES users(id), id text NOT NULL, PRIMARY KEY(user_id,id));
CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS request_status_idx ON purchase_requests(status,created_at);
CREATE INDEX IF NOT EXISTS price_history_idx ON purchase_items(item_id,location_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_date_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS items_category_idx ON items(category,active);
CREATE UNIQUE INDEX IF NOT EXISTS auto_request_open_idx ON purchase_requests(item_id) WHERE request_type='AUTO_MIN_STOCK' AND status IN ('PENDING','IN_CART');
CREATE OR REPLACE FUNCTION reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Auditoria imutável'; END; $$;
CREATE OR REPLACE TRIGGER immutable_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE TABLE IF NOT EXISTS operation_settings (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), auto_min_requests boolean NOT NULL DEFAULT true, allow_manual_in_sales boolean NOT NULL DEFAULT true);
INSERT INTO operation_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS registrations (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, password_hash text,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
  reviewed_by text REFERENCES users(id), approved_role text,
  CHECK ((status='PENDING') = (password_hash IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS registrations_pending_email_idx ON registrations(email) WHERE status='PENDING';
