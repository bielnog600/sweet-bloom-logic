import { Pool } from 'pg';
import { startWorkers } from './queue';
import { WhatsAppConnectionManager } from '../modules/whatsapp/whatsapp.manager';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const databaseUrl = process.env.DATABASE_URL || 'postgresql://whatsapp_saas:supersecret@localhost:5432/whatsapp_saas';

const db = new Pool({ connectionString: databaseUrl });
const waManager = new WhatsAppConnectionManager(db);

console.log('[Worker] Iniciando workers...');
startWorkers(redisUrl, db, waManager);
console.log('[Worker] Workers rodando.');
