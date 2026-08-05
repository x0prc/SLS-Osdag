require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createPool } = require('./db');

async function main() {
  const pool = createPool();
  const seedPath = path.resolve(__dirname, '..', '..', 'Web files', 'seed-data.json');
  const storageRoot = path.resolve(__dirname, '..', 'storage', 'user-files');
  const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));

  await pool.query('BEGIN');
  try {
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM login_failures');
    await pool.query('DELETE FROM user_files');
    await pool.query('DELETE FROM users');

    await fs.mkdir(storageRoot, { recursive: true });

    for (const user of seed.users) {
      const passwordHash = await bcrypt.hash(user.password, 12);
      await pool.query(
        `INSERT INTO users (id, email, email_lower, password_hash, full_name, display_name, bio, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          user.email,
          user.email.toLowerCase(),
          passwordHash,
          user.profile.fullName,
          user.profile.displayName,
          user.profile.bio,
          user.profile.role,
          user.profile.createdAt,
        ]
      );

      for (const file of user.files) {
        const storageName = `${file.id}-${file.fileName}`;
        const relativePath = path.join('storage', 'user-files', storageName);
        const absolutePath = path.join(storageRoot, storageName);
        const content = `Seeded file ${file.fileName}\nOwner: ${user.email}\nFile ID: ${file.id}\n`;
        await fs.writeFile(absolutePath, content, 'utf8');
        const stats = await fs.stat(absolutePath);

        await pool.query(
          `INSERT INTO user_files (id, owner_id, file_name, mime_type, size_bytes, uploaded_at, storage_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [file.id, user.id, file.fileName, file.mimeType, stats.size, file.uploadedAt, relativePath]
        );
      }
    }

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  } finally {
    await pool.end();
  }

  console.log(`Seeded ${seed.users.length} users and ${seed.users.flatMap((u) => u.files).length} files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
