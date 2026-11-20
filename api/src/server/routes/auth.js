import { Router } from 'express';
import { query } from '../../db.js';
import {
  authEnabled,
  hashPassword,
  requireAdmin,
  signToken,
  systemAdminLogin,
  verifyPassword,
} from '../../auth.js';

export const authRouter = Router();

/**
 * Имя показывается в шапке панели, поэтому защищаемся от случайного ввода пароля
 * в поле «Имя»: если значение совпадает с паролем — сохраняем пустое имя.
 */
const cleanName = (rawName, password) => {
  const name = String(rawName ?? '').trim() || null;
  if (name && password && name === String(password)) return null;
  return name;
};

const publicUser = (row) => ({
  id: row.id,
  login: row.login,
  name: row.name,
  role: row.role,
  active: row.active,
  isSystem: row.is_system,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** POST /api/auth/login — вход по логину и паролю. */
authRouter.post('/auth/login', async (req, res, next) => {
  try {
    if (!authEnabled) {
      return res.status(503).json({ error: 'Авторизация выключена: задайте AUTH_ADMIN_PASSWORD в .env' });
    }
    const login = String(req.body?.login ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });

    const { rows } = await query(`SELECT * FROM users WHERE login = $1`, [login]);
    const user = rows[0];
    if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me — текущий пользователь (проверка токена при загрузке UI). */
authRouter.get('/auth/me', async (req, res, next) => {
  try {
    if (!authEnabled) {
      return res.json({ id: 0, login: 'dev', name: 'Локальный доступ', role: 'admin', active: true, isSystem: true });
    }
    const { rows } = await query(`SELECT * FROM users WHERE id = $1 AND active = true`, [req.user.sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Пользователь не найден или отключён', code: 'AUTH_INVALID' });
    res.json(publicUser(rows[0]));
  } catch (err) {
    next(err);
  }
});

/** CRUD пользователей — только администратор. */
authRouter.get('/users', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM users ORDER BY is_system DESC, login`);
    res.json({ items: rows.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const login = String(req.body?.login ?? '').trim();
    const password = String(req.body?.password ?? '');
    const name = cleanName(req.body?.name, password);
    const role = req.body?.role === 'admin' ? 'admin' : 'user';

    if (login.length < 3) return res.status(400).json({ error: 'Логин короче 3 символов' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль короче 6 символов' });

    const exists = await query(`SELECT 1 FROM users WHERE login = $1`, [login]);
    if (exists.rows.length) return res.status(409).json({ error: 'Пользователь с таким логином уже есть' });

    const { rows } = await query(
      `INSERT INTO users (login, password_hash, name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [login, await hashPassword(password), name, role],
    );
    res.status(201).json(publicUser(rows[0]));
  } catch (err) {
    next(err);
  }
});

authRouter.patch('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: found } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
    const user = found[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const updates = [];
    const values = [];

    if (req.body?.name !== undefined) {
      updates.push(`name = $${values.length + 1}`);
      values.push(cleanName(req.body.name, req.body?.password));
    }

    if (req.body?.role !== undefined) {
      const role = req.body.role === 'admin' ? 'admin' : 'user';
      if (user.is_system && role !== 'admin') {
        return res.status(400).json({ error: 'Системного админа нельзя перевести в обычные пользователи' });
      }
      if (id === Number(req.user?.sub) && role !== 'admin') {
        return res.status(400).json({ error: 'Нельзя понизить собственную роль' });
      }
      updates.push(`role = $${values.length + 1}`);
      values.push(role);
    }

    if (req.body?.active !== undefined) {
      const active = Boolean(req.body.active);
      if (user.is_system && !active) {
        return res.status(400).json({ error: 'Системного админа нельзя отключить' });
      }
      if (id === Number(req.user?.sub) && !active) {
        return res.status(400).json({ error: 'Нельзя отключить самого себя' });
      }
      updates.push(`active = $${values.length + 1}`);
      values.push(active);
    }

    if (req.body?.password) {
      const password = String(req.body.password);
      if (password.length < 6) return res.status(400).json({ error: 'Пароль короче 6 символов' });
      updates.push(`password_hash = $${values.length + 1}`);
      values.push(await hashPassword(password));
    }

    if (!updates.length) return res.status(400).json({ error: 'Нет изменений' });

    updates.push('updated_at = now()');
    const { rows } = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id],
    );
    res.json(publicUser(rows[0]));
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.is_system || user.login === systemAdminLogin) {
      return res.status(400).json({ error: 'Системного админа удалить нельзя' });
    }
    if (id === Number(req.user?.sub)) return res.status(400).json({ error: 'Нельзя удалить самого себя' });

    await query(`DELETE FROM users WHERE id = $1`, [id]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
