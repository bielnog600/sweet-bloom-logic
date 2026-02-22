import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export async function runMigrations(db: Pool): Promise<void> {
  console.log('[Migrations] Verificando schema...');

  // Check if schema already exists by looking for the tenants table
  const check = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'tenants'
    ) as exists
  `);

  if (check.rows[0].exists) {
    console.log('[Migrations] Schema já existe, pulando migration.');
    return;
  }

  console.log('[Migrations] Schema não encontrado, rodando migration inicial...');

  const migrationPath = path.join(__dirname, 'migrations', '001_initial.sql');
  
  // Support both dev (src/) and prod (dist/) paths
  let sql: string;
  if (fs.existsSync(migrationPath)) {
    sql = fs.readFileSync(migrationPath, 'utf-8');
  } else {
    // In production, SQL files might be in src relative to project root
    const altPath = path.join(process.cwd(), 'src', 'db', 'migrations', '001_initial.sql');
    if (fs.existsSync(altPath)) {
      sql = fs.readFileSync(altPath, 'utf-8');
    } else {
      console.error('[Migrations] Arquivo 001_initial.sql não encontrado!');
      console.error('[Migrations] Tentou:', migrationPath, 'e', altPath);
      return;
    }
  }

  await db.query(sql);
  console.log('[Migrations] Schema criado com sucesso!');
}
