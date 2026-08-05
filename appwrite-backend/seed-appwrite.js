require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const sdk = require('node-appwrite');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function findOrCreateUser(users, seedUser) {
  const existing = await users.list([sdk.Query.equal('email', seedUser.email)]);
  if (existing.total > 0) return existing.users[0];

  return users.create(
    sdk.ID.unique(),
    seedUser.email,
    undefined,
    seedUser.password,
    seedUser.profile.fullName
  );
}

async function main() {
  const endpoint = required('APPWRITE_ENDPOINT');
  const projectId = required('APPWRITE_PROJECT_ID');
  const apiKey = required('APPWRITE_API_KEY');
  const databaseId = required('APPWRITE_DATABASE_ID');
  const collectionId = required('APPWRITE_FILES_COLLECTION_ID');
  const bucketId = required('APPWRITE_BUCKET_ID');

  const client = new sdk.Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const users = new sdk.Users(client);
  const databases = new sdk.Databases(client);
  const storage = new sdk.Storage(client);

  const seedPath = path.resolve(__dirname, '..', 'Web files', 'seed-data.json');
  const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));

  for (const seedUser of seed.users) {
    const user = await findOrCreateUser(users, seedUser);
    await users.updatePrefs(user.$id, {
      fullName: seedUser.profile.fullName,
      displayName: seedUser.profile.displayName,
      bio: seedUser.profile.bio,
      role: seedUser.profile.role,
      createdAt: seedUser.profile.createdAt,
    });

    for (const file of seedUser.files) {
      const fileId = file.id;
      const content = Buffer.from(`Seeded file ${file.fileName}\nOwner: ${seedUser.email}\nFile ID: ${file.id}\n`, 'utf8');

      try {
        await storage.createFile(
          bucketId,
          fileId,
          sdk.InputFile.fromBuffer(content, file.fileName),
          [
            sdk.Permission.read(sdk.Role.user(user.$id)),
            sdk.Permission.update(sdk.Role.user(user.$id)),
            sdk.Permission.delete(sdk.Role.user(user.$id)),
          ]
        );
      } catch (err) {
        if (err.code !== 409) throw err;
      }

      try {
        await databases.createDocument(
          databaseId,
          collectionId,
          fileId,
          {
            ownerId: user.$id,
            fileName: file.fileName,
            mimeType: file.mimeType,
            sizeBytes: content.length,
            uploadedAt: file.uploadedAt,
            storageFileId: fileId,
          },
          [sdk.Permission.read(sdk.Role.users())]
        );
      } catch (err) {
        if (err.code !== 409) throw err;
      }
    }
  }

  console.log(`Seeded ${seed.users.length} Appwrite users and ${seed.users.flatMap((u) => u.files).length} files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
