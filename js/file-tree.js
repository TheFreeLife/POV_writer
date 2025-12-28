/**
 * 파일 트리 관리자 - 드래그 위치 정밀 인지 버전
 */
class FileTreeManager {
    constructor() {
        this.files = [];
        this.currentFileId = null;
        this.expandedFolders = new Set();
        this.newItemType = 'file';
        this.newItemParentId = null;
        this.editingItem = null; // 수정 중인 아이템 저장
        this.draggedFileId = null;
        this.currentProjectId = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('newFolderBtn')?.addEventListener('click', () => this.showNewItemModal('folder'));
        document.getElementById('newFileBtn')?.addEventListener('click', () => this.showNewItemModal('file'));
        document.getElementById('cancelNewFileBtn')?.addEventListener('click', () => this.hideNewItemModal());
        document.getElementById('closeNewFileModal')?.addEventListener('click', () => this.hideNewItemModal());
        document.getElementById('createFileBtn')?.addEventListener('click', () => this.saveItem());
        document.addEventListener('click', () => this.hideContextMenu());
    }

    async loadProjectFiles(projectId) {
        this.currentProjectId = projectId;
        this.files = await storage.getProjectFiles(projectId);
        this.renderFileTree();
        this.setupRootDropZone();
    }

    renderFileTree() {
        const container = document.getElementById('fileTree');
        if (!container) return;
        container.innerHTML = '';

        const rootItems = this.files
            .filter(f => !f.parentId)
            .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));

        if (rootItems.length === 0) {
            container.innerHTML = '<div class="text-muted text-center" style="padding: 20px; font-size: 13px;">파일이 없습니다.</div>';
            return;
        }

        rootItems.forEach(item => {
            container.appendChild(this.buildTreeItem(item, 0));
        });
    }

    buildTreeItem(file, level) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tree-node-wrapper';
        wrapper.setAttribute('data-id', file.id);

        const isFolder = file.type === 'folder';
        const isExpanded = this.expandedFolders.has(file.id);
        const isSelected = this.currentFileId === file.id;
        const hasChildren = isFolder && this.files.some(f => f.parentId === file.id);

        const item = document.createElement('div');
        item.className = `tree-item ${isSelected ? 'selected' : ''}`;
        item.style.paddingLeft = `${level * 40 + 12}px`;
        item.setAttribute('draggable', 'true');

        const chevron = hasChildren ? `<span class="tree-chevron ${isExpanded ? 'active' : ''}">▶</span>` : '';
        const icon = isFolder ? (hasChildren && isExpanded ? '📂' : '📁') : '📄';

        item.innerHTML = `
            ${chevron}
            <span class="tree-icon">${icon}</span>
            <span class="tree-name">${this.escapeHtml(file.name)}</span>
        `;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isFolder) {
                if (hasChildren) this.toggleFolder(file.id);
            } else {
                this.selectFile(file.id);
            }
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showContextMenu(e, file);
        });

        // 드래그 시작
        item.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            this.draggedFileId = file.id;
            e.dataTransfer.setData('text/plain', file.id);
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.tree-item').forEach(el =>
                el.classList.remove('drag-into', 'drag-before', 'drag-after')
            );
        });

        // 드래그 오버 (판정: 위/중앙/아래 구분)
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.draggedFileId === file.id) return;

            const rect = item.getBoundingClientRect();
            const mouseY = e.clientY - rect.top;

            item.classList.remove('drag-into', 'drag-before', 'drag-after');

            // 폴더 중앙은 내부 이동, 상단/하단은 삽입
            if (isFolder && mouseY > rect.height * 0.25 && mouseY < rect.height * 0.75) {
                item.classList.add('drag-into');
            } else if (mouseY < rect.height * 0.5) {
                item.classList.add('drag-before');
            } else {
                item.classList.add('drag-after');
            }
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-into', 'drag-before', 'drag-after');
        });

        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const position = item.classList.contains('drag-into') ? 'into' :
                item.classList.contains('drag-before') ? 'before' : 'after';

            item.classList.remove('drag-into', 'drag-before', 'drag-after');

            const sourceId = e.dataTransfer.getData('text/plain');
            if (sourceId && sourceId !== file.id) {
                await this.handleDrop(sourceId, file, position);
            }
        });

        wrapper.appendChild(item);

        if (isFolder && isExpanded) {
            const children = this.files
                .filter(f => f.parentId === file.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));

            children.forEach(child => {
                wrapper.appendChild(this.buildTreeItem(child, level + 1));
            });
        }

        return wrapper;
    }

    toggleFolder(id) {
        if (this.expandedFolders.has(id)) this.expandedFolders.delete(id);
        else this.expandedFolders.add(id);
        this.renderFileTree();
    }

    async selectFile(id) {
        if (this.currentFileId === id) return;
        if (this.currentFileId) await window.editorManager?.saveCurrentFile(true);
        this.currentFileId = id;
        await window.editorManager?.loadFile(id);
        this.renderFileTree();
    }

    async handleDrop(draggedId, targetFile, position) {
        if (this.isDescendant(targetFile.id, draggedId)) {
            alert('자신의 하위 폴더로는 이동할 수 없습니다.');
            return;
        }

        let newParentId = null;
        let newOrder = 0;

        if (position === 'into') {
            newParentId = targetFile.id;
            const siblings = this.files.filter(f => f.parentId === newParentId);
            newOrder = siblings.length;
            this.expandedFolders.add(newParentId);
        } else {
            newParentId = targetFile.parentId;
            const siblings = this.files
                .filter(f => f.parentId === newParentId && f.id !== draggedId)
                .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));

            const targetIdx = siblings.findIndex(s => s.id === targetFile.id);
            newOrder = position === 'before' ? targetIdx : targetIdx + 1;
            if (newOrder < 0) newOrder = siblings.length;

            for (let i = 0; i < siblings.length; i++) {
                const updatedOrder = i >= newOrder ? i + 1 : i;
                if (siblings[i].order !== updatedOrder) {
                    await storage.updateFile(siblings[i].id, { order: updatedOrder });
                }
            }
        }

        await storage.updateFile(draggedId, { parentId: newParentId, order: newOrder });
        await this.loadProjectFiles(this.currentProjectId);
    }

    setupRootDropZone() {
        const container = document.getElementById('fileTree');
        if (!container || this.rootDropSet) return;

        container.addEventListener('dragover', (e) => {
            if (e.target === container || e.target.classList.contains('text-muted')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });

        container.addEventListener('drop', async (e) => {
            if (e.target === container || e.target.classList.contains('text-muted')) {
                e.preventDefault();
                const sourceId = e.dataTransfer.getData('text/plain');
                if (sourceId) {
                    const rootItems = this.files.filter(f => !f.parentId);
                    await storage.updateFile(sourceId, { parentId: null, order: rootItems.length });
                    await this.loadProjectFiles(this.currentProjectId);
                }
            }
        });
        this.rootDropSet = true;
    }

    isDescendant(targetId, potentialAncestorId) {
        let current = this.files.find(f => f.id === targetId);
        while (current && current.parentId) {
            if (current.parentId === potentialAncestorId) return true;
            current = this.files.find(f => f.id === current.parentId);
        }
        return false;
    }

    async showNewItemModal(type, parentId = null, itemToEdit = null) {
        this.newItemType = type;
        this.newItemParentId = parentId;
        this.editingItem = itemToEdit;

        const modal = document.getElementById('newFileModal');
        const title = document.getElementById('newFileModalTitle');
        const templateGroup = document.getElementById('templateGroup');
        const templateSelect = document.getElementById('fileTemplate');
        const templateLabel = templateGroup?.querySelector('.form-label');
        const submitBtn = document.getElementById('createFileBtn');

        if (modal && title) {
            if (this.editingItem) {
                title.textContent = this.editingItem.type === 'folder' ? '폴더 정보 수정' : '파일 이름 변경';
                submitBtn.textContent = '수정';
                document.getElementById('fileName').value = this.editingItem.name;
            } else {
                title.textContent = type === 'folder' ? '새 폴더 생성' : '새 파일 생성';
                submitBtn.textContent = '생성';
                document.getElementById('fileName').value = '';
            }

            if (templateGroup && templateLabel) {
                // 폴더이거나 새 파일인 경우 템플릿 영역 표시
                if (type === 'folder' || !this.editingItem) {
                    templateGroup.style.display = 'block';
                    templateLabel.textContent = type === 'folder' ? '기본 템플릿 (해당 폴더 내 새 파일에 적용)' : '파일 템플릿 선택';
                } else {
                    // 파일 수정 시에는 템플릿 선택 숨기기 (내용이 날아갈 수 있으므로)
                    templateGroup.style.display = 'none';
                }
            }

            // 커스텀 템플릿 로드
            if (templateSelect) {
                await this.refreshTemplateOptions();

                if (this.editingItem && this.editingItem.type === 'folder') {
                    templateSelect.value = this.editingItem.defaultTemplate || 'blank';
                } else if (parentId && !this.editingItem) {
                    // 새 아이템 생성 시 부모 템플릿 상속
                    const parentFolder = this.files.find(f => f.id === parentId);
                    templateSelect.value = (parentFolder && parentFolder.defaultTemplate) ? parentFolder.defaultTemplate : 'blank';
                } else {
                    templateSelect.value = 'blank';
                }
            }

            modal.classList.remove('hidden');
            document.getElementById('fileName').focus();
        }
    }

    async refreshTemplateOptions() {
        const select = document.getElementById('fileTemplate');
        if (!select) return;

        // 기본 템플릿
        select.innerHTML = `
            <option value="blank">빈 파일</option>
            <option value="item">📦 아이템 설정 (이름, 특징, 소유자 등)</option>
            <option value="place">🗺️ 장소/배경 설정 (위치, 분위기, 역사 등)</option>
        `;

        // DB에서 커스텀 템플릿 가져오기
        const customTemplates = await window.storage?.getAllTemplates();
        if (customTemplates && customTemplates.length > 0) {
            customTemplates.forEach(tpl => {
                const opt = document.createElement('option');
                opt.value = `custom-${tpl.id}`;
                opt.textContent = `${tpl.icon} ${tpl.name}`;
                select.appendChild(opt);
            });
        }
    }

    hideNewItemModal() {
        document.getElementById('newFileModal')?.classList.add('hidden');
        this.editingItem = null;
    }

    async saveItem() {
        const name = document.getElementById('fileName').value.trim();
        if (!name) return alert('이름을 입력해주세요.');

        const template = document.getElementById('fileTemplate').value;

        // 수정 모드인 경우
        if (this.editingItem) {
            try {
                const updates = { name };
                if (this.editingItem.type === 'folder') {
                    updates.defaultTemplate = template === 'blank' ? null : template;
                }
                await storage.updateFile(this.editingItem.id, updates);
                await this.loadProjectFiles(this.currentProjectId);
                this.hideNewItemModal();
                return;
            } catch (error) {
                console.error('아이템 수정 실패:', error);
                return alert('수정 중 오류가 발생했습니다.');
            }
        }

        // 생성 모드인 경우
        let content = '';
        let defaultTemplate = null;

        if (this.newItemType === 'file') {
            content = await this.getTemplateContent(template);
        } else {
            defaultTemplate = template === 'blank' ? null : template;
        }

        try {
            const siblings = this.files.filter(f => f.parentId === this.newItemParentId);
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(f => f.order)) : -1;

            await storage.createFile({
                projectId: this.currentProjectId,
                name,
                type: this.newItemType,
                parentId: this.newItemParentId,
                content,
                defaultTemplate,
                order: maxOrder + 1
            });

            if (this.newItemParentId) {
                this.expandedFolders.add(this.newItemParentId);
            }

            await this.loadProjectFiles(this.currentProjectId);
            this.hideNewItemModal();
        } catch (error) {
            console.error('아이템 생성 실패:', error);
            alert('생성 중 오류가 발생했습니다.');
        }
    }

    async getTemplateContent(template) {
        if (template.startsWith('custom-')) {
            const tplId = template.replace('custom-', '');
            const templates = await window.storage?.getAllTemplates();
            const found = templates.find(t => t.id === tplId);
            return found ? found.content : '';
        }

        switch (template) {
            case 'item':
                return `# 아이템 이름: \n\n## 1. 개요\n- 아이템 분류: \n- 현재 소유자: \n\n## 2. 특징\n- 형태: \n- 능력/기능: \n- 희귀도: \n\n## 3. 배경 및 역사\n- 제작자: \n- 발견 장소: \n- 관련 전설: \n\n## 4. 기타 메모\n- `;
            case 'place':
                return `# 장소 이름: \n\n## 1. 개요\n- 대륙/지역: \n- 지형적 특징: \n\n## 2. 분위기 및 묘사\n- 주된 기후: \n- 시각적 특징: \n- 배경 음악/소리: \n\n## 3. 역사 및 주요 사건\n- 설립 시기: \n- 중요한 과거 사건: \n\n## 4. 주요 세력 및 인물\n- 통치 세력: \n- 주목할 만한 거주자: \n\n## 5. 기타 메모\n- `;
            default:
                return '';
        }
    }

    showContextMenu(e, file) {
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

        menu.innerHTML = `
            ${file.type === 'folder' ? `
                <div class="context-menu-item" id="ctx-new-file"><span class="context-menu-icon">📄</span> 새 파일</div>
                <div class="context-menu-item" id="ctx-new-folder"><span class="context-menu-icon">📁</span> 새 폴더</div>
                <div class="context-menu-divider"></div>
            ` : ''}
            <div class="context-menu-item" id="ctx-rename"><span class="context-menu-icon">✏️</span> ${file.type === 'folder' ? '폴더 정보 수정' : '이름 변경'}</div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item danger" id="ctx-delete"><span class="context-menu-icon">🗑️</span> 삭제</div>
        `;
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.remove('hidden');

        document.getElementById('ctx-new-file')?.addEventListener('click', () => this.showNewItemModal('file', file.id));
        document.getElementById('ctx-new-folder')?.addEventListener('click', () => this.showNewItemModal('folder', file.id));
        document.getElementById('ctx-rename')?.addEventListener('click', () => this.showNewItemModal(file.type, file.parentId, file));
        document.getElementById('ctx-delete')?.addEventListener('click', () => this.deleteItem(file));
    }

    hideContextMenu() {
        document.getElementById('contextMenu')?.classList.add('hidden');
    }

    async createChild(parentId, type) {
        const name = prompt(`새 ${type === 'folder' ? '폴더' : '파일'} 이름:`);
        if (!name) return;
        const siblings = this.files.filter(f => f.parentId === parentId);
        await storage.createFile({
            projectId: this.currentProjectId,
            name,
            type,
            parentId,
            order: siblings.length
        });
        this.expandedFolders.add(parentId);
        await this.loadProjectFiles(this.currentProjectId);
    }


    async deleteItem(file) {
        const msg = file.type === 'folder' ? `"${file.name}" 폴더와 모든 내용이 삭제됩니다. 계속할까요?` : `"${file.name}" 파일을 삭제할까요?`;
        if (confirm(msg)) {
            await storage.deleteFile(file.id);
            if (this.currentFileId === file.id) {
                this.currentFileId = null;
                window.editorManager?.hideEditor();
            }
            await this.loadProjectFiles(this.currentProjectId);
        }
    }

    clearState() {
        this.currentFileId = null;
        this.files = [];
        this.expandedFolders.clear();
        const container = document.getElementById('fileTree');
        if (container) container.innerHTML = '';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
window.fileTreeManager = new FileTreeManager();
