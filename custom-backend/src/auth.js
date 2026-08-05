const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');

const DUMMY_HASH = '$2a$10$w7oSvSU8FtrQvjkZOfOe0eg9CvOa3B6YjQbwuS.fStcUS8ZqPtL0i';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getBearerToken(req) {
  const value = req.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function recordFailedLogin(pool, emailLower) {
  const maxFailures = Number(process.env.MAX_FAILED_LOGINS || 5);
  const lockoutMinutes = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);

  const { rows } = await pool.query(
    `INSERT INTO login_failures (email_lower, failed_count)
     VALUES ($1, 1)
     ON CONFLICT (email_lower)
     DO UPDATE SET failed_count = login_failures.failed_count + 1
     RETURNING failed_count`,
    [emailLower]
  );

  if (rows[0].failed_count >= maxFailures) {
    await pool.query(
      `UPDATE login_failures
       SET failed_count = 0, locked_until = now() + ($2 || ' minutes')::interval
       WHERE email_lower = $1`,
      [emailLower, lockoutMinutes]
    );
  }
}

async function isLocked(pool, emailLower) {
  const { rows } = await pool.query(
    'SELECT locked_until FROM login_failures WHERE email_lower = $1 AND locked_until > now()',
    [emailLower]
  );
  return rows.length > 0;
}

async function clearFailedLogins(pool, emailLower) {
  await pool.query('DELETE FROM login_failures WHERE email_lower = $1', [emailLower]);
}

async function createSession(pool, userId) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  const sessionId = `sess_${nanoid(24)}`;
  const ttlMinutes = Number(process.env.SESSION_TTL_MINUTES || 60);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const token = jwt.sign(
    { sub: userId, sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: `${ttlMinutes}m` }
  );

  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, hashToken(token), expiresAt]
  );

  return { token, expiresAt };
}

async function authenticate(pool, req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_err) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.display_name, u.bio, u.role, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1
       AND s.user_id = $2
       AND s.token_hash = $3
       AND s.revoked_at IS NULL
       AND s.expires_at > now()`,
    [payload.sid, payload.sub, hashToken(token)]
  );

  if (rows.length === 0) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = rows[0];
  req.sessionId = payload.sid;
  req.sessionToken = token;
  return next();
}

module.exports = {
  DUMMY_HASH,
  authenticate,
  clearFailedLogins,
  createSession,
  getBearerToken,
  hashToken,
  isLocked,
  normalizeEmail,
  recordFailedLogin,
};
