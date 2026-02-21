# WhatsApp SaaS - Arquitetura

## Visão Geral

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                │
│  Login │ Dashboard │ QR Connect │ Inbox │ CRM │ AI  │
│                    WebSocket Client                  │
└──────────────────────┬──────────────────────────────┘
                       │ REST + WS
┌──────────────────────┴──────────────────────────────┐
│                 BACKEND (Node.js/Express)            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  REST API     │  │  WebSocket   │  │ Event Bus │  │
│  │  (Express)    │  │  Server      │  │ (EE)      │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                │         │
│  ┌──────┴─────────────────┴────────────────┴──────┐  │
│  │         WhatsApp Connection Manager            │  │
│  │  (Baileys instances por tenant/número)         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────┐  ┌─────────────────────────────┐ │
│  │  BullMQ Worker │  │  AI Service (OpenAI)        │ │
│  │  (Filas/Jobs)  │  │  (opcional por tenant)      │ │
│  └───────┬────────┘  └─────────────────────────────┘ │
└──────────┼──────────────────────────────────────────┘
           │
┌──────────┴──────────┐  ┌──────────────────────┐
│  PostgreSQL         │  │  Redis               │
│  (dados + sessões)  │  │  (filas + locks)     │
└─────────────────────┘  └──────────────────────┘
```

## Decisão: Persistência de Sessão WhatsApp

**Escolha: Opção A — Postgres com criptografia (AES-256-GCM)**

Motivos:
1. **Backup centralizado**: Postgres já tem backup, replicação, PITR
2. **Multi-tenant seguro**: cada sessão isolada por tenant_id, criptografia individual
3. **Escalabilidade horizontal**: sem dependência de disco local = deploy em qualquer nó
4. **Docker simplificado**: sem volumes de sessão por tenant
5. **Restore rápido**: ao reiniciar, carrega sessões do banco e reconecta

A chave de criptografia vem do `.env` (`SESSION_ENCRYPTION_KEY`), uma por instalação.

## Fluxo de Conexão WhatsApp (QR Code)

1. Atendente clica "Gerar QR" no frontend
2. Frontend envia `POST /api/whatsapp/connect` com `instance_id`
3. Backend cria instância Baileys, gera QR
4. QR é emitido via WebSocket para o frontend (evento `whatsapp:qr`)
5. Usuário escaneia no celular
6. Baileys emite `connection.update` → `open`
7. Backend persiste credenciais criptografadas no Postgres
8. Frontend recebe `whatsapp:connected` via WebSocket
9. Mensagens recebidas → Event Bus → persistência → WebSocket → automações

## Event Bus (Desacoplamento)

```
WhatsApp Manager
  └─ emite: qr, connected, disconnected, message_received, message_sent, message_failed
       │
  Event Bus (Node EventEmitter)
       ├─ Listener: PersistenceHandler (salva no Postgres)
       ├─ Listener: WebSocketHandler (notifica frontend)
       ├─ Listener: AutomationHandler (verifica regras)
       └─ Listener: AIHandler (responde se configurado)
```

## Estrutura de Pastas

```
whatsapp-saas/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── config/
│   │   │   ├── database.ts       # Pool Postgres
│   │   │   ├── redis.ts          # Conexão Redis
│   │   │   └── env.ts            # Variáveis
│   │   ├── db/
│   │   │   └── migrations/
│   │   │       └── 001_initial.sql
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT + tenant isolation
│   │   │   ├── rateLimiter.ts    # Rate limit por tenant
│   │   │   └── tenantContext.ts  # Injeta tenant no req
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── auth.routes.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   └── auth.service.ts
│   │   │   ├── whatsapp/
│   │   │   │   ├── whatsapp.routes.ts
│   │   │   │   ├── whatsapp.controller.ts
│   │   │   │   ├── whatsapp.manager.ts    # ← CORE
│   │   │   │   ├── whatsapp.service.ts
│   │   │   │   └── whatsapp.events.ts
│   │   │   ├── inbox/
│   │   │   │   ├── inbox.routes.ts
│   │   │   │   ├── inbox.controller.ts
│   │   │   │   └── inbox.service.ts
│   │   │   ├── contacts/
│   │   │   ├── automations/
│   │   │   ├── ai/
│   │   │   └── scheduling/
│   │   ├── jobs/
│   │   │   ├── queue.ts          # BullMQ setup
│   │   │   ├── workers/
│   │   │   │   ├── sendMessage.worker.ts
│   │   │   │   ├── scheduledMessage.worker.ts
│   │   │   │   └── followUp.worker.ts
│   │   ├── websocket/
│   │   │   └── ws.ts             # Socket.IO setup
│   │   ├── utils/
│   │   │   ├── encryption.ts     # AES-256-GCM
│   │   │   └── eventBus.ts       # Node EventEmitter
│   │   └── types/
│   │       └── index.ts
│   └── Dockerfile
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx          # Login
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── whatsapp/
│   │   │   │   └── page.tsx      # QR Connect
│   │   │   ├── inbox/
│   │   │   │   └── page.tsx
│   │   │   ├── contacts/
│   │   │   │   └── page.tsx
│   │   │   ├── automations/
│   │   │   │   └── page.tsx
│   │   │   └── settings/
│   │   │       └── page.tsx
│   │   ├── components/
│   │   │   ├── QRCodeDisplay.tsx
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ContactCard.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   └── useAuth.ts
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   └── socket.ts
│   │   └── types/
│   │       └── index.ts
│   └── Dockerfile
└── docs/
    └── TESTING_GUIDE.md
```
