/**
 * Aplica todas as migrations SQL em supabase/migrations/ na ordem do nome.
 * Requer DATABASE_URL no .env ou variável de ambiente.
 *
 * Uso: node scripts/apply-migrations.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* .env opcional se DATABASE_URL já estiver no ambiente */
  }
}

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL não definida.\n" +
      "   Supabase Dashboard → Settings → Database → Connection string (URI)\n" +
      "   Adicione em gymsystem_backend/.env:\n" +
      "   DATABASE_URL=postgresql://postgres.[ref]:[SENHA]@...pooler.supabase.com:6543/postgres",
  );
  process.exit(1);
}

const migrationsDir = join(root, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureTrackingTable() {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function isApplied(version) {
  const { rows } = await client.query(
    "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1",
    [version],
  );
  return rows.length > 0;
}

async function markApplied(version) {
  await client.query(
    "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
    [version],
  );
}

async function main() {
  console.log(`Conectando ao banco… (${files.length} migration(s) encontrada(s))`);
  await client.connect();
  await ensureTrackingTable();

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (await isApplied(version)) {
      console.log(`⏭  ${file} (já aplicada)`);
      skipped++;
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`▶  Aplicando ${file}…`);

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await markApplied(version);
      await client.query("COMMIT");
      console.log(`✅ ${file}`);
      applied++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`❌ Falha em ${file}:`, err.message);
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nConcluído: ${applied} aplicada(s), ${skipped} ignorada(s).`);
}

main().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
