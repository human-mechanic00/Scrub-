const fs = require('fs');
const path = require('path');
const { query, close } = require('../db');

async function main() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    const exists = await query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (exists.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }
  console.log('Database is ready.');
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => close());
