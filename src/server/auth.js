export function createAuth({ password }) {
  function isAuthenticated(req) {
    if (!password) return true;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString();
      const [, pass] = decoded.split(':');
      if (pass === password) return true;
    }
    return false;
  }

  function requireWrite(req, res) {
    if (isAuthenticated(req)) return true;
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required for write operations' }));
    return false;
  }

  return { isAuthenticated, requireWrite };
}
