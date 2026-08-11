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
        // 노드 추가 버튼 -> 노드 형태 선택 모달 열기
        document.getElementById('newNodeBtn')?.addEventListener('click', () => {
            this.showNodeSelectModal();
        });

        document.getElementById('closeNodeSelectModal')?.addEventListener('click', () => this.hideNodeSelectModal());
        document.getElementById('cancelNodeSelectBtn')?.addEventListener('click', () => this.hideNodeSelectModal());

        // 하단 "나만의 커스텀 노드 정의하기" 버튼 -> 커스텀 마법사 모달로 전환
        document.getElementById('openCustomWizardBtn')?.addEventListener('click', () => {
            this.hideNodeSelectModal();
            this.showCustomWizardModal();
        });

        const nodeSelectModal = document.getElementById('nodeSelectModal');
        if (nodeSelectModal) {
            // 기본 프리셋 노드 형태 선택 카드 이벤트
            nodeSelectModal.querySelectorAll('.node-type-card').forEach(card => {
                card.addEventListener('click', () => {
                    const presetType = card.dataset.presetType;
                    this.hideNodeSelectModal();

                    if (presetType === 'stat') this.showNewStatModal();
                    else if (presetType === 'image') this.showNewImageModal();
                    else if (presetType === 'folder_collector') this.createCustomFolderCollectorNode('폴더 자동 수집기', '📂', '선택한 폴더의 모든 노드 자동 수집');
                    else this.showNewItemModal('file');

                });
            });
        }

        // --- 커스텀 마법사 모달 이벤트 ---
        document.getElementById('closeCustomWizardModal')?.addEventListener('click', () => this.hideCustomWizardModal());
        document.getElementById('cancelCustomWizardBtn')?.addEventListener('click', () => this.hideCustomWizardModal());
        document.getElementById('submitCustomWizardBtn')?.addEventListener('click', () => this.handleCustomWizardSubmit());

        const customWizardModal = document.getElementById('customWizardModal');
        if (customWizardModal) {
            customWizardModal.querySelectorAll('.wizard-type-card').forEach(card => {

                card.addEventListener('click', () => {
                    customWizardModal.querySelectorAll('.wizard-type-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.selectedWizardType = card.dataset.wizardType || 'file';
                    this.updateCustomWizardUI();
                });
            });
        }

        // 상단 탭 전환 이벤트
        document.querySelectorAll('.wizard-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.wizardTab;
                if (targetTab) this.switchWizardTab(targetTab);
            });
        });

        // 수치 항목 추가 버튼
        document.getElementById('wizardAddStatBtn')?.addEventListener('click', () => {
            const newName = '';
            this.addWizardStatRow(newName, 0);
        });


        // 텍스트 항목 추가 버튼
        document.getElementById('wizardAddTextFieldBtn')?.addEventListener('click', () => {
            this.addWizardTextFieldRow('', '');
        });

        // 포트 항목 추가 버튼
        document.getElementById('wizardAddInputPortBtn')?.addEventListener('click', () => {
            const existing = this.getWizardAllVarNames();
            let candidate = '입력 데이터';
            let idx = 1;
            while (existing.includes(candidate)) { candidate = `입력 데이터 ${++idx}`; }
            this.addPortConfigRow('input', candidate);
        });
        document.getElementById('wizardAddOutputPortBtn')?.addEventListener('click', () => {
            const existing = this.getWizardAllVarNames();
            let candidate = `출력 데이터 ${document.querySelectorAll('#wizardOutputPortList .stat-field-row').length + 1}`;
            let idx = document.querySelectorAll('#wizardOutputPortList .stat-field-row').length + 1;
            while (existing.includes(candidate)) { candidate = `출력 데이터 ${++idx}`; }
            this.addPortConfigRow('output', candidate);
        });

        // 테스트 실행 버튼
        document.getElementById('wizardTestRunBtn')?.addEventListener('click', () => {
            this.runWizardCodeTest();
        });

        // 사용 설명서 모달 열기/닫기
        const manualModal = document.getElementById('wizardCodeManualModal');
        document.getElementById('wizardCodeManualBtn')?.addEventListener('click', () => {
            manualModal?.classList.remove('hidden');
        });
        document.getElementById('closeWizardCodeManualModal')?.addEventListener('click', () => {
            manualModal?.classList.add('hidden');
        });
        document.getElementById('confirmWizardCodeManualBtn')?.addEventListener('click', () => {
            manualModal?.classList.add('hidden');
        });

        // 변수 칩 업데이트: input 변수가 바뀔 때마다 칩 업데이트
        const updateVarChips = () => this.updateWizardVarChips();
        document.getElementById('wizardStatList')?.addEventListener('input', updateVarChips);
        document.getElementById('wizardTextFieldsList')?.addEventListener('input', updateVarChips);
        document.getElementById('wizardInputPortList')?.addEventListener('input', updateVarChips);
        document.getElementById('wizardStatList')?.addEventListener('click', () => setTimeout(updateVarChips, 50));
        document.getElementById('wizardTextFieldsList')?.addEventListener('click', () => setTimeout(updateVarChips, 50));
        document.getElementById('wizardInputPortList')?.addEventListener('click', () => setTimeout(updateVarChips, 50));

        // 커스텀 마법사 이모지 피커 연동 (다중 행 Grid 스타일)
        const wizardIconBtn = document.getElementById('wizardIconBtn');
        const wizardIconPopover = document.getElementById('wizardIconPopover');
        if (wizardIconBtn && wizardIconPopover) {
            const emojis = [
                // 문서 및 서식
                '📄', '📜', '📖', '📝', '🖋️', '✒️', '✉️', '📓', '📕', '📘', '📙', '🏷️', '📋', '📌',
                // 게임/수치/UI
                '📊', '📈', '📉', '🎮', '🕹️', '🎲', '🎯', '🃏', '🧩', '👾', '🤖', '🔋', '💾', '⚙️', '⚖️',
                // 무기 및 장비
                '🗡️', '⚔️', '🏹', '🔫', '💣', '🛡️', '🪖', '🥋', '💍', '📿', '🔨', '⛏️', '🪓', '⚒️', '🔧',
                // 마법 및 요소
                '🔮', '🧪', '🌡️', '🧬', '⚡', '✨', '🌟', '💥', '🌀', '❄️', '🔥', '💧', '🍃', '☀️', '🌙',
                // 장소 및 배경
                '🏰', '⛪', '🏘️', '🏡', '🏛️', '⛩️', '🏔️', '🌋', '🏜️', '🏝️', '🌊', '🌲', '🌳', '⛺', '🗿',
                // 인물 및 몬스터
                '👤', '👥', '🤴', '👸', '👮‍♂️', '🕵️‍♀️', '💂‍♂️', '🦸‍♂️', '🦹‍♂️', '🧙‍♂️', '🧛‍♂️', '🧟‍♂️', '🐺', '🐉', '🐲',
                // 아이템 및 자원
                '💰', '💎', '🪙', '🗝️', '🔑', '🔓', '🔒', '📦', '🎁', '🍎', '🥩', '🍺', '💊', '💉', '🖼️', '📁'
            ];
            wizardIconPopover.innerHTML = '';
            emojis.forEach(emo => {
                const item = document.createElement('div');
                item.className = 'icon-item';
                item.textContent = emo;
                item.title = emo;
                item.onclick = (e) => {
                    e.stopPropagation();
                    wizardIconBtn.textContent = emo;
                    const inputEl = document.getElementById('wizardIcon');
                    if (inputEl) inputEl.value = emo;
                    wizardIconPopover.classList.add('hidden');
                };
                wizardIconPopover.appendChild(item);
            });

            wizardIconBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                wizardIconPopover.classList.toggle('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!wizardIconBtn.contains(e.target) && !wizardIconPopover.contains(e.target)) {
                    wizardIconPopover.classList.add('hidden');
                }
            });
        }

        document.getElementById('newFolderBtn')?.addEventListener('click', () => this.showNewItemModal('folder'));
        document.getElementById('newStatBtn')?.addEventListener('click', () => this.showNewStatModal());
        document.getElementById('newImageBtn')?.addEventListener('click', () => this.showNewImageModal());
        document.getElementById('newFileBtn')?.addEventListener('click', () => this.showNewItemModal('file'));
        document.getElementById('cancelNewFileBtn')?.addEventListener('click', () => this.hideNewItemModal());
        document.getElementById('closeNewFileModal')?.addEventListener('click', () => this.hideNewItemModal());
        document.getElementById('createFileBtn')?.addEventListener('click', () => this.saveItem());
        
        // 새 이미지 모달 이벤트
        document.getElementById('cancelNewImageBtn')?.addEventListener('click', () => this.hideNewImageModal());
        document.getElementById('closeNewImageModal')?.addEventListener('click', () => this.hideNewImageModal());
        
        const imageUploadWrapper = document.getElementById('imageUploadWrapper');
        if (imageUploadWrapper) {
            imageUploadWrapper.addEventListener('click', () => document.getElementById('imageFileInput').click());
            
            imageUploadWrapper.addEventListener('dragover', (e) => {
                e.preventDefault();
                imageUploadWrapper.classList.add('dragover');
            });

            imageUploadWrapper.addEventListener('dragleave', () => {
                imageUploadWrapper.classList.remove('dragover');
            });

            imageUploadWrapper.addEventListener('drop', (e) => {
                e.preventDefault();
                imageUploadWrapper.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    // input 요소에도 파일을 설정해주어 나중에 save 시 사용할 수 있게 함
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    const input = document.getElementById('imageFileInput');
                    if (input) input.files = dt.files;
                    
                    this.processImageFile(file);
                }
            });
        }
        
        document.getElementById('imageFileInput')?.addEventListener('change', (e) => this.handleImagePreview(e));
        document.getElementById('createImageItemBtn')?.addEventListener('click', () => this.saveImageItem());

        // 폴더 설정 모달 관련 리스너
        document.getElementById('cancelFolderSettingsBtn')?.addEventListener('click', () => this.hideFolderSettingsModal());
        document.getElementById('closeFolderSettingsModal')?.addEventListener('click', () => this.hideFolderSettingsModal());
        document.getElementById('saveFolderSettingsBtn')?.addEventListener('click', () => this.saveFolderSettings());

        // 폴더 통계 모달 관련 리스너
        document.getElementById('closeFolderStatsModal')?.addEventListener('click', () => this.hideFolderStatsModal());
        document.getElementById('closeFolderStatsBtn')?.addEventListener('click', () => this.hideFolderStatsModal());

        // 색상 선택기 리스너
        const colorPicker = document.getElementById('folderColorPicker');
        if (colorPicker) {
            colorPicker.addEventListener('click', (e) => {
                const swatch = e.target.closest('.color-swatch');
                if (swatch) {
                    document.querySelectorAll('#folderColorPicker .color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                }
            });

            // 드래그 스크롤 기능 추가
            let isDown = false;
            let startX;
            let scrollLeft;

            colorPicker.addEventListener('mousedown', (e) => {
                isDown = true;
                colorPicker.classList.add('grabbing');
                startX = e.pageX - colorPicker.offsetLeft;
                scrollLeft = colorPicker.scrollLeft;
            });

            colorPicker.addEventListener('mouseleave', () => {
                isDown = false;
                colorPicker.classList.remove('grabbing');
            });

            colorPicker.addEventListener('mouseup', () => {
                isDown = false;
                colorPicker.classList.remove('grabbing');
            });

            colorPicker.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX - colorPicker.offsetLeft;
                const walk = (x - startX) * 2; // 스크롤 속도 조절
                colorPicker.scrollLeft = scrollLeft - walk;
            });
        }

        document.addEventListener('click', () => this.hideContextMenu());
    }

    /**
     * 수치 계산기 커스텀 노드 생성
     */
    async showNewStatModal(parentId = null) {
        const fileData = {
            name: '📊 수치 계산기',
            type: 'file',
            parentId: parentId,
            isCustomNode: true,
            template: 'custom_node',
            icon: '📊',
            description: '스탯 입력값과 연산 코드가 포함된 노드',
            fields: [
                { name: '근력', val: 10, type: 'stat' },
                { name: '민첩', val: 10, type: 'stat' },
                { name: '지능', val: 10, type: 'stat' }
            ],
            code: `const 총합 = (Number(input.근력) || 0) + (Number(input.민첩) || 0) + (Number(input.지능) || 0);\nconst 전투력 = (Number(input.근력) || 0) * 2 + (Number(input.민첩) || 0) * 1.5 + (Number(input.지능) || 0);\nreturn { 총합, 전투력 };`,
            portsConfig: {
                inputs: [],
                outputs: [
                    { id: 'out_1', name: '총합', color: '#00ffcc' },
                    { id: 'out_2', name: '전투력', color: '#00ffcc' }
                ]
            }
        };

        await this.createNewCustomNode(fileData);
    }


    /**
     * 이미지 생성 모달 표시
     */
    showNewImageModal() {
        const modal = document.getElementById('newImageModal');
        if (!modal) return;

        document.getElementById('imageFileNameInput').value = '';
        document.getElementById('imageFileInput').value = '';
        document.getElementById('imageFilePreview').classList.add('hidden');
        document.getElementById('imageFilePlaceholder').classList.remove('hidden');

        modal.classList.remove('hidden');
        document.getElementById('imageFileNameInput').focus();
    }

    hideNewImageModal() {
        document.getElementById('newImageModal')?.classList.add('hidden');
    }

    processImageFile(file) {
        if (!file || !file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const preview = document.getElementById('imageFilePreview');
            const placeholder = document.getElementById('imageFilePlaceholder');
            if (preview && placeholder) {
                preview.src = event.target.result;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
            }
        };
        reader.readAsDataURL(file);
    }

    handleImagePreview(e) {
        const file = e.target.files[0];
        this.processImageFile(file);
    }

    async saveImageItem() {
        const name = document.getElementById('imageFileNameInput').value.trim();
        const fileInput = document.getElementById('imageFileInput');
        const file = fileInput.files[0];

        if (!name) return alert('이미지 이름을 입력해주세요.');
        if (!file) return alert('이미지를 선택해주세요.');

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            try {
                const siblings = this.files.filter(f => !f.parentId); // 일단 루트에 생성
                const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(f => f.order)) : -1;

                await storage.createFile({
                    projectId: this.currentProjectId,
                    name,
                    type: 'file',
                    parentId: null,
                    content: base64,
                    template: 'image',
                    portsConfig: { inputs: [], outputs: [{ id: 'out_1', name: '출력 데이터' }] },
                    order: maxOrder + 1
                });

                await this.loadProjectFiles(this.currentProjectId);
                this.hideNewImageModal();
                window.showToast?.('이미지 파일이 생성되었습니다.');
            } catch (error) {
                console.error('이미지 파일 생성 실패:', error);
                alert('생성 중 오류가 발생했습니다.');
            }
        };
        reader.readAsDataURL(file);
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
        
        let icon = '📄';
        if (isFolder) {
            icon = (hasChildren && isExpanded ? '📂' : '📁');
        } else if (file.template === 'stat') {
            icon = '📊';
        } else if (file.template === 'image' || (file.content && file.content.startsWith('data:image'))) {
            icon = '🖼️';
        }

        const iconColor = file.iconColor || '';
        const iconStyle = iconColor ? `style="--icon-color: ${iconColor};"` : '';

        item.innerHTML = `
            ${chevron}
            <span class="tree-icon" ${iconStyle}>${icon}</span>
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

        // 빈 공간 우클릭 처리
        container.addEventListener('contextmenu', (e) => {
            // 트리 아이템 위가 아닌 순수 컨테이너 위일 때만 작동
            if (e.target === container || e.target.classList.contains('text-muted')) {
                e.preventDefault();
                e.stopPropagation();
                this.showRootContextMenu(e);
            }
        });

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

    showExistingNodeOpenModal() {
        const modal = document.getElementById('existingNodeOpenModal');
        const container = document.getElementById('existingNodeListContainer');
        if (!modal || !container) return;

        container.innerHTML = '';

        const openableFiles = this.files.filter(f => f.type !== 'folder');

        if (openableFiles.length === 0) {
            container.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--color-text-tertiary);">
                    생성되어 저장된 노드가 없습니다.<br>
                    <strong>[➕ 새 노드 생성]</strong> 버튼을 눌러 새 노드를 먼저 생성하세요.
                </div>
            `;
        } else {
            openableFiles.forEach(file => {
                const item = document.createElement('div');
                item.className = 'existing-node-item';
                let typeLabel = '소설/원고 노드';
                if (file.isStatNode) typeLabel = '수치 계산기 노드';
                else if (file.type === 'image') typeLabel = '이미지 노드';

                const isOpen = window.windowManager?.getWindowInfo(file.id);

                item.innerHTML = `
                    <div class="existing-node-item-info">
                        <span style="font-size: 18px;">${file.name.slice(0, 2).trim() || '📄'}</span>
                        <span class="existing-node-item-name">${this.escapeHtml(file.name)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="existing-node-item-type">${typeLabel}</span>
                        ${isOpen ? '<span style="font-size: 11px; color: var(--color-accent-success); font-weight: bold;">(열려있음)</span>' : ''}
                    </div>
                `;

                item.addEventListener('click', () => {
                    this.hideExistingNodeOpenModal();
                    if (window.windowManager) {
                        window.windowManager.openWindow(file.id);
                        window.showToast?.(`'${file.name}' 노드가 캔버스에 열렸습니다. 📌`);
                    }
                });

                container.appendChild(item);
            });
        }

        modal.classList.remove('hidden');
    }

    hideExistingNodeOpenModal() {
        document.getElementById('existingNodeOpenModal')?.classList.add('hidden');
    }

    async showNodeSelectModal() {
        const modal = document.getElementById('nodeSelectModal');
        if (!modal) return;

        await this.renderCustomNodePresets();
        modal.classList.remove('hidden');
    }

    hideNodeSelectModal() {
        document.getElementById('nodeSelectModal')?.classList.add('hidden');
    }

    getDefaultNodeTemplates() {
        return [
            {
                id: 'preset_default_character',
                name: '주인공 캐릭터 카드',
                icon: '👤',
                desc: '이름, 소속, 성격, 특이사항 입력란과 프로필 생성 코드가 포함된 노드',
                isCustomNode: true,
                isDefault: true,
                fields: [
                    { name: '이름', val: '강현우', type: 'text', rows: 1 },
                    { name: '소속', val: '중앙 아카데미 3학년', type: 'text', rows: 1 },
                    { name: '성격', val: '평소엔 침착하지만 동료를 위해 물불 가리지 않음', type: 'text', rows: 2 },
                    { name: '특이사항', val: '10년 전 전생의 기억을 온전히 가지고 회귀함', type: 'text', rows: 2 }
                ],
                code: `const 프로필 = \`📌 《 \${input.이름} 》\\n• 소속: \${input.소속}\\n• 성격: \${input.성격}\\n• 특이사항: \${input.특이사항}\`;\nreturn { 프로필 };`,
                portsConfig: { inputs: [], outputs: [{ id: 'out_1', name: '프로필', color: '#00ffcc' }] }
            }
        ];
    }



    async renderCustomNodePresets() {
        const container = document.getElementById('customPresetsContainer');
        const section = document.getElementById('customPresetsSection');
        if (!container) return;

        container.innerHTML = '';
        const userPresets = await window.storage?.getCustomNodePresets() || [];

        const presets = [...userPresets];

        if (presets.length === 0) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = 'block';

        presets.forEach(preset => {
            const card = document.createElement('div');
            card.className = 'node-type-card';
            card.style.position = 'relative';

            let typeBadge = '입력 템플릿';
            if (preset.isTextFieldsNode || preset.wizardType === 'text_fields') typeBadge = '속성 템플릿';
            else if (preset.isStatNode || preset.wizardType === 'stat') typeBadge = '수치 템플릿';
            else if (preset.isSystemPromptNode || preset.wizardType === 'system_prompt') typeBadge = 'AI 템플릿';

            let portsPreviewHtml = '';
            if (preset.portsConfig) {
                const inArr = preset.portsConfig.inputs || [];
                const outArr = preset.portsConfig.outputs || [];
                const inDots = inArr.map(p => `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${p.color || '#2ecc71'}; margin-right:3px;" title="${this.escapeHtml(p.name)}"></span>`).join('');
                const outDots = outArr.map(p => `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${p.color || '#00ffcc'}; margin-right:3px;" title="${this.escapeHtml(p.name)}"></span>`).join('');
                if (inArr.length > 0 || outArr.length > 0) {
                    portsPreviewHtml = `<div style="margin-top:5px; font-size:10px; color:var(--color-text-tertiary); display:flex; gap:10px; align-items:center;">
                        ${inArr.length > 0 ? `<span>📥 ${inDots}</span>` : ''}
                        ${outArr.length > 0 ? `<span>📤 ${outDots}</span>` : ''}
                    </div>`;
                }
            }

            card.innerHTML = `
                <div class="node-type-icon">${preset.icon || '📄'}</div>
                <div class="node-type-info" style="flex: 1; padding-right: 48px;">
                    <div class="node-type-title" style="display: flex; align-items: center; justify-content: space-between;">
                        <span>${this.escapeHtml(preset.name)}</span>
                        <span style="font-size: 10px; color: var(--color-accent-primary); background: var(--color-bg-secondary); padding: 2px 6px; border-radius: 8px;">${typeBadge}</span>
                    </div>
                    <div class="node-type-desc">${this.escapeHtml(preset.desc || '입력 보존 노드 템플릿')}</div>
                    ${portsPreviewHtml}
                </div>
                ${!preset.isDefault ? `
                <div class="preset-card-actions" style="position: absolute; top: 6px; right: 6px; display: flex; gap: 2px;">
                    <button class="edit-preset-btn" title="템플릿 수정" style="background: transparent; border: none; color: var(--color-text-tertiary); cursor: pointer; font-size: 14px; padding: 2px 5px; border-radius: 4px;">✏️</button>
                    <button class="delete-preset-btn" title="템플릿 삭제" style="background: transparent; border: none; color: var(--color-text-tertiary); cursor: pointer; font-size: 14px; padding: 2px 5px; border-radius: 4px;">✕</button>
                </div>
                ` : ''}
            `;

            // 프리셋 수정/삭제 버튼 (사용자 템플릿만)
            if (!preset.isDefault) {
                card.querySelector('.edit-preset-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showCustomWizardModal(preset);
                });

                card.querySelector('.delete-preset-btn')?.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`'${preset.name}' 노드 템플릿을 삭제할까요?`)) {
                        await window.storage?.deleteCustomNodePreset(preset.id);
                        await this.renderCustomNodePresets();
                        window.showToast?.('노드 템플릿이 삭제되었습니다.');
                    }
                });
            }

            // 카드 클릭 시 입력값들이 채워진 상태로 노드 즉시 생성!
            card.addEventListener('click', async () => {
                this.hideNodeSelectModal();
                await this.createNodeFromPreset(preset);
            });

            container.appendChild(card);
        });
    }

    async createNodeFromPreset(preset) {
        let contentObj = {
            isCustomNode: true,
            fields: preset.fields || [],
            code: preset.code || '',
            portsConfig: preset.portsConfig || null
        };

        if (preset.content) {
            if (typeof preset.content === 'object') {
                contentObj = { ...contentObj, ...preset.content };
            } else {
                try {
                    contentObj = { ...contentObj, ...JSON.parse(preset.content) };
                } catch (e) {
                    contentObj.rawText = preset.content;
                }
            }
        }

        const fileData = {
            name: `${preset.icon || '📄'} ${preset.name}`,
            type: 'file',
            template: 'custom_node',
            isCustomNode: true,
            isTextFieldsNode: !!preset.isTextFieldsNode,
            isFolderCollectorNode: !!preset.isFolderCollectorNode,
            isStatNode: !!preset.isStatNode,
            isSystemPromptNode: !!preset.isSystemPromptNode,
            isAiMetaNode: !!preset.isAiMetaNode,
            description: preset.desc || '커스텀 정의 노드',
            code: preset.code || '',
            fields: preset.fields || [],
            content: JSON.stringify(contentObj, null, 2),
            portsConfig: preset.portsConfig || null
        };

        await this.createNewCustomNode(fileData);
    }

    switchWizardTab(tabName) {
        document.querySelectorAll('.wizard-tab-btn').forEach(btn => {
            const isActive = (btn.dataset.wizardTab === tabName);
            btn.classList.toggle('active', isActive);
        });


        const dataContent = document.getElementById('wizardTabContentData');
        const codeContent = document.getElementById('wizardTabContentCode');
        const configContent = document.getElementById('wizardTabContentConfig');

        if (dataContent) dataContent.classList.toggle('hidden', tabName !== 'data');
        if (codeContent) codeContent.classList.toggle('hidden', tabName !== 'code');
        if (configContent) configContent.classList.toggle('hidden', tabName !== 'config');
    }

    showCustomWizardModal(presetToEdit = null) {
        this.selectedWizardType = presetToEdit?.wizardType || 'file';
        this.editingCustomPresetId = presetToEdit?.id || null;

        const modal = document.getElementById('customWizardModal');
        if (!modal) return;

        this.switchWizardTab('config');



        const titleEl = modal.querySelector('.modal-title');
        const submitBtn = document.getElementById('submitCustomWizardBtn');
        if (titleEl) titleEl.textContent = presetToEdit ? '✏️ 커스텀 노드 프리셋 수정' : '✨ 나만의 커스텀 노드 정의 & 목록 추가';
        if (submitBtn) submitBtn.textContent = presetToEdit ? '💾 프리셋 수정 저장' : '✨ 노드 목록에 추가';

        const nameInput = document.getElementById('wizardName');
        const descInput = document.getElementById('wizardDesc');
        if (nameInput) nameInput.value = presetToEdit?.name || '';
        if (descInput) descInput.value = presetToEdit?.desc || '';

        const iconBtn = document.getElementById('wizardIconBtn');
        const iconInput = document.getElementById('wizardIcon');
        const defaultIcon = presetToEdit?.icon || '📄';
        if (iconBtn) iconBtn.textContent = defaultIcon;
        if (iconInput) iconInput.value = defaultIcon;

        modal.querySelectorAll('.wizard-type-card').forEach(card => {
            if (card.dataset.wizardType === this.selectedWizardType) card.classList.add('active');
            else card.classList.remove('active');
        });

        const list = document.getElementById('wizardStatList');
        if (list) {
            list.innerHTML = '';
            if (Array.isArray(presetToEdit?.fields) && presetToEdit.fields.some(f => typeof f.val === 'number')) {
                presetToEdit.fields.filter(f => typeof f.val === 'number').forEach(f => this.addWizardStatRow(f.name, f.val));
            } else if (!presetToEdit) {
                this.addWizardStatRow('', 0);
            }
        }

        const textList = document.getElementById('wizardTextFieldsList');
        if (textList) {
            textList.innerHTML = '';
            if (Array.isArray(presetToEdit?.fields) && presetToEdit.fields.some(f => typeof f.val === 'string' || f.type === 'text')) {
                presetToEdit.fields.filter(f => typeof f.val === 'string' || f.type === 'text').forEach(f => this.addWizardTextFieldRow(f.name, f.val, f.rows || 1));
            } else if (!presetToEdit) {
                this.addWizardTextFieldRow('', '', 1);
            }
        }



        const folderSelect = document.getElementById('wizardTargetFolder');
        if (folderSelect) {
            const projectFolders = (this.files || []).filter(f => f.type === 'folder');
            folderSelect.innerHTML = `<option value="root">📁 [프로젝트 전체 파일 노드]</option>` + 
                projectFolders.map(f => `<option value="${f.id}">📁 ${this.escapeHtml(f.name)}</option>`).join('');
            if (presetToEdit?.targetFolderId) {
                folderSelect.value = presetToEdit.targetFolderId;
            }
        }

        const itemTmplEl = document.getElementById('wizardItemTemplate');
        if (itemTmplEl) {
            itemTmplEl.value = presetToEdit?.itemTemplate || `📌 《 {$이름$} 》\n{$CONTENT$}`;
        }

        const delimEl = document.getElementById('wizardDelimiter');
        if (delimEl) {
            delimEl.value = presetToEdit?.delimiter !== undefined ? presetToEdit.delimiter : '-----------------------------------';
        }

        const inList = document.getElementById('wizardInputPortList');
        if (inList) {
            inList.innerHTML = '';
            const inputs = presetToEdit?.portsConfig?.inputs;
            if (Array.isArray(inputs) && inputs.length > 0) {
                inputs.forEach(p => this.addPortConfigRow('input', p.name, p.color));
            } else if (this.selectedWizardType !== 'folder_collector') {
                this.addPortConfigRow('input', '입력 데이터', '#2ecc71');
            }
        }

        const outList = document.getElementById('wizardOutputPortList');
        if (outList) {
            outList.innerHTML = '';
            const outputs = presetToEdit?.portsConfig?.outputs;
            if (Array.isArray(outputs) && outputs.length > 0) {
                outputs.forEach(p => this.addPortConfigRow('output', p.name, p.color));
            } else {
                this.addPortConfigRow('output', '출력 데이터', '#00ffcc');
            }
        }

        // 동작 코드 에디터 로드
        const codeEditor = document.getElementById('wizardCodeEditor');
        if (codeEditor) {
            codeEditor.value = presetToEdit?.code || '';
        }
        const testResult = document.getElementById('wizardTestResult');
        if (testResult) testResult.style.display = 'none';

        this.updateCustomWizardUI();
        this.updateWizardVarChips();
        modal.classList.remove('hidden');
        if (nameInput) nameInput.focus();
    }

    hideCustomWizardModal() {
        this.editingCustomPresetId = null;
        document.getElementById('customWizardModal')?.classList.add('hidden');
    }

    updateCustomWizardUI() {
        // 섹션들은 항상 표시 — 노드 형식 구분 없이 자유롭게 조합
    }

    /**
     * 현재 input 변수 목록을 칩(chip) 형태로 wizardVarChips에 표시합니다.
     * 클릭하면 코드 에디터에 input.변수명 을 삽입합니다.
     */
    updateWizardVarChips() {
        const container = document.getElementById('wizardVarChips');
        if (!container) return;

        const inputVarSelectors = [
            '#wizardStatList .stat-field-row .field-name',
            '#wizardTextFieldsList .stat-field-row .field-name',
            '#wizardInputPortList .stat-field-row .field-name',
        ];
        const names = [];
        inputVarSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                const v = el.value.trim();
                if (v && !names.includes(v)) names.push(v);
            });
        });

        container.innerHTML = '';
        if (names.length === 0) {
            container.innerHTML = '<span style="font-size: 11px; color: var(--color-text-tertiary);">↑ input 변수를 정의하면 여기에 표시됩니다</span>';
            return;
        }

        names.forEach(name => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = `input.${name}`;
            chip.title = `코드 에디터에 'input.${name}' 삽입`;
            chip.style.cssText = 'font-size: 11px; font-family: monospace; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--color-accent-primary); background: transparent; color: var(--color-accent-primary); cursor: pointer;';
            chip.addEventListener('click', () => {
                const editor = document.getElementById('wizardCodeEditor');
                if (!editor) return;
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                const insert = `input.${name}`;
                editor.value = editor.value.slice(0, start) + insert + editor.value.slice(end);
                editor.selectionStart = editor.selectionEnd = start + insert.length;
                editor.focus();
            });
            container.appendChild(chip);
        });
    }

    /**
     * 위자드 코드 에디터의 코드를 샘플 input 값으로 테스트 실행합니다.
     */
    async runWizardCodeTest() {
        const code = document.getElementById('wizardCodeEditor')?.value.trim();
        const resultEl = document.getElementById('wizardTestResult');
        if (!resultEl) return;

        if (!code) {
            resultEl.style.display = 'block';
            resultEl.style.color = 'var(--color-text-tertiary)';
            resultEl.textContent = '코드가 없습니다. 동작 코드를 작성해 주세요.';
            return;
        }

        // input 변수 수집 (샘플 값 자동 생성)
        const input = {};
        document.querySelectorAll('#wizardStatList .stat-field-row').forEach(row => {
            const name = row.querySelector('.field-name')?.value.trim();
            const val = parseFloat(row.querySelector('.field-val')?.value) || 0;
            if (name) input[name] = val;
        });
        document.querySelectorAll('#wizardTextFieldsList .stat-field-row').forEach(row => {
            const name = row.querySelector('.field-name')?.value.trim();
            const val = row.querySelector('.field-val')?.value.trim() || '(샘플)';
            if (name) input[name] = val;
        });
        document.querySelectorAll('#wizardInputPortList .stat-field-row').forEach(row => {
            const name = row.querySelector('.field-name')?.value.trim();
            if (name) input[name] = `[${name} 샘플 값]`;
        });

        try {
            const fn = new Function('input', `return (async () => { ${code} })()`);
            const result = await fn(input);
            resultEl.style.display = 'block';
            resultEl.style.color = '#2ecc71';
            resultEl.textContent = '✅ 실행 성공\n\n' + JSON.stringify(result, null, 2);
        } catch (err) {
            resultEl.style.display = 'block';
            resultEl.style.color = 'var(--color-accent-danger)';
            resultEl.textContent = '❌ 오류: ' + err.message;
        }
    }

    /**
     * Wizard 내 현재 정의된 모든 변수 이름 목록을 반환합니다.
     * stat 항목, textfield 항목, input 핀, output 핀 이름을 모두 포함합니다.
     * @param {HTMLElement|null} excludeEl - 중복 검사에서 제외할 input 요소 (자기 자신 수정 시)
     */
    getWizardAllVarNames(excludeEl = null) {
        const names = [];
        const selectors = [
            '#wizardStatList .stat-field-row .field-name',
            '#wizardTextFieldsList .stat-field-row .field-name',
            '#wizardInputPortList .stat-field-row .field-name',
            '#wizardOutputPortList .stat-field-row .field-name',
        ];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (el === excludeEl) return;
                const v = el.value.trim();
                if (v) names.push(v);
            });
        });
        return names;
    }

    /**
     * field-name input에 중복 검사 이벤트를 연결합니다.
     * blur 시 중복이면 빨간 테두리 + title 툴팁 표시, 아니면 초기화.
     */
    attachVarNameDuplicateCheck(inputEl) {
        inputEl.addEventListener('blur', () => {
            const val = inputEl.value.trim();
            if (!val) {
                inputEl.style.borderColor = '';
                inputEl.title = '';
                return;
            }
            const others = this.getWizardAllVarNames(inputEl);
            if (others.includes(val)) {
                inputEl.style.outline = '2px solid var(--color-accent-danger)';
                inputEl.title = `⚠️ '${val}' 이름이 이미 사용 중입니다. 변수명은 노드 내에서 유일해야 합니다.`;
                window.showToast?.(`⚠️ '${val}' 이름이 이미 사용 중입니다!`, 'error');
            } else {
                inputEl.style.outline = '';
                inputEl.title = '';
            }
        });
        inputEl.addEventListener('input', () => {
            // 입력 중에는 에러 표시 초기화
            inputEl.style.outline = '';
            inputEl.title = '';
        });
    }

    addWizardStatRow(name = '', val = 0) {
        const list = document.getElementById('wizardStatList');
        if (!list) return;

        const row = document.createElement('div');
        row.className = 'stat-field-row';
        row.innerHTML = `
            <input type="text" class="input field-name" placeholder="항목 이름 (예: 근력, HP)" value="${this.escapeHtml(name)}" style="flex: 1;">
            <input type="number" class="input field-val" placeholder="기본 수치" value="${val}" style="width: 90px;">
            <button type="button" class="btn btn-icon btn-secondary remove-field-btn" title="항목 삭제" style="color: var(--color-accent-danger); border: none; background: transparent;">✕</button>
        `;

        row.querySelector('.remove-field-btn')?.addEventListener('click', () => {
            row.remove();
        });

        const nameInput = row.querySelector('.field-name');
        if (nameInput) this.attachVarNameDuplicateCheck(nameInput);

        list.appendChild(row);
    }

    addWizardTextFieldRow(name = '', val = '', rows = 1) {
        const list = document.getElementById('wizardTextFieldsList');
        if (!list) return;

        const row = document.createElement('div');
        row.className = 'stat-field-row';
        row.style.cssText = 'display: flex; gap: 6px; align-items: center;';
        row.innerHTML = `
            <input type="text" class="input field-name" placeholder="항목 이름 (예: 소속)" value="${this.escapeHtml(name)}" style="width: 130px;">
            <input type="text" class="input field-val" placeholder="기본 텍스트 내용" value="${this.escapeHtml(val)}" style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 2px; font-size: 11px; color: var(--color-text-tertiary);" title="입력창 기본 줄 수 (높이)">
                <span>📏</span>
                <select class="input field-rows" style="font-size: 11px; padding: 2px 4px; width: 62px; height: 26px;">
                    <option value="1" ${rows == 1 || !rows ? 'selected' : ''}>1줄</option>
                    <option value="2" ${rows == 2 ? 'selected' : ''}>2줄</option>
                    <option value="3" ${rows == 3 ? 'selected' : ''}>3줄</option>
                    <option value="5" ${rows == 5 ? 'selected' : ''}>5줄</option>
                    <option value="8" ${rows == 8 ? 'selected' : ''}>8줄</option>
                    <option value="12" ${rows == 12 ? 'selected' : ''}>12줄</option>
                </select>
            </div>
            <button type="button" class="btn btn-icon btn-secondary remove-field-btn" title="항목 삭제" style="color: var(--color-accent-danger); border: none; background: transparent;">✕</button>
        `;


        row.querySelector('.remove-field-btn')?.addEventListener('click', () => {
            row.remove();
        });

        const nameInput = row.querySelector('.field-name');
        if (nameInput) this.attachVarNameDuplicateCheck(nameInput);

        list.appendChild(row);
    }




    addPortConfigRow(type = 'input', defaultName = '', defaultColor = '', defaultTemplate = '') {
        const listId = type === 'input' ? 'wizardInputPortList' : 'wizardOutputPortList';
        const list = document.getElementById(listId);
        if (!list) return;

        const fallbackColor = type === 'input' ? '#2ecc71' : '#00ffcc';
        const colorVal = defaultColor || fallbackColor;

        const row = document.createElement('div');
        row.className = 'stat-field-row';
        row.style.marginBottom = '6px';
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '6px';

        if (type === 'input') {
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
                    <input type="color" class="port-color-picker" value="${colorVal}" title="핀 색상 변경" style="width: 28px; height: 26px; padding: 1px 2px; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; background: transparent; flex-shrink: 0;">
                    <input type="text" class="input field-name" placeholder="포트 핀 이름" value="${this.escapeHtml(defaultName)}" style="flex: 1; font-size: 11px; height: 26px; padding: 0 6px;">
                    <button type="button" class="btn btn-icon btn-secondary remove-field-btn" title="포트 삭제" style="color: var(--color-accent-danger); border: none; background: transparent; padding: 2px; flex-shrink: 0;">✕</button>
                </div>
            `;

            const nameInput = row.querySelector('.field-name');
            if (nameInput) this.attachVarNameDuplicateCheck(nameInput);
        } else {
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
                    <input type="color" class="port-color-picker" value="${colorVal}" title="핀 색상 변경" style="width: 28px; height: 26px; padding: 1px 2px; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; background: transparent; flex-shrink: 0;">
                    <input type="text" class="input field-name" placeholder="포트 핀 이름 (예: 프로필, 칭호전용)" value="${this.escapeHtml(defaultName)}" style="flex: 1; font-size: 11px; height: 26px; padding: 0 6px;">
                    <button type="button" class="btn btn-icon btn-secondary remove-field-btn" title="포트 삭제" style="color: var(--color-accent-danger); border: none; background: transparent; padding: 2px; flex-shrink: 0;">✕</button>
                </div>
            `;

            const nameInput = row.querySelector('.field-name');
            if (nameInput) this.attachVarNameDuplicateCheck(nameInput);
        }

        row.querySelector('.remove-field-btn')?.addEventListener('click', () => {
            row.remove();
        });

        list.appendChild(row);
    }

    async handleCustomWizardSubmit() {
        const nameInput = document.getElementById('wizardName');
        const descInput = document.getElementById('wizardDesc');
        const name = nameInput ? nameInput.value.trim() : '';
        const desc = descInput ? descInput.value.trim() : '';
        const icon = document.getElementById('wizardIcon')?.value || '📄';
        const type = this.selectedWizardType || 'file';

        if (!name) {
            alert('노드 이름을 입력해 주세요.');
            nameInput?.focus();
            return;
        }

        // 변수명 중복 검사
        const allVarInputs = [
            ...document.querySelectorAll('#wizardStatList .stat-field-row .field-name'),
            ...document.querySelectorAll('#wizardTextFieldsList .stat-field-row .field-name'),
            ...document.querySelectorAll('#wizardInputPortList .stat-field-row .field-name'),
            ...document.querySelectorAll('#wizardOutputPortList .stat-field-row .field-name'),
        ];
        const seen = new Set();
        let duplicateEl = null;
        let duplicateName = '';
        for (const el of allVarInputs) {
            const v = el.value.trim();
            if (!v) continue;
            if (seen.has(v)) {
                duplicateEl = el;
                duplicateName = v;
                break;
            }
            seen.add(v);
        }
        if (duplicateEl) {
            duplicateEl.style.outline = '2px solid var(--color-accent-danger)';
            duplicateEl.title = `⚠️ '${duplicateName}' 이름이 중복되었습니다. 변수명은 노드 내에서 유일해야 합니다.`;
            duplicateEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            duplicateEl.focus();
            window.showToast?.(`⚠️ 변수명 '${duplicateName}'이 중복됩니다. 저장할 수 없습니다.`, 'error');
            return;
        }

        const fields = [];
        // 1) 수치형 항목 수집
        document.querySelectorAll('#wizardStatList .stat-field-row').forEach(row => {
            const fName = row.querySelector('.field-name')?.value.trim();
            const fVal = parseFloat(row.querySelector('.field-val')?.value) || 0;
            if (fName) fields.push({ name: fName, val: fVal, type: 'stat' });
        });
        // 2) 텍스트형 항목 수집
        document.querySelectorAll('#wizardTextFieldsList .stat-field-row').forEach(row => {
            const fName = row.querySelector('.field-name')?.value.trim();
            const fVal = row.querySelector('.field-val')?.value.trim() || '';
            const fRows = parseInt(row.querySelector('.field-rows')?.value) || 3;
            if (fName) fields.push({ name: fName, val: fVal, type: 'text', rows: fRows });
        });


        // 포트 핀 정보 수집 (이름, 핀 색상)
        const inputs = [];
        document.querySelectorAll('#wizardInputPortList .stat-field-row').forEach((row, idx) => {
            const pName = row.querySelector('.field-name')?.value.trim();
            const pColor = row.querySelector('.port-color-picker')?.value || '#2ecc71';
            if (pName) inputs.push({ id: `in_${idx + 1}`, name: pName, color: pColor });
        });

        const outputs = [];
        document.querySelectorAll('#wizardOutputPortList .stat-field-row').forEach((row, idx) => {
            const pName = row.querySelector('.field-name')?.value.trim();
            const pColor = row.querySelector('.port-color-picker')?.value || '#00ffcc';
            if (pName) outputs.push({ id: `out_${idx + 1}`, name: pName, color: pColor });
        });

        const portsConfig = { inputs, outputs };
        const code = document.getElementById('wizardCodeEditor')?.value.trim() || '';
        const isEditing = !!this.editingCustomPresetId;
        const presetId = this.editingCustomPresetId || ('preset_' + Date.now());

        const presetData = {
            id: presetId,
            name,
            icon,
            desc,
            isCustomNode: true,
            wizardType: type,
            fields,
            code,
            portsConfig,
            isFolderCollectorNode: type === 'folder_collector',
        };

        await window.storage?.saveCustomNodePreset(presetData);
        this.editingCustomPresetId = null;

        this.hideCustomWizardModal();
        await this.showNodeSelectModal();

        window.showToast?.(isEditing ? `'${name}' 프리셋 수정이 저장되었습니다! ✏️` : `'${name}' 커스텀 노드가 노드 목록에 추가되었습니다! ✨`);
    }

    async createCustomFolderCollectorNode(name, icon, desc, targetFolderId = 'root', itemTemplate = '', portsConfig = null) {
        const contentObj = {
            isFolderCollectorNode: true,
            targetFolderId: targetFolderId || 'root',
            itemTemplate: itemTemplate || ''
        };

        const defaultPorts = portsConfig || {
            inputs: [],
            outputs: [{ id: 'out_1', name: '수집 데이터', color: '#00ffcc' }]
        };

        const fileData = {
            name: `${icon || '📂'} ${name}`,
            type: 'file',
            template: 'folder_collector',
            isFolderCollectorNode: true,
            description: desc,
            content: JSON.stringify(contentObj, null, 2),
            portsConfig: defaultPorts
        };

        await this.createNewCustomNode(fileData);
    }

    async createCustomTextFieldsNode(name, icon, desc, fields, portsConfig = null, outputTemplate = '') {
        let finalTemplate = outputTemplate;
        if (!finalTemplate) {
            finalTemplate = `📌 《 {$이름$} 》\n` + fields.map(f => `• ${f.name}: {$${f.name}$}`).join('\n');
        }

        const contentObj = {
            isTextFieldsNode: true,
            textFields: fields.map(f => ({ name: f.name, val: f.val })),
            outputTemplate: finalTemplate,
            currentTab: 'manage'
        };

        const fileData = {
            name: `${icon} ${name}`,
            type: 'file',
            isTextFieldsNode: true,
            description: desc,
            content: JSON.stringify(contentObj, null, 2),
            portsConfig
        };

        await this.createNewCustomNode(fileData);
    }

    async createNewCustomNode(fileData) {
        try {
            const projectId = this.currentProjectId || window.app?.currentProjectId || (await storage.getProjects())?.[0]?.id;
            if (!projectId) {
                alert('현재 선택된 프로젝트가 없습니다.');
                return;
            }

            const siblings = (this.files || []).filter(f => !f.parentId);
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(f => f.order || 0)) : -1;

            const created = await storage.createFile({
                projectId,
                name: fileData.name,
                type: fileData.type || 'file',
                description: fileData.description || '',
                content: fileData.content || '',
                isCustomNode: fileData.isCustomNode !== undefined ? !!fileData.isCustomNode : true,
                isTextFieldsNode: !!fileData.isTextFieldsNode,
                isFolderCollectorNode: !!fileData.isFolderCollectorNode,
                isStatNode: !!fileData.isStatNode,
                isSystemPromptNode: !!fileData.isSystemPromptNode,
                isAiMetaNode: !!fileData.isAiMetaNode,
                portsConfig: fileData.portsConfig || null,
                template: fileData.template || fileData.defaultTemplate || 'custom_node',
                parentId: null,
                order: maxOrder + 1
            });

            if (projectId) {
                await this.loadProjectFiles(projectId);
            }

            if (created && window.windowManager) {
                window.windowManager.openWindow(created.id);
                window.showToast?.(`'${created.name}' 노드가 생성되어 캔버스에 추가되었습니다. ✨`);
            }
            return created;
        } catch (err) {
            console.error('커스텀 노드 생성 실패 상세 로그:', err);
            alert(`노드 생성 중 오류가 발생했습니다: ${err.message || err}`);
        }
    }



    updateNodeWizardUI() {
        const type = this.selectedCreateNodeType || 'file';
        const statSection = document.getElementById('statFieldsSection');
        const templateSection = document.getElementById('templateSelectSection');
        const iconBtn = document.getElementById('nodeCreateIconBtn');
        const iconInput = document.getElementById('nodeCreateIcon');

        if (statSection) {
            if (type === 'stat') statSection.classList.remove('hidden');
            else statSection.classList.add('hidden');
        }

        if (templateSection) {
            if (type === 'file') templateSection.classList.remove('hidden');
            else templateSection.classList.add('hidden');
        }

        let defaultIcon = '📄';
        if (type === 'stat') defaultIcon = '📊';
        else if (type === 'image') defaultIcon = '🖼️';
        else if (type === 'folder') defaultIcon = '📁';

        if (iconBtn) iconBtn.textContent = defaultIcon;
        if (iconInput) iconInput.value = defaultIcon;
    }

    addStatFieldRow(name = '', val = 0) {
        const list = document.getElementById('statFieldsList');
        if (!list) return;

        const row = document.createElement('div');
        row.className = 'stat-field-row';
        row.innerHTML = `
            <input type="text" class="input field-name" placeholder="항목 이름 (예: 근력, HP)" value="${this.escapeHtml(name)}" style="flex: 1;">
            <input type="number" class="input field-val" placeholder="기본 수치" value="${val}" style="width: 90px;">
            <button type="button" class="btn btn-icon btn-secondary remove-field-btn" title="항목 삭제" style="color: var(--color-accent-danger); border: none; background: transparent;">✕</button>
        `;

        row.querySelector('.remove-field-btn')?.addEventListener('click', () => {
            row.remove();
        });

        list.appendChild(row);
    }

    async handleCreateNodeSubmit() {
        const nameInput = document.getElementById('nodeCreateName');
        const descInput = document.getElementById('nodeCreateDesc');
        const name = nameInput ? nameInput.value.trim() : '';
        const desc = descInput ? descInput.value.trim() : '';
        const icon = document.getElementById('nodeCreateIcon')?.value || '📄';
        const type = this.selectedCreateNodeType || 'file';

        if (!name) {
            alert('노드 이름을 입력해 주세요.');
            nameInput?.focus();
            return;
        }

        this.hideNodeSelectModal();

        if (type === 'stat') {
            const fields = [];
            document.querySelectorAll('#statFieldsList .stat-field-row').forEach(row => {
                const fName = row.querySelector('.field-name')?.value.trim();
                const fVal = parseFloat(row.querySelector('.field-val')?.value) || 0;
                if (fName) {
                    fields.push({ name: fName, val: fVal });
                }
            });

            await this.createCustomStatNode(name, icon, desc, fields);
        } else if (type === 'file') {
            const template = document.getElementById('nodeCreateTemplate')?.value || 'blank';
            let content = '';
            if (template !== 'blank') {
                content = await this.getTemplateContent(template);
            }
            if (desc) {
                content = `<!-- 설명: ${desc} -->\n` + content;
            }
            const fileData = {
                name: `${icon} ${name}`,
                type: 'file',
                content,
                defaultTemplate: template === 'blank' ? null : template
            };
            const newFile = await this.createFile(fileData);
            if (newFile && window.windowManager) {
                window.windowManager.openWindow(newFile.id);
            }
        } else if (type === 'image') {
            this.showNewImageModal();
        } else if (type === 'folder') {
            await this.createFile({
                name: `${icon} ${name}`,
                type: 'folder'
            });
        }
    }

    async createCustomStatNode(name, icon, desc, fields, portsConfig = null) {
        let outputTemplateStr = `《 ${name} 》\n`;
        const statConfig = {};

        fields.forEach(f => {
            outputTemplateStr += `[${f.name}: {$${f.name}$}]\n`;
            statConfig[f.name] = f.val;
        });

        const fileData = {
            name: `${icon} ${name}`,
            type: 'file',
            isStatNode: true,
            description: desc,
            content: JSON.stringify({
                statConfig,
                outputTemplate: outputTemplateStr,
                history: []
            }, null, 2),
            portsConfig
        };

        await this.createNewCustomNode(fileData);
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
            modal.classList.remove('hidden');
            document.getElementById('fileName').focus();

            if (this.editingItem) {
                title.textContent = '파일 이름 변경';
                submitBtn.textContent = '수정';
                document.getElementById('fileName').value = this.editingItem.name;
                if (templateGroup) templateGroup.style.display = 'none';
            } else {
                title.textContent = type === 'folder' ? '새 폴더 생성' : '새 파일 생성';
                submitBtn.textContent = '생성';
                document.getElementById('fileName').value = '';
                if (templateGroup) templateGroup.style.display = 'block';
            }

            // 커스텀 템플릿 로드는 모달이 표시된 후 비동기로 처리하여 렉 방지
            if (templateSelect && templateGroup?.style.display !== 'none') {
                this.refreshTemplateOptions('fileTemplate').then(() => {
                    if (parentId && !this.editingItem) {
                        const parentFolder = this.files.find(f => f.id === parentId);
                        templateSelect.value = (parentFolder && parentFolder.defaultTemplate) ? parentFolder.defaultTemplate : 'blank';
                    } else {
                        templateSelect.value = 'blank';
                    }
                });
            }
        }
    }

    hideNewItemModal() {
        document.getElementById('newFileModal')?.classList.add('hidden');
        this.editingItem = null;
        this.isStatCreation = false;
    }

    async saveItem() {
        const name = document.getElementById('fileName').value.trim();
        if (!name) return alert('이름을 입력해주세요.');

        // 수치 계산기 생성 모드인 경우
        if (this.isStatCreation) {
            try {
                const siblings = this.files.filter(f => f.parentId === this.newItemParentId);
                const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(f => f.order)) : -1;

                await storage.createFile({
                    projectId: this.currentProjectId,
                    name,
                    type: 'file',
                    parentId: this.newItemParentId,
                    content: JSON.stringify({
                        stats: [
                            { name: '레벨', value: 1 },
                            { name: '경험치', value: 0 },
                            { name: '근력', value: 10 },
                            { name: '민첩', value: 10 }
                        ],
                        history: [],
                        outputTemplate: "《 {$이름$} 상태창 》\n[레벨: {$레벨$}]\n[경험치: {$경험치$}]\n[근력: {$근력$}]\n[민첩: {$민첩$}]"
                    }),
                    template: 'stat',
                    order: maxOrder + 1
                });

                await this.loadProjectFiles(this.currentProjectId);
                this.hideNewItemModal();
                this.isStatCreation = false;
                return;
            } catch (error) {
                console.error('수치 계산기 생성 실패:', error);
                return alert('생성 중 오류가 발생했습니다.');
            }
        }

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
                template: template === 'blank' ? null : template, // 템플릿 정보 저장
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
        if (template && template.startsWith('custom-')) {
            const tplId = template.replace('custom-', '');
            const templates = await window.storage?.getAllTemplates();
            const found = templates?.find(t => t.id === tplId);
            return found ? (typeof found.content === 'object' ? JSON.stringify(found.content, null, 2) : (found.content || '')) : '';
        }
        return '';
    }

    showContextMenu(e, file) {
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

        menu.innerHTML = `
            ${file.type === 'folder' ? `
                <div class="context-menu-item has-submenu" id="ctx-new-file-group">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="context-menu-icon">➕</span> 새 노드 추가
                    </div>
                    <div class="context-submenu">
                        <div class="context-menu-item" id="ctx-new-file-text"><span class="context-menu-icon">📄</span> 소설 / 원고 노드</div>
                        <div class="context-menu-item" id="ctx-new-file-stat"><span class="context-menu-icon">📊</span> 수치 계산기 노드</div>
                        <div class="context-menu-item" id="ctx-new-file-image"><span class="context-menu-icon">🖼️</span> 이미지 노드</div>
                        <div class="context-menu-item" id="ctx-open-wizard"><span class="context-menu-icon">✨</span> 커스텀 노드 정의...</div>
                    </div>
                </div>
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

        // 이벤트 리스너 바인딩
        document.getElementById('ctx-new-file-text')?.addEventListener('click', () => this.showNewItemModal('file', file.id));
        document.getElementById('ctx-new-file-image')?.addEventListener('click', () => this.showNewImageModal());
        document.getElementById('ctx-new-file-stat')?.addEventListener('click', () => this.showNewStatModal(file.id));
        document.getElementById('ctx-open-wizard')?.addEventListener('click', () => this.showNodeSelectModal());
        
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
        const avgCharsEl = document.getElementById('avgFolderChars');
        const mentionListEl = document.getElementById('fileMentionList');

        if (!modal) return;

        nameEl.textContent = file.name;
        totalCharsEl.textContent = '계산 중...';
        totalFilesEl.textContent = '계산 중...';
        if (avgCharsEl) avgCharsEl.textContent = '계산 중...';
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
            
            // 2. 총 글자 수 및 평균 글자 수 계산 (실시간 창 텍스트 반영)
            let totalChars = 0;
            let textFileCount = 0;
            filesOnly.forEach(f => {
                // 이미지 파일은 글자수 통계에서 제외
                if (f.template === 'image' || (f.content && f.content.startsWith('data:image'))) return;
                // 수치 계산기도 제외 (JSON 데이터이므로)
                if (f.template === 'stat') return;

                const openWin = window.windowManager?.windows.get(f.id);
                const content = openWin ? openWin.textarea.value : (f.content || '');
                totalChars += content.length;
                textFileCount++;
            });

            const avgChars = textFileCount > 0 ? Math.round(totalChars / textFileCount) : 0;

            totalCharsEl.textContent = `${totalChars.toLocaleString()}자`;
            totalFilesEl.textContent = `${filesOnly.length}개`;
            if (avgCharsEl) avgCharsEl.textContent = `${avgChars.toLocaleString()}자`;

            // 3. 파일별 언급 횟수 계산 (프로젝트 전체 기준)
            // 전체 텍스트 수집 (실시간 창 반영, 이미지는 제외)
            let fullProjectText = '';
            allProjectFiles.forEach(f => {
                if (f.type === 'file') {
                    // 이미지 파일이나 수치 계산기 파일은 검색 대상 텍스트에서 제외 (성능 및 정확도)
                    if (f.template === 'image' || (f.content && f.content.startsWith('data:image'))) return;
                    
                    const openWin = window.windowManager?.windows.get(f.id);
                    let content = (openWin && openWin.textarea) ? openWin.textarea.value : (f.content || '');
                    
                    // 수치 계산기 데이터인 경우 JSON이므로 텍스트 검색에서 제외하거나 이름만 포함
                    if (f.template === 'stat') return;

                    fullProjectText += content + '\n';
                }
            });

            const mentionStats = filesOnly.map(f => {
                if (!f.name || f.name.trim() === '') return { name: '이름 없음', count: 0 };
                
                // 정규표현식으로 언급 횟수 계산 (특수문자 보호)
                try {
                    const regexSafeName = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(regexSafeName, 'g');
                    const matches = fullProjectText.match(regex);
                    return {
                        name: f.name,
                        count: matches ? matches.length : 0
                    };
                } catch (e) {
                    return { name: f.name, count: 0 };
                }
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
        const colorPicker = document.getElementById('folderColorPicker');
        
        if (modal) {
            if (nameInput) nameInput.value = file.name;
            if (checkbox) checkbox.checked = !!file.hyperlinkEnabled;
            
            // 색상 설정 반영
            if (colorPicker) {
                const color = file.iconColor || '';
                document.querySelectorAll('#folderColorPicker .color-swatch').forEach(s => {
                    s.classList.toggle('active', s.dataset.color === color);
                });
            }

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
        
        // 선택된 색상 가져오기
        const activeSwatch = document.querySelector('#folderColorPicker .color-swatch.active');
        const iconColor = activeSwatch ? activeSwatch.dataset.color : '';
        
        if (!name) return alert('이름을 입력해주세요.');

        try {
            await storage.updateFile(this.editingItem.id, { 
                name, 
                defaultTemplate: template === 'blank' ? null : template,
                hyperlinkEnabled: enabled,
                iconColor: iconColor || null
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

    showRootContextMenu(e) {
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

        menu.innerHTML = `
            <div class="context-menu-item has-submenu" id="ctx-root-new-file-group">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="context-menu-icon">➕</span> 새 노드 추가
                </div>
                <div class="context-submenu">
                    <div class="context-menu-item" id="ctx-root-new-file-text"><span class="context-menu-icon">📄</span> 소설 / 원고 노드</div>
                    <div class="context-menu-item" id="ctx-root-new-file-stat"><span class="context-menu-icon">📊</span> 수치 계산기 노드</div>
                    <div class="context-menu-item" id="ctx-root-new-file-image"><span class="context-menu-icon">🖼️</span> 이미지 노드</div>
                    <div class="context-menu-item" id="ctx-root-open-wizard"><span class="context-menu-icon">✨</span> 커스텀 노드 정의...</div>
                </div>
            </div>
            <div class="context-menu-item" id="ctx-root-new-folder"><span class="context-menu-icon">📁</span> 새 폴더</div>
        `;
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.remove('hidden');

        document.getElementById('ctx-root-new-file-text')?.addEventListener('click', () => this.showNewItemModal('file', null));
        document.getElementById('ctx-root-new-file-image')?.addEventListener('click', () => this.showNewImageModal());
        document.getElementById('ctx-root-new-file-stat')?.addEventListener('click', () => this.showNewStatModal(null));
        document.getElementById('ctx-root-open-wizard')?.addEventListener('click', () => this.showNodeSelectModal());
        document.getElementById('ctx-root-new-folder')?.addEventListener('click', () => this.showNewItemModal('folder', null));
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
window.fileTreeManager = new FileTreeManager();
