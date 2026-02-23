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
        
        // 폴더 설정 모달 관련 리스너
        document.getElementById('cancelFolderSettingsBtn')?.addEventListener('click', () => this.hideFolderSettingsModal());
        document.getElementById('closeFolderSettingsModal')?.addEventListener('click', () => this.hideFolderSettingsModal());
        document.getElementById('saveFolderSettingsBtn')?.addEventListener('click', () => this.saveFolderSettings());

        // 폴더 통계 모달 관련 리스너
        document.getElementById('closeFolderStatsModal')?.addEventListener('click', () => this.hideFolderStatsModal());
        document.getElementById('closeFolderStatsBtn')?.addEventListener('click', () => this.hideFolderStatsModal());

        document.addEventListener('click', () => this.hideContextMenu());
    }

    async loadProjectFiles(projectId) {
        this.currentProjectId = projectId;
        this.files = await storage.getProjectFiles(projectId);
        this.renderFileTree();
        this.setupRootDropZone();
        
        // 하이퍼링크 정보 갱신 (비동기)
        if (window.windowManager && window.windowManager.updateAllHighlighters) {
            window.windowManager.updateAllHighlighters();
        }
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
        this.currentFileId = id;
        // 다중 창 시스템: 윈도우 매니저를 통해 파일을 캔버스 위 창으로 열기
        if (window.windowManager) {
            await window.windowManager.openWindow(id);
        }
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
        // 폴더 수정인 경우 폴더 설정 모달로 리다이렉트
        if (itemToEdit && itemToEdit.type === 'folder') {
            return this.showFolderSettingsModal(itemToEdit);
        }

        this.newItemType = type;
        this.newItemParentId = parentId;
        this.editingItem = itemToEdit;

        const modal = document.getElementById('newFileModal');
        const title = document.getElementById('newFileModalTitle');
        const templateGroup = document.getElementById('templateGroup');
        const templateSelect = document.getElementById('fileTemplate');
        const submitBtn = document.getElementById('createFileBtn');

        if (modal && title) {
            if (this.editingItem) {
                title.textContent = '파일 이름 변경';
                submitBtn.textContent = '수정';
                document.getElementById('fileName').value = this.editingItem.name;
                if (templateGroup) templateGroup.style.display = 'none'; // 파일 수정 시 템플릿 숨김
            } else {
                title.textContent = type === 'folder' ? '새 폴더 생성' : '새 파일 생성';
                submitBtn.textContent = '생성';
                document.getElementById('fileName').value = '';
                if (templateGroup) templateGroup.style.display = 'block';
            }

            // 커스텀 템플릿 로드
            if (templateSelect && templateGroup?.style.display !== 'none') {
                await this.refreshTemplateOptions('fileTemplate');

                if (parentId && !this.editingItem) {
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
                <div class="context-menu-item" id="ctx-folder-stats"><span class="context-menu-icon">📊</span> 통계</div>
                <div class="context-menu-item" id="ctx-folder-settings"><span class="context-menu-icon">⚙️</span> 폴더 설정</div>
            ` : `
                <div class="context-menu-item" id="ctx-rename"><span class="context-menu-icon">✏️</span> 이름 변경</div>
            `}
            <div class="context-menu-divider"></div>
            <div class="context-menu-item danger" id="ctx-delete"><span class="context-menu-icon">🗑️</span> 삭제</div>
        `;
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.remove('hidden');

        document.getElementById('ctx-new-file')?.addEventListener('click', () => this.showNewItemModal('file', file.id));
        document.getElementById('ctx-new-folder')?.addEventListener('click', () => this.showNewItemModal('folder', file.id));
        document.getElementById('ctx-folder-stats')?.addEventListener('click', () => this.showFolderStatsModal(file));
        document.getElementById('ctx-folder-settings')?.addEventListener('click', () => this.showFolderSettingsModal(file));
        document.getElementById('ctx-rename')?.addEventListener('click', () => this.showNewItemModal(file.type, file.parentId, file));
        document.getElementById('ctx-delete')?.addEventListener('click', () => this.deleteItem(file));
    }

    async showFolderStatsModal(file) {
        const modal = document.getElementById('folderStatsModal');
        const nameEl = document.getElementById('statsFolderName');
        const totalCharsEl = document.getElementById('totalFolderChars');
        const totalFilesEl = document.getElementById('totalFolderFiles');
        const mentionListEl = document.getElementById('fileMentionList');

        if (!modal) return;

        nameEl.textContent = file.name;
        totalCharsEl.textContent = '계산 중...';
        totalFilesEl.textContent = '계산 중...';
        mentionListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-text-tertiary);">데이터 분석 중...</div>';

        modal.classList.remove('hidden');

        // 통계 데이터 수집 및 계산
        try {
            const allProjectFiles = await storage.getProjectFiles(this.currentProjectId);
            
            // 1. 해당 폴더 내부의 모든 파일 찾기 (재귀적)
            const getChildrenRecursive = (parentId) => {
                let children = allProjectFiles.filter(f => f.parentId === parentId);
                let allChildren = [...children];
                children.forEach(c => {
                    if (c.type === 'folder') {
                        allChildren = [...allChildren, ...getChildrenRecursive(c.id)];
                    }
                });
                return allChildren;
            };

            const folderContent = getChildrenRecursive(file.id);
            const filesOnly = folderContent.filter(f => f.type === 'file');
            
            // 2. 총 글자 수 계산 (실시간 창 텍스트 반영)
            let totalChars = 0;
            filesOnly.forEach(f => {
                const openWin = window.windowManager?.windows.get(f.id);
                const content = openWin ? openWin.textarea.value : (f.content || '');
                totalChars += content.length;
            });

            totalCharsEl.textContent = `${totalChars.toLocaleString()}자`;
            totalFilesEl.textContent = `${filesOnly.length}개`;

            // 3. 파일별 언급 횟수 계산 (프로젝트 전체 기준)
            // 전체 텍스트 수집 (실시간 창 반영)
            let fullProjectText = '';
            allProjectFiles.forEach(f => {
                if (f.type === 'file') {
                    const openWin = window.windowManager?.windows.get(f.id);
                    fullProjectText += (openWin ? openWin.textarea.value : (f.content || '')) + '\n';
                }
            });

            const mentionStats = filesOnly.map(f => {
                if (!f.name) return { name: '이름 없음', count: 0 };
                // 정규표현식으로 언급 횟수 계산
                const regexSafeName = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(regexSafeName, 'g');
                const matches = fullProjectText.match(regex);
                return {
                    name: f.name,
                    count: matches ? matches.length : 0
                };
            }).sort((a, b) => b.count - a.count);

            // 4. 목록 렌더링
            if (mentionStats.length === 0) {
                mentionListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-text-tertiary);">파일이 없습니다.</div>';
            } else {
                mentionListEl.innerHTML = mentionStats.map(s => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--color-border);">
                        <span style="font-size: 13px; color: var(--color-text-primary);">${this.escapeHtml(s.name)}</span>
                        <span style="font-size: 12px; font-weight: 600; color: var(--color-accent-primary); background: var(--color-surface-3); padding: 4px 10px; border-radius: 20px;">${s.count}회 언급</span>
                    </div>
                `).join('');
            }

        } catch (error) {
            console.error('폴더 통계 계산 실패:', error);
            mentionListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-accent-danger);">데이터를 불러오는데 실패했습니다.</div>';
        }
    }

    hideFolderStatsModal() {
        document.getElementById('folderStatsModal')?.classList.add('hidden');
    }

    async showFolderSettingsModal(file) {
        this.editingItem = file;
        const modal = document.getElementById('folderSettingsModal');
        const nameInput = document.getElementById('folderNameInput');
        const templateSelect = document.getElementById('folderTemplateSelect');
        const checkbox = document.getElementById('hyperlinkEnabled');
        
        if (modal) {
            if (nameInput) nameInput.value = file.name;
            if (checkbox) checkbox.checked = !!file.hyperlinkEnabled;
            
            // 템플릿 목록 로드 및 선택
            if (templateSelect) {
                await this.refreshTemplateOptions('folderTemplateSelect');
                templateSelect.value = file.defaultTemplate || 'blank';
            }
            
            modal.classList.remove('hidden');
            if (nameInput) nameInput.focus();
        }
    }

    // 템플릿 옵션 새로고침 유틸리티
    async refreshTemplateOptions(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = `
            <option value="blank">빈 파일</option>
            <option value="item">📦 아이템 설정</option>
            <option value="place">🗺️ 장소/배경 설정</option>
        `;

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

    hideFolderSettingsModal() {
        document.getElementById('folderSettingsModal')?.classList.add('hidden');
        this.editingItem = null;
    }

    async saveFolderSettings() {
        if (!this.editingItem) return;
        
        const name = document.getElementById('folderNameInput').value.trim();
        const template = document.getElementById('folderTemplateSelect').value;
        const enabled = document.getElementById('hyperlinkEnabled').checked;
        
        if (!name) return alert('이름을 입력해주세요.');

        try {
            await storage.updateFile(this.editingItem.id, { 
                name, 
                defaultTemplate: template === 'blank' ? null : template,
                hyperlinkEnabled: enabled 
            });
            await this.loadProjectFiles(this.currentProjectId);
            
            if (window.windowManager && window.windowManager.updateAllHighlighters) {
                await window.windowManager.updateAllHighlighters();
            }
            
            this.hideFolderSettingsModal();
        } catch (error) {
            console.error('폴더 설정 저장 실패:', error);
            alert('저장 중 오류가 발생했습니다.');
        }
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
            // 삭제 전, 해당 파일(또는 폴더 내의 파일들)이 캔버스에 열려 있다면 창 닫기
            if (window.windowManager) {
                if (file.type === 'folder') {
                    // 폴더 삭제 시 하위 파일들도 모두 닫기
                    const children = this.files.filter(f => f.parentId === file.id || this.isDescendant(f.id, file.id));
                    for (const child of children) {
                        if (child.type === 'file') {
                            await window.windowManager.closeWindow(child.id);
                        }
                    }
                } else {
                    await window.windowManager.closeWindow(file.id);
                }
            }

            await storage.deleteFile(file.id);
            if (this.currentFileId === file.id) {
                this.currentFileId = null;
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
