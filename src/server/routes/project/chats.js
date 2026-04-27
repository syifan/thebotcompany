import fs from 'fs';
import path from 'path';
import { sendJson, readJson } from '../../http.js';
import {
  listSessions as chatListSessions,
  createSession as chatCreateSession,
  getSession as chatGetSession,
  deleteSession as chatDeleteSession,
  updateSessionPreferences as chatUpdateSessionPreferences,
  streamChatMessage,
  getActiveStream,
  saveMessage as chatSaveMessage,
} from '../../../chat.js';
import { getKeyPoolSafe, resolveKeyForProject, markRateLimited } from '../../../key-pool.js';

export async function handleProjectChatRoutes(req, res, url, ctx) {
  const {
    runner,
    projectId,
    subPath,
    requireWrite,
    getOAuthAccessToken,
    parseExplicitModelSelection,
    detectProviderFromToken,
    getProviderRuntimeSelection,
    parseSummarizeCooldown,
    formatStoredChatErrorMessage,
    log,
  } = ctx;

  if (req.method === 'GET' && subPath === 'chats') {
    try {
      sendJson(res, 200, { sessions: chatListSessions(runner.chatsDir) });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && subPath === 'chats') {
    if (!requireWrite(req, res)) return true;
    try {
      const data = await readJson(req) || {};
      const session = chatCreateSession(runner.chatsDir, data.title, {
        selectedKeyId: typeof data.selectedKeyId === 'string' ? data.selectedKeyId : null,
        selectedModel: typeof data.selectedModel === 'string' ? data.selectedModel : null,
      });
      sendJson(res, 201, { session });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const chatDetailMatch = req.method === 'GET' && subPath.match(/^chats\/(\d+)$/);
  if (chatDetailMatch) {
    try {
      const chatId = parseInt(chatDetailMatch[1]);
      const session = chatGetSession(runner.chatsDir, chatId);
      if (!session) {
        sendJson(res, 404, { error: 'Session not found' });
      } else {
        const activeStream = getActiveStream(chatId);
        sendJson(res, 200, {
          session,
          streaming: !!activeStream,
          streamingContent: activeStream ? { text: activeStream.text, toolCalls: activeStream.toolCalls } : null,
        });
      }
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const chatPreferencesMatch = req.method === 'PATCH' && subPath.match(/^chats\/(\d+)\/preferences$/);
  if (chatPreferencesMatch) {
    if (!requireWrite(req, res)) return true;
    try {
      const data = await readJson(req) || {};
      const chatId = parseInt(chatPreferencesMatch[1]);
      const session = chatUpdateSessionPreferences(runner.chatsDir, chatId, {
        selectedKeyId: typeof data.selectedKeyId === 'string' && data.selectedKeyId !== 'auto' ? data.selectedKeyId : null,
        selectedModel: typeof data.selectedModel === 'string' && data.selectedModel !== 'auto' ? data.selectedModel : null,
      });
      if (!session) {
        sendJson(res, 404, { error: 'Session not found' });
        return true;
      }
      sendJson(res, 200, { session });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const chatStreamMatch = req.method === 'GET' && subPath.match(/^chats\/(\d+)\/stream$/);
  if (chatStreamMatch) {
    const chatId = parseInt(chatStreamMatch[1]);
    const activeStream = getActiveStream(chatId);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    if (!activeStream) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return true;
    }
    activeStream.clients.add(res);
    res.on('close', () => { activeStream.clients.delete(res); });
    return true;
  }

  const chatDeleteMatch = req.method === 'DELETE' && subPath.match(/^chats\/(\d+)$/);
  if (chatDeleteMatch) {
    if (!requireWrite(req, res)) return true;
    try {
      chatDeleteSession(runner.chatsDir, parseInt(chatDeleteMatch[1]));
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && subPath === 'chats/upload') {
    if (!requireWrite(req, res)) return true;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (!boundaryMatch) {
          sendJson(res, 400, { error: 'Missing multipart boundary' });
          return;
        }
        const boundary = '--' + boundaryMatch[1];
        const parts = body.toString('binary').split(boundary).filter(p => p.trim() && p.trim() !== '--');
        let filename = null;
        let fileData = null;
        let mimeType = null;

        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const headers = part.slice(0, headerEnd);
          const filenameMatch = headers.match(/filename="([^"]+)"/);
          const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
          if (filenameMatch) {
            filename = filenameMatch[1];
            mimeType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
            const dataStart = headerEnd + 4;
            const dataEnd = part.endsWith('\r\n') ? part.length - 2 : part.length;
            fileData = Buffer.from(part.slice(dataStart, dataEnd), 'binary');
          }
        }

        if (!filename || !fileData) {
          sendJson(res, 400, { error: 'No file in upload' });
          return;
        }

        const uploadsDir = runner.uploadsDir;
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const ext = path.extname(filename) || '.bin';
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        fs.writeFileSync(path.join(uploadsDir, safeName), fileData);
        sendJson(res, 200, {
          filename: safeName,
          originalName: filename,
          mimeType,
          size: fileData.length,
          url: `/api/projects/${projectId}/uploads/${safeName}`,
        });
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
    });
    return true;
  }

  const uploadMatch = req.method === 'GET' && subPath.match(/^uploads\/(.+)$/);
  if (uploadMatch) {
    const filename = uploadMatch[1];
    const filePath = path.join(runner.uploadsDir, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  const chatMessageMatch = req.method === 'POST' && subPath.match(/^chats\/(\d+)\/message$/);
  if (chatMessageMatch) {
    if (!requireWrite(req, res)) return true;
    const chatId = parseInt(chatMessageMatch[1]);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const respondChatError = (statusCode, payload) => {
        try {
          chatSaveMessage(runner.chatsDir, chatId, 'assistant', formatStoredChatErrorMessage({
            error: payload.error,
            statusCode,
            source: payload.source || 'server',
            cooldownMs: payload.cooldownMs || 0,
          }), null, { success: false });
        } catch {}
        sendJson(res, statusCode, payload);
      };
      try {
        const data = JSON.parse(body);
        if (!data.message?.trim()) {
          respondChatError(400, { error: 'Message is required', source: 'validation' });
          return;
        }

        const imageUrls = (data.images || []).map(img => `/api/projects/${projectId}/uploads/${img.filename}`);
        chatSaveMessage(runner.chatsDir, chatId, 'user', data.message.trim(), imageUrls.length > 0 ? imageUrls : null);

        const config = runner.loadConfig();
        const oauthTokenGetter = async (authFile, provider) => getOAuthAccessToken(provider, runner.id);
        const explicitKeyId = typeof data.keyId === 'string' && data.keyId.trim() ? data.keyId.trim() : null;
        const { model: explicitModel, reasoningEffort: explicitReasoningEffort } = parseExplicitModelSelection(data.model);
        if (explicitModel && !explicitKeyId) {
          respondChatError(400, { error: 'Select a key before selecting a specific model.', source: 'validation' });
          return;
        }

        const selectedKeySafe = explicitKeyId
          ? (getKeyPoolSafe().keys || []).find(key => key.id === explicitKeyId) || null
          : null;

        chatUpdateSessionPreferences(runner.chatsDir, chatId, {
          selectedKeyId: explicitKeyId,
          selectedModel: explicitModel,
        });
        if (explicitKeyId && !selectedKeySafe) {
          respondChatError(404, { error: 'Selected API key was not found.', errorType: 'key_not_found', source: 'local_selection' });
          return;
        }
        if (selectedKeySafe && !selectedKeySafe.enabled) {
          respondChatError(400, { error: 'Selected API key is disabled.', errorType: 'key_disabled', source: 'local_selection' });
          return;
        }
        if (selectedKeySafe?.rateLimited) {
          respondChatError(429, {
            error: `Selected API key is currently rate limited${selectedKeySafe.cooldownMs ? ` for about ${Math.ceil(selectedKeySafe.cooldownMs / 60_000)}m` : ''}.`,
            errorType: 'key_rate_limited',
            source: 'local_cooldown',
            cooldownMs: selectedKeySafe.cooldownMs || 0,
          });
          return;
        }

        const keyConfig = explicitKeyId
          ? { ...config, keySelection: { keyId: explicitKeyId, fallback: false } }
          : config;
        const keyResult = await resolveKeyForProject(keyConfig, null, oauthTokenGetter);
        if (!keyResult?.token) {
          respondChatError(400, { error: explicitKeyId ? 'Selected API key is unavailable.' : 'No API key configured. Add one in Settings > Credentials.', source: explicitKeyId ? 'local_selection' : 'configuration' });
          return;
        }
        if (explicitKeyId && keyResult.keyId !== explicitKeyId) {
          respondChatError(400, { error: 'Selected API key is unavailable.', errorType: 'key_unavailable', source: 'local_selection' });
          return;
        }

        const modelTier = data.modelTier || 'high';
        const providerHint = keyResult.provider || detectProviderFromToken(keyResult.token);
        const runtimeSelection = explicitModel
          ? { selectedModel: explicitModel, reasoningEffort: explicitReasoningEffort, customConfig: keyResult.customConfig || null }
          : getProviderRuntimeSelection({ provider: providerHint, modelTier, keyResult, projectModels: config.models });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const chatOpts = {
          agentDir: runner.chatsDir,
          tbcDbPath: runner.projectDbPath,
          uploadsDir: runner.uploadsDir,
          projectPath: runner.path,
          chatId,
          userMessage: data.message.trim(),
          images: data.images || [],
          model: runtimeSelection.selectedModel,
          token: keyResult.token,
          provider: providerHint,
          customConfig: runtimeSelection.customConfig || null,
          res,
          reasoningEffort: runtimeSelection.reasoningEffort || null,
        };

        try {
          await streamChatMessage(chatOpts);
        } catch (chatErr) {
          const isRateLimit = /rate.limit|usage.limit|quota|429/i.test(chatErr.message);
          if (isRateLimit && keyResult.keyId) {
            const cooldownMs = parseSummarizeCooldown(chatErr.message);
            markRateLimited(keyResult.keyId, cooldownMs);
            log(`Chat: marked key ${keyResult.keyId} rate-limited for ${Math.ceil(cooldownMs / 60_000)}m`, runner.id);

            if (explicitKeyId) {
              chatErr.errorType = 'provider_rate_limited';
              chatErr.source = 'provider_429';
              chatErr.cooldownMs = cooldownMs;
              chatErr.statusCode = 429;
              throw chatErr;
            }

            const fallbackKey = await resolveKeyForProject(config, null, oauthTokenGetter);
            if (fallbackKey?.token && fallbackKey.token !== keyResult.token) {
              const fbProvider = fallbackKey.provider || detectProviderFromToken(fallbackKey.token);
              const fallbackSelection = getProviderRuntimeSelection({ provider: fbProvider, modelTier, keyResult: fallbackKey, projectModels: null });
              log(`Chat: falling back to key ${fallbackKey.keyId} (${fbProvider}), model → ${fallbackSelection.selectedModel}`, runner.id);
              chatOpts.token = fallbackKey.token;
              chatOpts.provider = fbProvider;
              chatOpts.model = fallbackSelection.selectedModel;
              chatOpts.reasoningEffort = fallbackSelection.reasoningEffort || null;
              chatOpts.customConfig = fallbackSelection.customConfig || null;
              await streamChatMessage(chatOpts);
            } else {
              throw chatErr;
            }
          } else {
            throw chatErr;
          }
        }

        res.end();
      } catch (error) {
        const errorPayload = {
          error: error.message,
          errorType: error.errorType || null,
          source: error.source || 'server',
          statusCode: error.statusCode || 500,
          cooldownMs: error.cooldownMs || 0,
        };
        try {
          chatSaveMessage(runner.chatsDir, chatId, 'assistant', formatStoredChatErrorMessage(errorPayload), null, { success: false });
        } catch {}
        if (!res.headersSent) {
          sendJson(res, errorPayload.statusCode, errorPayload);
        } else {
          res.write(`data: ${JSON.stringify({
            type: 'error',
            content: errorPayload.error,
            errorType: errorPayload.errorType,
            source: errorPayload.source,
            statusCode: errorPayload.statusCode,
            cooldownMs: errorPayload.cooldownMs,
          })}\n\n`);
          res.end();
        }
      }
    });
    return true;
  }

  return false;
}
