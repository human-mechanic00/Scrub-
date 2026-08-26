# Human Mechanic Store — PostgreSQL Edition

نسخة Full-Stack لمتجر Human Mechanic بدون اعتماد على Supabase أو Firebase.

## المزايا
- Node.js + Express + PostgreSQL
- سلة مشتريات محفوظة محليًا
- Checkout كامل داخل الموقع
- الدفع عند الاستلام جاهز
- مكان مخصص للدفع بالكارت لاحقًا
- شحن حسب المحافظة وقابل للتعديل من لوحة التحكم
- أكواد خصم قابلة للإنشاء والتفعيل والإيقاف
- مخزون يتحقق منه الـBackend ويُخصم داخل transaction
- إرجاع المخزون عند إلغاء الطلب
- منتجات مميزة، وصل حديثًا، والأكثر مبيعًا
- حالات للطلبات من جديد حتى مكتمل/ملغي
- حماية Admin بـJWT/Bcrypt وRate limiting وHelmet
- PostgreSQL migrations وindexes
- حل اختلافات أسماء التصنيفات العربية

## التشغيل
1. أنشئ PostgreSQL database.
2. انسخ `backend/.env.example` إلى `backend/.env` واضبط `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`.
3. شغّل `npm install` ثم `npm start`.
4. الـBackend سيطبق migrations تلقائيًا.
5. افتح الموقع من نفس السيرفر.

> بيانات المنتجات والطلبات الموجودة في Supabase القديمة لا يتم نقلها تلقائيًا. هذه النسخة تبدأ بقاعدة PostgreSQL جديدة.
