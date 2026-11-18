export async function signal(query = '', body) {
  const response = await fetch('/api/rtc' + query, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
    ...(body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    } : {})
  });
  if (response.status === 401) throw new Error('Oturum süresi doldu.');
  if (!response.ok) throw new Error('Yayın bağlantı servisine ulaşılamadı.');
  return response.status === 204 ? null : response.json();
}

export async function localDescription(peer, description) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== 'complete') {
    await new Promise(resolve => {
      function finish() {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      function check() {
        if (peer.iceGatheringState === 'complete') finish();
      }
      const timer = setTimeout(finish, 5000);
      peer.addEventListener('icegatheringstatechange', check);
      check();
    });
  }
  return peer.localDescription.toJSON();
}
