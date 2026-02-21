import { Pool } from 'pg';
import { eventBus, WhatsAppEvent } from '../../utils/eventBus';

/**
 * Registra os listeners do Event Bus para persistir mensagens,
 * criar contatos, atualizar conversas e disparar automações.
 */
export function registerWhatsAppEventHandlers(db: Pool): void {
  // ---- Mensagem recebida: persistir ----
  eventBus.on('whatsapp:message_received', async (event: WhatsAppEvent) => {
    const { tenantId, instanceId, data } = event;
    const { from, pushName, message, messageId, type } = data;

    try {
      // 1. Upsert contato
      const contactResult = await db.query(
        `INSERT INTO contacts (tenant_id, wa_id, phone, push_name, name)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (tenant_id, wa_id) DO UPDATE SET
           push_name = COALESCE(EXCLUDED.push_name, contacts.push_name),
           updated_at = NOW()
         RETURNING id`,
        [tenantId, from, from?.replace('@s.whatsapp.net', ''), pushName]
      );
      const contactId = contactResult.rows[0].id;

      // 2. Upsert conversa
      const content = extractTextContent(message);
      const convResult = await db.query(
        `INSERT INTO conversations (tenant_id, instance_id, contact_id, status, last_message_at, last_message_preview, unread_count)
         VALUES ($1, $2, $3, 'open', NOW(), $4, 1)
         ON CONFLICT ON CONSTRAINT conversations_tenant_id_instance_id_contact_id_key
         DO UPDATE SET
           last_message_at = NOW(),
           last_message_preview = $4,
           unread_count = conversations.unread_count + 1,
           status = CASE WHEN conversations.status = 'resolved' THEN 'open' ELSE conversations.status END,
           updated_at = NOW()
         RETURNING id`,
        [tenantId, instanceId, contactId, content?.substring(0, 200)]
      );

      // Se não existe unique constraint, usar alternativa:
      let conversationId: string;
      if (convResult.rows.length > 0) {
        conversationId = convResult.rows[0].id;
      } else {
        const findConv = await db.query(
          `SELECT id FROM conversations WHERE tenant_id = $1 AND instance_id = $2 AND contact_id = $3`,
          [tenantId, instanceId, contactId]
        );
        if (findConv.rows.length > 0) {
          conversationId = findConv.rows[0].id;
          await db.query(
            `UPDATE conversations SET last_message_at = NOW(), last_message_preview = $2,
             unread_count = unread_count + 1, updated_at = NOW() WHERE id = $1`,
            [conversationId, content?.substring(0, 200)]
          );
        } else {
          const newConv = await db.query(
            `INSERT INTO conversations (tenant_id, instance_id, contact_id, status, last_message_at, last_message_preview, unread_count)
             VALUES ($1, $2, $3, 'open', NOW(), $4, 1) RETURNING id`,
            [tenantId, instanceId, contactId, content?.substring(0, 200)]
          );
          conversationId = newConv.rows[0].id;
        }
      }

      // 3. Persistir mensagem
      await db.query(
        `INSERT INTO messages (tenant_id, conversation_id, instance_id, contact_id, wa_message_id, direction, type, content, status)
         VALUES ($1, $2, $3, $4, $5, 'inbound', $6, $7, 'delivered')`,
        [tenantId, conversationId, instanceId, contactId, messageId, type, content]
      );

      console.log(`[EventHandler] Mensagem recebida e persistida: ${messageId}`);
    } catch (err) {
      console.error('[EventHandler] Erro ao persistir mensagem recebida:', err);
    }
  });

  // ---- Mensagem enviada: atualizar status ----
  eventBus.on('whatsapp:message_sent', async (event: WhatsAppEvent) => {
    const { data } = event;
    try {
      await db.query(
        `UPDATE messages SET status = 'sent', updated_at = NOW() WHERE wa_message_id = $1`,
        [data.messageId]
      );
    } catch (err) {
      console.error('[EventHandler] Erro ao atualizar status de envio:', err);
    }
  });

  // ---- Status update (ack) ----
  eventBus.on('whatsapp:status_update', async (event: WhatsAppEvent) => {
    const { data } = event;
    const statusMap: Record<number, string> = {
      2: 'sent',
      3: 'delivered',
      4: 'read',
    };
    const status = statusMap[data.status];
    if (!status) return;

    try {
      await db.query(
        `UPDATE messages SET status = $2, updated_at = NOW() WHERE wa_message_id = $1`,
        [data.messageId, status]
      );
    } catch (err) {
      console.error('[EventHandler] Erro ao atualizar ack:', err);
    }
  });
}

function extractTextContent(message: any): string | null {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return `[Imagem] ${message.imageMessage.caption}`;
  if (message.imageMessage) return '[Imagem]';
  if (message.videoMessage?.caption) return `[Vídeo] ${message.videoMessage.caption}`;
  if (message.videoMessage) return '[Vídeo]';
  if (message.audioMessage) return '[Áudio]';
  if (message.documentMessage) return `[Documento] ${message.documentMessage?.fileName || ''}`;
  if (message.stickerMessage) return '[Sticker]';
  if (message.locationMessage) return '[Localização]';
  return '[Mensagem não suportada]';
}
