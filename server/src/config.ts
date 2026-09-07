import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().url(),
  TRUST_PROXY: z.string().default('true').transform((v) => v === 'true'),
  SCAN_CONCURRENCY: z.coerce.number().int().min(2).max(30).default(12),
  MAX_IMPORT_ROWS: z.coerce.number().int().min(1000).max(2000000).default(1000000),
  JWT_SECRET: z.string().min(32),
  MYSQL_HOST: z.string(),
  MYSQL_PORT: z.coerce.number().int().default(3306),
  MYSQL_DATABASE: z.string(),
  MYSQL_USER: z.string(),
  MYSQL_PASSWORD: z.string(),
  SMTP_PROVIDER: z.enum(['hostinger', 'gmail']).default('hostinger'),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: z.string().transform((v) => v === 'true'),
  SMTP_USER: z.string(),
  SMTP_PASSWORD: z.string(),
  SMTP_FROM_NAME: z.string().default('VYAVAS'),
  SMTP_FROM_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
});
export const config = schema.parse(process.env);
