# Appwrite Backend

This implementation uses Appwrite Account for registration, login, and logout. User file metadata is stored in an Appwrite Database collection, and file bytes are stored in Appwrite Storage.

## Required Appwrite Resources

Create these resources in the Appwrite console or with your own infrastructure tooling:

- Database ID: `secure-login` or the value of `APPWRITE_DATABASE_ID`
- Collection ID: `files` or the value of `APPWRITE_FILES_COLLECTION_ID`
- Bucket ID: `user-files` or the value of `APPWRITE_BUCKET_ID`

Collection attributes:

- `ownerId`: string, required, size 128
- `fileName`: string, required, size 255
- `mimeType`: string, required, size 128
- `sizeBytes`: integer, required
- `uploadedAt`: datetime, required
- `storageFileId`: string, required, size 128

Indexes:

- Key: `ownerId_idx`, type: key, attribute: `ownerId`

Permissions:

- Enable document security on the `files` collection.
- The seed script creates file metadata documents readable by authenticated users so the browser adapter can return `403` when a known file belongs to someone else instead of conflating that case with `404`.
- Storage files are created with read/update/delete permissions for the owning Appwrite user only, so cross-account downloads are rejected by Appwrite even if a user guesses a storage file ID.

For a production Appwrite-only version, I would move the single-file authorization check behind an Appwrite Function. That would preserve the strict `404` versus `403` distinction without making any cross-user metadata readable to authenticated clients.

## Seed Users

1. Copy `.env.example` to `.env` and fill in Appwrite values.
2. Create a server API key with Users, Databases, and Storage permissions.
3. Run `npm install`.
4. Run `npm run seed`.

Seeded credentials:

- `alice@example.com` / `Password123!`
- `bob@example.com` / `Password123!`
- `carol@example.com` / `Password123!`

## Using The Provided Client

Serve `../Web files/index.html`, select `Appwrite`, and fill in the Appwrite endpoint, project ID, database ID, collection ID, and bucket ID.
