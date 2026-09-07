import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export type Session = { id: number; email: string; role: Role };
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Session;
    user: Session;
  }
}
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const [rows] = await db.execute<any[]>(
      "SELECT email,role,status FROM users WHERE id=? LIMIT 1",
      [req.user.id],
    );
    const current=rows[0];
    if(!current||current.status!=='ACTIVE')throw new Error('Inactive account');
    req.user.email=current.email;
    req.user.role=current.role;
  } catch {
    reply.clearCookie('vyavas_session', { path: '/' });
    return reply.code(401).send({ error: 'Authentication required' });
  }
}
export const allow =
  (...roles: Role[]) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    await requireUser(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user.role))
      return reply.code(403).send({ error: 'Insufficient permission' });
  };
