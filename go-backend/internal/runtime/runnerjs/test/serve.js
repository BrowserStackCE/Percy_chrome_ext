// Serves test/fixture over http://127.0.0.1:<port>/ . The runner (like the Go
// validator) only accepts http(s) start URLs, so fixtures cannot use file://.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture');

export async function serveFixtures() {
  const server = http.createServer(async (req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname) || 'index.html';
    try {
      const body = await readFile(path.join(root, name));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}
