import { hasSession } from './frame.js';

const key = 'screen:rtc:offer';
const ttl = 60;
const validId = /^[0-9a-f-]{36}$/;

async function redis(command) {
  const url = process.env.REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Redis configuration missing');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error('Redis unavailable');
  const { result, error } = await response.json();
  if (error) throw new Error('Redis command failed');
  return result;
}

export default async function rtc(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const { DEVICE_TOKEN, VIEW_PASSWORD } = process.env;
  if (!DEVICE_TOKEN || !VIEW_PASSWORD) return res.status(503).end();
  if (!hasSession(req, DEVICE_TOKEN, VIEW_PASSWORD)) return res.status(401).end();
  const id = req.query?.id;
  try {
    if (req.method === 'GET') {
      if (req.query?.config === '1') {
        const raw = process.env.RTC_ICE_SERVERS;
        return res.status(200).json(raw ? JSON.parse(raw) : [
          { urls: 'stun:stun.l.google.com:19302' }
        ]);
      }
      if (id !== undefined && (typeof id !== 'string' || !validId.test(id))) {
        return res.status(400).end();
      }
      const result = await redis(['GET', id ? 'screen:rtc:answer:' + id : key]);
      return result ? res.status(200).json(JSON.parse(result)) : res.status(204).end();
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (req.headers['content-type'] !== 'application/json') return res.status(415).end();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { id: sessionId, type, sdp } = body ?? {};
    if (typeof sessionId !== 'string' || !validId.test(sessionId) ||
        !['offer', 'answer'].includes(type) || typeof sdp !== 'string' ||
        !sdp.startsWith('v=0') || sdp.length > 65536) return res.status(400).end();
    await redis(['SET', type === 'offer' ? key : 'screen:rtc:answer:' + sessionId,
      JSON.stringify({ id: sessionId, type, sdp }), 'EX', ttl]);
    return res.status(204).end();
  } catch {
    return res.status(503).end();
  }
}
