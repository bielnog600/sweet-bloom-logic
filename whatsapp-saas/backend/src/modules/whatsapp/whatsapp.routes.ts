import { Router, Request, Response } from 'express';
import { WhatsAppConnectionManager } from './whatsapp.manager';
import { Pool } from 'pg';

export function createWhatsAppRoutes(manager: WhatsAppConnectionManager, db: Pool): Router {
  const router = Router();

  // Listar instâncias do tenant
  router.get('/instances', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    try {
      const result = await db.query(
        `SELECT id, instance_name, phone_number, status, is_active, last_connected_at, created_at
         FROM whatsapp_instances WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );

      // Enriquecer com status live do manager
      const liveStatuses = manager.getInstancesStatus(tenantId);
      const instances = result.rows.map((row) => {
        const live = liveStatuses.find((s) => s.instanceId === row.id);
        return { ...row, live_status: live?.status || row.status };
      });

      res.json({ instances });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao listar instâncias' });
    }
  });

  // Criar nova instância
  router.post('/instances', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { instance_name } = req.body;

    if (!instance_name) {
      return res.status(400).json({ error: 'instance_name é obrigatório' });
    }

    try {
      // Verificar limite do plano
      const tenant = await db.query('SELECT max_instances FROM tenants WHERE id = $1', [tenantId]);
      const count = await db.query('SELECT COUNT(*) FROM whatsapp_instances WHERE tenant_id = $1', [tenantId]);

      if (parseInt(count.rows[0].count) >= tenant.rows[0].max_instances) {
        return res.status(403).json({ error: 'Limite de instâncias atingido para seu plano' });
      }

      const result = await db.query(
        `INSERT INTO whatsapp_instances (tenant_id, instance_name) VALUES ($1, $2) RETURNING *`,
        [tenantId, instance_name]
      );

      res.status(201).json({ instance: result.rows[0] });
    } catch (err: any) {
      if (err.constraint) {
        return res.status(409).json({ error: 'Já existe uma instância com esse nome' });
      }
      res.status(500).json({ error: 'Erro ao criar instância' });
    }
  });

  // Conectar (gera QR)
  router.post('/instances/:instanceId/connect', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { instanceId } = req.params;

    try {
      // Verificar se a instância pertence ao tenant
      const instance = await db.query(
        'SELECT id FROM whatsapp_instances WHERE id = $1 AND tenant_id = $2',
        [instanceId, tenantId]
      );
      if (instance.rows.length === 0) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }

      await manager.connect(tenantId, instanceId);
      res.json({ message: 'Conexão iniciada. QR será enviado via WebSocket.' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao conectar instância' });
    }
  });

  // Desconectar
  router.post('/instances/:instanceId/disconnect', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { instanceId } = req.params;
    const { logout } = req.body;

    try {
      await manager.disconnect(tenantId, instanceId, logout === true);
      res.json({ message: logout ? 'Deslogado com sucesso' : 'Desconectado' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao desconectar' });
    }
  });

  // Enviar mensagem de texto
  router.post('/send/text', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { instance_id, to, text } = req.body;

    if (!instance_id || !to || !text) {
      return res.status(400).json({ error: 'instance_id, to e text são obrigatórios' });
    }

    try {
      const result = await manager.sendTextMessage(tenantId, instance_id, to, text);
      res.json({ message: 'Mensagem enviada', messageId: result?.key.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Enviar mídia
  router.post('/send/media', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { instance_id, to, media_url, mimetype, filename, caption, type } = req.body;

    try {
      const result = await manager.sendMediaMessage(tenantId, instance_id, to, {
        url: media_url,
        mimetype,
        filename,
        caption,
      }, type || 'image');

      res.json({ message: 'Mídia enviada', messageId: result?.key.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
