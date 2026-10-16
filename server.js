const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.MOA_DATA_DIR || path.join(ROOT, 'data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LEGACY_NOTES_FILE = process.env.MOA_LEGACY_NOTES_FILE || path.join(ROOT, 'data', 'notes.json');
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const PUBLIC_FILES = new Set(['index.html', 'styles.css', 'app.js', 'icon.svg']);
const usersById = new Map();
const sessions = new Map();
const failedLogins = new Map();
let legacyNotes = [];
let writeQueue = Promise.resolve();

async function loadData() {
  try {
    const data = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    if (Array.isArray(data)) for (const user of data) if (user && typeof user.id === 'string') usersById.set(user.id, user);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read account database: ${error.message}`);
  }
  try {
    const data = JSON.parse(await fs.readFile(LEGACY_NOTES_FILE, 'utf8'));
    const checked = validateNotes(data);
    if (checked) legacyNotes = checked;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read existing notes for account migration:', error.message);
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('요청이 너무 큽니다.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || 'null')); }
      catch { reject(Object.assign(new Error('요청 형식이 올바르지 않습니다.'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function validateNotes(value) {
  if (!Array.isArray(value) || value.length > 10000) return null;
  const safe = [];
  for (const note of value) {
    if (!note || typeof note !== 'object' || typeof note.id !== 'string' || !note.id || note.id.length > 100) return null;
    if (typeof note.title !== 'string' || typeof note.body !== 'string') return null;
    if (note.title.length > 120 || note.body.length > 200000) return null;
    const createdAt = Date.parse(note.createdAt);
    const updatedAt = Date.parse(note.updatedAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
    safe.push({ id: note.id, title: note.title, body: note.body, createdAt: new Date(createdAt).toISOString(), updatedAt: new Date(updatedAt).toISOString(), favorite: note.favorite === true });
  }
  return safe;
}

function saveUsers(nextUsersOrUpdate) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const currentUsers = [...usersById.values()];
    const nextUsers = typeof nextUsersOrUpdate === 'function' ? nextUsersOrUpdate(currentUsers) : nextUsersOrUpdate;
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporaryFile = `${USERS_FILE}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(nextUsers, null, 2), 'utf8');
    await fs.rename(temporaryFile, USERS_FILE);
    usersById.clear();
    for (const user of nextUsers) usersById.set(user.id, user);
  });
  return writeQueue;
}

function getCookie(request, name) {
  const cookies = request.headers.cookie || '';
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function getSessionUser(request) {
  const token = getCookie(request, 'moa_session');
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  return usersById.get(session.userId) || null;
}

function setSessionCookie(response, token, secure) {
  response.setHeader('Set-Cookie', `moa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(response, secure) {
  response.setHeader('Set-Cookie', `moa_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}

function originIsAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const protocol = request.socket.encrypted ? 'https:' : 'http:';
    return parsed.host === request.headers.host && parsed.protocol === protocol;
  } catch { return false; }
}

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

function normalizeUsername(username) {
  return username.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
}

function publicUser(user) { return { id: user.id, username: user.username }; }

function issueSession(response, user, secure) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 });
  setSessionCookie(response, token, secure);
}

function loginRateLimitKey(request, username) { return `${request.socket.remoteAddress || 'unknown'}:${username}`; }

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

async function serveStatic(response, pathname) {
  let requestedPath;
  try { requestedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) && filePath !== ROOT) { response.writeHead(403).end('Forbidden'); return; }
  const publicPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (!PUBLIC_FILES.has(publicPath)) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    const data = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    response.end(data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); }
}

