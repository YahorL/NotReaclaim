import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { authCallbackQuerySchema, consentQuerySchema, registerSchema, loginSchema, setPasswordSchema, changeEmailSchema } from './schemas.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { normalizeEmail } from './auth/email.js';
import { ensureUserDefaults } from './auth/user-defaults.js';
import { signSession } from './auth/token.js';

/** 403 denials shared by password registration and the Google callback. */
const DENIAL_MESSAGES = {
  email_unverified: 'Your Google email is not verified',
  invalid_invite: 'A valid invite code is required',
  registration_closed: 'Registration is closed',
} as const;
type Denial = keyof typeof DENIAL_MESSAGES;

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  /**
   * The invite gate for a brand-new account: in invite mode the code must be consumed for this
   * email; other modes need none. Callers check `closed` (and duplicates) first, so a refused
   * signup never burns a code.
   */
  const inviteAccepted = async (inviteCode: string | undefined, email: string): Promise<boolean> => {
    if (deps.config.registrationMode !== 'invite') return true;
    return inviteCode ? deps.repos.invites.tryConsume(inviteCode, email, new Date(deps.now())) : false;
  };

  // State is a short-lived signed JWT so we can trust its purpose/userId/inviteCode on return.
  const signState = (data: Record<string, unknown>) => app.jwt.sign({ st: data }, { expiresIn: '10m' });
  const readState = (raw?: string): { purpose?: string; userId?: string; inviteCode?: string } => {
    if (!raw) return {};
    try { return (app.jwt.verify<{ st: Record<string, unknown> }>(raw).st ?? {}) as never; }
    catch { return {}; }
  };

  app.get('/auth/google', async (request) => {
    const { invite } = consentQuerySchema.parse(request.query);
    const state = signState({ purpose: 'login', ...(invite ? { inviteCode: invite } : {}) });
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri, state) };
  });

  app.get('/auth/google/link', guard, async (request) => {
    const state = signState({ purpose: 'link', userId: request.userId });
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri, state) };
  });

  app.get('/auth/google/status', guard, async (request) => {
    const user = await deps.repos.users.findById(request.userId);
    return {
      connected: user?.googleRefreshToken != null,
      brokenAt: user?.googleAuthBrokenAt?.toISOString() ?? null,
    };
  });

  app.get('/auth/google/callback', async (request, reply) => {
    const { code, state: rawState } = authCallbackQuerySchema.parse(request.query);
    const state = readState(rawState);
    const { email: googleEmail, emailVerified, googleUserId, encryptedRefreshToken } =
      await deps.google.tokens.exchangeCodeForLink(code, deps.config.googleRedirectUri);
    const email = normalizeEmail(googleEmail);
    // A fresh grant always heals a broken connection — clear the flag, and announce it only
    // when it was actually set so clients don't see a status event on every ordinary link.
    // The clear is the same conditional write the token service uses, so a concurrent refresh
    // or a second callback can't announce the recovery twice.
    const link = async (userId: string) => {
      await deps.repos.users.update(userId, {
        googleId: googleUserId,
        googleRefreshToken: encryptedRefreshToken,
      });
      if (await deps.repos.users.setGoogleAuthBroken(userId, null)) {
        deps.events.emit({ type: 'google.status', userId, broken: false });
      }
    };

    const finish = (userId: string) => {
      const token = signSession(app, userId);
      if (deps.config.webClientUrl) {
        const fragment = `token=${encodeURIComponent(token)}&userId=${encodeURIComponent(userId)}`;
        // NOTE: Fastify v4 arg order is redirect(code, url); flip to redirect(url, code) on the v5 upgrade.
        return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#${fragment}`);
      }
      return reply.send({ token, userId });
    };
    const deny = (code: Denial) => {
      if (deps.config.webClientUrl) {
        return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#error=${encodeURIComponent(code)}`);
      }
      return reply.code(403).send({ code, message: DENIAL_MESSAGES[code] });
    };

    // Authenticated linking flow.
    if (state.purpose === 'link' && state.userId) {
      await link(state.userId);
      return finish(state.userId);
    }
    // Branch 1: known google account → login.
    const byGoogle = await deps.repos.users.findByGoogleId(googleUserId);
    if (byGoogle) { await link(byGoogle.id); return finish(byGoogle.id); }
    // Beyond here we link/create from the asserted email — only trust a Google-verified one.
    if (!emailVerified) return deny('email_unverified');
    // Branch 2: known email → link.
    const byEmail = await deps.repos.users.findByEmail(email);
    if (byEmail) { await link(byEmail.id); return finish(byEmail.id); }
    // Branch 3: new email → gated registration.
    if (deps.config.registrationMode === 'closed') return deny('registration_closed');
    if (!(await inviteAccepted(state.inviteCode, email))) return deny('invalid_invite');
    const created = await deps.repos.users.create({ email });
    await link(created.id);
    await ensureUserDefaults(deps.repos.settings, created.id);
    return finish(created.id);
  });

  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const deny = (code: Denial) => reply.code(403).send({ code, message: DENIAL_MESSAGES[code] });

    if (deps.config.registrationMode === 'closed') return deny('registration_closed');
    // Check duplicate before consuming an invite, so a dup doesn't burn a code.
    if (await deps.repos.users.findByEmail(email)) {
      return reply.code(409).send({ code: 'email_taken', message: 'That email is already registered' });
    }
    if (!(await inviteAccepted(body.inviteCode, email))) return deny('invalid_invite');

    const passwordHash = await hashPassword(body.password);
    const user = await deps.repos.users.create({ email, passwordHash });
    await ensureUserDefaults(deps.repos.settings, user.id);

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
