import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { authCallbackQuerySchema, registerSchema, loginSchema, setPasswordSchema, changeEmailSchema } from './schemas.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { normalizeEmail } from './auth/email.js';
import { ensureUserDefaults } from './auth/user-defaults.js';
import { signSession } from './auth/token.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/auth/google', async () => {
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri) };
  });

  app.get('/auth/google/callback', async (request, reply) => {
    const { code } = authCallbackQuerySchema.parse(request.query);
    const user = await deps.google.tokens.connectFromCode(code, deps.config.googleRedirectUri);
    const token = signSession(app, user.id);
    if (deps.config.webClientUrl) {
      const fragment = `token=${encodeURIComponent(token)}&userId=${encodeURIComponent(user.id)}`;
      // NOTE: Fastify v4 arg order is redirect(code, url); flip to redirect(url, code) on the v5 upgrade.
      return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#${fragment}`);
    }
    return { token, userId: user.id };
  });

  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const mode = deps.config.registrationMode;

    if (mode === 'closed') {
      return reply.code(403).send({ code: 'registration_closed', message: 'Registration is closed' });
    }
    if (mode === 'invite') {
      const ok = body.inviteCode
        ? await deps.repos.invites.validate(body.inviteCode, email, new Date(deps.now()))
        : false;
      if (!ok) return reply.code(403).send({ code: 'invalid_invite', message: 'A valid invite code is required' });
    }
    if (await deps.repos.users.findByEmail(email)) {
      return reply.code(409).send({ code: 'email_taken', message: 'That email is already registered' });
    }

    const passwordHash = await hashPassword(body.password);
    const user = await deps.repos.users.create({ email, passwordHash });
    await ensureUserDefaults(deps.repos.settings, user.id);
    if (mode === 'invite' && body.inviteCode) await deps.repos.invites.consume(body.inviteCode);

    return { token: signSession(app, user.id), userId: user.id };
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const invalid = () => reply.code(401).send({ code: 'invalid_credentials', message: 'Invalid email or password' });

    const user = await deps.repos.users.findByEmail(email);
    if (!user || !user.passwordHash) return invalid();
    if (!(await verifyPassword(user.passwordHash, body.password))) return invalid();
    return { token: signSession(app, user.id), userId: user.id };
  });

  const guard = { onRequest: [app.authenticate] };

  app.post('/auth/set-password', guard, async (request, reply) => {
    const { password } = setPasswordSchema.parse(request.body);
    await deps.repos.users.update(request.userId, { passwordHash: await hashPassword(password) });
    return reply.code(204).send();
  });

  app.patch('/auth/email', guard, async (request) => {
    const { email } = changeEmailSchema.parse(request.body);
    const user = await deps.repos.users.update(request.userId, { email: normalizeEmail(email) });
    return { id: user.id, email: user.email };
  });
}