const server = http.createServer(async (request, response) => {
  let pathname;
  try { pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname; }
  catch { sendJson(response, 400, { error: '주소가 올바르지 않습니다.' }); return; }
  const secure = Boolean(request.socket.encrypted);

  if (request.method !== 'GET' && request.method !== 'HEAD' && !originIsAllowed(request)) {
    sendJson(response, 403, { error: '요청 출처가 올바르지 않습니다.' }); return;
  }

  if (pathname === '/api/auth/me' && request.method === 'GET') {
    const user = getSessionUser(request);
    if (!user && getCookie(request, 'moa_session')) clearSessionCookie(response, secure);
    sendJson(response, 200, { user: user ? publicUser(user) : null });
    return;
  }

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    try {
      const input = await readJson(request);
      const username = typeof input?.username === 'string' ? input.username.trim() : '';
      const normalized = normalizeUsername(username);
      const password = typeof input?.password === 'string' ? input.password : '';
      if ([...username].length < 3 || [...username].length > 32 || !/^[\p{L}\p{N}._-]+$/u.test(username)) {
        sendJson(response, 400, { error: '아이디는 3~32자의 한글, 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있어요.' }); return;
      }
      if (password.length < 8 || password.length > 128) { sendJson(response, 400, { error: '비밀번호는 8~128자로 입력해 주세요.' }); return; }
      if ([...usersById.values()].some((user) => user.normalizedUsername === normalized)) { sendJson(response, 409, { error: '이미 사용 중인 아이디예요.' }); return; }
      const salt = crypto.randomBytes(16).toString('hex');
      const user = { id: crypto.randomUUID(), username, normalizedUsername: normalized, salt, passwordHash: await hashPassword(password, salt), notes: [] };
      await saveUsers((currentUsers) => {
        if (currentUsers.some((entry) => entry.normalizedUsername === normalized)) throw Object.assign(new Error('이미 사용 중인 아이디예요.'), { statusCode: 409 });
        user.notes = currentUsers.length === 0 ? legacyNotes : [];
        return [...currentUsers, user];
      });
      issueSession(response, user, secure);
      sendJson(response, 201, { user: publicUser(user) });
    } catch (error) { sendJson(response, error.statusCode || 500, { error: error.message || '계정을 만들지 못했어요.' }); }
    return;
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    try {
      const input = await readJson(request);
      const normalized = typeof input?.username === 'string' ? normalizeUsername(input.username) : '';
      const password = typeof input?.password === 'string' ? input.password : '';
      const key = loginRateLimitKey(request, normalized);
      const attempts = failedLogins.get(key);
      if (attempts?.blockedUntil > Date.now()) { sendJson(response, 429, { error: '로그인 시도가 많아요. 잠시 후 다시 시도해 주세요.' }); return; }
      const user = [...usersById.values()].find((candidate) => candidate.normalizedUsername === normalized);
      const passwordHash = await hashPassword(password, user?.salt || 'moa-unknown-account-salt');
      const expectedHash = Buffer.from(user?.passwordHash || '0'.repeat(128), 'hex');
      const actualHash = Buffer.from(passwordHash, 'hex');
      const valid = Boolean(user && expectedHash.length === actualHash.length && crypto.timingSafeEqual(actualHash, expectedHash));
      if (!valid) {
        const failed = attempts && (!attempts.blockedUntil || attempts.blockedUntil > Date.now()) ? attempts.count : 0;
        const count = failed + 1;
        failedLogins.set(key, { count, blockedUntil: count >= 10 ? Date.now() + 15 * 60 * 1000 : 0 });
        sendJson(response, 401, { error: '아이디 또는 비밀번호를 확인해 주세요.' }); return;
      }
      failedLogins.delete(key);
      issueSession(response, user, secure);
      sendJson(response, 200, { user: publicUser(user) });
    } catch (error) { sendJson(response, error.statusCode || 500, { error: error.message || '로그인하지 못했어요.' }); }
    return;
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    const token = getCookie(request, 'moa_session');
    sessions.delete(token);
    clearSessionCookie(response, secure);
    sendJson(response, 200, { loggedOut: true });
    return;
  }

  if (pathname.startsWith('/api/notes')) {
    const user = getSessionUser(request);
    if (!user) { clearSessionCookie(response, secure); sendJson(response, 401, { error: '로그인이 필요합니다.' }); return; }

    if (pathname === '/api/notes' && request.method === 'GET') { sendJson(response, 200, user.notes || []); return; }

    if (pathname === '/api/notes/import' && request.method === 'POST') {
      try {
        const imported = validateNotes(await readJson(request));
        if (!imported) { sendJson(response, 400, { error: '노트 데이터가 올바르지 않습니다.' }); return; }
        if ((user.notes || []).length === 0 && imported.length > 0) {
          const nextUsers = [...usersById.values()].map((entry) => entry.id === user.id ? { ...entry, notes: imported } : entry);
          await saveUsers(nextUsers);
        }
        sendJson(response, 200, usersById.get(user.id).notes || []);
      } catch (error) { sendJson(response, error.statusCode || 500, { error: error.message || '노트를 가져오지 못했어요.' }); }
      return;
    }

    if (pathname === '/api/notes' && request.method === 'PUT') {
      try {
        const nextNotes = validateNotes(await readJson(request));
        if (!nextNotes) { sendJson(response, 400, { error: '노트 데이터가 올바르지 않습니다.' }); return; }
        const nextUsers = [...usersById.values()].map((entry) => entry.id === user.id ? { ...entry, notes: nextNotes } : entry);
        await saveUsers(nextUsers);
        sendJson(response, 200, { saved: true });
      } catch (error) { sendJson(response, error.statusCode || 500, { error: error.message || '노트를 저장하지 못했어요.' }); }
      return;
    }
    sendJson(response, 404, { error: '요청한 API를 찾을 수 없습니다.' });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  await serveStatic(response, pathname);
});

loadData().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`모아 is running at http://localhost:${PORT}`);
    const addresses = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === 'IPv4' && !entry.internal);
    for (const address of addresses) console.log(`Other devices on this Wi-Fi: http://${address.address}:${PORT}`);
  });
}).catch((error) => { console.error('Could not start 모아:', error); process.exitCode = 1; });

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
