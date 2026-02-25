/**
 * 프로젝트 관리자
 */
class ProjectManager {
    constructor() {
        this.currentEditingProject = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const getEl = id => document.getElementById(id);

        getEl('newProjectBtn')?.addEventListener('click', () => this.showNewProjectModal());
        getEl('closeNewProjectModal')?.addEventListener('click', () => this.hideNewProjectModal());
        getEl('cancelNewProjectBtn')?.addEventListener('click', () => this.hideNewProjectModal());
        getEl('createProjectBtn')?.addEventListener('click', () => this.createProject());

        getEl('thumbnailUpload')?.addEventListener('click', () => getEl('thumbnailInput')?.click());
        
        const thumbnailUpload = getEl('thumbnailUpload');
        if (thumbnailUpload) {
            thumbnailUpload.addEventListener('dragover', (e) => {
                e.preventDefault();
                thumbnailUpload.classList.add('dragover');
            });
            thumbnailUpload.addEventListener('dragleave', () => {
                thumbnailUpload.classList.remove('dragover');
            });
            thumbnailUpload.addEventListener('drop', (e) => {
                e.preventDefault();
                thumbnailUpload.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    const input = getEl('thumbnailInput');
                    if (input) input.files = dt.files;
                    this.handleThumbnailUpload(file, getEl('thumbnailPreview'), getEl('thumbnailPlaceholder'));
                }
            });
        }

        getEl('thumbnailInput')?.addEventListener('change', (e) => {
            this.handleThumbnailUpload(e.target.files[0], getEl('thumbnailPreview'), getEl('thumbnailPlaceholder'));
        });

        getEl('closeEditProjectModal')?.addEventListener('click', () => this.hideEditProjectModal());
        getEl('cancelEditProjectBtn')?.addEventListener('click', () => this.hideEditProjectModal());
        getEl('saveEditProjectBtn')?.addEventListener('click', () => this.saveEditProject());

        getEl('editThumbnailUpload')?.addEventListener('click', () => getEl('editThumbnailInput')?.click());
        
