import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const cookieName = '__Host-screen_session';
const sessionSeconds = 3600;

function equal(left, right) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

function sign(expiry, deviceToken, password) {
  return createHmac('sha256', deviceToken)
    .update(JSON.stringify(['screen-viewer', password, expiry]))
    .digest('base64url');
}

export function hasSession(req, deviceToken, password) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(cookieName + '='));
  const match = cookie?.slice(cookieName.length + 1).match(/^(\d{10})\.([\w-]{43})$/);
  return Boolean(match && Number(match[1]) > Math.floor(Date.now() / 1000) &&
    equal(match[2], sign(match[1], deviceToken, password)));
}

async function handleSession(req, res, deviceToken, email, password) {
  if (req.headers['content-type'] !== 'application/json') return res.status(415).end();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return res.status(413).end();
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  const attributes = '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=';
  if (body?.action === 'logout') {
    res.setHeader('Set-Cookie', cookieName + '=' + attributes + '0');
    return res.status(204).end();
  }
  if (typeof body?.email !== 'string' || typeof body?.password !== 'string' ||
      !equal(body.email.trim().toLowerCase(), email) ||
      !equal(body.password, password)) return res.status(401).end();
  const expiry = String(Math.floor(Date.now() / 1000) + sessionSeconds);
  res.setHeader('Set-Cookie', cookieName + '=' + expiry + '.' +
    sign(expiry, deviceToken, password) + attributes + sessionSeconds);
  return res.status(204).end();
}

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
  if (!['GET', 'PUT', 'DELETE', 'POST'].includes(req.method)) return res.status(405).end();
  const { VIEW_EMAIL, VIEW_PASSWORD, DEVICE_TOKEN } = process.env;
  const redisUrl = process.env.REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!VIEW_EMAIL || !VIEW_PASSWORD || !DEVICE_TOKEN || DEVICE_TOKEN.length < 32) {
    return res.status(503).end();
  }

  let command = ['GET', 'screen:latest'];
  try {
    if (req.method === 'POST') {
      return await handleSession(req, res, DEVICE_TOKEN, VIEW_EMAIL.trim().toLowerCase(), VIEW_PASSWORD);
    }
    const allowed = req.method === 'GET' ? hasSession(req, DEVICE_TOKEN, VIEW_PASSWORD) :
      authorized(req, DEVICE_TOKEN);
    if (!allowed) return res.status(401).end();
    if (!redisUrl || !redisToken) return res.status(503).end();
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

    const reply = await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + redisToken, 'Content-Type': 'application/json' },
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
