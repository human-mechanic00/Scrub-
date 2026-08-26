ALTER TABLE products ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS governorate VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS area VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod','card'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0);

CREATE TABLE IF NOT EXISTS shipping_rates (
    id BIGSERIAL PRIMARY KEY,
    governorate VARCHAR(80) NOT NULL UNIQUE,
    fee NUMERIC(12,2) NOT NULL CHECK (fee >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(80) NOT NULL UNIQUE,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent','fixed')),
    discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value >= 0),
    min_order NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_code_active ON coupons(code, is_active);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_active ON shipping_rates(is_active, governorate);

DROP TRIGGER IF EXISTS coupons_updated_at ON coupons;
CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO shipping_rates(governorate, fee) VALUES
('الشرقية',70),('الدقهلية',70),('الإسماعيلية',70),('بورسعيد',70),('القاهرة',70),('القليوبية',70),('دمياط',70),('الغربية',70),('كفر الشيخ',70),
('الإسكندرية',90),('البحيرة',90),('المنوفية',90),('السويس',90),('شمال سيناء',90),('جنوب سيناء',90),('البحر الأحمر',90),
('الفيوم',120),('بني سويف',120),('المنيا',120),('أسيوط',120),('سوهاج',120),('قنا',120),('الأقصر',120),('أسوان',120)
ON CONFLICT (governorate) DO NOTHING;

UPDATE products SET stock=10 WHERE stock=0;
