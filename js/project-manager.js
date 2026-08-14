/**
 * 프로젝트 관리자 (Project Manager)
 * - 프리미엄 비주얼 카드 UI & 실시간 검색 / 정렬 / 메타데이터 기능 지원
 */
class ProjectManager {
    constructor() {
        this.currentEditingProject = null;
        this.searchQuery = '';
        this.sortBy = 'updated'; // 'updated' | 'name' | 'created'
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const getEl = id => document.getElementById(id);

        // 생성 / 백업 모달 트리거
        getEl('newProjectBtn')?.addEventListener('click', () => this.showNewProjectModal());
        getEl('backupProjectBtn')?.addEventListener('click', () => this.showBackupModal());

        getEl('closeNewProjectModal')?.addEventListener('click', () => this.hideNewProjectModal());
        getEl('cancelNewProjectBtn')?.addEventListener('click', () => this.hideNewProjectModal());
        getEl('createProjectBtn')?.addEventListener('click', () => this.createProject());

        // 검색 및 정렬 필터
        getEl('projectSearchInput')?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim().toLowerCase();
            this.renderProjectList();
        });

        getEl('projectSortSelect')?.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.renderProjectList();
        });

        // 썸네일 업로드 이벤트 (새 프로젝트)
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

        // 편집 모달 관련
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
        const projectList = document.getElementById('projectList');
        if (!projectList) return;

        let projects = [];
        try {
            projects = await storage.getAllProjects();
        } catch (e) {
            console.error('프로젝트 데이터 로드 실패:', e);
        }

        // 헤더 통계 업데이트
        this.updateStatsBar(projects);

        // 검색 필터링
        let filteredProjects = projects;
        if (this.searchQuery) {
            filteredProjects = projects.filter(p => p.name.toLowerCase().includes(this.searchQuery));
        }

        // 정렬
        filteredProjects.sort((a, b) => {
            if (this.sortBy === 'name') {
                return a.name.localeCompare(b.name, 'ko');
            } else if (this.sortBy === 'created') {
                return (b.createdAt || 0) - (a.createdAt || 0);
            } else {
                // default: updated
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            }
        });

        projectList.innerHTML = '';

        // 최근 프로젝트 ID 파악 (가장 최근 수정된 프로젝트 1개)
        const mostRecentId = (projects.length > 0)
            ? [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.id
            : null;

        // 프로젝트 카드 렌더링
        if (filteredProjects.length > 0) {
            for (const project of filteredProjects) {
                const card = await this.createProjectCard(project, project.id === mostRecentId);
                projectList.appendChild(card);
            }
        } else if (this.searchQuery) {
            // 검색 결과 없음
            const emptyEl = document.createElement('div');
            emptyEl.className = 'project-empty-state';
            emptyEl.innerHTML = `
                <div class="project-empty-icon">🔍</div>
                <div class="project-empty-title">검색 결과가 없습니다</div>
                <div class="project-empty-desc">'${this.escapeHtml(this.searchQuery)}'에 해당하는 프로젝트를 찾지 못했습니다.</div>
            `;
            projectList.appendChild(emptyEl);
        }

        // 항상 마지막에 '새 프로젝트 생성' & '백업 및 복구' 인터랙티브 카드 추가
        const newCard = document.createElement('div');
        newCard.className = 'project-card-interactive';
        newCard.innerHTML = `
            <div class="project-interactive-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </div>
            <div class="project-interactive-title">새 프로젝트 생성</div>
            <div class="project-interactive-sub">새 소설 원고 및 스토리 노드 시작하기</div>
        `;
        newCard.onclick = () => this.showNewProjectModal();
        projectList.appendChild(newCard);

        const backupCard = document.createElement('div');
        backupCard.className = 'project-card-interactive backup-card';
        backupCard.innerHTML = `
            <div class="project-interactive-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
            </div>
            <div class="project-interactive-title">백업 및 데이터 복구</div>
            <div class="project-interactive-sub">POV 백업 파일 내보내기 / 불러오기</div>
        `;
        backupCard.onclick = () => this.showBackupModal();
        projectList.appendChild(backupCard);
    }

    updateStatsBar(projects) {
        const countEl = document.getElementById('totalProjectCount');
        const timeEl = document.getElementById('recentProjectTime');

        if (countEl) countEl.textContent = `${projects.length}개`;

        if (timeEl) {
            if (projects.length > 0) {
                const latest = [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                timeEl.textContent = this.formatRelativeTime(latest.updatedAt);
            } else {
                timeEl.textContent = '-';
            }
        }
    }

    async createProjectCard(project, isMostRecent = false) {
        const card = document.createElement('div');
        card.className = 'project-card';
        const thumbnail = project.thumbnail || '';

        // 노드(파일) 개수 비동기 로드
        let nodeCount = 0;
        try {
            if (window.storage?.getProjectFiles) {
                const files = await storage.getProjectFiles(project.id);
                nodeCount = Array.isArray(files) ? files.length : 0;
            }
        } catch (e) {
            console.warn('노드 개수 로드 실패:', e);
        }

        // 아트 플레이스홀더 그라데이션 및 엠블럼 텍스트
        const artGradient = this.generateArtGradient(project.name);
        const emblemChar = project.name ? project.name.trim().charAt(0).toUpperCase() : '📖';

        card.innerHTML = `
            <div class="project-card-thumbnail">
                ${thumbnail 
                    ? `<img src="${thumbnail}" class="project-card-thumbnail-img" alt="${this.escapeHtml(project.name)}">
                       <div class="project-card-thumbnail-overlay"></div>`
                    : `<div class="project-card-thumbnail-art" style="background: ${artGradient};">
                         <div class="project-card-emblem">${this.escapeHtml(emblemChar)}</div>
                       </div>`
                }
                ${isMostRecent ? `<div class="project-card-badge">✨ 최근 작업</div>` : ''}
            </div>

            <div class="project-card-actions">
                <button class="project-card-action-btn" data-action="edit" title="프로젝트 설정 / 수정">✏️</button>
                <button class="project-card-action-btn delete-btn" data-action="delete" title="프로젝트 삭제">🗑️</button>
            </div>

            <div class="project-card-body">
                <h3 class="project-card-title">${this.escapeHtml(project.name)}</h3>
                <div class="project-card-meta">
                    <div class="project-card-meta-item">
                        <span>🕒</span>
                        <span>${this.formatRelativeTime(project.updatedAt)}</span>
                    </div>
                    <div class="project-card-node-count">
                        <span>🧩</span>
                        <span>노드 ${nodeCount}개</span>
                    </div>
                </div>
            </div>
        `;

        card.onclick = (e) => {
            if (!e.target.closest('.project-card-action-btn')) {
                this.openProject(project.id);
            }
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

    generateArtGradient(nameStr) {
        let hash = 0;
        for (let i = 0; i < (nameStr || '').length; i++) {
            hash = nameStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h1 = Math.abs(hash) % 360;
        const h2 = (h1 + 60) % 360;
        return `linear-gradient(135deg, hsl(${h1}, 55%, 22%) 0%, hsl(${h2}, 65%, 12%) 100%)`;
    }

    formatRelativeTime(timestamp) {
        if (!timestamp) return '알 수 없음';
        const now = Date.now();
        const diffSec = Math.floor((now - timestamp) / 1000);

        if (diffSec < 60) return '방금 전';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}분 전`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour}시간 전`;
        const diffDay = Math.floor(diffHour / 24);
        if (diffDay < 30) return `${diffDay}일 전`;

        return new Date(timestamp).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
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

    async openProject(projectId) {
        window.currentProjectId = projectId;
        const project = await storage.getProject(projectId);
        if (!project) return;

        document.getElementById('currentProjectName').textContent = project.name;
        await window.fileTreeManager?.loadProjectFiles(projectId);

        document.getElementById('projectScreen')?.classList.add('hidden');
        document.getElementById('editorScreen')?.classList.remove('hidden');

        // 🌟 단일 통합 초기화 오케스트레이터 호출
        if (window.initProjectSession) {
            await window.initProjectSession(projectId);
        } else if (window.windowManager) {
            await window.windowManager.restoreSession(projectId);
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
}

// 명시적으로 window에 할당하여 app.js에서 접근 가능하도록 함
window.projectManager = new ProjectManager();
