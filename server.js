const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sendJSON(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function publicPapers(db) {
  return [...db.seedPapers, ...db.userPapers.filter((p) => p.status === 'approved')];
}

function calcStats(db) {
  const papers = publicPapers(db);
  const authors = new Set(papers.flatMap((p) => p.authors.split(',').map((a) => a.trim()).filter(Boolean)));
  const fields = new Set(papers.map((p) => p.category));
  const views = papers.reduce((sum, p) => sum + (p.views || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayUploads = db.userPapers.filter((p) => p.submittedAtISO === today).length + 128;
  const byYear = papers.reduce((acc, p) => {
    const y = String(p.year);
    acc[y] = (acc[y] || 0) + 1;
    return acc;
  }, {});

  return {
    total: papers.length,
    authors: authors.size,
    fields: fields.size,
    views,
    todayUploads,
    pending: db.userPapers.filter((p) => p.status === 'pending').length,
    byYear,
  };
}

function serveStatic(reqPath, res) {
  let pathname = reqPath === '/' ? '/index.html' : reqPath;
  pathname = path.normalize(pathname).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJSON(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/papers/public') {
      const db = readDB();
      return sendJSON(res, 200, publicPapers(db));
    }

    if (req.method === 'GET' && pathname === '/api/papers/moderation') {
      const db = readDB();
      const status = searchParams.get('status');
      if (!status) return sendJSON(res, 200, db.userPapers);
      return sendJSON(res, 200, db.userPapers.filter((p) => p.status === status));
    }

    if (req.method === 'POST' && pathname === '/api/papers') {
      const body = await readBody(req);
      const db = readDB();
      const { title, authors, category, abstract, year, affiliation, journal, keywords, userEmail } = body;
      if (!title || !authors || !category || !abstract || !userEmail) {
        return sendJSON(res, 400, { error: 'missing_required_fields' });
      }

      const paper = {
        id: Date.now(),
        type: 'community',
        status: 'pending',
        submittedAt: new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        submittedAtISO: new Date().toISOString().slice(0, 10),
        year: Number(year) || 2026,
        title,
        authors,
        category,
        abstract,
        affiliation: affiliation || '',
        journal: journal || 'Препринт',
        doi: `10.5555/scholaris.${Date.now()}`,
        keywords: keywords || '',
        views: 0,
        downloads: 0,
        citations: 0,
        tags: (keywords || '').split(',').slice(0, 3).map((x) => x.trim()).filter(Boolean),
        submittedBy: userEmail,
      };

      db.userPapers.unshift(paper);
      writeDB(db);
      return sendJSON(res, 201, paper);
    }

    if (req.method === 'PATCH' && /^\/api\/papers\/\d+\/status$/.test(pathname)) {
      const id = Number(pathname.split('/')[3]);
      const body = await readBody(req);
      const { status } = body;
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return sendJSON(res, 400, { error: 'invalid_status' });
      }

      const db = readDB();
      const idx = db.userPapers.findIndex((p) => p.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'paper_not_found' });
      db.userPapers[idx].status = status;
      db.userPapers[idx].type = 'community';
      writeDB(db);
      return sendJSON(res, 200, db.userPapers[idx]);
    }

    if (req.method === 'GET' && pathname === '/api/stats') {
      const db = readDB();
      return sendJSON(res, 200, calcStats(db));
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await readBody(req);
      const { name, email, password } = body;
      if (!name || !email || !password || String(password).length < 6) {
        return sendJSON(res, 400, { error: 'invalid_payload' });
      }
      const db = readDB();
      const normalized = String(email).toLowerCase();
      if (db.users.some((u) => u.email === normalized)) {
        return sendJSON(res, 409, { error: 'email_exists' });
      }
      const user = { id: Date.now(), name, email: normalized, password, provider: 'local' };
      db.users.push(user);
      writeDB(db);
      return sendJSON(res, 201, { name: user.name, email: user.email, provider: user.provider });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const email = String(body.email || '').toLowerCase();
      const password = body.password;
      const db = readDB();
      const user = db.users.find((u) => u.email === email && u.password === password);
      if (!user) return sendJSON(res, 401, { error: 'invalid_credentials' });
      return sendJSON(res, 200, { name: user.name, email: user.email, provider: user.provider });
    }

    if (req.method === 'POST' && pathname === '/api/auth/google-demo') {
      const body = await readBody(req);
      const email = String(body.email || '').toLowerCase();
      if (!email.endsWith('@gmail.com')) return sendJSON(res, 400, { error: 'gmail_only_demo' });
      const db = readDB();
      let user = db.users.find((u) => u.email === email);
      if (!user) {
        user = { id: Date.now(), name: email.split('@')[0], email, password: null, provider: 'google-demo' };
        db.users.push(user);
        writeDB(db);
      }
      return sendJSON(res, 200, { name: user.name, email: user.email, provider: user.provider });
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = await readBody(req);
      if (body.username === 'admin' && body.password === 'admin123') {
        return sendJSON(res, 200, { ok: true, role: 'admin' });
      }
      return sendJSON(res, 401, { error: 'invalid_admin_credentials' });
    }

    return sendJSON(res, 404, { error: 'not_found' });
  } catch (err) {
    if (err.message === 'invalid_json') return sendJSON(res, 400, { error: 'invalid_json' });
    if (err.message === 'payload_too_large') return sendJSON(res, 413, { error: 'payload_too_large' });
    console.error(err);
    return sendJSON(res, 500, { error: 'internal_error' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }

  if (serveStatic(url.pathname, res)) return;

  const fallback = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(fallback)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(fallback).pipe(res);
  }

  return sendText(res, 404, 'Not Found');
});

server.listen(PORT, () => {
  console.log(`Scholaris server running on http://localhost:${PORT}`);
});
