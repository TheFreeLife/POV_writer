/**
 * IndexedDB 저장소 관리 모듈 (안정화 버전)
 */

const DB_NAME = 'NovelEditorDB';
const DB_VERSION = 6;
const PROJECTS_STORE = 'projects';
const FILES_STORE = 'files';
const CHARACTERS_STORE = 'characters';
const MEMOS_STORE = 'memos';
const TEMPLATES_STORE = 'templates';

class StorageManager {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise(async (resolve, reject) => {
      try {
        if (navigator.storage && navigator.storage.persist) {
          await navigator.storage.persist();
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error('IndexedDB 열기 실패:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          console.log('IndexedDB 초기화 성공');

          this.db.onversionchange = () => {
            this.db.close();
            console.warn('DB 버전 변경 감지 - 세션 종료');
          };

          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          console.log(`DB 업그레이드: ${event.oldVersion} → ${event.newVersion}`);

          const stores = [
            { name: PROJECTS_STORE, key: 'id', indexes: [{ name: 'updatedAt', path: 'updatedAt', unique: false }] },
            {
              name: FILES_STORE, key: 'id', indexes: [
                { name: 'projectId', path: 'projectId', unique: false },
                { name: 'parentId', path: 'parentId', unique: false }
              ]
            },
            { name: CHARACTERS_STORE, key: 'id', indexes: [{ name: 'projectId', path: 'projectId', unique: false }] },
            { name: MEMOS_STORE, key: 'id', indexes: [{ name: 'projectId', path: 'projectId', unique: false }] },
            { name: TEMPLATES_STORE, key: 'id', indexes: [] }
          ];

          stores.forEach(s => {
            if (!db.objectStoreNames.contains(s.name)) {
              const store = db.createObjectStore(s.name, { keyPath: s.key });
              s.indexes.forEach(idx => store.createIndex(idx.name, idx.path, { unique: idx.unique }));
            }
          });
        };
      } catch (err) {
        reject(err);
      }
    });

    return this._initPromise;
  }

  async _transaction(storeNames, mode, callback) {
    await this.init();
    if (!this.db) throw new Error('DB가 초기화되지 않았습니다.');

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(storeNames, mode);
        const result = callback(transaction);

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = (e) => {
          console.error(`Transaction Error [${storeNames}]:`, e.target.error);
          reject(e.target.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  // 프로젝트 메서드
  async getAllProjects() {
    return this._transaction([PROJECTS_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const req = tx.objectStore(PROJECTS_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
      });
    });
  }

  async getProject(id) {
    if (!id) return null;
    return this._transaction([PROJECTS_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const req = tx.objectStore(PROJECTS_STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
    });
  }

  async createProject(project) {
    const newProject = {
      id: this.generateId(),
      name: project.name,
      thumbnail: project.thumbnail || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._transaction([PROJECTS_STORE], 'readwrite', (tx) => {
      tx.objectStore(PROJECTS_STORE).add(newProject);
    });
    return newProject;
  }

  async updateProject(id, updates) {
    if (!id) return null;
    const project = await this.getProject(id);
    if (!project) {
      console.warn('업데이트할 프로젝트를 찾을 수 없음:', id);
      return null;
    }

    const updatedProject = {
      ...project,
      ...updates,
      updatedAt: Date.now(),
    };

    await this._transaction([PROJECTS_STORE], 'readwrite', (tx) => {
      tx.objectStore(PROJECTS_STORE).put(updatedProject);
    });
    return updatedProject;
  }

  async deleteProject(id) {
    return this._transaction([PROJECTS_STORE, FILES_STORE, CHARACTERS_STORE, MEMOS_STORE], 'readwrite', (tx) => {
      tx.objectStore(PROJECTS_STORE).delete(id);
      const stores = [FILES_STORE, CHARACTERS_STORE, MEMOS_STORE];
      stores.forEach(sName => {
        const store = tx.objectStore(sName);
        const index = store.index('projectId');
        index.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          }
        };
      });
    });
  }

  // 파일 메서드
  async getProjectFiles(projectId) {
    return this._transaction([FILES_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const index = tx.objectStore(FILES_STORE).index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
      });
    });
  }

