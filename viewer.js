const status = document.querySelector('#status');
const frame = document.querySelector('#frame');
const stopButton = document.querySelector('#stop');
const login = document.querySelector('#login');
const email = document.querySelector('#email');
const password = document.querySelector('#password');
const loginButton = login.querySelector('button');
let session;
let imageUrl;

function clearFrame() {
  frame.hidden = true;
  frame.removeAttribute('src');
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = undefined;
}

function stop() {
  session?.abort();
  session = undefined;
  clearFrame();
  stopButton.hidden = true;
  status.textContent = 'Bağlantı kapalı';
}

async function connect() {
  stop();
  login.hidden = true;
  const controller = new AbortController();
  session = controller;
  stopButton.hidden = false;
  status.textContent = 'Bağlanıyor';
  while (!controller.signal.aborted) {
    try {
      const response = await fetch('/api/frame', {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4500)])
      });
      const image = response.status === 200 ? await response.blob() : null;
      if (controller.signal.aborted) break;
      if (response.status === 401) {
        stop();
        login.hidden = false;
        status.textContent = 'İzlemek için giriş yap.';
        break;
      }
      const previous = imageUrl;
      if (image) {
        imageUrl = URL.createObjectURL(image);
        frame.src = imageUrl;
        frame.hidden = false;
        if (previous) URL.revokeObjectURL(previous);
      } else {
        clearFrame();
      }
      status.textContent = image ? 'Yayın açık' :
        response.status === 204 ? 'Yayın bekleniyor' : 'Bağlantı hatası';
    } catch {
      if (controller.signal.aborted) break;
      clearFrame();
      status.textContent = 'Bağlantı hatası';
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

function startViewer() {
  if (location.protocol !== 'https:') {
    status.textContent = 'İzleme sayfasını Vercel HTTPS adresinden aç.';
    return;
  }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  void connect();
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
    if (response.status === 204) void connect();
    else status.textContent = response.status === 401 ? 'E-posta veya parola hatalı.' :
      'Giriş şu anda kullanılamıyor.';
  } catch {
    status.textContent = 'Giriş bağlantısı kurulamadı.';
  } finally {
    password.value = '';
    loginButton.disabled = false;
  }
});

stopButton.addEventListener('click', async () => {
  stop();
  try {
    const response = await sessionRequest({ action: 'logout' });
    if (response.status !== 204) throw new Error();
    login.hidden = false;
    status.textContent = 'Oturum kapatıldı.';
  } catch {
    stopButton.hidden = false;
    status.textContent = 'Oturum kapatılamadı. Tekrar dene.';
  }
});
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', startViewer);
