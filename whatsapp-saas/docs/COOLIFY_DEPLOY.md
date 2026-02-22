# Deploy no Coolify (VPS)

## Pré-requisitos
- VPS com Coolify instalado e funcionando
- Domínio configurado (ex: `app.seudominio.com` para frontend, `api.seudominio.com` para backend)
- DNS apontando para o IP da VPS

---

## Passo a Passo

### 1. Subir o repositório para Git

O Coolify puxa o código de um repositório Git (GitHub, GitLab, Gitea, etc.).

```bash
# Na raiz do projeto whatsapp-saas/
git init
git add .
git commit -m "initial commit"
git remote add origin <seu-repo-url>
git push -u origin main
```

### 2. Configurar no Coolify

#### Opção A: Docker Compose (Recomendado)

1. No painel do Coolify, vá em **Projects → New → Docker Compose**
2. Conecte seu repositório Git
3. Defina o **Base Directory** como `/whatsapp-saas` (se o compose estiver dentro dessa pasta)
4. O Coolify detectará o `docker-compose.yml` automaticamente

#### Opção B: Serviços individuais

Se preferir mais controle, crie cada serviço separadamente:

1. **Postgres**: Use o recurso built-in do Coolify (Database → PostgreSQL)
2. **Redis**: Use o recurso built-in do Coolify (Database → Redis)  
3. **Backend**: Docker → apontar para `whatsapp-saas/backend/Dockerfile`
4. **Worker**: Docker → mesmo Dockerfile, override command: `node dist/jobs/worker.js`
5. **Frontend**: Docker → apontar para `whatsapp-saas/frontend/Dockerfile`

### 3. Variáveis de Ambiente

No Coolify, vá em **Environment Variables** do projeto e configure:

```env
# ---- Postgres ----
DB_USER=whatsapp_saas
DB_PASSWORD=GERE_UMA_SENHA_FORTE_AQUI
DB_NAME=whatsapp_saas
DATABASE_URL=postgresql://whatsapp_saas:SUA_SENHA@postgres:5432/whatsapp_saas

# ---- Redis ----
REDIS_URL=redis://redis:6379

# ---- Backend ----
PORT=3001
NODE_ENV=production
JWT_SECRET=GERE_UM_SECRET_FORTE
JWT_EXPIRES_IN=7d

# ---- Criptografia ----
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_ENCRYPTION_KEY=GERE_UMA_CHAVE_DE_64_CHARS_HEX

# ---- CORS ----
CORS_ORIGIN=https://app.seudominio.com

# ---- URLs públicas (frontend) ----
PUBLIC_API_URL=https://api.seudominio.com
PUBLIC_WS_URL=https://api.seudominio.com

# ---- Portas expostas ----
BACKEND_PORT=3001
FRONTEND_PORT=3000
```

### 4. Domínios e Proxy Reverso

No Coolify, configure os domínios para cada serviço:

| Serviço   | Domínio                    | Porta interna |
|-----------|----------------------------|---------------|
| frontend  | `app.seudominio.com`       | 3000          |
| backend   | `api.seudominio.com`       | 3001          |

O Coolify gerencia SSL automaticamente via Let's Encrypt.

**Importante para WebSocket:** No Coolify, certifique-se de que o proxy do backend suporta WebSocket:
- Vá nas configurações do serviço backend
- Ative **WebSocket Support** (ou adicione headers de upgrade no proxy)

### 5. Volumes Persistentes

O Coolify gerencia volumes Docker automaticamente. Verifique que estes volumes estão criados:
- `pgdata` → dados do Postgres
- `redisdata` → dados do Redis
- `whatsapp_sessions` → sessões WhatsApp

### 6. Deploy

1. Clique em **Deploy** no Coolify
2. Acompanhe os logs de build
3. Após subir, acesse `https://app.seudominio.com`

---

## Verificação Pós-Deploy

```bash
# Health check do backend
curl https://api.seudominio.com/health

# Deve retornar:
# {"status":"ok","uptime":...}
```

## Troubleshooting

### Build falha no frontend
- Verifique se as variáveis `NEXT_PUBLIC_*` estão como **build-time** args no Coolify

### WebSocket não conecta
- Confirme que o proxy está com WebSocket habilitado
- No Coolify: Settings do serviço → Proxy → Enable WebSocket
- Verifique que `CORS_ORIGIN` bate com o domínio do frontend

### Sessão WhatsApp cai após redeploy
- O volume `whatsapp_sessions` deve ser persistente
- No Coolify, marque o volume como **Persistent** (não efêmero)
- As credenciais também ficam no Postgres, então mesmo sem o volume, ao reiniciar ele tenta restaurar

### Postgres não inicia
- Verifique se a porta 5432 não está em uso por outro serviço na VPS
- Se usar o Postgres built-in do Coolify, ajuste `DATABASE_URL` para o host correto

---

## Segurança em Produção

- [ ] Troque TODOS os secrets (JWT_SECRET, SESSION_ENCRYPTION_KEY, DB_PASSWORD)
- [ ] Use senhas com pelo menos 32 caracteres aleatórios
- [ ] Não exponha Postgres/Redis externamente (sem ports no compose = seguro)
- [ ] Ative firewall na VPS (apenas 80, 443, 22)
- [ ] Configure backups automáticos do Postgres no Coolify
- [ ] Monitore logs via Coolify dashboard
