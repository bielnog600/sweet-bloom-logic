import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { Pool } from 'pg';
import pino from 'pino';
import { encrypt, decrypt } from '../../utils/encryption';
import { eventBus, WhatsAppEvent } from '../../utils/eventBus';

const logger = pino({ level: 'silent' });

interface ManagedInstance {
  socket: WASocket | null;
  tenantId: string;
  instanceId: string;
  phoneNumber?: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending';
  retryCount: number;
  maxRetries: number;
}

export class WhatsAppConnectionManager {
  private instances: Map<string, ManagedInstance> = new Map();
  private db: Pool;
  private encryptionKey: string;

  constructor(db: Pool, encryptionKey: string) {
    this.db = db;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Gera a chave única para uma instância: tenantId:instanceId
   */
  private getKey(tenantId: string, instanceId: string): string {
    return `${tenantId}:${instanceId}`;
  }

  /**
   * Inicia todas as instâncias ativas do banco (ao subir o servidor)
   */
  async restoreAllSessions(): Promise<void> {
    const result = await this.db.query(
      `SELECT wi.id as instance_id, wi.tenant_id, wi.instance_name
       FROM whatsapp_instances wi
       WHERE wi.status = 'connected' AND wi.is_active = true`
    );

    console.log(`[WA Manager] Restaurando ${result.rows.length} sessões...`);

    for (const row of result.rows) {
      try {
        await this.connect(row.tenant_id, row.instance_id);
      } catch (err) {
        console.error(`[WA Manager] Falha ao restaurar ${row.instance_id}:`, err);
      }
    }
  }

  /**
   * Conecta uma instância WhatsApp (gera QR ou restaura sessão)
   */
  async connect(tenantId: string, instanceId: string): Promise<void> {
    const key = this.getKey(tenantId, instanceId);

    // Se já conectada, ignora
    const existing = this.instances.get(key);
    if (existing?.status === 'connected') {
      console.log(`[WA Manager] Instância ${key} já conectada.`);
      return;
    }

    // Carregar sessão salva do banco
    const savedSession = await this.loadSession(instanceId, tenantId);

    // Criar auth state customizado (em memória, persistido no banco)
    const { state, saveCreds } = await this.createAuthState(instanceId, tenantId, savedSession);

    const { version } = await fetchLatestBaileysVersion();

    

    const socket = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      generateHighQualityLinkPreview: true,
    });

    

    const previousRetryCount = existing?.retryCount || 0;

    const instance: ManagedInstance = {
      socket,
      tenantId,
      instanceId,
      status: 'connecting',
      retryCount: previousRetryCount,
      maxRetries: 5,
    };

    this.instances.set(key, instance);

    // ---- Event Handlers ----

    // QR Code
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        instance.status = 'qr_pending';
        await this.updateInstanceStatus(instanceId, 'qr_pending');

        this.emitEvent({
          tenantId,
          instanceId,
          type: 'qr',
          data: { qr },
          timestamp: new Date(),
        });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        instance.status = 'disconnected';
        await this.updateInstanceStatus(instanceId, 'disconnected');

        this.emitEvent({
          tenantId,
          instanceId,
          type: 'disconnected',
          data: { statusCode, shouldReconnect },
          timestamp: new Date(),
        });

