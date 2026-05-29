import http from 'node:http';
import { prisma, createUserRepository } from '@notreclaim/db';
import { loadGoogleConfig } from '../src/config.js';
import { createGoogleClient } from '../src/google-client.js';
import { createTokenService } from '../src/token-service.js';

async function main(): Promise<void> {
  const config = loadGoogleConfig();
  const client = createGoogleClient({ clientId: config.clientId, clientSecret: config.clientSecret });
  const users = createUserRepository(prisma);
  const tokens = createTokenService({ client, users, encryptionKey: config.encryptionKey });

  const redirect = new URL(config.redirectUri);
  const port = Number(redirect.port || '80');

  const server = http.createServer((req, res) => {
    void (async () => {
      const reqUrl = new URL(req.url ?? '/', config.redirectUri);
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing ?code');
        return;
      }
      try {
        const user = await tokens.connectFromCode(code, config.redirectUri);
        res.writeHead(200);
        res.end(`Connected as ${user.email}. You can close this tab.`);
        console.log(`Connected user ${user.id} (${user.email}).`);
      } catch (error) {
        res.writeHead(500);
        res.end('Error connecting; check the server log.');
        console.error(error);
      } finally {
        server.close();
        await prisma.$disconnect();
      }
    })();
  });

  server.listen(port, () => {
    console.log('Open this URL in your browser to grant access:\n');
    console.log(client.getConsentUrl(config.redirectUri));
  });
}

void main();
