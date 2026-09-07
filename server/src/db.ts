import mysql from 'mysql2/promise';
import { config } from './config.js';
export const db = mysql.createPool({
  host: config.MYSQL_HOST,
  port: config.MYSQL_PORT,
  database: config.MYSQL_DATABASE,
  user: config.MYSQL_USER,
  password: config.MYSQL_PASSWORD,
  charset: 'utf8mb4_unicode_ci',
  connectionLimit: 12,
  timezone: 'Z',
  decimalNumbers: true,
});
export async function audit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: unknown,
  ip?: string,
) {
  await db.execute(
    'INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata,ip_address) VALUES(?,?,?,?,?,?)',
    [
      userId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata ?? {}),
      ip ?? null,
    ],
  );
}
