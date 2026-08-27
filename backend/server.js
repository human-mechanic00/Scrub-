const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, transaction } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PROJECT_ROOT = path.join(__dirname, '..');
const ROOT = path.resolve(PROJECT_ROOT, 'www');
const UPLOADS = process.env.VERCEL
  ? path.join('/tmp', 'uploads')
  : path.join(ROOT, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('WARNING: JWT_SECRET is missing/short. Set a random secret of at least 32 characters in production.');
}

fs.mkdirSync(UPLOADS, { recursive: true });

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: false
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype || ''))
});

function normalizeCategory(value) {
  const v = String(value || '').trim();
  const map = {
    'الصيدلة': 'pharmacy', 'صيدلة': 'pharmacy',
    'العلاج الطبيعي': 'physiotherapy', 'علاج طبيعي': 'physiotherapy',
    'الأسنان': 'dentistry', 'أسنان': 'dentistry',
    'البلاطي': 'lab-coats', 'بلاطي': 'lab-coats',
    'الاسكرابات الطبية': 'scrubs', 'اسكرابات طبية': 'scrubs'
  };
  return map[v] || v;
}

function publicProduct(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    category: row.category_name,
    category_key: row.category_key,
    image: row.image_url || '',
    description: row.description || '',
    stock: row.stock,
    featured: !!row.featured,
    badge: row.badge || '',
    options: row.options || [],
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const productSelect = `
  SELECT p.*, c.key AS category_key, c.name_ar AS category_name
  FROM products p
  JOIN categories c ON c.id = p.category_id
`;

async function findProduct(id) {
  const result = await query(`${productSelect} WHERE p.id = $1`, [id]);
  return result.rows[0] || null;
}

function requireAdmin(req, res, next) {
  const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '') || req.get('X-Admin-Token');
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const payload = jwt.verify(token, JWT_SECRET || 'development-only-secret');
    if (payload.role !== 'admin') throw new Error('role');
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة الإدارة منتهية أو غير صالحة' });
  }
}

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const productSchema = z.object({
  name: z.string().trim().min(1).max(180),
  price: z.coerce.number().min(0).max(99999999),
  category: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional().default(''),
  stock: z.coerce.number().int().min(0).max(1000000).optional().default(0),
  featured: z.preprocess(v => v === true || v === 'true' || v === '1' || v === 1, z.boolean()).optional().default(false),
  badge: z.string().trim().max(80).optional().default(''),
  options: z.string().optional().default('[]')
});
const orderSchema = z.object({
  customer_name: z.string().trim().min(2).max(160),
  customer_phone: z.string().trim().min(5).max(40),
  customer_address: z.string().trim().min(3).max(1000),
  governorate: z.string().trim().min(2).max(80),
  area: z.string().trim().min(2).max(120),
  payment_method: z.enum(['cod','card']).default('cod'),
  coupon_code: z.string().trim().max(80).optional().default(''),
  items: z.array(z.object({ product_id: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive().max(99), options: z.record(z.string(), z.string()).optional().default({}) })).min(1).max(100)
});

app.get('/api/health', async (_, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'postgresql' });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body || {});
    const adminEmail = process.env.ADMIN_EMAIL || '';
    const hash = process.env.ADMIN_PASSWORD_HASH || '';
    if (!adminEmail || !hash || email.toLowerCase() !== adminEmail.toLowerCase()) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    const valid = await bcrypt.compare(password, hash);
    if (!valid) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    const token = jwt.sign({ role: 'admin', email: adminEmail }, JWT_SECRET || 'development-only-secret', { expiresIn: '8h' });
    res.json({ token, expiresIn: 8 * 60 * 60 });
  } catch {
    res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
  }
});

app.post('/api/admin/logout', requireAdmin, (_, res) => res.json({ ok: true }));

app.get('/api/categories', async (_, res, next) => {
  try {
    const result = await query('SELECT key, name_ar AS name, sort_order FROM categories WHERE is_active = TRUE ORDER BY sort_order, id');
    res.json({ categories: result.rows });
  } catch (e) { next(e); }
});

app.get('/api/products', async (req, res, next) => {
  try {
    const params = [];
    const conditions = ['p.is_active = TRUE'];
    if (req.query.category) { params.push(normalizeCategory(req.query.category)); conditions.push(`c.key = $${params.length}`); }
    let orderBy = 'p.created_at DESC, p.id DESC';
    if (req.query.sort === 'best') orderBy = '(SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.product_id=p.id) DESC, p.created_at DESC';
    if (req.query.sort === 'new') orderBy = 'p.created_at DESC, p.id DESC';
    if (req.query.featured === 'true') conditions.push('p.featured = TRUE');
    const result = await query(`${productSelect} WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`, params);
    res.json({ products: result.rows.map(publicProduct) });
  } catch (e) { next(e); }
});

