import { readJson, sendJson } from '../http.js';

export async function handleRealtimeRoutes(req, res, url, ctx) {
  const {
    vapidPublic,
    pushSubscriptions,
    notifications,
    sseClients,
    isAuthenticated,
    passwordRequired,
  } = ctx;

  // --- VAPID public key ---
  if (req.method === 'GET' && url.pathname === '/api/push/vapid-key') {
    sendJson(res, 200, { key: vapidPublic || null });
    return true;
  }

  // --- Push subscription ---
  if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
    try {
      const sub = await readJson(req);
      if (sub?.endpoint) {
        pushSubscriptions.set(sub.endpoint, sub);
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 400, { error: 'Missing endpoint' });
      }
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON' });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
    try {
      const { endpoint } = await readJson(req);
      pushSubscriptions.delete(endpoint);
    } catch {}
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Notifications API ---
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    sendJson(res, 200, notifications);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') {
    for (const notification of notifications) notification.read = true;
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3];
    const notification = notifications.find(item => item.id === id);
    if (notification) notification.read = true;
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- SSE endpoint ---
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return true;
  }

  // --- Auth status ---
  if (req.method === 'GET' && url.pathname === '/api/auth') {
    sendJson(res, 200, { authenticated: isAuthenticated(req), passwordRequired });
    return true;
  }

  return false;
}
