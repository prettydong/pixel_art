import { Agent, createServer, request } from 'node:http';

// Keep the existing browser address while the backend serves the production build.
// Stream responses directly so downloads and agent event streams remain incremental.
const host = process.env.PIXEL_FRONTEND_HOST ?? '0.0.0.0';
const port = Number(process.env.PIXEL_FRONTEND_PORT ?? 5173);
const target = new URL(process.env.PIXEL_BACKEND_URL ?? 'http://127.0.0.1:3000');
if (!Number.isInteger(port) || port < 1 || port > 65535 || target.protocol !== 'http:') {
  throw new Error('Invalid frontend port or backend HTTP URL');
}
const agent = new Agent({ keepAlive: true });
const server = createServer((incoming, outgoing) => {
  const upstream = request({
    hostname: target.hostname, port: target.port || 80,
    path: incoming.url, method: incoming.method, headers: incoming.headers, agent,
  }, response => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.on('error', () => outgoing.destroy());
    response.pipe(outgoing);
  });
  upstream.on('error', () => {
    if (outgoing.headersSent) outgoing.destroy();
    else { outgoing.writeHead(502, { 'Cache-Control': 'no-store' }); outgoing.end(); }
  });
  incoming.on('error', () => upstream.destroy());
  incoming.on('aborted', () => upstream.destroy());
  outgoing.on('close', () => upstream.destroy());
  incoming.pipe(upstream);
});
const shutdown = () => server.close(() => agent.destroy());
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
server.listen(port, host, () => console.log(`Production frontend listening on ${host}:${port}`));
