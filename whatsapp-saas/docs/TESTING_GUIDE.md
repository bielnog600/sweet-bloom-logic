# Guia de Teste Local

## 1. Pré-requisitos

- Docker + Docker Compose instalados
- Node.js 20+ (para desenvolvimento sem Docker)
- Um celular com WhatsApp

## 2. Subir o ambiente

```bash
# Copiar variáveis de ambiente
cp .env.example .env

# Gerar chave de criptografia real
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Cole o resultado no SESSION_ENCRYPTION_KEY do .env

# Subir tudo
docker-compose up -d

# Verificar logs
docker-compose logs -f backend
```

## 3. Criar conta (tenant + owner)

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Minha Empresa",
    "slug": "minha-empresa",
    "name": "Admin",
    "email": "admin@empresa.com",
    "password": "123456"
  }'
```

Salve o `token` retornado.

## 4. Criar instância WhatsApp

```bash
TOKEN="seu_token_aqui"

curl -X POST http://localhost:3001/api/whatsapp/instances \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"instance_name": "Vendas"}'
```

Salve o `id` da instância.

## 5. Conectar via QR Code

### Via Frontend (recomendado)
1. Acesse `http://localhost:3000/whatsapp`
2. Clique em "Gerar QR" na instância criada
3. Escaneie com o WhatsApp (Menu > Dispositivos vinculados > Vincular dispositivo)

### Via API + WebSocket
```bash
# Iniciar conexão
curl -X POST http://localhost:3001/api/whatsapp/instances/INSTANCE_ID/connect \
  -H "Authorization: Bearer $TOKEN"

# O QR será enviado via WebSocket (evento whatsapp:qr)
# No frontend, conecte ao socket:
# const socket = io('http://localhost:3001', { auth: { token: TOKEN } })
# socket.on('whatsapp:qr', ({ qr }) => console.log('QR:', qr))
```

## 6. Enviar mensagem de teste

```bash
curl -X POST http://localhost:3001/api/whatsapp/send/text \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "instance_id": "INSTANCE_ID",
    "to": "5511999999999@s.whatsapp.net",
    "text": "Olá! Teste do SaaS 🚀"
  }'
```

## 7. Receber mensagens

- Envie uma mensagem para o número conectado
- A mensagem aparecerá no Inbox (`http://localhost:3000/inbox`)
- Via WebSocket: `socket.on('whatsapp:message', (data) => ...)`

## 8. Testar fluxo completo

1. ✅ Registrar empresa
2. ✅ Login
3. ✅ Criar instância WhatsApp
4. ✅ Conectar via QR
5. ✅ Enviar mensagem
6. ✅ Receber mensagem
7. ✅ Assumir conversa no Inbox
8. ✅ Marcar como resolvida
9. ✅ Desconectar / Reconectar

## 9. Desenvolvimento sem Docker

```bash
# Terminal 1: Postgres
docker run -d --name pg -p 5432:5432 -e POSTGRES_USER=whatsapp_saas -e POSTGRES_PASSWORD=supersecret -e POSTGRES_DB=whatsapp_saas postgres:16

# Terminal 2: Redis
docker run -d --name redis -p 6379:6379 redis:7

# Terminal 3: Backend
cd backend && npm install && npm run dev

# Terminal 4: Frontend
cd frontend && npm install && npm run dev
```

## 10. Pontos de Evolução

- [ ] **Planos e billing**: Stripe integration, limites por plano
- [ ] **Multi-instância avançado**: load balancing entre instâncias
- [ ] **Webhooks**: notificar sistemas externos
- [ ] **API pública**: com API keys e rate limit
- [ ] **Dashboard analytics**: métricas de atendimento, tempo médio, etc.
- [ ] **Chatbot builder**: fluxos visuais (drag & drop)
- [ ] **Integração CRM**: Pipedrive, HubSpot, etc.
- [ ] **Grupos WhatsApp**: suporte a grupos
- [ ] **Templates**: mensagens pré-aprovadas
- [ ] **Escala horizontal**: separar WhatsApp Manager em microserviço
- [ ] **Backup de mídia**: S3/MinIO para arquivos recebidos
- [ ] **Logs e observabilidade**: Grafana + Prometheus
- [ ] **Testes automatizados**: Jest + Supertest
- [ ] **CI/CD**: GitHub Actions pipeline
