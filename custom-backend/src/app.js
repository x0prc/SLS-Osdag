const path = require('path');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { nanoid } = require('nanoid');

const {
  DUMMY_HASH,
  authenticate,
  clearFailedLogins,
  createSession,
  getBearerToken,
  hashToken,
  isLocked,
  normalizeEmail,
  recordFailedLogin,
} = require('./auth');

function serializeUser(row) {
  return {
    id: row.id,
    email: row.email,
    profile: {
      fullName: row.full_name,
      displayName: row.display_name,
      bio: row.bio,
      role: row.role,
      createdAt: row.created_at,
    },
  };
}

function serializeFile(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

function createApp(pool) {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: false }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 25,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/register', async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim();
      const emailLower = normalizeEmail(email);
      const password = String(req.body.password || '');

      if (!/^\S+@\S+\.\S+$/.test(emailLower) || password.length < 8) {
        return res.status(400).json({ error: 'Valid email and password of at least 8 characters are required' });
      }

      const id = `usr_${nanoid(12)}`;
      const passwordHash = await bcrypt.hash(password, 12);

      const { rows } = await pool.query(
        `INSERT INTO users (id, email, email_lower, password_hash, display_name, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, email, full_name, display_name, bio, role, created_at`,
        [id, email, emailLower, passwordHash, emailLower.split('@')[0]]
      );

      return res.status(201).json(serializeUser(rows[0]));
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      return next(err);
    }
  });

  app.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const emailLower = normalizeEmail(req.body.email);
      const password = String(req.body.password || '');
      const genericError = { error: 'Invalid email or password' };

      if (!emailLower || await isLocked(pool, emailLower)) {
        return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
      }

      const { rows } = await pool.query('SELECT * FROM users WHERE email_lower = $1', [emailLower]);
      const user = rows[0];
      const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

      if (!valid || !user) {
        await recordFailedLogin(pool, emailLower || 'missing-email');
        return res.status(401).json(genericError);
      }

      await clearFailedLogins(pool, emailLower);
      const session = await createSession(pool, user.id);

      return res.json({
        token: session.token,
        expiresAt: session.expiresAt,
        user: { id: user.id, email: user.email },
      });
    } catch (err) {
      return next(err);
    }
  });

  app.post('/logout', async (req, res, next) => {
    try {
      const token = getBearerToken(req);
      if (token) {
        await pool.query(
          'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
          [hashToken(token)]
        );
      }
      return res.json({ message: 'Logged out' });
    } catch (err) {
      return next(err);
    }
  });

  const requireAuth = (req, res, next) => authenticate(pool, req, res, next);

  app.get('/me', requireAuth, (req, res) => {
    return res.json(serializeUser(req.user));
  });

  app.get('/files', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, owner_id, file_name, mime_type, size_bytes, uploaded_at
         FROM user_files
         WHERE owner_id = $1
         ORDER BY uploaded_at ASC, id ASC`,
        [req.user.id]
      );
      return res.json({ files: rows.map(serializeFile) });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/files/:id', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, owner_id, file_name, mime_type, size_bytes, uploaded_at
         FROM user_files
         WHERE id = $1`,
        [req.params.id]
      );

      if (rows.length === 0) return res.status(404).json({ error: 'File not found' });
      if (rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'You do not have access to this file' });

      return res.json({ file: serializeFile(rows[0]) });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/files/:id/download', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM user_files WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).send('File not found');
      if (rows[0].owner_id !== req.user.id) return res.status(403).send('Forbidden');

      const storagePath = path.resolve(__dirname, '..', rows[0].storage_path);
      return res.download(storagePath, rows[0].file_name);
    } catch (err) {
      return next(err);
    }
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