        const editThumbnailUpload = getEl('editThumbnailUpload');
        if (editThumbnailUpload) {
            editThumbnailUpload.addEventListener('dragover', (e) => {
                e.preventDefault();
                editThumbnailUpload.classList.add('dragover');
            });
            editThumbnailUpload.addEventListener('dragleave', () => {
                editThumbnailUpload.classList.remove('dragover');
            });
            editThumbnailUpload.addEventListener('drop', (e) => {
                e.preventDefault();
                editThumbnailUpload.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    const input = getEl('editThumbnailInput');
                    if (input) input.files = dt.files;
                    this.handleThumbnailUpload(file, getEl('editThumbnailPreview'), getEl('editThumbnailPlaceholder'));
                }
            });
        }

        getEl('editThumbnailInput')?.addEventListener('change', (e) => {
            this.handleThumbnailUpload(e.target.files[0], getEl('editThumbnailPreview'), getEl('editThumbnailPlaceholder'));
        });
    }

    handleThumbnailUpload(file, previewElement, placeholderElement) {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (previewElement) {
                    previewElement.src = e.target.result;
                    previewElement.classList.remove('hidden');
                }
                placeholderElement?.classList.add('hidden');
            };
            reader.readAsDataURL(file);
        }
    }

    showNewProjectModal() {
        const modal = document.getElementById('newProjectModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.getElementById('projectName')?.focus();

        const nameInput = document.getElementById('projectName');
        if (nameInput) nameInput.value = '';

        const preview = document.getElementById('thumbnailPreview');
        const placeholder = document.getElementById('thumbnailPlaceholder');
        if (preview) preview.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
    }

    hideNewProjectModal() {
        document.getElementById('newProjectModal')?.classList.add('hidden');
    }

    async createProject() {
        const name = document.getElementById('projectName')?.value.trim();
        if (!name) return alert('프로젝트 이름을 입력하세요.');

        const preview = document.getElementById('thumbnailPreview');
        const thumbnail = (preview && !preview.classList.contains('hidden')) ? preview.src : null;

        try {
            const project = await storage.createProject({ name, thumbnail });
            await storage.createFile({
                projectId: project.id,
                name: '챕터 1',
                type: 'folder',
                parentId: null,
                order: 0
            });
            this.hideNewProjectModal();
            await this.renderProjectList();
        } catch (error) {
            console.error('프로젝트 생성 실패:', error);
            alert('프로젝트 생성에 실패했습니다.');
        }
    }

    async renderProjectList() {
        console.log('프로젝트 목록 렌더링 시작');
        const projectList = document.getElementById('projectList');
        if (!projectList) return;

        let projects = [];
        try {
            projects = await storage.getAllProjects();
        } catch (e) {
            console.error('프로젝트 데이터 로드 실패:', e);
        }

        projectList.innerHTML = '';

        // 프로젝트 카드 렌더링
        if (Array.isArray(projects) && projects.length > 0) {
            projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            projects.forEach(project => {
                projectList.appendChild(this.createProjectCard(project));
            });
        }

        // 새 프로젝트 카드 (항상 마지막에 추가)
        const newCard = document.createElement('div');
        newCard.className = 'project-card project-card-new';
        newCard.innerHTML = `
            <div class="project-card-new-content">
                <div class="project-card-new-icon">+</div>
                <div class="project-card-new-text">새 프로젝트</div>
            </div>
        `;
        newCard.onclick = () => this.showNewProjectModal();
        projectList.appendChild(newCard);

        // 3. 백업/복구 통합 관리 카드
        const backupCard = document.createElement('div');
        backupCard.className = 'project-card project-card-new';
        backupCard.innerHTML = `
            <div class="project-card-new-content">
                <div class="project-card-new-icon" style="color: var(--color-text-tertiary);">💾</div>
                <div class="project-card-new-text">백업 및 복구</div>
            </div>
        `;
        backupCard.onclick = () => this.showBackupModal();
        projectList.appendChild(backupCard);

        console.log('프로젝트 목록 렌더링 완료');
    }

    // --- 백업 관리 모달 관련 메서드 ---

    async showBackupModal() {
        const modal = document.getElementById('backupModal');
        const listContainer = document.getElementById('backupProjectList');
        if (!modal || !listContainer) return;

        const projects = await storage.getAllProjects();
        projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        listContainer.innerHTML = projects.map(p => `
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-bottom: 1px solid var(--color-border); transition: background 0.2s;" onmouseover="this.style.background='var(--color-surface-2)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="backup-project-checkbox" data-id="${p.id}" style="width: 18px; height: 18px; cursor: pointer;">
                <div style="flex: 1;">
                    <div style="font-size: 13px; font-weight: 600; color: var(--color-text-primary);">${this.escapeHtml(p.name)}</div>
                    <div style="font-size: 11px; color: var(--color-text-tertiary);">${new Date(p.updatedAt).toLocaleDateString()}</div>
                </div>
            </label>
        `).join('');

        if (projects.length === 0) {
            listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-text-tertiary); font-size: 12px;">백업할 프로젝트가 없습니다.</div>';
        }

        this.updateBackupCount();
        
        // 체크박스 클릭 시 숫자 업데이트
        listContainer.querySelectorAll('input').forEach(cb => {
            cb.addEventListener('change', () => this.updateBackupCount());
        });

        modal.classList.remove('hidden');
    }

    hideBackupModal() {
        document.getElementById('backupModal')?.classList.add('hidden');
    }

    updateBackupCount() {
        const checked = document.querySelectorAll('.backup-project-checkbox:checked').length;
        const text = document.getElementById('backupCountText');
        if (text) text.textContent = `${checked}개의 프로젝트 선택됨`;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    setupBackupEventListeners() {
        const getEl = id => document.getElementById(id);

        getEl('closeBackupModalBtn')?.addEventListener('click', () => this.hideBackupModal());
        getEl('cancelBackupBtn')?.addEventListener('click', () => this.hideBackupModal());

        // 백업 불러오기 (복구)
        const modalInput = getEl('modalBackupInput');
        getEl('modalImportBtn')?.addEventListener('click', () => modalInput.click());
        modalInput?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !window.backupManager) return;

            const data = await window.backupManager.importData(file);
            if (data) {
                if (confirm('POV 백업 파일의 데이터를 복구할까요?\n기존 데이터는 유지되며 중복 시 덮어씌워집니다.')) {
                    await window.storage.restoreBackup(data);
                    location.reload();
                }
            }
            e.target.value = '';
        });

        // 전체 데이터 백업
        getEl('exportAllFullBtn')?.addEventListener('click', async () => {
            const data = await window.storage.getAllBackupData();
            await window.backupManager.exportData(data, `POV_Full_Backup_${new Date().toISOString().slice(0,10)}.pov`);
            this.hideBackupModal();
        });

        // 설정/프리셋만 백업
        getEl('exportOnlySettingsBtn')?.addEventListener('click', async () => {
            const data = await window.storage.getSettingsBackupData();
            await window.backupManager.exportData(data, `POV_Settings_Backup_${new Date().toISOString().slice(0,10)}.pov`);
            this.hideBackupModal();
        });

        // 선택 프로젝트 백업
        getEl('startSelectedBackupBtn')?.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.backup-project-checkbox:checked');
            if (checkedBoxes.length === 0) return alert('백업할 프로젝트를 선택해주세요.');

            const ids = Array.from(checkedBoxes).map(cb => cb.dataset.id);
            const data = await window.storage.getMultipleProjectsBackupData(ids);
            
            let fileName = `POV_Selected_Backup_${new Date().toISOString().slice(0,10)}.pov`;
            if (checkedBoxes.length === 1) {
                const name = checkedBoxes[0].parentElement.querySelector('div div').textContent;
                fileName = `POV_Project_${name.replace(/[\/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().slice(0,10)}.pov`;
            }

            await window.backupManager.exportData(data, fileName);
            this.hideBackupModal();
        });
    }

    createProjectCard(project) {
        const card = document.createElement('div');
        card.className = 'project-card';
        const thumbnail = project.thumbnail || '';

        card.innerHTML = `
          <div class="project-card-thumbnail">
            ${thumbnail ? `<img src="${thumbnail}" class="project-card-thumbnail-img">` : '<div class="project-card-thumbnail-placeholder"><span>📚</span></div>'}
          </div>
          <div class="project-card-actions">
            <button class="project-card-action-btn" data-action="edit">✏️</button>
            <button class="project-card-action-btn" data-action="delete">🗑️</button>
          </div>
          <div class="project-card-body">
            <div class="project-card-title">${this.escapeHtml(project.name)}</div>
            <div class="project-card-meta"><span>${this.formatDate(project.updatedAt)}</span></div>
          </div>
        `;

        card.onclick = (e) => {
            if (!e.target.closest('.project-card-action-btn')) this.openProject(project.id);
        };

        card.querySelector('[data-action="edit"]').onclick = (e) => {
            e.stopPropagation();
            this.showEditProjectModal(project);
        };

        card.querySelector('[data-action="delete"]').onclick = (e) => {
            e.stopPropagation();
            this.deleteProject(project.id, project.name);
        };

        return card;
    }

    async openProject(projectId) {
        window.currentProjectId = projectId;
        const project = await storage.getProject(projectId);
        if (!project) return;

        document.getElementById('currentProjectName').textContent = project.name;
        await window.fileTreeManager?.loadProjectFiles(projectId);

        document.getElementById('projectScreen')?.classList.add('hidden');
        document.getElementById('editorScreen')?.classList.remove('hidden');

        // 세션 복구 (줌/팬 및 열린 창들)
        if (window.windowManager) {
            await window.windowManager.restoreSession();
        }

        window.toolsPanel?.loadProjectData(projectId);
    }

    showEditProjectModal(project) {
        this.currentEditingProject = project;
        const modal = document.getElementById('editProjectModal');
        if (!modal) return;

        document.getElementById('editProjectName').value = project.name;
        const preview = document.getElementById('editThumbnailPreview');
        const placeholder = document.getElementById('editThumbnailPlaceholder');

        if (project.thumbnail) {
            preview.src = project.thumbnail;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            preview.classList.add('hidden');
            placeholder.classList.remove('hidden');
        }

        modal.classList.remove('hidden');
        document.getElementById('editProjectName')?.focus();
    }

    hideEditProjectModal() {
        document.getElementById('editProjectModal')?.classList.add('hidden');
        this.currentEditingProject = null;
    }

    async saveEditProject() {
        if (!this.currentEditingProject) return;
        const name = document.getElementById('editProjectName')?.value.trim();
        if (!name) return alert('이름을 입력하세요.');

        const preview = document.getElementById('editThumbnailPreview');
        const thumbnail = (preview && !preview.classList.contains('hidden')) ? preview.src : null;

        try {
            await storage.updateProject(this.currentEditingProject.id, { name, thumbnail });
            this.hideEditProjectModal();
            await this.renderProjectList();
        } catch (error) {
            console.error('수정 실패:', error);
        }
    }

    async deleteProject(id, name) {
        if (confirm(`"${name}" 프로젝트를 삭제할까요?`)) {
            await storage.deleteProject(id);
            await this.renderProjectList();
        }
    }

    formatDate(t) { return new Date(t).toLocaleDateString(); }
    escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

// 명시적으로 window에 할당하여 app.js에서 접근 가능하도록 함
window.projectManager = new ProjectManager();
