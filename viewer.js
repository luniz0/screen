const status = document.querySelector('#status');
const frame = document.querySelector('#frame');
const stopButton = document.querySelector('#stop');
const storageKey = 'screen-share-viewer';
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
  stopButton.disabled = true;
  status.textContent = 'Bağlantı kapalı';
}

async function connect(key) {
  stop();
  const controller = new AbortController();
  session = controller;
  stopButton.disabled = false;
  status.textContent = 'Bağlanıyor';
  while (!controller.signal.aborted) {
    try {
      const response = await fetch('/api/frame', {
        headers: { Authorization: 'Bearer ' + key },
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4500)])
      });
      const image = response.status === 200 ? await response.blob() : null;
      if (controller.signal.aborted) break;
      if (response.status === 401) {
        stop();
        sessionStorage.removeItem(storageKey);
        status.textContent = 'Davet bağlantısı geçersiz';
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

function connectFromInvitation() {
  if (location.protocol !== 'https:') {
    status.textContent = 'İzleme sayfasını Vercel HTTPS adresinden aç.';
    return;
  }
  const invitation = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invitation !== null) {
    history.replaceState(null, '', location.pathname + location.search);
    sessionStorage.setItem(storageKey, invitation);
  }
  const key = sessionStorage.getItem(storageKey);
  if (key) void connect(key);
  else status.textContent = 'İzlemek için özel davet bağlantısını aç.';
}

stopButton.addEventListener('click', () => {
  sessionStorage.removeItem(storageKey);
  stop();
});
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', connectFromInvitation);