  async getFile(id) {
    if (!id) return null;
    return this._transaction([FILES_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const req = tx.objectStore(FILES_STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
    });
  }

  async createFile(file) {
    const newFile = {
      id: this.generateId(),
      projectId: file.projectId,
      name: file.name,
      type: file.type,
      parentId: file.parentId || null,
      content: file.content || '',
      defaultTemplate: file.defaultTemplate || null,
      order: file.order || 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._transaction([FILES_STORE], 'readwrite', (tx) => {
      tx.objectStore(FILES_STORE).add(newFile);
    });
    return newFile;
  }

  async updateFile(id, updates) {
    if (!id) return null;
    const file = await this.getFile(id);
    if (!file) {
      console.warn('업데이트할 파일을 찾을 수 없음:', id);
      return null;
    }

    const updatedFile = {
      ...file,
      ...updates,
      updatedAt: Date.now(),
    };

    await this._transaction([FILES_STORE], 'readwrite', (tx) => {
      tx.objectStore(FILES_STORE).put(updatedFile);
    });
    return updatedFile;
  }

  async deleteFile(id) {
    const file = await this.getFile(id);
    if (!file) return;

    if (file.type === 'folder') {
      const children = await this.getChildFiles(id);
      for (const child of children) {
        await this.deleteFile(child.id);
      }
    }

    await this._transaction([FILES_STORE], 'readwrite', (tx) => {
      tx.objectStore(FILES_STORE).delete(id);
    });
  }

  async getChildFiles(parentId) {
    return this._transaction([FILES_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const index = tx.objectStore(FILES_STORE).index('parentId');
        const req = index.getAll(parentId);
        req.onsuccess = () => resolve(req.result || []);
      });
    });
  }

  // 메모 메서드
  async getProjectMemos(projectId) {
    return this._transaction([MEMOS_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const index = tx.objectStore(MEMOS_STORE).index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
      });
    });
  }

  async createMemo(memo) {
    const newMemo = {
      id: this.generateId(),
      projectId: memo.projectId,
      content: memo.content || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this._transaction([MEMOS_STORE], 'readwrite', (tx) => {
      tx.objectStore(MEMOS_STORE).add(newMemo);
    });
    return newMemo;
  }

  async updateMemo(id, updates) {
    return this._transaction([MEMOS_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(MEMOS_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const data = { ...req.result, ...updates, updatedAt: Date.now() };
        store.put(data);
      };
    });
  }

  async deleteMemo(id) {
    await this._transaction([MEMOS_STORE], 'readwrite', (tx) => {
      tx.objectStore(MEMOS_STORE).delete(id);
    });
  }

  async deleteMemos(ids) {
    await this._transaction([MEMOS_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(MEMOS_STORE);
      ids.forEach(id => store.delete(id));
    });
  }

  // 템플릿 메서드
  async getAllTemplates() {
    return this._transaction([TEMPLATES_STORE], 'readonly', (tx) => {
      return new Promise((resolve) => {
        const req = tx.objectStore(TEMPLATES_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
      });
    });
  }

  async createTemplate(template) {
    const newTemplate = {
      id: this.generateId(),
      name: template.name,
      content: template.content || '',
      icon: template.icon || '📄',
      createdAt: Date.now()
    };
    await this._transaction([TEMPLATES_STORE], 'readwrite', (tx) => {
      tx.objectStore(TEMPLATES_STORE).add(newTemplate);
    });
    return newTemplate;
  }

  async deleteTemplate(id) {
    await this._transaction([TEMPLATES_STORE], 'readwrite', (tx) => {
      tx.objectStore(TEMPLATES_STORE).delete(id);
    });
  }

  async updateTemplate(id, updates) {
    return this._transaction([TEMPLATES_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(TEMPLATES_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const data = { ...req.result, ...updates, updatedAt: Date.now() };
        store.put(data);
      };
    });
  }

  // 유틸리티
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        usagePercent: (estimate.usage / estimate.quota * 100).toFixed(2)
      };
    }
    return null;
  }

  async resetDatabase() {
    if (confirm('모든 데이터가 영구적으로 삭제됩니다. 계속하시겠습니까?')) {
      if (this.db) this.db.close();
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => {
        alert('데이터베이스가 초기화되었습니다. 페이지를 새로고침합니다.');
        location.reload();
      };
    }
  }
}

const storage = new StorageManager();
window.storage = storage;
