import { localDescription, signal } from './rtc.js';

const status = document.querySelector('#status');
const video = document.querySelector('#frame');
const login = document.querySelector('#login');
const email = document.querySelector('#email');
const password = document.querySelector('#password');
const loginButton = login.querySelector('button');
const logout = document.querySelector('#stop');
const publish = document.querySelector('#publish');
const end = document.querySelector('#end');
const publisher = new URLSearchParams(location.search).get('publish') === '1';
let active;

function stop() {
  if (active) {
    active.closed = true;
    active.peer?.close();
    active.stream?.getTracks().forEach(track => track.stop());
  }
  active = undefined;
  video.srcObject = null;
  video.hidden = true;
  end.hidden = true;
  publish.hidden = !publisher || logout.hidden;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function peerFor(session) {
  session.peer?.close();
  session.peer = new RTCPeerConnection({ iceServers: session.iceServers });
  return session.peer;
}

async function view(session) {
  let previousOffer;
  while (!session.closed) {
    const offer = await signal();
    if (session.closed) return;
    if (!offer || offer.id === previousOffer) {
      await wait(550);
      continue;
    }
    previousOffer = offer.id;
    const peer = peerFor(session);
    peer.ontrack = ({ track }) => {
      if (session.closed || session.peer !== peer) return;
      video.srcObject = new MediaStream([track]);
      video.hidden = false;
      void video.play().catch(() => {
        video.controls = true;
        status.textContent = 'Başlatmak için videoya dokun.';
      });
    };
    await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    if (session.closed) return;
    const answer = await localDescription(peer, await peer.createAnswer());
    if (session.closed) return;
    await signal('', { ...answer, id: offer.id });
    const deadline = performance.now() + 15000;
    while (!session.closed && !['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
      if (peer.connectionState === 'connected') {
        status.textContent = video.readyState >= 2 ? 'Yayın açık' : 'İlk kare bekleniyor';
      } else if (performance.now() >= deadline) {
        break;
      }
      await wait(500);
    }
    if (session.closed) return;
    peer.close();
    video.srcObject = null;
    video.hidden = true;
    status.textContent = 'Yeniden bağlanıyor';
  }
}

async function send(session, track) {
  let target = 60;
  while (!session.closed) {
    const id = crypto.randomUUID();
    const peer = peerFor(session);
    const { sender } = peer.addTransceiver(track, {
      direction: 'sendonly',
      streams: [session.stream],
      sendEncodings: [{ maxFramerate: target,
        maxBitrate: target === 60 ? 12000000 : 6500000 }]
    });
    const offer = await localDescription(peer, await peer.createOffer());
    if (session.closed) return;
    await signal('', { ...offer, id });
    status.textContent = 'İzleyici bekleniyor';
    for (let count = 0; !session.closed && count < 65; count++) {
      const answer = await signal('?id=' + id);
      if (session.closed) return;
      if (answer) {
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        break;
      }
      await wait(650);
    }
    if (session.closed) return;
    if (!peer.remoteDescription) continue;
    const initial = sender.getParameters();
    initial.degradationPreference = 'maintain-resolution';
    await sender.setParameters(initial);
    const deadline = performance.now() + 15000;
    let previous;
    let lowSamples = 0;
    let connected = false;
    while (!session.closed) {
      const state = peer.connectionState;
      if (['failed', 'closed', 'disconnected'].includes(state)) break;
      if (!connected && state !== 'connected' && performance.now() > deadline) break;
      if (state === 'connected') {
        connected = true;
        const reports = await sender.getStats();
        const outbound = [...reports.values()].find(item =>
          item.type === 'outbound-rtp' && item.kind === 'video');
        const fps = outbound && previous && outbound.timestamp > previous.timestamp
          ? (outbound.framesEncoded - previous.framesEncoded) * 1000 /
            (outbound.timestamp - previous.timestamp)
          : undefined;
        previous = outbound;
        const constrained = outbound && ['cpu', 'bandwidth'].includes(outbound.qualityLimitationReason);
        lowSamples = constrained && fps < 48 ? lowSamples + 1 : 0;
        if (target === 60 && lowSamples >= 3) {
          await track.applyConstraints({ width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } });
          const params = sender.getParameters();
          params.encodings[0].maxFramerate = 30;
          params.encodings[0].maxBitrate = 6500000;
          await sender.setParameters(params);
          target = 30;
        }
        const measured = Number.isFinite(fps) ? ' · ' + Math.round(fps) + ' FPS gönderiliyor' : '';
        status.textContent = 'Yayın açık · ' + target + ' FPS hedefi' + measured;
      }
      await wait(1000);
    }
  }
}

function sessionRequest(body) {
  return fetch('/api/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4500)
  });
}

async function start() {
  stop();
  logout.hidden = true;
  publish.hidden = true;
  status.textContent = 'Bağlanıyor';
  const session = { closed: false };
  active = session;
  try {
    session.iceServers = await signal('?config=1');
    if (session.closed) return;
    login.hidden = true;
    logout.hidden = false;
    if (publisher) {
      publish.hidden = false;
      status.textContent = 'Ekranı paylaş düğmesine basıp tarayıcıda ekranı seç.';
    } else {
      status.textContent = 'Yayın bekleniyor';
      await view(session);
    }
  } catch (error) {
    if (session.closed) return;
    stop();
    login.hidden = false;
    logout.hidden = true;
    status.textContent = error.message === 'Oturum süresi doldu.' ? 'İzlemek için giriş yap.' : error.message;
  }
}

publish.addEventListener('click', async () => {
  const session = active;
  if (!session) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    status.textContent = 'Bu tarayıcı ekran paylaşımını desteklemiyor. Sayfayı Windows’ta Chrome veya Edge ile aç.';
    return;
  }
  publish.hidden = true;
  status.textContent = 'Tarayıcıda paylaşılacak ekranı seç ve Paylaş düğmesine bas.';
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      audio: false
    });
    if (session.closed) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    session.stream = stream;
    const [track] = stream.getVideoTracks();
    track.contentHint = 'motion';
    track.addEventListener('ended', () => { if (!session.closed) void start(); });
    end.hidden = false;
    status.textContent = 'Ekran paylaşılıyor · Yayın bağlantısı hazırlanıyor';
    await send(session, track);
  } catch (error) {
    if (session.closed) return;
    await start();
    status.textContent = error.name === 'NotAllowedError'
      ? 'Ekran paylaşımı iptal edildi veya tarayıcı izin vermedi. Düğmeye basıp ekranı seç ve Paylaş’a bas.'
      : 'Yayın başlatılamadı. ' + error.message;
  }
});

end.addEventListener('click', () => void start());
login.addEventListener('submit', async event => {
  event.preventDefault();
  loginButton.disabled = true;
  try {
    const response = await sessionRequest({ email: email.value, password: password.value });
    if (response.status === 204) void start();
    else status.textContent = response.status === 401 ? 'E-posta veya parola hatalı.' :
      'Giriş şu anda kullanılamıyor.';
  } catch {
    status.textContent = 'Giriş bağlantısı kurulamadı.';
  } finally {
    password.value = '';
    loginButton.disabled = false;
  }
});

logout.addEventListener('click', async () => {
  stop();
  logout.disabled = true;
  publish.hidden = true;
  try {
    const response = await sessionRequest({ action: 'logout' });
    if (response.status !== 204) throw new Error();
    logout.hidden = true;
    login.hidden = false;
    status.textContent = 'Oturum kapatıldı.';
  } catch {
    status.textContent = 'Oturum kapatılamadı. Tekrar dene.';
  } finally {
    logout.disabled = false;
  }
});
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', () => void start());
