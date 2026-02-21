-- ============================================================
-- WhatsApp SaaS - Migration 001: Schema Completo
-- ============================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'atendente');
CREATE TYPE instance_status AS ENUM ('disconnected', 'connecting', 'connected', 'qr_pending', 'expired');
CREATE TYPE conversation_status AS ENUM ('open', 'in_progress', 'resolved', 'archived');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_status AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');
CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location');
CREATE TYPE contact_status AS ENUM ('lead', 'cliente', 'perdido');
CREATE TYPE scheduled_message_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');
CREATE TYPE automation_type AS ENUM ('follow_up', 'welcome', 'away', 'custom');
CREATE TYPE automation_run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- ============================================================
-- TENANTS (empresas)
-- ============================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'free',
    max_instances INT DEFAULT 1,
    max_users INT DEFAULT 5,
    rate_limit_per_minute INT DEFAULT 60,
    is_active BOOLEAN DEFAULT true,
    business_hours JSONB DEFAULT '{"enabled": false, "timezone": "America/Sao_Paulo", "schedule": {}}',
    away_message TEXT DEFAULT 'Estamos fora do horário de atendimento. Retornaremos em breve!',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'atendente',
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- WHATSAPP INSTANCES (cada número conectado)
-- ============================================================
CREATE TABLE whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    status instance_status DEFAULT 'disconnected',
    is_active BOOLEAN DEFAULT true,
    last_connected_at TIMESTAMPTZ,
    last_disconnected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, instance_name)
);

CREATE INDEX idx_instances_tenant ON whatsapp_instances(tenant_id);
CREATE INDEX idx_instances_status ON whatsapp_instances(status);

-- ============================================================
-- WHATSAPP SESSIONS (credenciais criptografadas)
-- ============================================================
CREATE TABLE whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Dados da sessão Baileys criptografados (AES-256-GCM)
    creds_encrypted BYTEA,
    creds_iv BYTEA,
    creds_tag BYTEA,
    -- Keys da sessão (sender keys, pre keys, etc.)
    keys_encrypted BYTEA,
    keys_iv BYTEA,
    keys_tag BYTEA,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(instance_id)
);

CREATE INDEX idx_sessions_instance ON whatsapp_sessions(instance_id);
CREATE INDEX idx_sessions_tenant ON whatsapp_sessions(tenant_id);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    wa_id VARCHAR(50) NOT NULL, -- número WhatsApp (ex: 5511999999999@s.whatsapp.net)
    phone VARCHAR(20),
    name VARCHAR(255),
    push_name VARCHAR(255), -- nome do WhatsApp
    profile_pic_url TEXT,
    status contact_status DEFAULT 'lead',
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, wa_id)
);

CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_wa_id ON contacts(wa_id);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_status ON contacts(status);

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_tags_tenant ON tags(tenant_id);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    status conversation_status DEFAULT 'open',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    locked_at TIMESTAMPTZ,
    unread_count INT DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_to);
CREATE INDEX idx_conversations_last_msg ON conversations(last_message_at DESC);

-- ============================================================
-- CONTACT_TAGS (junction)
-- ============================================================
CREATE TABLE contact_tags (
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
);

-- ============================================================
-- CONVERSATION_TAGS (junction)
-- ============================================================
CREATE TABLE conversation_tags (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, tag_id)
);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL, -- null = msg do contato
    wa_message_id VARCHAR(255), -- ID da mensagem no WhatsApp
    direction message_direction NOT NULL,
    type message_type DEFAULT 'text',
    content TEXT,
    media_url TEXT,
    media_mime_type VARCHAR(100),
    media_filename VARCHAR(255),
    status message_status DEFAULT 'pending',
    metadata JSONB DEFAULT '{}',
    is_from_ai BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_tenant ON messages(tenant_id);
CREATE INDEX idx_messages_wa_id ON messages(wa_message_id);
CREATE INDEX idx_messages_status ON messages(status);

-- ============================================================
-- SCHEDULED_MESSAGES
-- ============================================================
CREATE TABLE scheduled_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    contact_list_ids UUID[] DEFAULT '{}', -- lista de contatos
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_url TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    status scheduled_message_status DEFAULT 'pending',
    error_message TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tenant ON scheduled_messages(tenant_id);
CREATE INDEX idx_scheduled_status ON scheduled_messages(status, scheduled_at);

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type automation_type NOT NULL,
    is_active BOOLEAN DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}',
    -- config example for follow_up:
    -- {"delay_minutes": 60, "message": "Olá, posso ajudar?", "max_attempts": 3}
    -- config example for welcome:
    -- {"message": "Bem-vindo!", "only_first_contact": true}
    -- config example for away:
    -- {"message": "Fora do horário", "use_ai": false}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automations_tenant ON automations(tenant_id);
CREATE INDEX idx_automations_type ON automations(type);

-- ============================================================
-- AUTOMATION_RUNS
-- ============================================================
CREATE TABLE automation_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    status automation_run_status DEFAULT 'pending',
    result JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    attempt INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automation_runs_automation ON automation_runs(automation_id);
CREATE INDEX idx_automation_runs_status ON automation_runs(status, next_run_at);

-- ============================================================
-- AI_SETTINGS (configuração por tenant)
-- ============================================================
CREATE TABLE ai_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT false,
    openai_api_key_encrypted BYTEA,
    openai_api_key_iv BYTEA,
    openai_api_key_tag BYTEA,
    model VARCHAR(50) DEFAULT 'gpt-4o-mini',
    max_tokens INT DEFAULT 500,
    temperature FLOAT DEFAULT 0.7,
    system_prompt TEXT DEFAULT 'Você é um assistente de atendimento. Seja educado e objetivo.',
    context_messages INT DEFAULT 10, -- últimas X mensagens como contexto
    mode VARCHAR(50) DEFAULT 'away_only', -- 'always', 'away_only', 'suggest_only'
    monthly_budget_cents INT DEFAULT 5000, -- R$ 50,00
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AI_USAGE_LOGS
-- ============================================================
CREATE TABLE ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    model VARCHAR(50),
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    estimated_cost_cents FLOAT DEFAULT 0,
    request_type VARCHAR(50), -- 'auto_reply', 'suggestion'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_tenant ON ai_usage_logs(tenant_id, created_at DESC);

-- ============================================================
-- AUDIT_LOGS
-- ============================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger em todas as tabelas com updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at'
        AND table_schema = 'public'
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_%s_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at()
        ', t, t);
    END LOOP;
END;
$$;
