import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { eventBus, WhatsAppEvent } from '../utils/eventBus';

let io: Server;

export function setupWebSocket(httpServer: HttpServer, jwtSecret: string, corsOrigin: string): Server {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Autenticação via JWT no handshake
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Token não fornecido'));
    }

    try {
      const decoded = jwt.verify(token as string, jwtSecret) as any;
      (socket as any).userId = decoded.userId;
      (socket as any).tenantId = decoded.tenantId;
      (socket as any).role = decoded.role;
      next();
    } catch (err) {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const tenantId = (socket as any).tenantId;
    const userId = (socket as any).userId;

    console.log(`[WS] Usuário ${userId} conectado (tenant: ${tenantId})`);

    // Entrar na sala do tenant (isolamento)
    socket.join(`tenant:${tenantId}`);

    // Entrar na sala pessoal
    socket.join(`user:${userId}`);

    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Usuário ${userId} desconectado`);
    });
  });

  // ---- Bridge: Event Bus → WebSocket ----

  eventBus.on('whatsapp', (event: WhatsAppEvent) => {
    const room = `tenant:${event.tenantId}`;

    switch (event.type) {
      case 'qr':
        // QR vai para todos do tenant (ou para quem solicitou)
        io.to(room).emit('whatsapp:qr', {
          instanceId: event.instanceId,
          qr: event.data.qr,
        });
        break;

      case 'connected':
        io.to(room).emit('whatsapp:connected', {
          instanceId: event.instanceId,
          phoneNumber: event.data.phoneNumber,
          pushName: event.data.pushName,
        });
        break;

      case 'disconnected':
        io.to(room).emit('whatsapp:disconnected', {
          instanceId: event.instanceId,
          reason: event.data.reason,
        });
        break;

      case 'message_received':
        io.to(room).emit('whatsapp:message', {
          instanceId: event.instanceId,
          direction: 'inbound',
          ...event.data,
        });
        break;

      case 'message_sent':
        io.to(room).emit('whatsapp:message', {
          instanceId: event.instanceId,
          direction: 'outbound',
          ...event.data,
        });
        break;

      case 'status_update':
        io.to(room).emit('whatsapp:status', event.data);
        break;
    }
  });

  return io;
}

export function getIO(): Server {
  return io;
}
