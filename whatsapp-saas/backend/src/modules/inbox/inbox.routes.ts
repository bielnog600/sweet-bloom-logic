import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

export function createInboxRoutes(db: Pool): Router {
  const router = Router();

  // Listar conversas
  router.get('/conversations', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { status, assigned_to, page = 1, limit = 50 } = req.query;

    try {
      let where = 'c.tenant_id = $1';
      const values: any[] = [tenantId];
      let paramIndex = 2;

      if (status) {
        where += ` AND c.status = $${paramIndex++}`;
        values.push(status);
      }
      if (assigned_to) {
        where += ` AND c.assigned_to = $${paramIndex++}`;
        values.push(assigned_to);
      }

      const offset = (Number(page) - 1) * Number(limit);
      values.push(Number(limit), offset);

      const result = await db.query(
        `SELECT c.*, 
                ct.name as contact_name, ct.phone as contact_phone, ct.push_name, ct.profile_pic_url,
                u.name as assigned_name,
                wi.instance_name, wi.phone_number as instance_phone
         FROM conversations c
         JOIN contacts ct ON c.contact_id = ct.id
         LEFT JOIN users u ON c.assigned_to = u.id
         JOIN whatsapp_instances wi ON c.instance_id = wi.id
         WHERE ${where}
         ORDER BY c.last_message_at DESC NULLS LAST
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        values
      );

      res.json({ conversations: result.rows });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao listar conversas' });
    }
  });

  // Mensagens de uma conversa
  router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { before, limit = 50 } = req.query;

    try {
      let where = 'm.conversation_id = $1 AND m.tenant_id = $2';
      const values: any[] = [id, tenantId];

      if (before) {
        where += ` AND m.created_at < $3`;
        values.push(before);
      }

      values.push(Number(limit));

      const result = await db.query(
        `SELECT m.*, u.name as sender_name
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE ${where}
         ORDER BY m.created_at DESC
         LIMIT $${values.length}`,
        values
      );

      // Zerar unread ao abrir
      await db.query(
        'UPDATE conversations SET unread_count = 0 WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );

      res.json({ messages: result.rows.reverse() });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao listar mensagens' });
    }
  });

  // Assumir conversa (lock)
  router.post('/conversations/:id/assign', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const { id } = req.params;

    try {
      // Verificar lock (TTL de 30 min)
      const conv = await db.query(
        `SELECT locked_by, locked_at FROM conversations WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );

      if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversa não encontrada' });

      const { locked_by, locked_at } = conv.rows[0];
      const lockExpired = locked_at && new Date().getTime() - new Date(locked_at).getTime() > 30 * 60 * 1000;

      if (locked_by && locked_by !== userId && !lockExpired) {
        return res.status(409).json({ error: 'Conversa já assumida por outro atendente' });
      }

      await db.query(
        `UPDATE conversations SET assigned_to = $3, locked_by = $3, locked_at = NOW(), status = 'in_progress'
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, userId]
      );

      res.json({ message: 'Conversa assumida' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao assumir conversa' });
    }
  });

  // Resolver conversa
  router.post('/conversations/:id/resolve', async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    try {
      await db.query(
        `UPDATE conversations SET status = 'resolved', resolved_at = NOW(), locked_by = NULL, locked_at = NULL
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      res.json({ message: 'Conversa resolvida' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao resolver conversa' });
    }
  });

  return router;
}
