import crypto from 'node:crypto';
import { query } from './db.js';

/**
 * Аутентификация: JWT (HS256) + пользователи в БД + системный админ из ENV.
 *
 * ENV:
 *   AUTH_ADMIN_LOGIN     — логин системного админа (по умолчанию admin)
 *   AUTH_ADMIN_PASSWORD  — пароль системного админа; если пусто — авторизация выключена
 *   AUTH_JWT_SECRET      — секрет подписи токенов (обязателен при включённой авторизации)
 *   AUTH_TOKEN_TTL_H     — срок жизни токена в часах (по умолчанию 24)
 */

const adminLogin = process.env.AUTH_ADMIN_LOGIN || 'admin';
const adminPassword = process.env.AUTH_ADMIN_PASSWORD || '';
const jwtSecret = process.env.AUTH_JWT_SECRET || '';
const tokenTtlH = Number(process.env.AUTH_TOKEN_TTL_H || 24);

/** Авторизация выключена, если не задан пароль системного админа (локальная разработка). */
export const authEnabled = Boolean(adminPassword);
export const jwtConfigured = Boolean(jwtSecret);

if (authEnabled && !jwtConfigured) {
  console.warn('[auth] AUTH_JWT_SECRET не задан — токены будут недействительны после перезапуска API');
}

const activeSecret = jwtSecret || crypto.randomBytes(32).toString('hex');

const b64url = (value) => Buffer.from(value).toString('base64url');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, saltHex, keyHex] = stored.split('$');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      login: user.login,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + tokenTtlH * 3600,
    }),
  );
  const signature = crypto.createHmac('sha256', activeSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac('sha256', activeSecret).update(`${header}.${payload}`).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** Системный админ из ENV: создаём/обновляем при старте, защищён от удаления и смены роли. */
export async function ensureSystemAdmin() {
  if (!authEnabled) {
    console.warn('[auth] AUTH_ADMIN_PASSWORD не задан — авторизация выключена, доступ без логина');
    return;
  }
  const passwordHash = await hashPassword(adminPassword);
  await query(
    `INSERT INTO users (login, password_hash, name, role, is_system, active)
     VALUES ($1, $2, $3, 'admin', true, true)
     ON CONFLICT (login) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = 'admin',
           is_system = true,
           active = true,
           updated_at = now()`,
    [adminLogin, passwordHash, 'Системный администратор'],
  );
  console.log(`[auth] системный админ «${adminLogin}» готов`);
}

/** Пользователь из токена, если авторизация включена; иначе — «локальный админ». */
export function requireAuth(req, res, next) {
  if (!authEnabled) {
    req.user = { sub: 0, login: 'dev', role: 'admin', name: 'Локальный доступ' };
    return next();
  }
  // Логин и health не требуют токена.
  if (req.path === '/auth/login' || req.path === '/health') return next();

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация', code: 'AUTH_REQUIRED' });
  }
  const payload = verifyToken(header.slice('Bearer '.length));
  if (!payload) return res.status(401).json({ error: 'Токен недействителен или истёк', code: 'AUTH_INVALID' });
  req.user = payload;
  next();
}

export function requireAdmin(req, res, next) {
  if (!authEnabled) return next();
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав: действие доступно только администратору', code: 'FORBIDDEN' });
  }
  next();
}

export const systemAdminLogin = adminLogin;