app.get('/api/products/:id', async (req, res, next) => {
  try {
    const product = await findProduct(req.params.id);
    if (!product || !product.is_active) return res.status(404).json({ error: 'المنتج غير موجود' });
    res.json({ product: publicProduct(product) });
  } catch (e) { next(e); }
});

app.post('/api/products', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    const categoryKey = normalizeCategory(data.category);
    const category = await query('SELECT id FROM categories WHERE key = $1 AND is_active = TRUE', [categoryKey]);
    if (!category.rowCount) return res.status(400).json({ error: 'التصنيف غير صالح' });
    let options=[]; try { options = JSON.parse(data.options || '[]'); if (!Array.isArray(options)) options=[]; } catch {}
    const image = req.file ? `/uploads/${req.file.filename}` : '';
    const result = await query(`INSERT INTO products(name, price, category_id, image_url, description, stock, featured, badge, options) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [data.name, data.price, category.rows[0].id, image, data.description, data.stock, data.featured, data.badge, JSON.stringify(options)]);
    const product = await findProduct(result.rows[0].id);
    res.status(201).json({ product: publicProduct(product) });
  } catch (e) { next(e); }
});

app.put('/api/products/:id', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    const current = await findProduct(req.params.id);
    if (!current) return res.status(404).json({ error: 'المنتج غير موجود' });
    const data = productSchema.parse({
      name: req.body.name ?? current.name,
      price: req.body.price ?? current.price,
      category: req.body.category ?? current.category_name,
      description: req.body.description ?? current.description,
      stock: req.body.stock ?? current.stock,
      featured: req.body.featured ?? current.featured,
      badge: req.body.badge ?? current.badge,
      options: req.body.options ?? JSON.stringify(current.options || [])
    });
    const categoryKey = normalizeCategory(data.category);
    const category = await query('SELECT id FROM categories WHERE key = $1 AND is_active = TRUE', [categoryKey]);
    if (!category.rowCount) return res.status(400).json({ error: 'التصنيف غير صالح' });
    let options=[]; try { options = JSON.parse(data.options || '[]'); if (!Array.isArray(options)) options=[]; } catch {}
    const image = req.file ? `/uploads/${req.file.filename}` : (req.body.image || current.image_url || '');
    await query(`UPDATE products SET name=$1, price=$2, category_id=$3, image_url=$4, description=$5, stock=$6, featured=$7, badge=$8, options=$9 WHERE id=$10`, [data.name, data.price, category.rows[0].id, image, data.description, data.stock, data.featured, data.badge, JSON.stringify(options), req.params.id]);
    const product = await findProduct(req.params.id);
    res.json({ product: publicProduct(product) });
  } catch (e) { next(e); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res, next) => {
  try {
    const product = await findProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
    await query('DELETE FROM products WHERE id=$1', [req.params.id]);
    if (product.image_url?.startsWith('/uploads/')) {
      const file = path.join(ROOT, product.image_url.replace(/^\/+/,'').replaceAll('/', path.sep));
      if (file.startsWith(UPLOADS) && fs.existsSync(file)) fs.unlink(file, () => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/shipping/rates', async (_, res, next) => {
  try {
    const result = await query('SELECT governorate, fee FROM shipping_rates WHERE is_active = TRUE ORDER BY governorate');
    res.json({ rates: result.rows.map(r => ({ governorate: r.governorate, fee: Number(r.fee) })) });
  } catch (e) { next(e); }
});

app.post('/api/coupons/validate', async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const subtotal = Number(req.body?.subtotal || 0);
    if (!code || !Number.isFinite(subtotal) || subtotal < 0) return res.status(400).json({ error: 'بيانات الكوبون غير صالحة' });
    const result = await query(`SELECT * FROM coupons WHERE UPPER(code)=UPPER($1) AND is_active=TRUE AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR used_count < max_uses)`, [code]);
    if (!result.rowCount) return res.status(404).json({ error: 'كود الخصم غير صالح أو منتهي' });
    const c = result.rows[0];
    if (subtotal < Number(c.min_order)) return res.status(400).json({ error: `الحد الأدنى لاستخدام الكود ${Number(c.min_order)} جنيه` });
    const discount = c.discount_type === 'percent' ? Math.min(subtotal, subtotal * Number(c.discount_value) / 100) : Math.min(subtotal, Number(c.discount_value));
    res.json({ valid: true, code: c.code, discount: Number(discount), label: c.discount_type === 'percent' ? `${c.discount_value}% خصم` : `${c.discount_value} جنيه خصم` });
  } catch (e) { next(e); }
});

app.get('/api/admin/shipping', requireAdmin, async (_, res, next) => {
  try { const r = await query('SELECT * FROM shipping_rates ORDER BY governorate'); res.json({ rates: r.rows }); } catch(e){ next(e); }
});
app.put('/api/admin/shipping/:governorate', requireAdmin, async (req,res,next)=>{
  try { const fee = z.coerce.number().min(0).max(100000).parse(req.body?.fee); const r=await query(`INSERT INTO shipping_rates(governorate,fee) VALUES($1,$2) ON CONFLICT(governorate) DO UPDATE SET fee=EXCLUDED.fee,updated_at=NOW() RETURNING *`,[req.params.governorate,fee]); res.json({rate:r.rows[0]}); } catch(e){next(e);}
});
app.get('/api/admin/coupons', requireAdmin, async (_,res,next)=>{ try{const r=await query('SELECT * FROM coupons ORDER BY created_at DESC');res.json({coupons:r.rows});}catch(e){next(e);} });
app.post('/api/admin/coupons', requireAdmin, async(req,res,next)=>{ try{const data=z.object({code:z.string().trim().min(2).max(80),discount_type:z.enum(['percent','fixed']),discount_value:z.coerce.number().positive(),min_order:z.coerce.number().min(0).default(0),max_uses:z.coerce.number().int().positive().nullable().optional(),expires_at:z.string().datetime().nullable().optional()}).parse(req.body); const r=await query(`INSERT INTO coupons(code,discount_type,discount_value,min_order,max_uses,expires_at) VALUES(UPPER($1),$2,$3,$4,$5,$6) RETURNING *`,[data.code,data.discount_type,data.discount_value,data.min_order,data.max_uses||null,data.expires_at||null]);res.status(201).json({coupon:r.rows[0]});}catch(e){next(e);} });
app.patch('/api/admin/coupons/:id', requireAdmin, async(req,res,next)=>{try{const active=z.coerce.boolean().parse(req.body?.is_active);const r=await query('UPDATE coupons SET is_active=$1 WHERE id=$2 RETURNING *',[active,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'الكوبون غير موجود'});res.json({coupon:r.rows[0]});}catch(e){next(e);}});

app.post('/api/orders', orderLimiter, async (req, res, next) => {
  try {
    const data = orderSchema.parse(req.body || {});
    const order = await transaction(async (client) => {
      const ids = [...new Set(data.items.map(i => i.product_id))];
      const products = await client.query(`${productSelect} WHERE p.id = ANY($1::bigint[]) AND p.is_active = TRUE FOR UPDATE`, [ids]);
      if (products.rowCount !== ids.length) throw Object.assign(new Error('أحد المنتجات غير متاح'), { statusCode: 400 });
      const byId = new Map(products.rows.map(p => [String(p.id), p]));
      const normalizedItems = data.items.map(item => {
        const p = byId.get(String(item.product_id));
        if (Number(p.stock) < item.quantity) throw Object.assign(new Error(`الكمية المتاحة من ${p.name} هي ${p.stock}`), { statusCode: 400 });
        return { product_id: p.id, product_name: p.name, product_price: Number(p.price), quantity: item.quantity, options: item.options || {} };
      });
      const subtotal = normalizedItems.reduce((sum, item) => sum + item.product_price * item.quantity, 0);
      const shippingResult = await client.query('SELECT fee FROM shipping_rates WHERE governorate=$1 AND is_active=TRUE', [data.governorate]);
      const shipping = shippingResult.rowCount ? Number(shippingResult.rows[0].fee) : 90;
      let discount = 0; let couponCode = '';
      if (data.coupon_code) {
        const couponResult = await client.query(`SELECT * FROM coupons WHERE UPPER(code)=UPPER($1) AND is_active=TRUE AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR used_count < max_uses) FOR UPDATE`, [data.coupon_code]);
        if (!couponResult.rowCount) throw Object.assign(new Error('كود الخصم غير صالح أو منتهي'), { statusCode: 400 });
        const c = couponResult.rows[0];
        if (subtotal < Number(c.min_order)) throw Object.assign(new Error(`الحد الأدنى لاستخدام الكود ${Number(c.min_order)} جنيه`), { statusCode: 400 });
        discount = c.discount_type === 'percent' ? Math.min(subtotal, subtotal * Number(c.discount_value) / 100) : Math.min(subtotal, Number(c.discount_value));
        couponCode = c.code;
        await client.query('UPDATE coupons SET used_count=used_count+1 WHERE id=$1', [c.id]);
      }
      const total = Math.max(0, subtotal + shipping - discount);
      const orderResult = await client.query(`INSERT INTO orders(customer_name,customer_phone,customer_address,governorate,area,subtotal,shipping_fee,discount_amount,coupon_code,total_price,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING *`, [data.customer_name,data.customer_phone,data.customer_address,data.governorate,data.area,subtotal,shipping,discount,couponCode,total,data.payment_method]);
      const orderId = orderResult.rows[0].id;
      for (const item of normalizedItems) {
        await client.query(`INSERT INTO order_items(order_id,product_id,product_name,product_price,quantity) VALUES($1,$2,$3,$4,$5)`, [orderId,item.product_id,item.product_name,item.product_price,item.quantity]);
        await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2', [item.quantity,item.product_id]);
      }
      return { ...orderResult.rows[0], items: normalizedItems };
    });
    res.status(201).json({ order });
  } catch (e) { next(e); }
});

app.get('/api/orders', requireAdmin, async (_, res, next) => {
  try {
    const orders = await query('SELECT * FROM orders ORDER BY created_at DESC, id DESC');
    const items = await query('SELECT * FROM order_items ORDER BY order_id DESC, id');
    const map = new Map();
    for (const item of items.rows) {
      if (!map.has(String(item.order_id))) map.set(String(item.order_id), []);
      map.get(String(item.order_id)).push(item);
    }
    res.json({ orders: orders.rows.map(o => ({ ...o, total_price: Number(o.total_price), items: map.get(String(o.id)) || [] })) });
  } catch (e) { next(e); }
});

app.patch('/api/orders/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const status = z.enum(['pending','confirmed','processing','shipped','completed','cancelled']).parse(req.body?.status);
    const order = await transaction(async client => {
      const current = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!current.rowCount) throw Object.assign(new Error('الطلب غير موجود'),{statusCode:404});
      const old=current.rows[0];
      if(old.status!=='cancelled' && status==='cancelled'){
        const items=await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1 AND product_id IS NOT NULL',[req.params.id]);
        for(const item of items.rows) await client.query('UPDATE products SET stock=stock+$1 WHERE id=$2',[item.quantity,item.product_id]);
        if(old.coupon_code) await client.query('UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE code=$1',[old.coupon_code]);
      }
      if(old.status==='cancelled' && status!=='cancelled'){
        const items=await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1 AND product_id IS NOT NULL',[req.params.id]);
        for(const item of items.rows){const r=await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock >= $1 RETURNING id',[item.quantity,item.product_id]);if(!r.rowCount)throw Object.assign(new Error('المخزون الحالي لا يكفي لإعادة تفعيل الطلب'),{statusCode:400});}
        if(old.coupon_code) await client.query('UPDATE coupons SET used_count=used_count+1 WHERE code=$1',[old.coupon_code]);
      }
      const r=await client.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *',[status,req.params.id]);return r.rows[0];
    });
    res.json({order});
  } catch(e){next(e);}
});

app.get('/api/admin/stats', requireAdmin, async (_, res, next) => {
  try {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = TRUE)::int AS "productsCount",
        (SELECT COUNT(*) FROM orders)::int AS "ordersCount",
        (SELECT COUNT(DISTINCT customer_phone) FROM orders)::int AS "customersCount",
        (SELECT COALESCE(SUM(total_price),0) FROM orders WHERE status <> 'cancelled')::numeric AS "salesTotal"
    `);
    const row = result.rows[0];
    res.json({ productsCount: row.productsCount, ordersCount: row.ordersCount, customersCount: row.customersCount, salesTotal: Number(row.salesTotal) });
  } catch (e) { next(e); }
});

app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(ROOT, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.statusCode || (err.name === 'ZodError' ? 400 : 500);
  if (res.headersSent) return next(err);
  res.status(status).json({ error: status === 500 ? 'حدث خطأ في الخادم' : (err.issues?.[0]?.message || err.message || 'بيانات غير صالحة') });
});

async function start() {
  try {
    await query('SELECT 1');
    await query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const migrationDir = path.join(__dirname, 'migrations');
    const migrations = fs.readdirSync(migrationDir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
    const lock = await query('SELECT pg_try_advisory_lock(987654321) AS locked');
    if (lock.rows[0].locked) {
      for (const file of migrations) {
        const version = Number(file.match(/^(\d+)_/)[1]);
        const done = await query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
        if (!done.rowCount) {
          const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
          await transaction(async (client) => { await client.query(sql); await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]); });
          console.log(`Applied database migration ${version}.`);
        }
      }
      await query('SELECT pg_advisory_unlock(987654321)');
    }
    if (!process.env.VERCEL) {
      app.listen(PORT, () => console.log(`Human Mechanic running on port ${PORT}`));
    }
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

if (!process.env.VERCEL) {
  start();
}

module.exports = app;
