import { EventEmitter } from 'events';

export interface WhatsAppEvent {
  tenantId: string;
  instanceId: string;
  type: 'qr' | 'connected' | 'disconnected' | 'message_received' | 'message_sent' | 'message_failed' | 'status_update';
  data: any;
  timestamp: Date;
}

class EventBus extends EventEmitter {
  private static instance: EventBus;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  emitWhatsApp(event: WhatsAppEvent): void {
    this.emit('whatsapp', event);
    this.emit(`whatsapp:${event.type}`, event);
    this.emit(`whatsapp:${event.tenantId}`, event);
    this.emit(`whatsapp:${event.tenantId}:${event.instanceId}`, event);
  }
}

export const eventBus = EventBus.getInstance();