        if (shouldReconnect && instance.retryCount < instance.maxRetries) {
          instance.retryCount++;
          const delay = Math.min(1000 * Math.pow(2, instance.retryCount), 30000);
          console.log(`[WA Manager] Reconectando ${key} em ${delay}ms (tentativa ${instance.retryCount})...`);
          setTimeout(() => this.connect(tenantId, instanceId), delay);
        } else if (!shouldReconnect) {
          // Logout: limpar sessão
          await this.deleteSession(instanceId, tenantId);
          this.instances.delete(key);
        }
      }

      if (connection === 'open') {
        instance.status = 'connected';
        instance.retryCount = 0;
        instance.phoneNumber = socket.user?.id?.split(':')[0];

        await this.updateInstanceStatus(instanceId, 'connected', instance.phoneNumber);

        this.emitEvent({
          tenantId,
          instanceId,
          type: 'connected',
          data: {
            phoneNumber: instance.phoneNumber,
            pushName: socket.user?.name,
          },
          timestamp: new Date(),
        });

        console.log(`[WA Manager] ${key} conectado como ${instance.phoneNumber}`);
      }
    });

    // Persistir credenciais ao atualizar
    socket.ev.on('creds.update', async () => {
      await saveCreds();
      await this.saveSession(instanceId, tenantId, state);
    });

    // Mensagens recebidas
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue; // Ignorar msgs enviadas por nós

        this.emitEvent({
          tenantId,
          instanceId,
          type: 'message_received',
          data: {
            messageId: msg.key.id,
            from: msg.key.remoteJid,
            pushName: msg.pushName,
            message: msg.message,
            timestamp: msg.messageTimestamp,
            type: this.getMessageType(msg.message),
          },
          timestamp: new Date(),
        });
      }
    });

    // Status de mensagens (ack)
    socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update.status) {
          this.emitEvent({
            tenantId,
            instanceId,
            type: 'status_update',
            data: {
              messageId: update.key.id,
              remoteJid: update.key.remoteJid,
              status: update.update.status, // 2=sent, 3=delivered, 4=read
            },
            timestamp: new Date(),
          });
        }
      }
    });
  }

  /**
   * Desconectar uma instância
   */
  async disconnect(tenantId: string, instanceId: string, logout = false): Promise<void> {
    const key = this.getKey(tenantId, instanceId);
    const instance = this.instances.get(key);

    if (!instance?.socket) return;

    if (logout) {
      await instance.socket.logout();
      await this.deleteSession(instanceId, tenantId);
    } else {
      instance.socket.end(new Error('User requested disconnect'));
    }

    await this.updateInstanceStatus(instanceId, 'disconnected');
    this.instances.delete(key);

    this.emitEvent({
      tenantId,
      instanceId,
      type: 'disconnected',
      data: { reason: logout ? 'logout' : 'manual' },
      timestamp: new Date(),
    });
  }

  /**
   * Enviar mensagem de texto
   */
  async sendTextMessage(tenantId: string, instanceId: string, to: string, text: string): Promise<proto.WebMessageInfo | null> {
    const instance = this.getInstance(tenantId, instanceId);
    if (!instance?.socket || instance.status !== 'connected') {
      throw new Error(`Instância ${instanceId} não está conectada`);
    }

    try {
      const result = await instance.socket.sendMessage(to, { text });

      this.emitEvent({
        tenantId,
        instanceId,
        type: 'message_sent',
        data: {
          messageId: result?.key.id,
          to,
          content: text,
          type: 'text',
        },
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      this.emitEvent({
        tenantId,
        instanceId,
        type: 'message_failed',
        data: { to, content: text, error: (error as Error).message },
        timestamp: new Date(),
      });
      throw error;
    }
  }

  /**
   * Enviar mídia (imagem, documento, etc.)
   */
  async sendMediaMessage(
    tenantId: string,
    instanceId: string,
    to: string,
    media: { url?: string; buffer?: Buffer; mimetype: string; filename?: string; caption?: string },
    type: 'image' | 'document' | 'video' | 'audio'
  ): Promise<proto.WebMessageInfo | null> {
    const instance = this.getInstance(tenantId, instanceId);
    if (!instance?.socket || instance.status !== 'connected') {
      throw new Error(`Instância ${instanceId} não está conectada`);
    }

    const msgContent: any = {};

    if (type === 'image') {
      msgContent.image = media.url ? { url: media.url } : media.buffer;
      msgContent.caption = media.caption;
    } else if (type === 'document') {
      msgContent.document = media.url ? { url: media.url } : media.buffer;
      msgContent.mimetype = media.mimetype;
      msgContent.fileName = media.filename;
    } else if (type === 'video') {
      msgContent.video = media.url ? { url: media.url } : media.buffer;
      msgContent.caption = media.caption;
    } else if (type === 'audio') {
      msgContent.audio = media.url ? { url: media.url } : media.buffer;
      msgContent.mimetype = media.mimetype;
    }

    const result = await instance.socket.sendMessage(to, msgContent);

    this.emitEvent({
      tenantId,
      instanceId,
      type: 'message_sent',
      data: { messageId: result?.key.id, to, type, filename: media.filename },
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * Obter status de todas as instâncias de um tenant
   */
  getInstancesStatus(tenantId: string): Array<{ instanceId: string; status: string; phoneNumber?: string }> {
    const results: Array<{ instanceId: string; status: string; phoneNumber?: string }> = [];

    for (const [key, instance] of this.instances) {
      if (instance.tenantId === tenantId) {
        results.push({
          instanceId: instance.instanceId,
          status: instance.status,
          phoneNumber: instance.phoneNumber,
        });
      }
    }

    return results;
  }

  // ---- Métodos privados ----

  private getInstance(tenantId: string, instanceId: string): ManagedInstance | undefined {
    return this.instances.get(this.getKey(tenantId, instanceId));
  }

  private emitEvent(event: WhatsAppEvent): void {
    eventBus.emitWhatsApp(event);
  }

  private getMessageType(message: proto.IMessage | null | undefined): string {
    if (!message) return 'unknown';
    if (message.conversation || message.extendedTextMessage) return 'text';
    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.documentMessage) return 'document';
    if (message.stickerMessage) return 'sticker';
    if (message.locationMessage) return 'location';
    return 'unknown';
  }

  private async updateInstanceStatus(instanceId: string, status: string, phoneNumber?: string): Promise<void> {
    const fields = ['status = $2', 'updated_at = NOW()'];
    const values: any[] = [instanceId, status];

    if (status === 'connected') {
      fields.push('last_connected_at = NOW()');
    } else if (status === 'disconnected') {
      fields.push('last_disconnected_at = NOW()');
    }

    if (phoneNumber) {
      values.push(phoneNumber);
      fields.push(`phone_number = $${values.length}`);
    }

    await this.db.query(
      `UPDATE whatsapp_instances SET ${fields.join(', ')} WHERE id = $1`,
      values
    );
  }

  // ---- Persistência de Sessão (Postgres criptografado) ----

  private async createAuthState(instanceId: string, tenantId: string, savedSession: any) {
    const creds = savedSession?.creds || {};
    const keys = savedSession?.keys || {};

    const state = {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, any> = {};
          for (const id of ids) {
            if (keys[type]?.[id]) {
              data[id] = keys[type][id];
            }
          }
          return data;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          for (const type in data) {
            if (!keys[type]) keys[type] = {};
            for (const id in data[type]) {
              keys[type][id] = data[type][id];
              if (data[type][id] === null || data[type][id] === undefined) {
                delete keys[type][id];
              }
            }
          }
        },
      },
    };

    const saveCreds = async () => {
      // Será chamado pelo creds.update event
    };

    return { state, saveCreds };
  }

  private async saveSession(instanceId: string, tenantId: string, state: any): Promise<void> {
    try {
      const credsJson = JSON.stringify(state.creds);
      const keysJson = JSON.stringify({}); // Keys são mantidas em memória e podem ser grandes

      const credsEnc = encrypt(credsJson, this.encryptionKey);
      const keysEnc = encrypt(keysJson, this.encryptionKey);

      await this.db.query(
        `INSERT INTO whatsapp_sessions (instance_id, tenant_id, creds_encrypted, creds_iv, creds_tag, keys_encrypted, keys_iv, keys_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (instance_id) DO UPDATE SET
           creds_encrypted = $3, creds_iv = $4, creds_tag = $5,
           keys_encrypted = $6, keys_iv = $7, keys_tag = $8,
           updated_at = NOW()`,
        [
          instanceId, tenantId,
          credsEnc.encrypted, credsEnc.iv, credsEnc.tag,
          keysEnc.encrypted, keysEnc.iv, keysEnc.tag,
        ]
      );
    } catch (err) {
      console.error(`[WA Manager] Erro ao salvar sessão ${instanceId}:`, err);
    }
  }

  private async loadSession(instanceId: string, tenantId: string): Promise<any | null> {
    try {
      const result = await this.db.query(
        `SELECT * FROM whatsapp_sessions WHERE instance_id = $1 AND tenant_id = $2`,
        [instanceId, tenantId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      const credsJson = decrypt(row.creds_encrypted, row.creds_iv, row.creds_tag, this.encryptionKey);
      const creds = JSON.parse(credsJson);

      return { creds, keys: {} };
    } catch (err) {
      console.error(`[WA Manager] Erro ao carregar sessão ${instanceId}:`, err);
      return null;
    }
  }

  private async deleteSession(instanceId: string, tenantId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM whatsapp_sessions WHERE instance_id = $1 AND tenant_id = $2`,
      [instanceId, tenantId]
    );
  }
}
