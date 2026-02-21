import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function createAuthRoutes(db: Pool): Router {
  const router = Router();
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
  const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

  // Registrar tenant + owner
  router.post('/register', async (req: Request, res: Response) => {
    const { company_name, slug, name, email, password } = req.body;

    if (!company_name || !slug || !name || !email || !password) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const tenant = await client.query(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
        [company_name, slug]
      );
      const tenantId = tenant.rows[0].id;

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, 'owner') RETURNING id, role`,
        [tenantId, email, passwordHash, name]
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        { userId: user.rows[0].id, tenantId, role: user.rows[0].role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      res.status(201).json({ token, tenantId, userId: user.rows[0].id });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.constraint?.includes('slug')) {
        return res.status(409).json({ error: 'Slug já em uso' });
      }
      res.status(500).json({ error: 'Erro ao registrar' });
    } finally {
      client.release();
    }
  });

  // Login
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
      const result = await db.query(
        `SELECT u.id, u.tenant_id, u.password_hash, u.role, u.name, u.is_active, t.is_active as tenant_active
         FROM users u JOIN tenants t ON u.tenant_id = t.id
         WHERE u.email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      const user = result.rows[0];
      if (!user.is_active || !user.tenant_active) {
        return res.status(403).json({ error: 'Conta desativada' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

      const token = jwt.sign(
        { userId: user.id, tenantId: user.tenant_id, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      res.json({ token, user: { id: user.id, name: user.name, role: user.role, tenantId: user.tenant_id } });
    } catch (err) {
      res.status(500).json({ error: 'Erro no login' });
    }
  });

  return router;
}
