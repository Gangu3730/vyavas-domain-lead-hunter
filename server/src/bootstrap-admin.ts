import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db } from './db.js';
if (!config.BOOTSTRAP_ADMIN_EMAIL || !config.BOOTSTRAP_ADMIN_PASSWORD)
  throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD');
const hash = await bcrypt.hash(config.BOOTSTRAP_ADMIN_PASSWORD, 12);
await db.execute(
  `INSERT INTO users(email,password_hash,role,status) VALUES(?,?,'SUPER_ADMIN','ACTIVE') ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),role='SUPER_ADMIN',status='ACTIVE'`,
  [config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), hash],
);
console.log('Super admin ready');
await db.end();
