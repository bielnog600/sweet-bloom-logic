import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { WhatsAppConnectionManager } from '../modules/whatsapp/whatsapp.manager';

let sendMessageQueue: Queue;
let scheduledMessageQueue: Queue;
let followUpQueue: Queue;

export function setupQueues(redisUrl: string): { sendMessageQueue: Queue; scheduledMessageQueue: Queue; followUpQueue: Queue } {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  sendMessageQueue = new Queue('send-message', { connection });
  scheduledMessageQueue = new Queue('scheduled-message', { connection });
  followUpQueue = new Queue('follow-up', { connection });

  return { sendMessageQueue, scheduledMessageQueue, followUpQueue };
}

export function startWorkers(
  redisUrl: string,
  db: Pool,
  waManager: WhatsAppConnectionManager
): void {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  // ---- Worker: Enviar Mensagem ----
  new Worker('send-message', async (job: Job) => {
    const { tenantId, instanceId, to, text, messageDbId, mediaUrl, mediaType, mimetype, filename, caption } = job.data;

    try {
      let result;
      if (mediaUrl) {
        result = await waManager.sendMediaMessage(tenantId, instanceId, to, {
          url: mediaUrl,
          mimetype,
          filename,
          caption,
        }, mediaType || 'image');
      } else {
        result = await waManager.sendTextMessage(tenantId, instanceId, to, text);
      }

      // Atualizar no banco
      if (messageDbId) {
        await db.query(
          `UPDATE messages SET wa_message_id = $2, status = 'sent', updated_at = NOW() WHERE id = $1`,
          [messageDbId, result?.key.id]
        );
      }

      return { success: true, messageId: result?.key.id };
    } catch (error: any) {
      // Atualizar status como falho
      if (messageDbId) {
        await db.query(
          `UPDATE messages SET status = 'failed', metadata = jsonb_set(COALESCE(metadata, '{}'), '{error}', $2::jsonb), updated_at = NOW() WHERE id = $1`,
          [messageDbId, JSON.stringify(error.message)]
        );
      }
      throw error; // BullMQ vai fazer retry
    }
  }, {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 }, // Rate limit: 10 msgs/seg
  });

  // ---- Worker: Mensagens Agendadas ----
  new Worker('scheduled-message', async (job: Job) => {
    const { scheduledMessageId, tenantId } = job.data;

    const result = await db.query(
      `SELECT sm.*, wi.id as instance_id FROM scheduled_messages sm
       JOIN whatsapp_instances wi ON sm.instance_id = wi.id
       WHERE sm.id = $1 AND sm.tenant_id = $2 AND sm.status = 'pending'`,
      [scheduledMessageId, tenantId]
    );

    if (result.rows.length === 0) return;

    const scheduled = result.rows[0];

    // Se é pra um contato específico
    if (scheduled.contact_id) {
      const contact = await db.query('SELECT wa_id FROM contacts WHERE id = $1', [scheduled.contact_id]);
      if (contact.rows.length > 0) {
        await sendMessageQueue.add('send', {
          tenantId,
          instanceId: scheduled.instance_id,
          to: contact.rows[0].wa_id,
          text: scheduled.content,
          mediaUrl: scheduled.media_url,
        });
      }
    }

    // Se é pra uma lista
    if (scheduled.contact_list_ids?.length > 0) {
      const contacts = await db.query(
        'SELECT wa_id FROM contacts WHERE id = ANY($1)',
        [scheduled.contact_list_ids]
      );
      for (const contact of contacts.rows) {
        await sendMessageQueue.add('send', {
          tenantId,
          instanceId: scheduled.instance_id,
          to: contact.wa_id,
          text: scheduled.content,
          mediaUrl: scheduled.media_url,
        }, { delay: Math.random() * 5000 }); // Delay aleatório para evitar ban
      }
    }

    await db.query(
      `UPDATE scheduled_messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [scheduledMessageId]
    );
  }, { connection, concurrency: 3 });

  // ---- Worker: Follow-up ----
  new Worker('follow-up', async (job: Job) => {
    const { automationRunId, tenantId } = job.data;

    const run = await db.query(
      `SELECT ar.*, a.config FROM automation_runs ar
       JOIN automations a ON ar.automation_id = a.id
       WHERE ar.id = $1 AND ar.tenant_id = $2 AND ar.status = 'pending'`,
      [automationRunId, tenantId]
    );

    if (run.rows.length === 0) return;

    const { conversation_id, config } = run.rows[0];

    // Verificar se o contato respondeu desde o agendamento
    const recentMsg = await db.query(
      `SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'inbound'
       AND created_at > $2 LIMIT 1`,
      [conversation_id, run.rows[0].created_at]
    );

    if (recentMsg.rows.length > 0) {
      // Contato respondeu, cancelar follow-up
      await db.query(
        `UPDATE automation_runs SET status = 'cancelled', completed_at = NOW() WHERE id = $1`,
        [automationRunId]
      );
      return;
    }

    // Enviar follow-up
    const conv = await db.query(
      `SELECT c.contact_id, ct.wa_id, c.instance_id FROM conversations c
       JOIN contacts ct ON c.contact_id = ct.id WHERE c.id = $1`,
      [conversation_id]
    );

    if (conv.rows.length > 0) {
      await sendMessageQueue.add('send', {
        tenantId,
        instanceId: conv.rows[0].instance_id,
        to: conv.rows[0].wa_id,
        text: config.message,
      });

      await db.query(
        `UPDATE automation_runs SET status = 'completed', completed_at = NOW(), attempt = attempt + 1 WHERE id = $1`,
        [automationRunId]
      );
    }
  }, { connection, concurrency: 2 });

  console.log('[Workers] Todos os workers iniciados');
}

export { sendMessageQueue, scheduledMessageQueue, followUpQueue };
