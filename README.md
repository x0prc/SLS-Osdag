# Secure Login System

This repository contains two implementations using the provided `Web files/index.html` test client only:

- `custom-backend/`: Node/Express + PostgreSQL REST API
- `appwrite-backend/`: Appwrite Account, Database, and Storage setup with a browser adapter for the provided client

The included `mock-api.js` remains only for the page's mock mode. It is not used by either backend implementation.

## Seeded Test Users

All seeded users use password `Password123!`.

- `alice@example.com`, files `file_001`, `file_002`
- `bob@example.com`, files `file_003`, `file_004`
- `carol@example.com`, files `file_005`, `file_006`

## Run The Custom Backend

1. Start PostgreSQL: `docker compose up -d postgres`
2. Install dependencies: `cd custom-backend && npm install`
3. Copy env file: `cp .env.example .env`
4. Set `JWT_SECRET` in `.env` to a long random string.
5. Run schema and seed data: `npm run reset`
6. Start API: `npm run dev`
7. Serve the provided web client: from `Web files`, run `python3 -m http.server 8080`
8. Open `http://localhost:8080`, select `Custom REST backend`, keep base URL `http://localhost:3000`, and leave cookie sessions unchecked.

Useful custom endpoints:

- `POST /register` with `{ "email": "...", "password": "..." }`
- `POST /login` with `{ "email": "...", "password": "..." }`, returns `{ token }`
- `POST /logout` with `Authorization: Bearer <token>`
- `GET /me` with `Authorization: Bearer <token>`
- `GET /files` with `Authorization: Bearer <token>`
- `GET /files/:id` with `Authorization: Bearer <token>`
- `GET /files/:id/download` with `Authorization: Bearer <token>`

## Run The Appwrite Implementation

1. Create an Appwrite project.
2. Follow `appwrite-backend/README.md` to create the database, collection, bucket, attributes, index, and API key.
3. Install dependencies: `cd appwrite-backend && npm install`
4. Copy env file: `cp .env.example .env`
5. Fill in the Appwrite values.
6. Seed accounts and files: `npm run seed`
7. Serve the provided web client: from `Web files`, run `python3 -m http.server 8080`
8. Open `http://localhost:8080`, select `Appwrite`, and fill in the Appwrite settings fieldset.

## JWT vs Session Reasoning

The custom backend uses JWT bearer tokens because the provided test client already has a token input and consistently attaches `Authorization: Bearer <token>` to protected routes. A purely stateless JWT would make logout weak because the server could not revoke an issued token before expiry. To avoid that, each JWT includes a server-side `session_id`, and the API validates the token against the `sessions` table on every protected request.

This is a hybrid design: JWT gives simple client transport, while the database session row gives server-side revocation and expiry enforcement.

## Logout Implementation

Custom logout hashes the presented bearer token and marks the matching session row as revoked. After logout, the same token still verifies cryptographically, but protected routes reject it because the session row has `revoked_at` set.

Appwrite logout calls `account.deleteSession('current')`. Appwrite invalidates the managed session server-side, so later Account, Database, and Storage requests from that browser session are rejected.

## User Data Isolation

The custom backend never accepts a user ID from the client for `/me` or `/files`. The authenticated user comes only from the validated token and active session row.

For file access, `/files` filters with `WHERE owner_id = authenticated_user_id`. `/files/:id` first checks whether the file exists, then returns `403` if it exists but belongs to another user, and `404` if it does not exist. Downloads use the same owner check before streaming bytes.

Appwrite mode uses Appwrite Account for identity. The adapter queries files by the current Appwrite user ID and checks `doc.ownerId === account.$id` before displaying metadata or triggering a Storage download. Storage files are seeded with owner-only read permissions, so Appwrite itself rejects cross-user downloads.

## Security Practices Included

- Passwords are hashed with bcrypt in the custom backend seed script and registration route.
- Login failure responses use `Invalid email or password` without revealing whether an email exists.
- Login has both route-level rate limiting and a database-backed per-email lockout after repeated failures.
- Sessions are validated consistently for every protected custom route.
- Session tokens are stored in PostgreSQL only as SHA-256 hashes.
- File download routes perform the same authorization checks as metadata routes.

## What Appwrite Handles Automatically

Appwrite handles password hashing, managed sessions, secure session cookies/tokens, user identity, and Storage permission checks. I configured the files collection schema, the `ownerId` index, seeded user preferences for profile data, and seeded per-user Storage file permissions.

## Improvements With More Time

- Move Appwrite single-file metadata checks into an Appwrite Function to preserve strict `403` versus `404` behavior without making cross-user metadata readable to authenticated clients.
- Add automated integration tests that spin up PostgreSQL and verify cross-user access failures.
- Store real uploaded files through a multipart upload endpoint instead of seeded sample text files.
- Add refresh-token rotation or shorter access-token lifetimes for higher-risk deployments.
