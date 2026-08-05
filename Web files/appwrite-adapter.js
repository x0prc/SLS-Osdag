(function () {
  const original = {
    doRegister: window.doRegister,
    doLogin: window.doLogin,
    doLogout: window.doLogout,
    getMe: window.getMe,
    getFiles: window.getFiles,
    getFileById: window.getFileById,
    downloadFileById: window.downloadFileById,
  };

  function isAppwriteMode() {
    const selected = document.querySelector('input[name="backendMode"]:checked');
    return selected && selected.value === 'appwrite';
  }

  function config() {
    return {
      endpoint: document.getElementById('awEndpoint').value.trim(),
      projectId: document.getElementById('awProjectId').value.trim(),
      databaseId: document.getElementById('awDatabaseId').value.trim(),
      collectionId: document.getElementById('awFilesCollectionId').value.trim(),
      bucketId: document.getElementById('awBucketId').value.trim(),
    };
  }

  function services() {
    if (!window.Appwrite) throw new Error('Appwrite Web SDK is not loaded');
    const cfg = config();
    const client = new Appwrite.Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId);
    return {
      cfg,
      account: new Appwrite.Account(client),
      databases: new Appwrite.Databases(client),
      storage: new Appwrite.Storage(client),
      ID: Appwrite.ID,
      Query: Appwrite.Query,
    };
  }

  function fileFromDoc(doc) {
    return {
      id: doc.$id,
      ownerId: doc.ownerId,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
      storageFileId: doc.storageFileId,
    };
  }

  function statusFromError(err) {
    return err && (err.code || err.status || err.response && err.response.code) || 500;
  }

  async function currentUser(account) {
    return account.get();
  }

  async function guard(fn, label) {
    if (!isAppwriteMode()) return fn.fallback();
    try {
      return await fn.run();
    } catch (err) {
      log(label, { status: statusFromError(err), body: { error: err.message || 'Appwrite request failed' } });
    }
  }

  window.doRegister = function () {
    return guard({
      fallback: original.doRegister,
      run: async function () {
        const { account, ID } = services();
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;
        const created = await account.create(ID.unique(), email, password, email.split('@')[0]);
        await account.createEmailPasswordSession(email, password);
        await account.updatePrefs({
          fullName: '',
          displayName: email.split('@')[0],
          bio: '',
          role: 'user',
          createdAt: new Date().toISOString(),
        });
        log('Appwrite register', { status: 201, body: { id: created.$id, email: created.email } });
      },
    }, 'Appwrite register');
  };

  window.doLogin = function () {
    return guard({
      fallback: original.doLogin,
      run: async function () {
        const { account } = services();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const session = await account.createEmailPasswordSession(email, password);
        log('Appwrite login', { status: 200, body: { sessionId: session.$id } });
      },
    }, 'Appwrite login');
  };

  window.doLogout = function () {
    return guard({
      fallback: original.doLogout,
      run: async function () {
        const { account } = services();
        await account.deleteSession('current');
        document.getElementById('token').value = '';
        log('Appwrite logout', { status: 200, body: { message: 'Logged out' } });
      },
    }, 'Appwrite logout');
  };

  window.getMe = function () {
    return guard({
      fallback: original.getMe,
      run: async function () {
        const { account } = services();
        const user = await currentUser(account);
        log('Appwrite /me', {
          status: 200,
          body: { id: user.$id, email: user.email, profile: user.prefs || {} },
        });
      },
    }, 'Appwrite /me');
  };

  window.getFiles = function () {
    return guard({
      fallback: original.getFiles,
      run: async function () {
        const { cfg, account, databases, Query } = services();
        const user = await currentUser(account);
        const result = await databases.listDocuments(cfg.databaseId, cfg.collectionId, [Query.equal('ownerId', user.$id)]);
        log('Appwrite /files', { status: 200, body: { files: result.documents.map(fileFromDoc) } });
      },
    }, 'Appwrite /files');
  };

  window.getFileById = function () {
    return guard({
      fallback: original.getFileById,
      run: async function () {
        const { cfg, account, databases } = services();
        const id = document.getElementById('fileId').value;
        const user = await currentUser(account);
        try {
          const doc = await databases.getDocument(cfg.databaseId, cfg.collectionId, id);
          if (doc.ownerId !== user.$id) {
            log('Appwrite /files/' + id, { status: 403, body: { error: 'You do not have access to this file' } });
            return;
          }
          log('Appwrite /files/' + id, { status: 200, body: { file: fileFromDoc(doc) } });
        } catch (err) {
          const status = statusFromError(err) === 404 ? 404 : statusFromError(err);
          log('Appwrite /files/' + id, { status, body: { error: status === 404 ? 'File not found' : err.message } });
        }
      },
    }, 'Appwrite /files/:id');
  };

  window.downloadFileById = function () {
    return guard({
      fallback: original.downloadFileById,
      run: async function () {
        const { cfg, account, databases, storage } = services();
        const id = document.getElementById('fileId').value;
        const user = await currentUser(account);
        const doc = await databases.getDocument(cfg.databaseId, cfg.collectionId, id);
        if (doc.ownerId !== user.$id) {
          log('Appwrite download ' + id, { status: 403, body: { error: 'You do not have access to this file' } });
          return;
        }
        const url = storage.getFileDownload(cfg.bucketId, doc.storageFileId || doc.$id);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        a.click();
        log('Appwrite download ' + id, { status: 200, note: 'File download triggered.' });
      },
    }, 'Appwrite download');
  };
})();
