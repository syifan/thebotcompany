import { readJson, sendJson } from '../http.js';

export async function handleKeyRoutes(req, res, url, ctx) {
  const {
    requireWrite,
    allowCustomProvider,
    getKeyPoolSafe,
    addKey,
    addOAuthKey,
    updateKey,
    removeKey,
    reorderKeys,
  } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/keys') {
    sendJson(res, 200, { ...getKeyPoolSafe(), allowCustomProvider });
    return true;
  }

  const keyGetMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (req.method === 'GET' && keyGetMatch) {
    if (!requireWrite(req, res)) return true;
    const key = getKeyPoolSafe().keys.find(item => item.id === keyGetMatch[1]);
    if (!key) {
      sendJson(res, 404, { error: 'Key not found' });
      return true;
    }
    sendJson(res, 200, { key });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/keys') {
    if (!requireWrite(req, res)) return true;
    try {
      const { label, token, provider, type, authFile, customConfig } = await readJson(req);
      if (provider === 'custom' && !allowCustomProvider) {
        sendJson(res, 403, { error: 'Custom provider is disabled on this instance (set TBC_ALLOW_CUSTOM_PROVIDER=true to enable)' });
        return true;
      }
      if (type === 'oauth' && authFile) {
        addOAuthKey({ label, provider, authFile });
      } else if (token) {
        addKey({ label, token, provider, type, customConfig });
      } else {
        sendJson(res, 400, { error: 'Token is required (or authFile for OAuth)' });
        return true;
      }
      sendJson(res, 200, getKeyPoolSafe());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const keysPutMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (req.method === 'PUT' && keysPutMatch) {
    if (!requireWrite(req, res)) return true;
    try {
      const patch = await readJson(req);
      if (patch.customConfig && !allowCustomProvider) {
        sendJson(res, 403, { error: 'Custom provider is disabled on this instance' });
        return true;
      }
      const updated = updateKey(keysPutMatch[1], patch);
      if (!updated) {
        sendJson(res, 404, { error: 'Key not found' });
        return true;
      }
      sendJson(res, 200, getKeyPoolSafe());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const keysDeleteMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (req.method === 'DELETE' && keysDeleteMatch) {
    if (!requireWrite(req, res)) return true;
    removeKey(keysDeleteMatch[1]);
    sendJson(res, 200, getKeyPoolSafe());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/keys/reorder') {
    if (!requireWrite(req, res)) return true;
    try {
      const { orderedIds } = await readJson(req);
      reorderKeys(orderedIds);
      sendJson(res, 200, getKeyPoolSafe());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
