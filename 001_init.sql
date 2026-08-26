CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id SMALLSERIAL PRIMARY KEY,
    key VARCHAR(80) NOT NULL UNIQUE,
    name_ar VARCHAR(120) NOT NULL UNIQUE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    category_id SMALLINT NOT NULL REFERENCES categories(id) ON UPDATE CASCADE,
    image_url TEXT,
    description TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    customer_name VARCHAR(160) NOT NULL,
    customer_phone VARCHAR(40) NOT NULL,
    customer_address TEXT NOT NULL,
    total_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','processing','shipped','completed','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(180) NOT NULL,
    product_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (product_price >= 0),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    line_total NUMERIC(12,2) GENERATED ALWAYS AS (product_price * quantity) STORED
);

CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO categories (key, name_ar, sort_order) VALUES
('scrubs', 'اسكرابات طبية', 1),
('lab-coats', 'بلاطي', 2),
('physiotherapy', 'علاج طبيعي', 3),
('dentistry', 'أسنان', 4),
('pharmacy', 'صيدلة', 5)
ON CONFLICT (key) DO UPDATE SET name_ar = EXCLUDED.name_ar, sort_order = EXCLUDED.sort_order;
