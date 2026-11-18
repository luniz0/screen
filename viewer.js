const status = document.querySelector('#status');
const frame = document.querySelector('#frame');
const login = document.querySelector('#login');
const email = document.querySelector('#email');
const password = document.querySelector('#password');
const loginButton = login.querySelector('button');
const logout = document.querySelector('#stop');
let active;
let imageUrl;

function clearFrame() {
  frame.hidden = true;
  frame.removeAttribute('src');
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = undefined;
}

function stop() {
  active?.abort();
  active = undefined;
  clearFrame();
}

async function watch() {
  stop();
  login.hidden = true;
  logout.hidden = true;
  status.textContent = 'Bağlanıyor';
  const controller = new AbortController();
  active = controller;
  let etag;
  while (!controller.signal.aborted) {
    const started = performance.now();
    let interval = 1000 / 30;
    try {
      const response = await fetch('/api/frame', {
        headers: etag ? { 'If-None-Match': etag } : {},
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4500)])
      });
      const image = response.status === 200 ? await response.blob() : null;
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        stop();
        login.hidden = false;
        status.textContent = 'İzlemek için giriş yap.';
        return;
      }
      if (image) {
        const previous = imageUrl;
        imageUrl = URL.createObjectURL(image);
        frame.src = imageUrl;
        frame.hidden = false;
        if (previous) URL.revokeObjectURL(previous);
        etag = response.headers.get('ETag');
      } else if (response.status !== 304) {
        clearFrame();
        etag = undefined;
        interval = 600;
      }
      if ([200, 204, 304].includes(response.status)) logout.hidden = false;
      status.textContent = image || response.status === 304 ? 'JPEG yayını açık' :
        response.status === 204 ? 'Windows uygulamasından yayın başlat.' : 'Bağlantı hatası';
    } catch {
      if (controller.signal.aborted) return;
      clearFrame();
      etag = undefined;
      interval = 1000;
      status.textContent = 'Bağlantı hatası';
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, interval - (performance.now() - started))));
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

login.addEventListener('submit', async event => {
  event.preventDefault();
  loginButton.disabled = true;
  try {
    const response = await sessionRequest({ email: email.value, password: password.value });
    if (response.status === 204) void watch();
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
window.addEventListener('pageshow', () => void watch());
