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
        console.log('프로젝트 목록 렌더링 완료');
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
