import express from 'express';
import http from 'http';
import cors from 'cors';
import { Pool } from 'pg';
import { WhatsAppConnectionManager } from './modules/whatsapp/whatsapp.manager';
import { registerWhatsAppEventHandlers } from './modules/whatsapp/whatsapp.events';
import { createWhatsAppRoutes } from './modules/whatsapp/whatsapp.routes';
import { createInboxRoutes } from './modules/inbox/inbox.routes';
import { createAuthRoutes } from './modules/auth/auth.routes';
import { setupWebSocket } from './websocket/ws';
import { setupQueues, startWorkers } from './jobs/queue';
import { authMiddleware } from './middleware/auth';

const PORT = process.env.PORT || 3001;

// ---- Database ----
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---- Express ----
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ---- WhatsApp Manager ----
const waManager = new WhatsAppConnectionManager(db, process.env.SESSION_ENCRYPTION_KEY!);

// ---- Event Handlers (persistência, automações) ----
registerWhatsAppEventHandlers(db);

// ---- Routes ----
app.use('/api/auth', createAuthRoutes(db));
app.use('/api/whatsapp', authMiddleware, createWhatsAppRoutes(waManager, db));
app.use('/api/inbox', authMiddleware, createInboxRoutes(db));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ---- HTTP + WebSocket ----
const httpServer = http.createServer(app);
setupWebSocket(httpServer, process.env.JWT_SECRET!, process.env.CORS_ORIGIN || 'http://localhost:3000');

// ---- Queues ----
const queues = setupQueues(process.env.REDIS_URL || 'redis://localhost:6379');
startWorkers(process.env.REDIS_URL || 'redis://localhost:6379', db, waManager);

// ---- Start ----
httpServer.listen(PORT, async () => {
  console.log(`[Server] Rodando na porta ${PORT}`);

  // Restaurar sessões ao subir
  try {
    await waManager.restoreAllSessions();
    console.log('[Server] Sessões restauradas');
  } catch (err) {
    console.error('[Server] Erro ao restaurar sessões:', err);
  }
});
