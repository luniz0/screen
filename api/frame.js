import { timingSafeEqual } from 'node:crypto';

function authorized(req, secret) {
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from('Bearer ' + secret);
  const received = Buffer.from(req.headers.authorization || '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return res.status(405).end();
  const { VIEW_TOKEN, DEVICE_TOKEN, REDIS_REST_URL, REDIS_REST_TOKEN } = process.env;
  if (!VIEW_TOKEN || !DEVICE_TOKEN || VIEW_TOKEN === DEVICE_TOKEN ||
      !REDIS_REST_URL || !REDIS_REST_TOKEN) return res.status(503).end();
  if (!authorized(req, req.method === 'GET' ? VIEW_TOKEN : DEVICE_TOKEN)) {
    return res.status(401).end();
  }

  let command = ['GET', 'screen:latest'];
  try {
    if (req.method === 'PUT') {
      if (req.headers['content-type'] !== 'image/jpeg') return res.status(415).end();
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024) return res.status(413).end();
        chunks.push(chunk);
      }
      const frame = Buffer.concat(chunks);
      if (frame.length < 4 || frame.readUInt16BE(0) !== 0xffd8 ||
          frame.readUInt16BE(frame.length - 2) !== 0xffd9) return res.status(400).end();
      command = ['SET', 'screen:latest', frame.toString('base64'), 'EX', 5];
    }
    if (req.method === 'DELETE') command = ['DEL', 'screen:latest'];

    const reply = await fetch(REDIS_REST_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + REDIS_REST_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(3000)
    });
    if (!reply.ok) return res.status(503).end();
    const { result, error } = await reply.json();
    if (error) return res.status(503).end();
    if (req.method !== 'GET' || !result) return res.status(204).end();
    res.setHeader('Content-Type', 'image/jpeg');
    return res.status(200).end(Buffer.from(result, 'base64'));
  } catch {
    return res.status(503).end();
  }
}
