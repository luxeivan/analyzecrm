import { readFile } from 'node:fs/promises';
import { pool } from '../db.js';

let ready = false;

/** Идемпотентно создаёт всю схему БД (вызывается и ETL, и API). */
export async function ensureSchema() {
  if (ready) return;
  const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  ready = true;
}
