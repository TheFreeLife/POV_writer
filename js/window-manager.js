/**
 * 다중 창 관리자 (Window Manager)
 * 캔버스 위에 드래그/리사이즈 가능한 에디터 창을 관리합니다.
 */
class WindowManager {
    constructor() {
        this.windows = new Map(); // fileId -> windowInfo
        this.zIndexCounter = 100;
        this.cascadeOffset = 0;
        this.activeWindowId = null;
        this.selectedWindowIds = new Set(); // 다중 선택된 ID들
        this.dragState = null;
        this.resizeState = null;
        this.selectionState = null; // 영역 선택 상태
        this.autoSaveTimers = new Map();
        
        // 퀵 뷰 관련 상태
        this.quickViewCard = null;
        this.quickViewTimer = null;
        this.currentQuickViewId = null;

        // 하이퍼링크 맵 (파일명 -> fileId)
        this.hyperlinkMap = new Map();

        // 캔버스 줌/팬 상태
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.panState = null;
        this.minScale = 0.25;
        this.maxScale = 3;

        // 노드 간 연결선 상태
        this.nodeConnections = []; // Array<{ id, fromId, fromPort, toId, toPort }>
        this.connectionDragState = null;
        this.selectedConnectionId = null;

        // 캔버스 그룹 영역 상태
        this.canvasRegions = [];
        this.regionDragState = null;
        this.regionResizeState = null;

        this.init();
    }

    init() {
        // 전역 마우스 이벤트
        document.addEventListener('mousemove', (e) => {
            this.onMouseMove(e);
            if (this.statResizeState) this.onStatResizing(e);
        });
        document.addEventListener('mouseup', (e) => {
            this.onMouseUp(e);
            if (this.statResizeState) this.stopStatResizing(e);
        });
        document.addEventListener('click', (e) => {
            this.hideContextMenu();
            if (!e.target.closest('.node-connection-line')) {
                this.deselectConnection();
            }
        });
        window.addEventListener('blur', () => {
            document.querySelectorAll('.selection-box').forEach(el => el.remove());
            this.selectionState = null;
        });

        // 상단 헤더 저장 버튼
        document.getElementById('saveBtn')?.addEventListener('click', () => {
            this.saveActiveWindow();
        });

        // 캔버스 그룹 영역 추가 버튼
        document.getElementById('addCanvasRegionBtn')?.addEventListener('click', () => {
            this.addCanvasRegion();
        });

        // 텍스트 병합 모달 버튼
        document.getElementById('closeMergeModal')?.addEventListener('click', () => this.hideMergeModal());
        document.getElementById('cancelMergeBtn')?.addEventListener('click', () => this.hideMergeModal());
        document.getElementById('confirmMergeBtn')?.addEventListener('click', () => this.confirmMerge());

        // 버전 히스토리 모달 버튼
        document.getElementById('closeVersionModal')?.addEventListener('click', () => document.getElementById('versionModal').classList.add('hidden'));
        document.getElementById('cancelVersionBtn')?.addEventListener('click', () => document.getElementById('versionModal').classList.add('hidden'));

        // 노드 핀/포트 수정 모달 버튼
        document.getElementById('closeNodePortEditModal')?.addEventListener('click', () => this.hideNodePortEditModal());
        document.getElementById('cancelNodePortEditBtn')?.addEventListener('click', () => this.hideNodePortEditModal());
        document.getElementById('saveNodePortEditBtn')?.addEventListener('click', () => this.saveNodePortEdit());
        document.getElementById('editAddInputPortBtn')?.addEventListener('click', () => this.addNodePortEditRow('input', '입력 데이터', '#2ecc71'));
        document.getElementById('editAddOutputPortBtn')?.addEventListener('click', () => this.addNodePortEditRow('output', '출력 데이터', '#00ffcc'));

        // 전역 단축키 (저장 및 연결선 삭제)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                const editorScreen = document.getElementById('editorScreen');
                if (editorScreen && !editorScreen.classList.contains('hidden')) {
                    e.preventDefault();
                    this.saveActiveWindow();
                }
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedConnectionId) {
                // 입력 필드 집중 시에는 동작하지 않도록 체크
                const activeTag = document.activeElement ? document.activeElement.tagName : '';
                if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
                    e.preventDefault();
                    this.deleteConnection(this.selectedConnectionId);
                }
            }
        });

        // 캔버스 줌/팬 초기화 (DOM 로드 후)
        setTimeout(() => this.setupCanvasZoom(), 0);
    }

    /**
     * 하이퍼링크 맵 업데이트 (활성화된 폴더 내 파일명 수집)
     */
    async updateHyperlinkMap() {
        if (!window.currentProjectId) return;
        
        try {
            const files = await storage.getProjectFiles(window.currentProjectId);
            const enabledFolders = files.filter(f => f.type === 'folder' && f.hyperlinkEnabled);
            
            this.hyperlinkMap.clear();
            
            for (const folder of enabledFolders) {
                // 해당 폴더의 직계 자식 파일들만 수집 (또는 하위 모두 수집할지 결정 - 여기서는 직계)
                const children = files.filter(f => f.parentId === folder.id && f.type === 'file');
                for (const child of children) {
                    this.hyperlinkMap.set(child.name, child.id);
                }
            }
        } catch (error) {
            console.error('하이퍼링크 맵 업데이트 실패:', error);
        }
    }

    /**
     * 모든 열린 창의 하이라이터 갱신
     */
    async updateAllHighlighters() {
        await this.updateHyperlinkMap();
        for (const [fileId] of this.windows) {
            this.updateHighlighter(fileId);
        }
    }

    /**
     * 캔버스 줌/팬 설정
     */
    setupCanvasZoom() {
        const canvasArea = document.getElementById('canvasArea');
        const container = document.getElementById('canvasContainer');
        if (!canvasArea || !container) return;

        // 초기 위치: (0,0)에서 시작
        this.panX = 0;
        this.panY = 0;

        // 프로젝트 상태 로드 (줌/팬)
        setTimeout(() => this.restoreSession(), 0);

        this.applyTransform(container);

        // 마우스 휠 줌 (Ctrl 없이 바로 동작)
        canvasArea.addEventListener('wheel', (e) => {
            // 에디터 창 내부(텍스트 영역 등)에서 휠을 사용하는 경우는 제외 (스크롤 허용)
            if (e.target.closest('.editor-window')) return;

            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.08 : 0.08;
            this.zoomAt(e.clientX, e.clientY, delta);
        }, { passive: false });

        // 키보드 줌 (+/-)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.1);
                } else if (e.key === '-') {
                    e.preventDefault();
                    this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, -0.1);
                }
            }
        });

        // 우클릭 드래그로 캔버스 팬 이동
        canvasArea.addEventListener('mousedown', (e) => {
            // 창(윈도우) 위에서는 캔버스 팬 이동 방지
            if (e.target.closest('.editor-window')) return;

            if (e.button === 2) {
                e.preventDefault();
                this.panState = {
                    startX: e.clientX,
                    startY: e.clientY,
                    origPanX: this.panX,
                    origPanY: this.panY
                };
                document.body.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';
            }
        });

        // 캔버스 배경 클릭 시 다중 선택 시작
        canvasArea.addEventListener('mousedown', (e) => {
            if (e.target === canvasArea || e.target === container) {
                if (e.button === 0) { // 좌클릭
                    document.querySelectorAll('.selection-box').forEach(el => el.remove());
                    const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
                    if (!isMulti) {
                        this.unfocusAll();
                    }

                    const rect = canvasArea.getBoundingClientRect();
                    // 캔버스 기준 좌표 계산 (줌/팬 반영)
                    const startX = (e.clientX - rect.left - this.panX) / this.scale;
                    const startY = (e.clientY - rect.top - this.panY) / this.scale;

                    this.selectionState = {
                        startX,
                        startY,
                        currentX: startX,
                        currentY: startY,
                        element: null,
                        isMulti,
                        initialSelected: new Set(this.selectedWindowIds)
                    };
                }
            }
        });

        // 캔버스 위 우클릭 메뉴 차단
        canvasArea.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // 줌 리셋 단축키 (Ctrl+0)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                const editorScreen = document.getElementById('editorScreen');
                if (editorScreen && !editorScreen.classList.contains('hidden')) {
                    e.preventDefault();
                    this.resetZoom();
                }
            }
        });
    }

    /**
     * 특정 지점 기준 줌 실행
     * @param {number} clientX 마우스 X 좌표
     * @param {number} clientY 마우스 Y 좌표
     * @param {number} delta 줌 변화량
     */
    zoomAt(clientX, clientY, delta) {
        const canvasArea = document.getElementById('canvasArea');
        if (!canvasArea) return;

        const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale + delta));
        if (newScale === this.scale) return;

        const rect = canvasArea.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        const prevCanvasX = (mouseX - this.panX) / this.scale;
        const prevCanvasY = (mouseY - this.panY) / this.scale;

        this.scale = newScale;
        this.panX = mouseX - prevCanvasX * this.scale;
        this.panY = mouseY - prevCanvasY * this.scale;

        this.applyTransform();
        this.showZoomIndicator();
        this.saveProjectCanvasState();
    }

    /**
     * 줌 배율 표시기 노출 (우하단)
     */
    showZoomIndicator() {
        const indicator = document.getElementById('zoomIndicator');
        if (!indicator) return;

        indicator.textContent = `${Math.round(this.scale * 100)}%`;
        indicator.classList.add('show');

        clearTimeout(this._zoomTimer);
        this._zoomTimer = setTimeout(() => {
            indicator.classList.remove('show');
        }, 1000);
    }

    /**
     * 줌 및 팬 상태 초기화 (100%)
     */
    resetZoom() {
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
        this.showZoomIndicator();
        this.saveProjectCanvasState();
    }

    /**
     * 캔버스 변형 적용 (Scale & Pan)
     */
    applyTransform(container) {
        if (!container) container = document.getElementById('canvasContainer');
        if (!container) return;

        container.style.transformOrigin = '0 0';
        container.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;

        // 도트 배경 동기화 (CSS Variables 활용)
        const area = document.getElementById('canvasArea');
        if (area) {
            area.style.setProperty('--pan-x', `${this.panX}px`);
            area.style.setProperty('--pan-y', `${this.panY}px`);
            area.style.setProperty('--scale', this.scale);

            // 축소 배율에 따른 도트 투명도 처리
            const dotOpacity = this.scale < 0.5 ? Math.max(0, (this.scale - 0.3) / 0.2) : 1;
            area.style.setProperty('--dot-opacity', dotOpacity);
        }
    }

    /**
     * 프로젝트 캔버스 상태 저장 (로컬 스토리지)
     */
    async saveProjectCanvasState() {
        if (!window.currentProjectId) return;
        await storage.updateProject(window.currentProjectId, {
            canvasState: {
                scale: this.scale,
                panX: this.panX,
                panY: this.panY
            }
        });
    }

    async restoreSession() {
        if (!window.currentProjectId) return;

        // 하이퍼링크 정보 미리 로드
        await this.updateHyperlinkMap();

        const project = await storage.getProject(window.currentProjectId);
        if (project && project.canvasState) {
            this.scale = project.canvasState.scale || 1;
            this.panX = project.canvasState.panX || 0;
            this.panY = project.canvasState.panY || 0;
            this.applyTransform();
        }

        // 열려있던 창들 복구
        const files = await storage.getProjectFiles(window.currentProjectId);
        const openFiles = files.filter(f => f.windowState && f.windowState.isOpen);

        for (const file of openFiles) {
            await this.openWindow(file.id, file.windowState);
        }

        // 노드 간 연결선 데이터 로드 및 렌더링
        await this.loadProjectConnections(window.currentProjectId);
    }

    /**
     * 파일을 새 창으로 열거나, 이미 열린 창이면 포커스
     */
    async openWindow(fileId, restoreState = null) {
        const isManualOpen = !restoreState;

        // 이미 열린 경우
        if (this.windows.has(fileId)) {
            this.focusWindow(fileId);
            
            // 수동으로 열었는데 현재 화면(뷰포트)에 보이지 않는다면 중앙으로 이동
            if (isManualOpen && !this.isWindowInViewport(fileId)) {
                this.moveWindowToViewCenter(fileId);
            }
            return;
        }

        // 파일 로드
        const file = await storage.getFile(fileId);
        if (!file || file.type === 'folder') return;

        // 창 위치 계산
        const container = document.getElementById('canvasContainer');
        const canvasArea = document.getElementById('canvasArea');
        if (!container) return;

        // 설정에서 기본 창 크기 불러오기
        const settings = window.toolsPanel?.settings || window.toolsPanel?.loadSettingsSync() || {};
        const defW = settings.defaultWinWidth || 520;
        const defH = settings.defaultWinHeight || 400;

        let x, y, width = defW, height = defH;

        // 세션 복구(최초 로드 등)일 때만 저장된 상태를 사용
        if (restoreState && typeof restoreState.x === 'number') {
            x = restoreState.x;
            y = restoreState.y;
            width = restoreState.width || defW;
            height = restoreState.height || defH;
        } else {
            // 수동으로 여는 경우 현재 보고 있는 화면의 중앙 좌표 계산
            const center = this.calculateViewCenter(width, height);
            x = center.x;
            y = center.y;
        }

        // 창 DOM 생성
        const windowEl = this.createWindowDOM(file, x, y, width, height);
        container.appendChild(windowEl);

        // 상태 저장
        const windowInfo = {
            fileId,
            file,
            element: windowEl,
            textarea: windowEl.querySelector('.window-textarea'),
            backdrop: windowEl.querySelector('.window-backdrop'),
            modified: false
        };
        this.windows.set(fileId, windowInfo);

        // 타자기 모드 초기 상태 반영
        if (file.windowState?.isLineFocus && windowInfo.textarea) {
            windowInfo.textarea.classList.add('line-focus-mode');
            setTimeout(() => this.updateLineFocus(fileId), 10);
        }

        // 파일의 isOpen 상태 업데이트
        if (!restoreState) {
            await this.updateFileWindowState(fileId, { isOpen: true, x, y, width, height });
        }

        // 포커스
        this.focusWindow(fileId);

        // 폴더 자동 수집 노드 및 커스텀 노드(수치 노드 포함) 초기 렌더링
        const isFolderCollector = file.template === 'folder_collector' || file.isFolderCollectorNode || (file.content && typeof file.content === 'string' && file.content.includes('"isFolderCollectorNode"'));
        const isCustomNode = !isFolderCollector && (file.isCustomNode || file.template === 'custom_node' || file.template === 'stat' || file.isStatNode || file.template === 'text_fields' || file.isTextFieldsNode || (file.content && typeof file.content === 'string' && (file.content.includes('"isCustomNode"') || file.content.includes('"stats"'))));

        if (isFolderCollector) {
            this.renderFolderCollectorNode(fileId);
        } else if (isCustomNode) {
            this.renderCustomNode(fileId);
        }



        // 초기 하이라이트 적용
        this.updateHighlighter(fileId);
        // 이미지 창인 경우 원본 크기 표시
        const isImage = file.template === 'image' || (file.content && file.content.startsWith('data:image'));
        if (isImage && file.content) {
            this.updateImageSizeInfo(fileId, file.content);
        }

        this.renderConnections();
    }

    /**
     * 현재 노드의 입력값 및 모든 설정 상태를 그대로 보존하여 노드 템플릿으로 저장
     */
    async saveNodeAsTemplate(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.file) return;

        const file = info.file;
        const winEl = info.element;

        // 1. 현재 DOM 입력 필드 최신 상태를 file.content 객체/문자열로 집계
        if (file.isTextFieldsNode || (file.content && typeof file.content === 'string' && file.content.includes('"isTextFieldsNode"'))) {
            try {
                const container = winEl.querySelector(`#textFieldContainer_${fileId}`);
                if (container) {
                    const data = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
                    const fields = data.textFields || [];
                    const rows = container.querySelectorAll('.stat-item-row');
                    rows.forEach((row, idx) => {
                        if (fields[idx]) {
                            const valInput = row.querySelector('.stat-name-input:nth-child(2)');
                            if (valInput) fields[idx].value = valInput.value;
                        }
                    });
                    const outTplTextarea = container.querySelector('.memo-textarea');
                    if (outTplTextarea) data.outputTemplate = outTplTextarea.value;

                    file.content = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else if (file.template === 'stat' || file.isStatNode) {
            try {
                const container = winEl.querySelector(`#statContainer_${fileId}`);
                if (container) {
                    const data = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
                    const stats = data.stats || [];
                    const rows = container.querySelectorAll('.stat-item-row');
                    rows.forEach((row, idx) => {
                        if (stats[idx]) {
                            const valInput = row.querySelector('.stat-value');
                            if (valInput) stats[idx].value = parseInt(valInput.value, 10) || 0;
                        }
                    });
                    file.content = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else if (file.isSystemPromptNode || (file.content && typeof file.content === 'string' && file.content.includes('"command"'))) {
            try {
                const cmdInput = winEl.querySelector(`#sysPromptCommand_${fileId}`);
                const txtTextarea = winEl.querySelector(`#sysPromptText_${fileId}`);
                if (cmdInput && txtTextarea) {
                    const data = { command: cmdInput.value, text: txtTextarea.value };
                    file.content = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else if (file.isAiMetaNode || (file.content && typeof file.content === 'string' && file.content.includes('"role"'))) {
            try {
                const roleInput = winEl.querySelector(`#aiMetaRole_${fileId}`);
                const taskTextarea = winEl.querySelector(`#aiMetaTask_${fileId}`);
                const instTextarea = winEl.querySelector(`#aiMetaInstructions_${fileId}`);
                if (roleInput && taskTextarea && instTextarea) {
                    const data = { role: roleInput.value, task: taskTextarea.value, instructions: instTextarea.value };
                    file.content = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else {
            const textarea = winEl.querySelector('.window-textarea');
            if (textarea) {
                file.content = textarea.value;
            }
        }

        // 파일 최신 변경사항 DB 저장
        await window.storage.updateFile(fileId, { content: file.content });

        const rawName = (file.name || '새 노드').replace(/^[^\w\s가-힣]+\s*/, '').trim();
        const customName = prompt('이 노드를 어떤 이름의 템플릿으로 저장하시겠습니까?', rawName);
        if (!customName || !customName.trim()) return;

        const templateObj = {
            id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: customName.trim(),
            icon: file.icon || '📄',
            desc: `입력 칸이 채워진 노드 템플릿 (${new Date().toLocaleDateString()})`,
            wizardType: file.template || 'file',
            template: file.template || 'file',
            isTextFieldsNode: !!file.isTextFieldsNode,
            isFolderCollectorNode: !!file.isFolderCollectorNode,
            isStatNode: !!file.isStatNode,
            isSystemPromptNode: !!file.isSystemPromptNode,
            isAiMetaNode: !!file.isAiMetaNode,
            content: file.content || '',
            portsConfig: file.portsConfig || null,
            createdAt: Date.now()
        };

        await window.storage.createTemplate(templateObj);
        window.showToast?.(`'${templateObj.name}' 노드가 입력 보존 템플릿으로 저장되었습니다! ⭐`);

        if (window.templateManager) {
            await window.templateManager.renderNodeTemplatesInSelectModal();
        }
    }

    /**
     * 이미지 원본 크기 정보 업데이트
     */
    updateImageSizeInfo(fileId, base64) {
        const sizeEl = document.getElementById(`imageSize_${fileId}`);
        const info = this.windows.get(fileId);
        if (!sizeEl || !base64 || !info) return;

        const img = new Image();
        img.onload = () => {
            // MIME 타입에서 실제 확장자 추출 (예: data:image/png;base64 -> PNG)
            let ext = 'IMG';
            
            if (base64.startsWith('data:image/')) {
                const mimeType = base64.split(';')[0].split(':')[1]; // image/png
                ext = mimeType.split('/')[1].toUpperCase(); // PNG
            }

            // JPEG 보정 및 표시
            if (ext === 'JPEG') ext = 'JPG';
            sizeEl.textContent = `(${img.naturalWidth}x${img.naturalHeight} / ${ext})`;
            
            // 저장된 회전 및 스케일 적용
            this.applyImageRotation(fileId);
        };
        img.src = base64;
    }

    /**
     * 타자기 모드(Line Focus) 업데이트
     */
    updateLineFocus(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.textarea || !info.element) return;

        const textarea = info.textarea;
        const isFocus = textarea.classList.contains('line-focus-mode');
        const editor = info.element.querySelector('.window-editor');
        if (!editor) return;

        let highlight = editor.querySelector('.line-focus-highlight');
        if (!isFocus) {
            if (highlight) highlight.remove();
            return;
        }

        if (!highlight) {
            highlight = document.createElement('div');
            highlight.className = 'line-focus-highlight';
            editor.appendChild(highlight);
        }

        const textBefore = (textarea.value || "").substring(0, textarea.selectionStart || 0);
        const currentLineIndex = textBefore.split('\n').length - 1;

        const style = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        
        const topPos = paddingTop + (currentLineIndex * lineHeight);
        highlight.style.top = `${topPos}px`;
        highlight.style.height = `${lineHeight}px`;
        highlight.style.width = `calc(100% - ${parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)}px)`;
        highlight.style.left = style.paddingLeft;
        highlight.style.transform = `translateY(-${textarea.scrollTop}px)`;

        // CSS 변수 설정 (마스킹용)
        editor.style.setProperty('--focus-top', `${topPos}px`);
        editor.style.setProperty('--focus-height', `${lineHeight}px`);
    }

    /**
     * 타자기 모드 토글
     */
    toggleLineFocus(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.textarea) return;

        const isFocus = info.textarea.classList.toggle('line-focus-mode');
        this.updateLineFocus(fileId);
        this.updateFileWindowState(fileId, { isLineFocus: isFocus });
    }

    /**
     * 현재 뷰포트의 중앙 좌표 계산 (줌/팬 반영)
     */
    calculateViewCenter(width, height) {
        const canvasArea = document.getElementById('canvasArea');
        const areaRect = canvasArea ? canvasArea.getBoundingClientRect() : { width: 800, height: 600 };
        
        // 캔버스 좌표계 기준 중심점 계산
        const viewCenterX = (areaRect.width / 2 - this.panX) / this.scale;
        const viewCenterY = (areaRect.height / 2 - this.panY) / this.scale;

        // 계단식 배열(Cascade)을 위한 오프셋 적용 (노드 간 여백 포함)
        const offsetStep = 50;
        const x = viewCenterX - (width / 2) + (this.cascadeOffset * offsetStep) % 250;
        const y = viewCenterY - (height / 2) + (this.cascadeOffset * offsetStep) % 180;
        this.cascadeOffset++;
        
        return { x, y };
    }

    /**
     * 창이 현재 화면(뷰포트) 안에 있는지 확인
     */
    isWindowInViewport(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return false;
        
        const rect = info.element.getBoundingClientRect();
        const areaRect = document.getElementById('canvasArea').getBoundingClientRect();
        
        // 최소 50px 이상 화면에 걸쳐있는지 확인
        return (
            rect.right > areaRect.left + 50 &&
            rect.left < areaRect.right - 50 &&
            rect.bottom > areaRect.top + 50 &&
            rect.top < areaRect.bottom - 50
        );
    }

    /**
     * 창을 현재 화면 중앙으로 즉시 이동
     */
    moveWindowToViewCenter(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;
        
        const width = info.element.offsetWidth;
        const height = info.element.offsetHeight;
        const center = this.calculateViewCenter(width, height);
        
        info.element.style.left = `${center.x}px`;
        info.element.style.top = `${center.y}px`;
        
        // 이동된 위치 저장
        this.updateFileWindowState(fileId, { x: center.x, y: center.y });
    }

    /**
     * 파일의 윈도우 상태 저장
     */
    async updateFileWindowState(fileId, stateUpdates) {
        const file = await storage.getFile(fileId);
        if (!file) return;

        const currentWindowState = file.windowState || {};
        const newWindowState = { ...currentWindowState, ...stateUpdates };

        await storage.updateFile(fileId, { windowState: newWindowState });
    }

    /**
     * 창 DOM 생성
     */
    createWindowDOM(file, x, y, width, height) {
        const isCollapsed = file.windowState?.isCollapsed || false;
        const isImage = file.template === 'image' || (file.content && typeof file.content === 'string' && file.content.startsWith('data:image'));
        const isStat = file.template === 'stat' || file.isStatNode;
        const isTextFields = file.isTextFieldsNode || (file.content && typeof file.content === 'string' && file.content.includes('"isTextFieldsNode"'));
        const isSystemPrompt = file.isSystemPromptNode || (file.content && typeof file.content === 'string' && file.content.includes('"command"'));
        const isFolderCollector = file.template === 'folder_collector' || file.isFolderCollectorNode || (file.content && typeof file.content === 'string' && file.content.includes('"isFolderCollectorNode"'));
        const isCustomNode = !isFolderCollector && (file.isCustomNode || file.template === 'custom_node' || file.template === 'stat' || file.isStatNode || file.template === 'text_fields' || file.isTextFieldsNode || (file.content && typeof file.content === 'string' && (file.content.includes('"isCustomNode"') || file.content.includes('"stats"'))));



        
        const win = document.createElement('div');
        win.className = `editor-window${isCollapsed ? ' collapsed' : ''}${isImage ? ' image-window' : ''}${isStat ? ' stat-window' : ''}`;
        win.dataset.fileId = file.id;
        win.style.left = `${x}px`;
        win.style.top = `${y}px`;
        win.style.width = isCollapsed ? '180px' : `${width}px`;
        win.style.height = isCollapsed ? '50px' : `${height}px`;
        win.style.zIndex = ++this.zIndexCounter;

        // 아이콘 결정
        const icon = file.icon || (file.template ? this.getTemplateIcon(file.template) : '📄');
        const collapseChar = isCollapsed ? '+' : '−';

        let bodyContent = '';
        if (isImage) {
            const hasImage = !!file.content;
            bodyContent = `
                <div class="window-body image-body">
                    <div class="window-image-container" id="imageContainer_${file.id}">
                        ${hasImage ? 
                            `<img src="${file.content}" class="window-image-viewer" id="imageViewer_${file.id}">` : 
                            `<div class="image-upload-dropzone" id="dropzone_${file.id}">
                                <div class="image-upload-icon">🖼️</div>
                                <div class="image-upload-text">클릭하거나 이미지를 드래그하여 업로드</div>
                                <input type="file" id="imageInput_${file.id}" accept="image/*" style="display: none;">
                             </div>`
                        }
                    </div>
                </div>
            `;
        } else if (isFolderCollector) {
            bodyContent = `
                <div class="stat-calculator-container" id="folderCollectorContainer_${file.id}">
                    <!-- 폴더 자동 수집 노드 UI가 렌더링됩니다 -->
                </div>
            `;
        } else if (isCustomNode) {
            bodyContent = `
                <div class="window-body custom-node-body" style="padding:0; height:calc(100% - 35px); overflow:hidden;">
                    <!-- 커스텀 정의 노드 UI가 렌더링됩니다 -->
                </div>
            `;
        } else {
            bodyContent = `
                <div class="window-editor">
                    <div class="window-backdrop"></div>
                    <textarea class="window-textarea" 
                        placeholder="여기에 이야기를 작성하세요..." 
                        spellcheck="false">${this.escapeHtml(file.content || '')}</textarea>
                </div>
            `;
        }


        const isImageNode = file.template === 'image' || (file.content && typeof file.content === 'string' && file.content.startsWith('data:image'));
        const defaultInputs = (isFolderCollector || isImageNode) ? [] : [{ id: 'in_1', name: '입력 데이터' }];

        const portsConfig = file.portsConfig || {
            inputs: defaultInputs,
            outputs: [{ id: 'out_1', name: '출력 데이터' }]
        };

        const inputsArr = isImageNode ? [] : (Array.isArray(portsConfig.inputs) ? portsConfig.inputs : defaultInputs);
        const outputsArr = Array.isArray(portsConfig.outputs) ? portsConfig.outputs : [{ id: 'out_1', name: '출력 데이터' }];

        const inputsHtml = inputsArr.map(p => {
            const portColor = p.color || '#2ecc71';
            return `
            <div class="node-port-item node-port-item-left">
                <div class="node-port port-left" data-file-id="${file.id}" data-port-id="${p.id}" data-port-type="left" data-port-color="${portColor}" style="--port-color: ${portColor};" title="📥 Input 포트: ${this.escapeHtml(p.name)}"></div>
                <span class="node-port-label node-port-label-left" style="--port-color: ${portColor};">📥 ${this.escapeHtml(p.name)}</span>
            </div>
            `;
        }).join('');

        const outputsHtml = outputsArr.map(p => {
            const portColor = p.color || '#00ffcc';
            return `
            <div class="node-port-item node-port-item-right">
                <div class="node-port port-right" data-file-id="${file.id}" data-port-id="${p.id}" data-port-type="right" data-port-color="${portColor}" style="--port-color: ${portColor};" title="📤 Output 포트: ${this.escapeHtml(p.name)}"></div>
                <span class="node-port-label node-port-label-right" style="--port-color: ${portColor};">📤 ${this.escapeHtml(p.name)}</span>
            </div>
            `;
        }).join('');

        // 포트 개수에 따른 노드 창 최소 높이 (60px 간격 + 핀 높이 고려)
        const maxPortsCount = Math.max(inputsArr.length, outputsArr.length);
        const calcMinHeight = Math.max(240, maxPortsCount * 80 + 50);
        win.style.minHeight = `${calcMinHeight}px`;

        win.innerHTML = `
            <div class="node-ports-wrapper-left">${inputsHtml}</div>
            <div class="node-ports-wrapper-right">${outputsHtml}</div>
            <div class="window-titlebar" data-file-id="${file.id}">
                <div class="window-titlebar-left">
                    <span class="window-titlebar-icon">${icon}</span>
                    <span class="window-titlebar-name">${this.escapeHtml(file.name)}</span>
                    ${isImage ? `<span class="window-image-size" id="imageSize_${file.id}"></span>` : ''}
                    <span class="window-modified" data-indicator="${file.id}"></span>
                </div>
                <div class="window-titlebar-actions">
                    <button class="window-btn window-btn-save-template" data-action="save-template" title="⭐ 현재 채워진 입력 상태 그대로 노드 템플릿 저장">⭐</button>
                    ${isImage ? `<button class="window-btn window-btn-rotate" data-action="rotate" title="90도 회전">🔄</button>` : ''}
                    ${(!isImage && !isStat) ? `<button class="window-btn window-btn-focus" data-action="line-focus" title="타자기 모드(집중)">🖋️</button>` : ''}
                    <button class="window-btn window-btn-collapse" data-action="collapse" title="접기/펴기">${collapseChar}</button>
                    <button class="window-btn window-btn-close" data-action="close" title="닫기">✕</button>
                </div>
            </div>
            ${bodyContent}
            ${(!isImage && !isStat) ? `
            <div class="window-statusbar">
                <div class="window-status-left" data-stats="${file.id}">
                    <span class="stat-item total">0자</span>
                    <span class="stat-item nospace">(공백제외 0)</span>
                    <span class="stat-item sentences">0문장</span>
                    <span class="stat-item paragraphs">0단락</span>
                </div>
                <div class="window-status-right">
                    <button class="window-status-btn" data-action="version" title="버전 관리(스냅샷)" style="background:transparent; border:none; color:inherit; cursor:pointer; font-size:12px; padding:0 4px; opacity:0.7;">🕒</button>
                    <span class="window-status-saved" data-saved="${file.id}"></span>
                </div>
            </div>
            ` : ''}
            <div class="window-edge edge-n" data-dir="n"></div>
            <div class="window-edge edge-s" data-dir="s"></div>
            <div class="window-edge edge-e" data-dir="e"></div>
            <div class="window-edge edge-w" data-dir="w"></div>
            <div class="window-edge edge-nw" data-dir="nw"></div>
            <div class="window-edge edge-ne" data-dir="ne"></div>
            <div class="window-edge edge-sw" data-dir="sw"></div>
            <div class="window-edge edge-se" data-dir="se"></div>
        `;

        // 설정 적용 지연 실행 (글꼴 등 동기화)
        setTimeout(() => {
            if (window.toolsPanel) {
                const settings = window.toolsPanel.loadSettingsSync();
                this.applySettingsToWindow(win, settings);
            }
        }, 0);

        // 이벤트 바인딩
        this.bindWindowEvents(win, file.id);

        // 초기 글자수 업데이트 (이미지가 아닐 때만)
        if (!isImage) {
            this.updateCharCount(file.id, file.content || '', win);
        }

        return win;
    }

    applySettingsToWindow(win, s) {
        const editor = win.querySelector('.window-editor');
        const textarea = win.querySelector('.window-textarea');
        const backdrop = win.querySelector('.window-backdrop');
        
        // 이미지 창 등 에디터가 없는 경우 스킵
        if (!editor || !textarea) return;

        // 1. 에디터 배경색 적용
        editor.style.backgroundColor = s.backgroundColor;

        // 2. 텍스트 스타일 및 색상 적용
        [textarea, backdrop].forEach(el => {
            if (!el) return;
            el.style.fontFamily = s.fontFamily;
            el.style.fontSize = s.fontSize + 'px';
            el.style.lineHeight = s.lineHeight;
            el.style.letterSpacing = s.letterSpacing + 'px';
        });

        // 3. 텍스트 색상 및 투명도 처리 (에디터 전용 설정값 사용)
        const editorTextColor = s.textColor || '#e6edf3';
        textarea.style.color = 'transparent';
        textarea.style.webkitTextFillColor = 'transparent';
        textarea.style.caretColor = editorTextColor;
        
        if (backdrop) {
            backdrop.style.color = editorTextColor;
        }
    }

    /**
     * 하이라이터 업데이트 (다이얼로그/생각/하이퍼링크 강조)
     */
    updateHighlighter(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.backdrop) return;

        let text = info.textarea.value;
        if (!text) {
            info.backdrop.innerHTML = '';
            return;
        }

        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 1. 하이퍼링크 (파일명) 강조 - 특수 마커를 사용하여 중복 매칭 방지
        if (this.hyperlinkMap.size > 0) {
            const sortedNames = Array.from(this.hyperlinkMap.keys())
                .sort((a, b) => b.length - a.length);

            for (const name of sortedNames) {
                if (!name) continue;
                const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const regexSafeName = escapedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // 경계 확인 제거: 문장 내 어디에 있든 파일명이 포함되어 있으면 매칭
                const regex = new RegExp(`${regexSafeName}`, 'g');
                
                html = html.replace(regex, (match) => `\u0001${match}\u0002`);
            }
        }

        // 2. 다이얼로그 및 생각 강조 (줄바꿈 방지)
        html = html.replace(/"([^"\n]*)"/g, '<span class="hl-dialogue">"$1"</span>');
        html = html.replace(/'([^'\n]*)'/g, '<span class="hl-thought">\'$1\'</span>');
        html = html.replace(/\(([^)\n]*)\)/g, '<span class="hl-thought">($1)</span>');

        // 3. 임시 마커를 실제 하이퍼링크 span으로 변환
        html = html.replace(/\u0001/g, '<span class="hl-link">').replace(/\u0002/g, '</span>');

        // 4. 줄바꿈 처리 및 렌더링
        info.backdrop.innerHTML = html.replace(/\n/g, '<br>') + (text.endsWith('\n') ? '<br>' : '');

        // 5. 스크롤 동기화
        info.backdrop.scrollTop = info.textarea.scrollTop;
    }

    /**
     * 창 이벤트 바인딩
     */
    bindWindowEvents(win, fileId) {
        // 노드 포트 드래그 연결 이벤트
        const ports = win.querySelectorAll('.node-port');
        ports.forEach(port => {
            port.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const portType = port.dataset.portType;
                this.startConnectionDrag(e, fileId, portType, port);
            });
        });

        // 포커스 (클릭 시)
        win.addEventListener('mousedown', (e) => {
            const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
            this.focusWindow(fileId, isMulti);
        });

        // 타이틀 바 드래그
        const titlebar = win.querySelector('.window-titlebar');

        // 우클릭 컨텍스트 메뉴
        titlebar.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showContextMenu(e.clientX, e.clientY, fileId);
        });

        titlebar.addEventListener('mousedown', (e) => {
            if (e.target.closest('.window-btn')) return;
            e.preventDefault();

            // 만약 현재 창이 선택되지 않은 상태라면 이를 단독 선택(또는 다중 추가)
            const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
            if (!this.selectedWindowIds.has(fileId)) {
                this.focusWindow(fileId, isMulti);
            }

            // 선택된 모든 창들의 정보를 수집하여 드래그 상태에 저장
            const targets = [];
            this.selectedWindowIds.forEach(id => {
                const info = this.windows.get(id);
                if (info && info.element) {
                    const leftVal = parseFloat(info.element.style.left);
                    const topVal = parseFloat(info.element.style.top);
                    targets.push({
                        id,
                        element: info.element,
                        origLeft: !isNaN(leftVal) ? leftVal : info.element.offsetLeft,
                        origTop: !isNaN(topVal) ? topVal : info.element.offsetTop
                    });
                }
            });

            this.dragState = {
                fileId,
                targets,
                startX: e.clientX,
                startY: e.clientY
            };

            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';

            // 드래그 종료 시 위치 저장
            window.addEventListener('mouseup', () => {
                if (this.dragState && this.dragState.fileId === fileId) {
                    this.dragState.targets.forEach(t => {
                        this.updateFileWindowState(t.id, {
                            x: t.element.offsetLeft,
                            y: t.element.offsetTop
                        });
                    });
                }
            }, { once: true });
        });

        // 버튼 (닫기, 접기, 회전)
        win.querySelectorAll('.window-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'close') this.closeWindow(fileId);
                if (action === 'collapse') this.toggleCollapse(fileId);
                if (action === 'rotate') this.rotateImage(fileId);
                if (action === 'line-focus') this.toggleLineFocus(fileId);
                if (action === 'save-template') this.saveNodeAsTemplate(fileId);
            });
        });

        // 상태바 버튼 (버전 관리)
        win.querySelectorAll('.window-status-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'version') this.showVersionHistory(fileId);
            });
        });

        // 이미지 업로드 이벤트 (이미지 파일인 경우)
        const dropzone = win.querySelector(`#dropzone_${fileId}`);
        const input = win.querySelector(`#imageInput_${fileId}`);
        
        if (dropzone && input) {
            dropzone.addEventListener('click', () => input.click());
            
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.handleImageUpload(fileId, file);
            });

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('dragover');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    this.handleImageUpload(fileId, file);
                }
            });
        }

        // 8방향 리사이즈 핸들
        win.querySelectorAll('.window-edge').forEach(edge => {
            edge.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const leftVal = parseFloat(win.style.left);
                const topVal = parseFloat(win.style.top);
                const widthVal = parseFloat(win.style.width);
                const heightVal = parseFloat(win.style.height);

                this.resizeState = {
                    fileId,
                    element: win,
                    dir: edge.dataset.dir,
                    startX: e.clientX,
                    startY: e.clientY,
                    origWidth: !isNaN(widthVal) ? widthVal : win.offsetWidth,
                    origHeight: !isNaN(heightVal) ? heightVal : win.offsetHeight,
                    origLeft: !isNaN(leftVal) ? leftVal : win.offsetLeft,
                    origTop: !isNaN(topVal) ? topVal : win.offsetTop
                };
                const cursorMap = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
                document.body.style.cursor = cursorMap[edge.dataset.dir] || 'nwse-resize';
                document.body.style.userSelect = 'none';

                // 리사이즈 종료 시 크기/위치 저장
                window.addEventListener('mouseup', () => {
                    this.updateFileWindowState(fileId, {
                        x: win.offsetLeft,
                        y: win.offsetTop,
                        width: win.offsetWidth,
                        height: win.offsetHeight
                    });
                }, { once: true });
            });
        });

        // 텍스트 편집 (에디터가 있는 경우에만)
        const textarea = win.querySelector('.window-textarea');
        if (!textarea) return;

        textarea.addEventListener('input', () => {
            this.onTextChange(fileId, textarea.value);
            this.updateHighlighter(fileId);
            this.updateLineFocus(fileId);
        });

        textarea.addEventListener('scroll', () => {
            this.updateHighlighter(fileId);
            this.updateLineFocus(fileId);
        });

        // 커서 이동 대응 (클릭, 키보드)
        ['click', 'keyup', 'focus'].forEach(evt => {
            textarea.addEventListener(evt, () => {
                this.updateLineFocus(fileId);
            });
        });

        // 따옴표 자동 닫기 및 괄호 처리 (스마트 버전)
        textarea.addEventListener('keydown', (e) => {
            const settings = window.toolsPanel?.settings || {};

            // 엔터 시 자동 들여쓰기 처리
            if (e.key === 'Enter' && settings.autoIndent && !e.shiftKey) {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const text = textarea.value;

                // 엔터(줄바꿈) + 공백 한 칸 삽입
                const newText = text.substring(0, start) + "\n " + text.substring(end);
                textarea.value = newText;
                textarea.selectionStart = textarea.selectionEnd = start + 2; // \n + 공백 (2글자)
                
                this.onTextChange(fileId, newText);
                this.updateHighlighter(fileId);
                return;
            }

            if (!settings.autoCloseQuotes) return;

            const charMap = { '"': '"', "'": "'", "(": ")", "[": "]", "{": "}" };
            const openChar = e.key;
            const closeChar = charMap[openChar];
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;

            // 1. 오버타이핑 처리: 닫는 문자가 바로 앞에 있고 똑같은 문자를 치면 커서만 이동
            if (start === end && text[start] === openChar && (openChar === "'" || openChar === '"' || openChar === ')' || openChar === ']' || openChar === '}')) {
                e.preventDefault();
                textarea.selectionStart = textarea.selectionEnd = start + 1;
                return;
            }

            // 2. 자동 닫기 및 감싸기
            if (closeChar) {
                e.preventDefault();
                
                if (start !== end) {
                    // 선택된 텍스트가 있으면 감싸기
                    const selected = text.substring(start, end);
                    textarea.value = text.substring(0, start) + openChar + selected + closeChar + text.substring(end);
                    textarea.selectionStart = start + 1;
                    textarea.selectionEnd = end + 1;
                } else {
                    // 선택된 텍스트가 없으면 자동 닫고 가운데로
                    textarea.value = text.substring(0, start) + openChar + closeChar + text.substring(end);
                    textarea.selectionStart = textarea.selectionEnd = start + 1;
                }
                
                this.onTextChange(fileId, textarea.value);
                this.updateHighlighter(fileId);
            }
        });

        // 텍스트 영역에서 드래그 방지 및 포커스 처리
        textarea.addEventListener('mousedown', (e) => {
            this.focusWindow(fileId);
            e.stopPropagation();
        });

        textarea.addEventListener('click', async (e) => {
            // Ctrl + 좌클릭 시 작동
            if (!(e.ctrlKey || e.metaKey)) return;

            const pos = textarea.selectionStart;
            const text = textarea.value;

            // 1. 하이퍼링크 작동 (파일명 클릭 시 창 열기)
            if (this.hyperlinkMap.size > 0) {
                const sortedNames = Array.from(this.hyperlinkMap.keys()).sort((a, b) => b.length - a.length);
                for (const name of sortedNames) {
                    let index = text.indexOf(name);
                    while (index !== -1) {
                        if (pos >= index && pos <= index + name.length) {
                            e.preventDefault();
                            const targetId = this.hyperlinkMap.get(name);
                            if (targetId) {
                                this.openWindow(targetId);
                                return;
                            }
                        }
                        index = text.indexOf(name, index + 1);
                    }
                }
            }
        });

        // Ctrl 키를 누른 채 하이퍼링크 위에 마우스를 올리면 커서 변경 및 퀵 뷰 표시
        textarea.addEventListener('mousemove', (e) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            
            // 커서 아래에 파일명이나 상태창 트리거가 있는지 확인
            const pos = this.getTextOffsetFromPoint(textarea, e.clientX, e.clientY);
            const text = textarea.value;
            let foundLink = false;
            let foundStat = false;
            let targetFileId = null;

            if (pos !== -1 && this.hyperlinkMap.size > 0) {
                for (const [name, id] of this.hyperlinkMap.entries()) {
                    let index = text.indexOf(name);
                    while (index !== -1) {
                        if (pos >= index && pos <= index + name.length) {
                            foundLink = true;
                            targetFileId = id;
                            break;
                        }
                        index = text.indexOf(name, index + 1);
                    }
                    if (foundLink) break;
                }
            }

            // 커서 스타일 변경 (Ctrl 누른 상태에서만 포인터)
            textarea.style.cursor = (isCtrl && (foundLink || foundStat)) ? 'pointer' : 'text';

            // 퀵 뷰 처리 (Ctrl 여부와 상관없이 이름 위에 있으면 표시)
            if (foundLink && targetFileId) {
                clearTimeout(this.quickViewTimer);
                this.quickViewTimer = setTimeout(() => {
                    this.showQuickView(targetFileId, e.clientX, e.clientY);
                }, 300); // 300ms 호버 대기
            } else {
                clearTimeout(this.quickViewTimer);
                this.hideQuickView();
            }
        });

        textarea.addEventListener('mouseleave', () => {
            clearTimeout(this.quickViewTimer);
            this.hideQuickView();
        });

        textarea.addEventListener('focus', () => {
            this.focusWindow(fileId);
        });
    }

    /**
     * 마우스 좌표로부터 텍스트 오프셋(인덱스) 계산
     */
    getTextOffsetFromPoint(textarea, x, y) {
        // 브라우저 지원 확인 (현대 브라우저 표준)
        if (document.caretPositionFromPoint) {
            const range = document.caretPositionFromPoint(x, y);
            return range ? range.offset : -1;
        } else if (document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(x, y);
            return range ? range.startOffset : -1;
        }
        return -1;
    }

    /**
     * 마우스 이동 처리
     */
    onMouseMove(e) {
        // 다중 드래그 이동
        if (this.dragState) {
            const currentScale = this.scale || this.zoom || 1;
            const dx = (e.clientX - this.dragState.startX) / currentScale;
            const dy = (e.clientY - this.dragState.startY) / currentScale;
            this.dragState.targets.forEach(t => {
                t.element.style.left = `${t.origLeft + dx}px`;
                t.element.style.top = `${t.origTop + dy}px`;
            });
            this.renderConnections();
        }

        // 영역 선택 드래그 (Marquee)
        if (this.selectionState) {
            const canvasArea = document.getElementById('canvasArea');
            const rect = canvasArea.getBoundingClientRect();
            
            // 캔버스 좌표계 기준 위치 계산
            const currentX = (e.clientX - rect.left - this.panX) / this.scale;
            const currentY = (e.clientY - rect.top - this.panY) / this.scale;
            
            this.selectionState.currentX = currentX;
            this.selectionState.currentY = currentY;
            
            this.updateSelectionBox();
            this.updateSelection(this.selectionState.isMulti);
        }

        // 8방향 리사이즈
        if (this.resizeState) {
            const s = this.resizeState;
            const currentScale = this.scale || this.zoom || 1;
            const dx = (e.clientX - s.startX) / currentScale;
            const dy = (e.clientY - s.startY) / currentScale;
            const dir = s.dir;
            
            const minW = parseFloat(s.element.style.minWidth) || 280;
            const minH = parseFloat(s.element.style.minHeight) || 220;

            let newW = s.origWidth, newH = s.origHeight;
            let newL = s.origLeft, newT = s.origTop;

            if (dir.includes('e')) { newW = Math.max(minW, s.origWidth + dx); }
            if (dir.includes('w')) { newW = Math.max(minW, s.origWidth - dx); newL = s.origLeft + (s.origWidth - newW); }
            if (dir.includes('s')) { newH = Math.max(minH, s.origHeight + dy); }
            if (dir.includes('n')) { newH = Math.max(minH, s.origHeight - dy); newT = s.origTop + (s.origHeight - newH); }

            s.element.style.width = `${newW}px`;
            s.element.style.height = `${newH}px`;
            s.element.style.left = `${newL}px`;
            s.element.style.top = `${newT}px`;

            // 이미지 창인 경우 회전 스케일 재계산
            if (s.element.classList.contains('image-window')) {
                this.applyImageRotation(s.fileId);
            }
            this.renderConnections();
        }

        // 노드 연결선 드래그 처리
        if (this.connectionDragState) {
            this.updateConnectionDrag(e);
        }

        // 캔버스 그룹 영역 이동
        if (this.regionDragState) {
            const currentScale = this.scale || this.zoom || 1;
            const dx = (e.clientX - this.regionDragState.startX) / currentScale;
            const dy = (e.clientY - this.regionDragState.startY) / currentScale;
            const targetRegion = (this.canvasRegions || []).find(r => r.id === this.regionDragState.regionId);
            if (targetRegion) {
                targetRegion.x = Math.round(this.regionDragState.origX + dx);
                targetRegion.y = Math.round(this.regionDragState.origY + dy);
                const boxEl = document.getElementById(targetRegion.id);
                if (boxEl) {
                    boxEl.style.left = `${targetRegion.x}px`;
                    boxEl.style.top = `${targetRegion.y}px`;
                }
            }
        }

        // 캔버스 그룹 영역 4방향 모서리 크기 조절
        if (this.regionResizeState) {
            const currentScale = this.scale || this.zoom || 1;
            const dx = (e.clientX - this.regionResizeState.startX) / currentScale;
            const dy = (e.clientY - this.regionResizeState.startY) / currentScale;
            const dir = this.regionResizeState.dir || 'se';
            const s = this.regionResizeState;
            const targetRegion = (this.canvasRegions || []).find(r => r.id === s.regionId);

            if (targetRegion) {
                const minW = 180;
                const minH = 120;
                let newW = s.origW, newH = s.origH;
                let newX = s.origX, newY = s.origY;

                if (dir.includes('e')) {
                    newW = Math.max(minW, s.origW + dx);
                }
                if (dir.includes('w')) {
                    newW = Math.max(minW, s.origW - dx);
                    newX = s.origX + (s.origW - newW);
                }
                if (dir.includes('s')) {
                    newH = Math.max(minH, s.origH + dy);
                }
                if (dir.includes('n')) {
                    newH = Math.max(minH, s.origH - dy);
                    newY = s.origY + (s.origH - newH);
                }

                targetRegion.x = Math.round(newX);
                targetRegion.y = Math.round(newY);
                targetRegion.width = Math.round(newW);
                targetRegion.height = Math.round(newH);

                const boxEl = document.getElementById(targetRegion.id);
                if (boxEl) {
                    boxEl.style.left = `${targetRegion.x}px`;
                    boxEl.style.top = `${targetRegion.y}px`;
                    boxEl.style.width = `${targetRegion.width}px`;
                    boxEl.style.height = `${targetRegion.height}px`;
                }
            }
        }

        // 캔버스 팬
        if (this.panState) {
            const dx = e.clientX - this.panState.startX;
            const dy = e.clientY - this.panState.startY;
            this.panX = this.panState.origPanX + dx;
            this.panY = this.panState.origPanY + dy;
            this.applyTransform();
            this.saveProjectCanvasState();
        }
    }

    /**
     * 마우스 놓기 처리
     */
    onMouseUp(e) {
        if (this.connectionDragState) {
            this.endConnectionDrag(e);
        }

        document.querySelectorAll('.selection-box').forEach(el => el.remove());

        if (this.regionDragState || this.regionResizeState) {
            this.regionDragState = null;
            this.regionResizeState = null;
            this.saveRegions();
        }

        if (this.dragState || this.resizeState || this.panState || this.selectionState) {
            this.dragState = null;
            this.resizeState = null;
            this.panState = null;
            this.selectionState = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }

    /**
     * 선택 영역 UI 업데이트
     */
    updateSelectionBox() {
        const s = this.selectionState;
        if (!s) return;

        const left = Math.min(s.startX, s.currentX);
        const top = Math.min(s.startY, s.currentY);
        const width = Math.abs(s.startX - s.currentX);
        const height = Math.abs(s.startY - s.currentY);

        // 일정 크기 이상 드래그했을 때만 상자 생성
        if (!s.element && (width > 5 || height > 5)) {
            s.element = document.createElement('div');
            s.element.className = 'selection-box';
            document.getElementById('canvasContainer').appendChild(s.element);
        }

        if (s.element) {
            s.element.style.left = `${left}px`;
            s.element.style.top = `${top}px`;
            s.element.style.width = `${width}px`;
            s.element.style.height = `${height}px`;
        }
    }

    /**
     * 선택 영역 내의 창 식별 및 상태 업데이트
     */
    updateSelection(isMulti) {
        const s = this.selectionState;
        if (!s) return;

        const left = Math.min(s.startX, s.currentX);
        const top = Math.min(s.startY, s.currentY);
        const right = left + Math.abs(s.startX - s.currentX);
        const bottom = top + Math.abs(s.startY - s.currentY);

        this.windows.forEach((info, fileId) => {
            const winLeft = info.element.offsetLeft;
            const winTop = info.element.offsetTop;
            const winRight = winLeft + info.element.offsetWidth;
            const winBottom = winTop + info.element.offsetHeight;

            // 사각형 충돌 체크 (AABB)
            const isInside = !(winLeft > right || winRight < left || winTop > bottom || winBottom < top);

            if (isMulti) {
                // 다중 선택 모드: 기존 선택 유지 + 현재 영역 포함된 것 추가
                if (isInside || s.initialSelected.has(fileId)) {
                    this.selectedWindowIds.add(fileId);
                    info.element.classList.add('focused');
                } else {
                    this.selectedWindowIds.delete(fileId);
                    info.element.classList.remove('focused');
                }
            } else {
                // 일반 모드: 현재 영역 안에 있는 것만 선택
                if (isInside) {
                    this.selectedWindowIds.add(fileId);
                    info.element.classList.add('focused');
                    this.activeWindowId = fileId;
                } else {
                    this.selectedWindowIds.delete(fileId);
                    info.element.classList.remove('focused');
                }
            }
        });

        // 통계 업데이트
        window.toolsPanel?.updateStats();
    }

    /**
     * 창 포커스 (다중 선택 대응)
     * @param {string} fileId 파일 ID
     * @param {boolean} isMulti Shift 키 등을 이용한 다중 선택 여부
     */
    focusWindow(fileId, isMulti = false) {
        if (!isMulti) {
            // 일반 클릭 시: 이전의 모든 포커스 제거 (이미 선택된 것 중 본인이 있으면 해제하지 않음 - 드래그를 위해)
            if (!this.selectedWindowIds.has(fileId)) {
                this.unfocusAll();
            }
        }

        const info = this.windows.get(fileId);
        if (!info) return;

        if (isMulti && this.selectedWindowIds.has(fileId)) {
            // 이미 선택된 경우 해제 (토글)
            this.selectedWindowIds.delete(fileId);
            info.element.classList.remove('focused');
            if (this.activeWindowId === fileId) {
                this.activeWindowId = Array.from(this.selectedWindowIds).pop() || null;
            }
        } else {
            // 새로 선택
            this.selectedWindowIds.add(fileId);
            info.element.style.zIndex = ++this.zIndexCounter;
            info.element.classList.add('focused');
            this.activeWindowId = fileId;
        }

        // 통계 업데이트
        window.toolsPanel?.updateStats();
    }

    /**
     * 모든 창 포커스 해제
     */
    unfocusAll() {
        this.windows.forEach((info) => {
            info.element.classList.remove('focused');
        });
        this.activeWindowId = null;
        this.selectedWindowIds.clear();
    }

    /**
     * 텍스트 변경 처리
     */
    onTextChange(fileId, content) {
        const info = this.windows.get(fileId);
        if (!info) return;

        // 수정됨 표시
        info.modified = true;
        const indicator = info.element.querySelector(`[data-indicator="${fileId}"]`);
        if (indicator) indicator.classList.add('show');

        // 글자수 업데이트
        this.updateCharCount(fileId, content);
        
        // 타자기 모드 갱신
        this.updateLineFocus(fileId);

        // 통계 업데이트
        if (this.activeWindowId === fileId) {
            window.toolsPanel?.updateStats();
        }

        // 자동 저장 (3초 디바운스)
        const settings = window.toolsPanel?.loadSettingsSync();
        if (settings?.autoSave !== false) {
            clearTimeout(this.autoSaveTimers.get(fileId));
            this.autoSaveTimers.set(fileId, setTimeout(() => {
                this.saveWindow(fileId, true);
            }, 3000));
        }
    }

    /**
     * 창 저장
     */
    async saveWindow(fileId, isAuto = false) {
        const info = this.windows.get(fileId);
        if (!info) return;

        if (isAuto) {
            const settings = window.toolsPanel?.settings || window.toolsPanel?.loadSettingsSync();
            if (settings?.autoSave === false) return;
        }

        const content = info.textarea.value;

        try {
            const result = await storage.updateFile(fileId, { content });
            if (!result) return;

            info.file.content = content;
            info.modified = false;

            // 수정됨 표시 제거
            const indicator = info.element.querySelector(`[data-indicator="${fileId}"]`);
            if (indicator) indicator.classList.remove('show');

            // 저장 상태 표시
            const savedEl = info.element.querySelector(`[data-saved="${fileId}"]`);
            if (savedEl) {
                savedEl.textContent = isAuto ? '자동 저장됨' : '저장됨';
                setTimeout(() => { savedEl.textContent = ''; }, 2000);
            }

            if (window.currentProjectId) {
                await storage.updateProject(window.currentProjectId, {});
            }

            if (!isAuto) {
                window.showToast?.('저장되었습니다.');
            }

            // 헤더 인디케이터
            if (isAuto) {
                const headerIndicator = document.getElementById('autoSaveIndicator');
                if (headerIndicator) {
                    headerIndicator.textContent = '자동 저장됨';
                    headerIndicator.classList.add('show');
                    clearTimeout(this._headerIndicatorTimer);
                    this._headerIndicatorTimer = setTimeout(() => {
                        headerIndicator.classList.remove('show');
                    }, 2000);
                }
            }
        } catch (error) {
            console.error('저장 실패:', error);
        }
    }

    /**
     * 현재 포커스된 창 저장
     */
    async saveActiveWindow() {
        if (this.activeWindowId) {
            await this.saveWindow(this.activeWindowId, false);
        }
    }

    /**
     * 모든 열린 창 저장
     */
    async saveAllWindows() {
        for (const [fileId] of this.windows) {
            await this.saveWindow(fileId, true);
        }
    }

    /**
     * 창 닫기
     */
    async closeWindow(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;

        // 수정된 내용 저장
        if (info.modified) {
            await this.saveWindow(fileId, true);
        }

        // 닫기 상태 저장
        await this.updateFileWindowState(fileId, { isOpen: false });

        // 타이머 정리
        clearTimeout(this.autoSaveTimers.get(fileId));
        this.autoSaveTimers.delete(fileId);

        // DOM 제거
        info.element.remove();
        this.windows.delete(fileId);
        this.selectedWindowIds.delete(fileId);

        // 다른 창으로 포커스 이동
        if (this.activeWindowId === fileId) {
            const remainingSelected = Array.from(this.selectedWindowIds);
            if (remainingSelected.length > 0) {
                this.focusWindow(remainingSelected[remainingSelected.length - 1], true);
            } else {
                this.activeWindowId = null;
                const remaining = Array.from(this.windows.keys());
                if (remaining.length > 0) {
                    this.focusWindow(remaining[remaining.length - 1]);
                }
            }
        }

        // 통계 업데이트
        window.toolsPanel?.updateStats();
        this.renderConnections();
    }

    /**
     * 창 접기/펴기 토글
     */
    toggleCollapse(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;

        const el = info.element;
        const btn = el.querySelector('.window-btn-collapse');

        if (el.classList.contains('collapsed')) {
            // 펴기
            el.classList.remove('collapsed');
            el.style.width = el.dataset.prevWidth || '520px';
            el.style.height = el.dataset.prevHeight || '400px';
            if (btn) btn.textContent = '−';
        } else {
            // 접기
            el.dataset.prevWidth = el.style.width;
            el.dataset.prevHeight = el.style.height;
            el.classList.add('collapsed');
            if (btn) btn.textContent = '+';
        }

        // 상태 저장
        this.updateFileWindowState(fileId, {
            width: el.offsetWidth,
            height: el.offsetHeight,
            isCollapsed: el.classList.contains('collapsed')
        });
    }

    /**
     * 글자수 업데이트
     */
    updateCharCount(fileId, content, root = document) {
        const statsEl = root.querySelector(`[data-stats="${fileId}"]`);
        if (!statsEl) return;

        const total = content.length;
        const noSpace = content.replace(/\s/g, '').length;

        // 문장: . ! ? 기준으로 분리 (다중 구두점 고려)
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

        // 단락: 줄바꿈 기준
        const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0).length;

        statsEl.querySelector('.total').textContent = `${total.toLocaleString()}자`;
        statsEl.querySelector('.nospace').textContent = `(공백제외 ${noSpace.toLocaleString()})`;
        statsEl.querySelector('.sentences').textContent = `${sentences.toLocaleString()}문장`;
        statsEl.querySelector('.paragraphs').textContent = `${paragraphs.toLocaleString()}단락`;
    }

    /**
     * 모든 창 닫기 (프로젝트 전환 시)
     */
    async clearAllWindows() {
        for (const [fileId, info] of this.windows) {
            if (info.modified) {
                await this.saveWindow(fileId, true);
            }
            clearTimeout(this.autoSaveTimers.get(fileId));
            info.element.remove();
        }
        this.windows.clear();
        this.selectedWindowIds.clear();
        this.autoSaveTimers.clear();
        this.activeWindowId = null;
        this.cascadeOffset = 0;

        // 캔버스 상태 리셋 및 노드 연결선 초기화
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
        this.nodeConnections = [];
        this.renderConnections();
    }

    /**
     * 컨텍스트 메뉴 표시
     */
    showContextMenu(x, y, fileId) {
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

        const info = this.windows.get(fileId);
        const isImage = info && (info.file.template === 'image' || (info.file.content && info.file.content.startsWith('data:image')));
        const isMulti = this.selectedWindowIds.size > 1;
        let menuHtml = '';

        if (isMulti) {
            menuHtml += `
                <div class="context-menu-item" data-action="merge">
                    <span class="context-menu-icon">🔀</span>
                    <span>텍스트 병합 (${this.selectedWindowIds.size}개)</span>
                </div>
                <div class="context-menu-divider"></div>
            `;
        }

        if (isImage && !isMulti) {
            menuHtml += `
                <div class="context-menu-item" data-action="fit-image">
                    <span class="context-menu-icon">🖼️</span>
                    <span>이미지 비율에 맞추기</span>
                </div>
                <div class="context-menu-divider"></div>
            `;
        }

        if (!isMulti) {
            menuHtml += `
                <div class="context-menu-item" data-action="duplicate">
                    <span class="context-menu-icon">📋</span>
                    <span>노드 복사</span>
                </div>
                <div class="context-menu-item" data-action="edit-node-ports">
                    <span class="context-menu-icon">📌</span>
                    <span>노드 핀 (포트) 정보...</span>
                </div>
                <div class="context-menu-divider"></div>
            `;
        }

        menuHtml += `
            <div class="context-menu-item danger" data-action="delete">
                <span class="context-menu-icon">🗑️</span>
                <span>삭제</span>
            </div>
        `;

        menu.innerHTML = menuHtml;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');

        // 메뉴 아이템 클릭 이벤트
        const deleteBtn = menu.querySelector('[data-action="delete"]');
        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isMulti) {
                if (confirm(`선택한 ${this.selectedWindowIds.size}개의 창을 모두 닫을까요?`)) {
                    const idsToClose = Array.from(this.selectedWindowIds);
                    idsToClose.forEach(id => this.closeWindow(id));
                }
            } else {
                this.closeWindow(fileId);
            }
            this.hideContextMenu();
        });

        const mergeBtn = menu.querySelector('[data-action="merge"]');
        mergeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showMergeModal();
            this.hideContextMenu();
        });

        const fitBtn = menu.querySelector('[data-action="fit-image"]');
        fitBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const img = document.getElementById(`imageViewer_${fileId}`);
            if (img && img.naturalWidth) {
                this.fitWindowToImage(fileId, img.naturalWidth, img.naturalHeight);
            } else {
                window.showToast?.('이미지가 아직 로드되지 않았습니다.');
            }
            this.hideContextMenu();
        });

        const editPortsBtn = menu.querySelector('[data-action="edit-node-ports"]');
        editPortsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showNodePortEditModal(fileId);
            this.hideContextMenu();
        });

        const duplicateBtn = menu.querySelector('[data-action="duplicate"]');
        duplicateBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.duplicateNode(fileId);
            this.hideContextMenu();
        });
    }

    /**
     * 컨텍스트 메뉴 숨기기
     */
    hideContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) menu.classList.add('hidden');
    }

    /**
     * 선택한 노드의 모든 입력값과 커스텀 데이터, 포트 설정을 그대로 복제하여 새 노드로 캔버스에 생성
     */
    async duplicateNode(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.file) return;

        const originalFile = info.file;
        const winEl = info.element;

        // 1. 현재 DOM의 최신 입력 데이터(Text, Fields, Stat, Prompts) 집계 및 동기화
        let currentContent = originalFile.content;

        if (originalFile.isTextFieldsNode || (currentContent && typeof currentContent === 'string' && currentContent.includes('"isTextFieldsNode"'))) {
            try {
                const container = winEl.querySelector(`#textFieldContainer_${fileId}`);
                if (container) {
                    const data = typeof currentContent === 'string' ? JSON.parse(currentContent) : currentContent;
                    const fields = data.textFields || [];
                    const rows = container.querySelectorAll('.stat-item-row');
                    rows.forEach((row, idx) => {
                        if (fields[idx]) {
                            const valInput = row.querySelector('.stat-name-input:nth-child(2)');
                            if (valInput) fields[idx].value = valInput.value;
                        }
                    });
                    const outTplTextarea = container.querySelector('.memo-textarea');
                    if (outTplTextarea) data.outputTemplate = outTplTextarea.value;
                    currentContent = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else if (originalFile.template === 'stat' || originalFile.isStatNode) {
            try {
                const container = winEl.querySelector(`#statContainer_${fileId}`);
                if (container) {
                    const data = typeof currentContent === 'string' ? JSON.parse(currentContent) : currentContent;
                    const stats = data.stats || [];
                    const rows = container.querySelectorAll('.stat-item-row');
                    rows.forEach((row, idx) => {
                        if (stats[idx]) {
                            const valInput = row.querySelector('.stat-value');
                            if (valInput) stats[idx].value = parseInt(valInput.value, 10) || 0;
                        }
                    });
                    currentContent = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else if (originalFile.isSystemPromptNode || (currentContent && typeof currentContent === 'string' && currentContent.includes('"command"'))) {
            try {
                const cmdInput = winEl.querySelector(`#sysPromptCommand_${fileId}`);
                const txtTextarea = winEl.querySelector(`#sysPromptText_${fileId}`);
                if (cmdInput && txtTextarea) {
                    const data = { command: cmdInput.value, text: txtTextarea.value };
                    currentContent = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else if (originalFile.isAiMetaNode || (currentContent && typeof currentContent === 'string' && currentContent.includes('"role"'))) {
            try {
                const roleInput = winEl.querySelector(`#aiMetaRole_${fileId}`);
                const taskTextarea = winEl.querySelector(`#aiMetaTask_${fileId}`);
                const instTextarea = winEl.querySelector(`#aiMetaInstructions_${fileId}`);
                if (roleInput && taskTextarea && instTextarea) {
                    const data = { role: roleInput.value, task: taskTextarea.value, instructions: instTextarea.value };
                    currentContent = JSON.stringify(data, null, 2);
                }
            } catch (e) {}
        } else {
            const textarea = winEl.querySelector('.window-textarea');
            if (textarea) {
                currentContent = textarea.value;
            }
        }

        // 원본 노드 업데이트
        await storage.updateFile(fileId, { content: currentContent });

        // 2. 원본 노드 위치 근처(오른쪽/아래로 40px offset)에 새 노드 윈도우 배치
        const origX = parseInt(winEl.style.left, 10) || 100;
        const origY = parseInt(winEl.style.top, 10) || 100;
        const origWidth = parseInt(winEl.style.width, 10) || 480;
        const origHeight = parseInt(winEl.style.height, 10) || 380;

        const newWindowState = {
            x: origX + 40,
            y: origY + 40,
            width: origWidth,
            height: origHeight,
            collapsed: false,
            zIndex: (this.maxZIndex || 10) + 1
        };

        const fileData = {
            projectId: originalFile.projectId,
            name: originalFile.name, // storage.createFile 이 자동으로 중복 방지 (1), (2) 추가함!
            type: originalFile.type || 'file',
            parentId: originalFile.parentId || null,
            content: currentContent,
            template: originalFile.template || null,
            isStatNode: !!originalFile.isStatNode,
            isSystemPromptNode: !!originalFile.isSystemPromptNode,
            isAiMetaNode: !!originalFile.isAiMetaNode,
            isTextFieldsNode: !!originalFile.isTextFieldsNode,
            isFolderCollectorNode: !!originalFile.isFolderCollectorNode,
            portsConfig: originalFile.portsConfig ? JSON.parse(JSON.stringify(originalFile.portsConfig)) : null,
            description: originalFile.description || '',
            windowState: newWindowState
        };

        const duplicatedFile = await storage.createFile(fileData);

        // 3. 파일 트리 갱신
        if (window.fileTreeManager) {
            await window.fileTreeManager.loadProjectFiles(originalFile.projectId);
        }

        // 4. 복제된 새 노드 창 즉시 열기 및 포커스
        await this.openWindow(duplicatedFile.id);
        window.showToast?.(`'${duplicatedFile.name}' 노드가 동일한 내용으로 복사되었습니다! 📋`);
    }

    addNodePortEditRow(type = 'input', name = '', color = '') {
        const listId = type === 'input' ? 'editInputPortList' : 'editOutputPortList';
        const list = document.getElementById(listId);
        if (!list) return;

        const fallbackColor = type === 'input' ? '#2ecc71' : '#00ffcc';
        const colorVal = color || fallbackColor;

        const row = document.createElement('div');
        row.className = 'stat-field-row';
        row.style.marginBottom = '6px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        row.innerHTML = `
            <input type="color" class="port-color-picker" value="${colorVal}" title="핀 색상 변경" style="width: 28px; height: 26px; padding: 1px 2px; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; background: transparent; flex-shrink: 0;">
            <input type="text" class="input field-name" placeholder="포트 핀 이름" value="${this.escapeHtml(name)}" style="flex: 1; font-size: 11px; height: 26px; padding: 0 6px;">
            <button type="button" class="btn btn-icon btn-secondary remove-field-btn" title="포트 삭제" style="color: var(--color-accent-danger); border: none; background: transparent; padding: 2px; flex-shrink: 0;">✕</button>
        `;

        row.querySelector('.remove-field-btn')?.addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    async showNodePortEditModal(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;
        const file = info.file;

        const modal = document.getElementById('nodePortEditModal');
        if (!modal) return;

        const fileIdInput = document.getElementById('nodePortEditFileId');
        if (fileIdInput) fileIdInput.value = fileId;

        const titleEl = document.getElementById('nodePortEditTitle');
        if (titleEl) titleEl.textContent = `📌 '${file.name}' 노드 핀 (포트) 정보`;

        const portsConfig = file.portsConfig || {
            inputs: [{ id: 'in_1', name: '입력 데이터', color: '#2ecc71' }],
            outputs: [{ id: 'out_1', name: '출력 데이터', color: '#00ffcc' }]
        };

        const inList = document.getElementById('editInputPortList');
        if (inList) {
            inList.innerHTML = (portsConfig.inputs || []).map(p => `
                <div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--color-surface-1); border-radius: 6px; margin-bottom: 6px; border: 1px solid var(--color-border);">
                    <span style="width: 14px; height: 14px; border-radius: 50%; background: ${p.color || '#2ecc71'}; display: inline-block; flex-shrink: 0;"></span>
                    <span style="font-size: 12px; font-weight: 600;">${this.escapeHtml(p.name)}</span>
                </div>
            `).join('') || '<div style="font-size: 11px; color: var(--color-text-tertiary);">Input 포트 없음</div>';
        }

        const outList = document.getElementById('editOutputPortList');
        if (outList) {
            outList.innerHTML = (portsConfig.outputs || []).map(p => `
                <div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--color-surface-1); border-radius: 6px; margin-bottom: 6px; border: 1px solid var(--color-border);">
                    <span style="width: 14px; height: 14px; border-radius: 50%; background: ${p.color || '#00ffcc'}; display: inline-block; flex-shrink: 0;"></span>
                    <span style="font-size: 12px; font-weight: 600;">${this.escapeHtml(p.name)}</span>
                </div>
            `).join('') || '<div style="font-size: 11px; color: var(--color-text-tertiary);">Output 포트 없음</div>';
        }

        modal.classList.remove('hidden');
    }

    hideNodePortEditModal() {
        document.getElementById('nodePortEditModal')?.classList.add('hidden');
    }

    async saveNodePortEdit() {
        const fileId = document.getElementById('nodePortEditFileId')?.value;
        if (!fileId) return;

        const inputs = [];
        document.querySelectorAll('#editInputPortList .stat-field-row').forEach((row, idx) => {
            const pName = row.querySelector('.field-name')?.value.trim();
            const pColor = row.querySelector('.port-color-picker')?.value || '#2ecc71';
            if (pName) inputs.push({ id: `in_${idx + 1}`, name: pName, color: pColor });
        });

        const outputs = [];
        document.querySelectorAll('#editOutputPortList .stat-field-row').forEach((row, idx) => {
            const pName = row.querySelector('.field-name')?.value.trim();
            const pColor = row.querySelector('.port-color-picker')?.value || '#00ffcc';
            if (pName) outputs.push({ id: `out_${idx + 1}`, name: pName, color: pColor });
        });

        const portsConfig = { inputs, outputs };

        await window.storage?.updateFile(fileId, { portsConfig });

        const info = this.windows.get(fileId);
        if (info) {
            info.file.portsConfig = portsConfig;
            this.rebuildWindowPorts(fileId);
        }

        this.hideNodePortEditModal();
        this.renderConnections();
        window.showToast?.('노드 핀(포트) 설정이 저장되었습니다! 📌');
    }

    rebuildWindowPorts(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.element) return;
        const file = info.file;

        const portsConfig = file.portsConfig || { inputs: [], outputs: [] };
        const inputsArr = portsConfig.inputs || [];
        const outputsArr = portsConfig.outputs || [];

        const leftWrapper = info.element.querySelector('.node-ports-wrapper-left');
        const rightWrapper = info.element.querySelector('.node-ports-wrapper-right');

        if (leftWrapper) {
            leftWrapper.innerHTML = inputsArr.map(p => {
                const portColor = p.color || '#2ecc71';
                return `
                <div class="node-port-item node-port-item-left">
                    <div class="node-port port-left" data-file-id="${file.id}" data-port-id="${p.id}" data-port-type="left" data-port-color="${portColor}" style="--port-color: ${portColor};" title="📥 Input 포트: ${this.escapeHtml(p.name)}"></div>
                    <span class="node-port-label node-port-label-left" style="--port-color: ${portColor};">📥 ${this.escapeHtml(p.name)}</span>
                </div>
                `;
            }).join('');
        }

        if (rightWrapper) {
            rightWrapper.innerHTML = outputsArr.map(p => {
                const portColor = p.color || '#00ffcc';
                return `
                <div class="node-port-item node-port-item-right">
                    <div class="node-port port-right" data-file-id="${file.id}" data-port-id="${p.id}" data-port-type="right" data-port-color="${portColor}" style="--port-color: ${portColor};" title="📤 Output 포트: ${this.escapeHtml(p.name)}"></div>
                    <span class="node-port-label node-port-label-right" style="--port-color: ${portColor};">📤 ${this.escapeHtml(p.name)}</span>
                </div>
                `;
            }).join('');
        }

        info.element.querySelectorAll('.node-port').forEach(portEl => {
            portEl.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const portType = portEl.dataset.portType;
                if (portType === 'right') {
                    this.startConnectionDrag(e, file.id, portType, portEl);
                }
            });
        });

        const maxPortsCount = Math.max(inputsArr.length, outputsArr.length);
        const calcMinHeight = Math.max(240, maxPortsCount * 80 + 50);
        info.element.style.minHeight = `${calcMinHeight}px`;
    }

    /**
     * 텍스트 병합 모달 표시
     */
    showMergeModal() {
        const modal = document.getElementById('mergeModal');
        const list = document.getElementById('mergeOrderList');
        const input = document.getElementById('mergeFileName');
        if (!modal || !list || !input) return;

        // 선택된 창들의 정보 수집 및 Y 좌표(상단 기준) 정렬
        const selectedWindows = Array.from(this.selectedWindowIds).map(id => {
            const info = this.windows.get(id);
            return {
                id,
                name: info.file.name,
                y: info.element.offsetTop
            };
        }).sort((a, b) => a.y - b.y);

        // 목록 생성
        list.innerHTML = '';
        selectedWindows.forEach(win => {
            const item = document.createElement('div');
            item.className = 'merge-order-item';
            item.draggable = true;
            item.dataset.id = win.id;
            item.innerHTML = `
                <span class="handle">☰</span>
                <span class="name">${this.escapeHtml(win.name)}</span>
                <span class="y-pos">Y: ${Math.round(win.y)}</span>
            `;

            // 드래그 앤 드롭 이벤트 바인딩
            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.setData('text/plain', win.id);
            });
            item.addEventListener('dragend', () => item.classList.remove('dragging'));
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = list.querySelector('.dragging');
                if (!dragging || dragging === item) return;
                
                const rect = item.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                if (e.clientY < midpoint) {
                    list.insertBefore(dragging, item);
                } else {
                    list.insertBefore(dragging, item.nextSibling);
                }
            });

            list.appendChild(item);
        });

        // 기본 파일 이름 설정
        const now = new Date();
        input.value = `병합된 문서_${now.getMonth() + 1}${now.getDate()}_${now.getHours()}${now.getMinutes()}`;
        
        modal.classList.remove('hidden');
        input.focus();
    }

    /**
     * 병합 모달 숨기기
     */
    hideMergeModal() {
        const modal = document.getElementById('mergeModal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * 실제 병합 실행
     */
    async confirmMerge() {
        const name = document.getElementById('mergeFileName').value.trim();
        if (!name) return alert('파일 이름을 입력해주세요.');

        const listItems = document.querySelectorAll('#mergeOrderList .merge-order-item');
        const fileIds = Array.from(listItems).map(item => item.dataset.id);

        if (fileIds.length < 2) return alert('병합할 파일이 부족합니다.');

        let mergedContent = '';
        for (let i = 0; i < fileIds.length; i++) {
            const info = this.windows.get(fileIds[i]);
            if (info) {
                let content = info.textarea.value;
                if (i === 0) content = content.trimStart();
                
                mergedContent += content;
                
                // 파일 간에 구분용 줄바꿈 추가 (마지막 파일 제외)
                if (i < fileIds.length - 1) {
                    if (!content.endsWith('\n')) {
                        mergedContent += '\n\n';
                    } else if (!content.endsWith('\n\n')) {
                        mergedContent += '\n';
                    }
                }
            }
        }

        // 장소 이동 경로 추가
        if (locations.length > 0) {
            const movement = `[장소 이동: ${locations.join(' -> ')}]\n\n`;
            mergedContent = movement + mergedContent;
        }

        try {
            // 새 파일 생성 (프로젝트 루트에 생성)
            const newFile = await storage.createFile({
                projectId: window.currentProjectId,
                name: name,
                type: 'file',
                content: mergedContent,
                parentId: null // 루트에 생성
            });

            if (newFile) {
                this.hideMergeModal();
                // 파일 트리 새로고침
                if (window.fileTreeManager) {
                    await window.fileTreeManager.loadProjectFiles(window.currentProjectId);
                }
                // 새 파일 열기
                await this.openWindow(newFile.id);
                window.showToast?.('파일이 성공적으로 병합되었습니다.');
            }
        } catch (error) {
            console.error('병합 실패:', error);
            alert('병합 중 오류가 발생했습니다.');
        }
    }

    /**
     * 현재 활성 창의 텍스트 반환 (통계 등에서 사용)
     */
    getActiveText() {
        if (!this.activeWindowId) return '';
        const info = this.windows.get(this.activeWindowId);
        return info ? info.textarea.value : '';
    }

    /**
     * 이미지 업로드 처리
     */
    async handleImageUpload(fileId, file) {
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            
            // 1. 저장소 업데이트 (콘텐츠에 base64 저장)
            await storage.updateFile(fileId, { content: base64 });
            
            // 2. UI 업데이트
            const container = document.getElementById(`imageContainer_${fileId}`);
            if (container) {
                container.innerHTML = `<img src="${base64}" class="window-image-viewer" id="imageViewer_${fileId}">`;
                
                // 3. 이미지 정보 업데이트 (비율 및 크기 텍스트)
                const img = new Image();
                img.onload = () => {
                    this.fitWindowToImage(fileId, img.naturalWidth, img.naturalHeight);
                    this.updateImageSizeInfo(fileId, base64);
                };
                img.src = base64;
            }
            
            window.showToast?.('이미지가 업로드되었습니다.');
        };
        reader.readAsDataURL(file);
    }

    /**
     * 이미지 비율에 맞춰 창 크기 조정
     */
    fitWindowToImage(fileId, naturalWidth, naturalHeight) {
        const info = this.windows.get(fileId);
        if (!info) return;

        const win = info.element;
        const currentRotation = (info.file.windowState?.rotation || 0) % 360;
        const isSwapped = currentRotation === 90 || currentRotation === 270;
        
        // 회전 각도에 따라 너비/높이 기준 스왑
        const w = isSwapped ? naturalHeight : naturalWidth;
        const h = isSwapped ? naturalWidth : naturalHeight;

        let newWidth = Math.min(w, 800);
        let newHeight = (newWidth * h) / w;

        if (newHeight > 600) {
            newHeight = 600;
            newWidth = (newHeight * w) / h;
        }

        win.style.width = `${newWidth}px`;
        win.style.height = `${newHeight + 36}px`;

        this.updateFileWindowState(fileId, {
            width: newWidth,
            height: newHeight + 36
        });
    }

    /**
     * 이미지를 90도씩 회전
     */
    async rotateImage(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;

        const currentRotation = (info.file.windowState?.rotation || 0) + 90;
        
        // 상태 저장
        info.file.windowState = { ...info.file.windowState, rotation: currentRotation };
        await this.updateFileWindowState(fileId, { rotation: currentRotation });

        // 회전 및 스케일 적용
        this.applyImageRotation(fileId);
    }

    /**
     * 회전 각도와 창 크기에 맞춰 이미지 크기 및 위치 조절
     */
    applyImageRotation(fileId) {
        const info = this.windows.get(fileId);
        const img = document.getElementById(`imageViewer_${fileId}`);
        if (!info || !img) return;

        // 브라우저 렌더링 주기에 맞춰 정확한 치수 계산
        requestAnimationFrame(() => {
            const rotation = (info.file.windowState?.rotation || 0) % 360;
            const isSwapped = Math.abs(rotation % 180) === 90;
            const container = img.parentElement;
            
            if (!container) return;

            // 실제 측정값 또는 저장된 값 사용
            let cw = container.offsetWidth;
            let ch = container.offsetHeight;

            // 만약 측정값이 0이라면 저장된 윈도우 상태에서 가져옴
            if (cw === 0 || ch === 0) {
                cw = info.file.windowState?.width || 400;
                ch = (info.file.windowState?.height || 336) - 36; // 타이틀바 제외
            }

            if (isSwapped) {
                // 90도/270도 회전 시 이미지 요소의 가로세로를 창과 반대로 스왑
                img.style.width = `${ch}px`;
                img.style.height = `${cw}px`;
            } else {
                img.style.width = '100%';
                img.style.height = '100%';
            }
            
            img.style.transform = `rotate(${rotation}deg)`;
            img.style.position = 'relative'; // absolute 제거
            img.style.top = 'auto';
            img.style.left = 'auto';
        });
    }

    getTemplateIcon(template) {
        const icons = { item: '📦', place: '🗺️', character: '👤', image: '🖼️', stat: '📊' };
        return icons[template] || '📄';
    }

    /**
     * 수치 계산기 렌더링 (탭 인터페이스 및 출력 템플릿 추가)
     */
    renderStatCalculator(fileId) {
        const info = this.windows.get(fileId);
        const container = document.getElementById(`statContainer_${fileId}`);
        if (!info || !container) return;

        let data;
        try {
            data = JSON.parse(info.file.content || '{"stats":[], "history":[], "outputTemplate":""}');
            if (!data.stats) data.stats = [];
            if (!data.history) data.history = [];
            if (data.currentTab === undefined) data.currentTab = 'manage';
            // 기본 템플릿 제공
            if (!data.outputTemplate) {
                data.outputTemplate = "《 {{이름}} 상태창 》\n" + 
                                     data.stats.map(s => `[${s.name}: {{${s.name}}}]`).join(' ');
            }
        } catch (e) {
            data = { stats: [], history: [], outputTemplate: "", currentTab: 'manage' };
        }

        const tab = data.currentTab;

        container.innerHTML = `
            <div class="stat-tabs">
                <div class="stat-tab ${tab === 'manage' ? 'active' : ''}" onclick="window.windowManager.switchStatTab('${fileId}', 'manage')">⚙️ 스탯 관리</div>
                <div class="stat-tab ${tab === 'template' ? 'active' : ''}" onclick="window.windowManager.switchStatTab('${fileId}', 'template')">📝 출력 양식</div>
                <div class="stat-tab ${tab === 'history' ? 'active' : ''}" onclick="window.windowManager.switchStatTab('${fileId}', 'history')">📜 변경 기록</div>
            </div>
            
            <div class="stat-content" id="statContent_${fileId}">
                ${tab === 'manage' ? `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <span style="font-size: 15px; font-weight: 700; color: var(--color-text-secondary);">캐릭터 스탯 설정</span>
                        <button class="btn btn-icon btn-secondary" onclick="window.windowManager.addStatItem('${fileId}')" title="항목 추가" style="width: 32px; height: 32px; font-size: 18px;">＋</button>
                    </div>
                    ${data.stats.map((s, idx) => `
                        <div class="stat-item-row">
                            <input type="text" class="stat-name-input" value="${this.escapeHtml(s.name)}" 
                                onchange="window.windowManager.onStatNameChange('${fileId}', ${idx}, this.value)" placeholder="항목명">
                            <div class="stat-controls">
                                <button class="stat-btn" onclick="window.windowManager.updateStat('${fileId}', ${idx}, -1)">-</button>
                                <span class="stat-value">${s.value}</span>
                                <button class="stat-btn" onclick="window.windowManager.updateStat('${fileId}', ${idx}, 1)">+</button>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <input type="number" class="stat-input-small" placeholder="값" 
                                    onkeypress="if(event.key==='Enter') window.windowManager.updateStat('${fileId}', ${idx}, parseInt(this.value) || 0, true)">
                            </div>
                            <button class="btn btn-icon" style="color: var(--color-text-muted); font-size: 16px;" 
                                onclick="window.windowManager.removeStatItem('${fileId}', ${idx})">✕</button>
                        </div>
                    `).join('')}
                    ${data.stats.length === 0 ? '<div style="text-align: center; padding: 40px; color: var(--color-text-tertiary); font-size: 14px;">등록된 스탯이 없습니다.<br>항목을 추가하세요.</div>' : ''}
                    <button class="stat-add-btn" onclick="window.windowManager.addStatItem('${fileId}')">+ 새 항목 추가</button>
                ` : ''}

                ${tab === 'template' ? `
                    <div style="height: 100%; display: flex; flex-direction: column; gap: 16px;">
                        <div style="font-size: 16px; font-weight: 700; color: var(--color-text-secondary); letter-spacing: -0.02em;">출력 양식 커스텀</div>
                        <div style="font-size: 14px; color: #fff; line-height: 1.8; background: #1a1f26; padding: 16px; border-radius: 10px; border: 1px solid rgba(88, 166, 255, 0.3); box-shadow: inset 0 0 20px rgba(0,0,0,0.2);">
                            <b style="color: var(--color-accent-primary); font-size: 15px; display: block; margin-bottom: 8px;">💡 작성 가이드</b>
                            변수는 <code style="color: #ffffff; background: #30363d; padding: 2px 8px; border-radius: 4px; font-family: inherit; font-weight: 700; border: 1px solid rgba(255, 255, 255, 0.1);">{$스탯이름$}</code> 형태로 넣으세요.<br>
                            <code style="color: #ffffff; background: #30363d; padding: 2px 8px; border-radius: 4px; font-family: inherit; font-weight: 700; border: 1px solid rgba(255, 255, 255, 0.1);">{$이름$}</code>은 파일명으로 자동 치환됩니다.
                        </div>
                        <textarea class="input" id="statTemplateEditor_${fileId}" style="flex: 1; font-family: inherit; font-size: 18px; line-height: 1.7; padding: 20px; resize: none; background: var(--color-bg-primary); color: #e6edf3; border: 1px solid var(--color-border); letter-spacing: 0.01em;"
                            placeholder="본문에 불러올 때 사용될 양식을 작성하세요...">${this.escapeHtml(data.outputTemplate)}</textarea>
                        
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                            <div style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                                <span style="color: var(--color-accent-primary);">변수:</span> 
                                <span style="background: var(--color-surface-3); padding: 2px 8px; border-radius: 4px;">{$이름$}</span>
                                ${data.stats.map(s => `<span style="background: var(--color-surface-3); padding: 2px 8px; border-radius: 4px;">{$${s.name}$}</span>`).join('')}
                            </div>
                            <button class="btn btn-primary" style="padding: 8px 24px; font-weight: 700;" 
                                onclick="window.windowManager.updateStatTemplate('${fileId}', document.getElementById('statTemplateEditor_${fileId}').value)">저장</button>
                        </div>
                    </div>
                ` : ''}

                ${tab === 'history' ? `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <span style="font-size: 15px; font-weight: 700; color: var(--color-text-secondary);">변경 기록 (최근 100개)</span>
                        <span style="cursor: pointer; font-size: 12px; color: var(--color-accent-danger); opacity: 0.8; font-weight: 600;" onclick="window.windowManager.clearStatHistory('${fileId}')">기록 삭제</span>
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 13px;">
                        ${data.history.slice().reverse().map(h => `
                            <div class="history-item">
                                <span class="history-time">${new Date(h.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                                <span style="font-weight: 600;">${this.escapeHtml(h.name)}</span>: 
                                <span>${h.prev} → ${h.curr}</span>
                                <span class="${h.diff >= 0 ? 'history-diff-plus' : 'history-diff-minus'}">
                                    (${h.diff >= 0 ? '+' : ''}${h.diff})
                                </span>
                            </div>
                        `).join('')}
                        ${data.history.length === 0 ? '<div style="text-align: center; padding: 40px; color: var(--color-text-tertiary);">기록이 없습니다.</div>' : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }

    async switchStatTab(fileId, tab) {
        const info = this.windows.get(fileId);
        if (!info) return;
        let data = JSON.parse(info.file.content || '{}');
        data.currentTab = tab;
        await this.saveStatData(fileId, data);
    }

    async updateStatTemplate(fileId, template) {
        const info = this.windows.get(fileId);
        if (!info) return;
        let data = JSON.parse(info.file.content || '{}');
        data.outputTemplate = template;
        await this.saveStatData(fileId, data);
        window.showToast?.('출력 양식이 저장되었습니다.');
    }

    async updateStat(fileId, index, delta, isAbsolute = false) {
        const info = this.windows.get(fileId);
        if (!info) return;

        let data = JSON.parse(info.file.content || '{"stats":[], "history":[]}');
        const stat = data.stats[index];
        if (!stat) return;

        const prev = stat.value;
        const diff = isAbsolute ? delta : delta; // delta가 증분일 수도, 절대값일 수도 있음 (여기선 인자명 그대로 처리)
        
        if (isAbsolute) {
            stat.value = delta;
        } else {
            stat.value += delta;
        }

        const actualDiff = stat.value - prev;
        if (actualDiff === 0) return;

        // 기록 추가
        data.history.push({
            time: Date.now(),
            name: stat.name || '미지정',
            prev: prev,
            curr: stat.value,
            diff: actualDiff
        });

        // 최대 100개까지만 기록 유지
        if (data.history.length > 100) data.history.shift();

        await this.saveStatData(fileId, data);
    }

    async addStatItem(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;

        let data = JSON.parse(info.file.content || '{"stats":[], "history":[]}');
        data.stats.push({ name: '새 스탯', value: 10 });
        
        await this.saveStatData(fileId, data);
    }

    async removeStatItem(fileId, index) {
        if (!confirm('이 항목을 삭제할까요?')) return;
        const info = this.windows.get(fileId);
        if (!info) return;

        let data = JSON.parse(info.file.content || '{"stats":[], "history":[]}');
        data.stats.splice(index, 1);
        
        await this.saveStatData(fileId, data);
    }

    async onStatNameChange(fileId, index, newName) {
        const info = this.windows.get(fileId);
        if (!info) return;

        let data = JSON.parse(info.file.content || '{"stats":[], "history":[]}');
        data.stats[index].name = newName;
        
        await this.saveStatData(fileId, data);
    }

    async clearStatHistory(fileId) {
        if (!confirm('변경 기록을 모두 삭제할까요?')) return;
        const info = this.windows.get(fileId);
        if (!info) return;

        let data = JSON.parse(info.file.content || '{"stats":[], "history":[]}');
        data.history = [];
        
        await this.saveStatData(fileId, data);
    }

    async saveStatData(fileId, data) {
        const info = this.windows.get(fileId);
        if (!info) return;

        const content = JSON.stringify(data);
        info.file.content = content;
        
        await storage.updateFile(fileId, { content });
        this.renderStatCalculator(fileId);
    }



    /**
     * 커스텀 정의 노드의 UI를 렌더링합니다.
     * (수치/텍스트 입력 항목 + 동작 코드 실행/보기 + Output 결과)
     */
    async renderCustomNode(fileId) {
        const info = this.getWindowInfo(fileId);
        if (!info) return;

        const windowEl = info.element;
        if (!windowEl) return;

        const body = windowEl.querySelector('.window-body');
        if (!body) return;

        let data = {};
        try {
            data = JSON.parse(info.file.content || '{}');
        } catch (e) {
            data = {};
        }

        let fields = data.fields || info.file.fields || [];

        // 구식 스탯 데이터(data.stats) 하위 호환 마이그레이션
        if (fields.length === 0 && Array.isArray(data.stats) && data.stats.length > 0) {
            fields = data.stats.map(s => ({ name: s.name, val: s.value, type: 'stat' }));
        }
        // 구식 텍스트 속성 데이터(data.textFields) 하위 호환 마이그레이션
        if (fields.length === 0 && Array.isArray(data.textFields) && data.textFields.length > 0) {
            fields = data.textFields.map(f => ({ name: f.name, val: f.val || '', type: 'text', rows: f.rows || 1 }));
        }

        const code = data.code || info.file.code || '';
        const ports = info.file.portsConfig || data.portsConfig || { inputs: [], outputs: [] };


        // 수치형 항목 & 텍스트형 항목 분리
        const statFields = fields.filter(f => f.type === 'stat' || typeof f.val === 'number');
        const textFields = fields.filter(f => f.type === 'text' || typeof f.val === 'string');

        // 입력 폼 HTML 생성
        let fieldsHtml = '';

        if (statFields.length > 0) {
            fieldsHtml += `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--color-accent-primary); margin-bottom: 6px;">📊 수치 입력 항목</div>
                    ${statFields.map((f, i) => `
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; background: var(--color-surface-1); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--color-border);">
                            <span style="font-size: 12px; font-weight: 600; min-width: 75px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(f.name)}">• ${this.escapeHtml(f.name)}:</span>
                            <div style="display: flex; align-items: center; gap: 4px; flex: 1;">
                                <button type="button" class="btn btn-secondary" onclick="const inp=this.nextElementSibling; inp.stepDown(); inp.dispatchEvent(new Event('input'));" style="width: 32px; height: 30px; padding: 0; font-weight: 800; font-size: 16px; line-height: 1; border-radius: 6px; background: var(--color-surface-2); color: var(--color-text-primary); cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">−</button>
                                <input type="number" class="input stat-input-field" data-var-name="${this.escapeHtml(f.name)}" data-field-index="${i}" data-field-kind="stat" style="flex: 1; font-size: 13px; font-weight: 700; text-align: center; height: 30px; padding: 0 4px; color: var(--color-accent-primary); background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 6px;" value="${f.val ?? 0}">
                                <button type="button" class="btn btn-secondary" onclick="const inp=this.previousElementSibling; inp.stepUp(); inp.dispatchEvent(new Event('input'));" style="width: 32px; height: 30px; padding: 0; font-weight: 800; font-size: 16px; line-height: 1; border-radius: 6px; background: var(--color-surface-2); color: var(--color-text-primary); cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">＋</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (textFields.length > 0) {
            fieldsHtml += `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--color-accent-primary); margin-bottom: 6px;">🏷️ 텍스트 입력 항목</div>
                    ${textFields.map((f, i) => `
                        <div style="margin-bottom: 8px; background: var(--color-surface-1); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--color-border);">
                            <div style="font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--color-text-secondary);">${this.escapeHtml(f.name)}</div>
                            <textarea class="input stat-input-field" data-var-name="${this.escapeHtml(f.name)}" data-field-index="${i}" data-field-kind="text" rows="${f.rows || 1}" style="width: 100%; font-size: 12px; line-height: 1.5; resize: vertical; min-height: ${Math.max(30, (f.rows || 1) * 22)}px;" placeholder="${this.escapeHtml(f.name)} 입력">${this.escapeHtml(f.val ?? '')}</textarea>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (fields.length === 0) {
            fieldsHtml = `<div style="font-size: 11px; color: var(--color-text-tertiary); font-style: italic; margin-bottom: 10px; text-align: center; padding: 10px; background: var(--color-surface-1); border-radius: 6px; border: 1px dashed var(--color-border);">직접 입력 항목이 없습니다.</div>`;
        }

        // 전체 UI 조합 (순수 입력 항목 전용 UI)
        body.innerHTML = `
            <div class="custom-node-container" style="padding: 12px; height: 100%; display: flex; flex-direction: column; gap: 10px; overflow-y: auto;">
                
                <!-- 입력 변수 항목 영역 -->
                ${fieldsHtml}

            </div>
        `;

        // 1) 입력 필드 실시간 자동 저장
        body.querySelectorAll('.stat-input-field').forEach(inputEl => {
            inputEl.addEventListener('input', () => {
                const varName = inputEl.dataset.varName;
                const val = inputEl.type === 'number' ? (parseFloat(inputEl.value) || 0) : inputEl.value;

                // data 객체 및 file 업데이트
                const targetField = fields.find(f => f.name === varName);
                if (targetField) targetField.val = val;

                data.fields = fields;
                info.file.content = JSON.stringify(data, null, 2);
                window.storage?.updateFile(fileId, { content: info.file.content });
            });
        });
    }









    /**
     * 버전 히스토리 표시
     */
    async showVersionHistory(fileId) {
        const modal = document.getElementById('versionModal');
        const list = document.getElementById('versionList');
        const saveBtn = document.getElementById('saveSnapshotBtn');
        if (!modal || !list) return;

        // 저장 버튼 이벤트 교체
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', () => this.saveVersionSnapshot(fileId));

        const versions = await storage.getFileVersions(fileId);
        list.innerHTML = '';

        if (versions.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--color-text-tertiary); font-size:13px;">저장된 스냅샷이 없습니다.</div>';
        } else {
            versions.forEach(v => {
                const item = document.createElement('div');
                item.className = 'version-item';
                item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--color-surface-2); border:1px solid var(--color-border); border-radius:8px; margin-bottom:4px; transition:all 0.2s;';
                
                item.innerHTML = `
                    <div style="flex:1;">
                        <div style="font-size:13px; font-weight:600; color:var(--color-text-primary); margin-bottom:2px;">${this.escapeHtml(v.name)}</div>
                        <div style="font-size:11px; color:var(--color-text-tertiary);">${new Date(v.createdAt).toLocaleString()} (${v.content.length}자)</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-secondary" data-action="restore" style="padding:4px 8px; font-size:11px; height:28px;">되돌리기</button>
                        <button class="btn btn-icon" data-action="delete" style="width:28px; height:28px; font-size:12px; color:var(--color-text-muted);">✕</button>
                    </div>
                `;

                item.querySelector('[data-action="restore"]').onclick = () => this.restoreVersion(fileId, v);
                item.querySelector('[data-action="delete"]').onclick = () => this.deleteVersion(fileId, v.id);
                
                list.appendChild(item);
            });
        }

        modal.classList.remove('hidden');
    }

    async saveVersionSnapshot(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;

        const content = info.textarea.value;
        const name = prompt('스냅샷 이름을 입력하세요 (비워두면 현재 시간으로 저장):');
        if (name === null) return; // 취소

        await storage.createVersion({
            fileId,
            name: name.trim() || null,
            content
        });

        window.showToast?.('새 스냅샷이 저장되었습니다.');
        this.showVersionHistory(fileId); // 목록 갱신
    }

    async restoreVersion(fileId, version) {
        if (!confirm(`"${version.name}" 버전으로 본문을 되돌릴까요?\n(현재 작성 중인 내용은 사라지므로 미리 스냅샷을 저장하는 것을 추천합니다.)`)) return;

        const info = this.windows.get(fileId);
        if (!info || !info.textarea) return;

        info.textarea.value = version.content;
        this.onTextChange(fileId, version.content);
        this.updateHighlighter(fileId);
        
        document.getElementById('versionModal').classList.add('hidden');
        window.showToast?.('선택한 버전으로 복구되었습니다.');
    }

    async deleteVersion(fileId, versionId) {
        if (!confirm('이 스냅샷을 삭제할까요?')) return;
        await storage.deleteVersion(versionId);
        this.showVersionHistory(fileId);
    }

    /**
     * 퀵 뷰 카드 표시
     */
    async showQuickView(fileId, x, y) {
        if (this.currentQuickViewId === fileId) return; // 이미 같은 파일 표시 중
        
        // 이전 카드 제거
        this.hideQuickView();
        
        const file = await storage.getFile(fileId);
        if (!file) return;

        this.currentQuickViewId = fileId;
        
        // 카드 엘리먼트 생성
        const card = document.createElement('div');
        card.className = 'quick-view-card';
        
        const summary = this.extractSummary(file.content || '');
        
        const icon = file.template ? this.getTemplateIcon(file.template) : '📄';
        
        card.innerHTML = `
            <div class="qv-header">
                <span class="qv-icon">${icon}</span>
                <span class="qv-name">${this.escapeHtml(file.name)}</span>
            </div>
            <div class="qv-content">${this.escapeHtml(summary)}</div>
            <div class="qv-footer">자세히 보려면 Ctrl + 클릭</div>
        `;
        
        document.body.appendChild(card);
        this.quickViewCard = card;
        
        // 위치 조정 (화면 밖으로 나가지 않게)
        const cardRect = card.getBoundingClientRect();
        let posX = x + 20;
        let posY = y + 20;
        
        if (posX + cardRect.width > window.innerWidth) posX = x - cardRect.width - 20;
        if (posY + cardRect.height > window.innerHeight) posY = y - cardRect.height - 20;
        
        card.style.left = `${posX}px`;
        card.style.top = `${posY}px`;
    }

    /**
     * 퀵 뷰 카드 숨김
     */
    hideQuickView() {
        if (this.quickViewCard) {
            this.quickViewCard.remove();
            this.quickViewCard = null;
        }
        this.currentQuickViewId = null;
    }

    /**
     * 본문에서 요약문 추출 로직
     */
    extractSummary(content) {
        if (!content) return '내용이 없습니다.';
        const allLines = content.split('\n').filter(l => l.trim().length > 0);
        const text = allLines.slice(0, 10).join('\n').trim();
        return text.length > 800 ? text.substring(0, 800) + '...' : text;
    }

    // ===================================
    // 노드 간 연결선 (Node Connections) 시스템
    // ===================================

    /**
     * 프로젝트 변경 시 노드 연결 정보 불러오기
     */
    async loadProjectConnections(projectId) {
        // 기존에 이미 열려있는 창에 포트 핀이 없으면 보장 부착 및 이벤트 등록
        this.windows.forEach((info, fileId) => {
            if (info.element && !info.element.querySelector('.node-port')) {
                const pLeft = document.createElement('div');
                pLeft.className = 'node-port port-left';
                pLeft.dataset.fileId = fileId;
                pLeft.dataset.portType = 'left';
                pLeft.title = '입력 포트 (Input - 화살표 들어오는 곳)';

                const pRight = document.createElement('div');
                pRight.className = 'node-port port-right';
                pRight.dataset.fileId = fileId;
                pRight.dataset.portType = 'right';
                pRight.title = '출력 포트 (Output - 드래그하여 연결)';

                info.element.prepend(pLeft, pRight);

                [pLeft, pRight].forEach(port => {
                    port.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const portType = port.dataset.portType;
                        this.startConnectionDrag(e, fileId, portType, port);
                    });
                });
            }
        });

        if (!projectId) {
            this.nodeConnections = [];
            this.renderConnections();
            return;
        }
        try {
            if (window.storage) {
                const conns = await window.storage.getProjectConnections(projectId);
                this.nodeConnections = Array.isArray(conns) ? conns.map(c => ({
                    ...c,
                    fromPort: 'right',
                    toPort: 'left'
                })) : [];
            }
        } catch (e) {
            console.warn('노드 연결 정보 불러오기 실패:', e);
            this.nodeConnections = [];
        }
        this.renderConnections();
        await this.loadProjectRegions(projectId);
    }

    /**
     * 노드 연결 정보 저장
     */
    async saveConnections() {
        if (!window.currentProjectId || !window.storage) return;
        try {
            await window.storage.saveProjectConnections(window.currentProjectId, this.nodeConnections);
        } catch (e) {
            console.error('노드 연결 정보 저장 실패:', e);
        }
    }

    /**
     * 프로젝트 캔버스 영역 정보 불러오기
     */
    async loadProjectRegions(projectId) {
        if (!projectId) {
            this.canvasRegions = [];
            this.renderCanvasRegions();
            return;
        }
        try {
            if (window.storage) {
                const regions = await window.storage.getProjectRegions(projectId);
                this.canvasRegions = Array.isArray(regions) ? regions : [];
            }
        } catch (e) {
            console.warn('캔버스 영역 정보 불러오기 실패:', e);
            this.canvasRegions = [];
        }
        this.renderCanvasRegions();
    }

    /**
     * 프로젝트 캔버스 영역 정보 저장
     */
    async saveRegions() {
        if (!window.currentProjectId || !window.storage) return;
        try {
            await window.storage.saveProjectRegions(window.currentProjectId, this.canvasRegions);
        } catch (e) {
            console.error('캔버스 영역 정보 저장 실패:', e);
        }
    }

    /**
     * 캔버스에 새 그룹 영역 추가
     */
    addCanvasRegion(title = '새 그룹 영역', x = null, y = null, width = 500, height = 350, color = '#58a6ff') {
        const canvasContainer = document.getElementById('canvasContainer');

        if (x === null || y === null) {
            const canvasArea = document.getElementById('canvasArea');
            if (canvasArea && canvasContainer) {
                const areaRect = canvasArea.getBoundingClientRect();
                const centerClientX = areaRect.left + areaRect.width / 2;
                const centerClientY = areaRect.top + areaRect.height / 2;

                const cRect = canvasContainer.getBoundingClientRect();
                x = (centerClientX - cRect.left) / this.scale - width / 2;
                y = (centerClientY - cRect.top) / this.scale - height / 2;
            } else {
                x = 300;
                y = 200;
            }
        }

        const newRegion = {
            id: 'region_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            title: title || '새 그룹 영역',
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height),
            color: color || '#58a6ff'
        };

        if (!this.canvasRegions) this.canvasRegions = [];
        this.canvasRegions.push(newRegion);

        this.renderCanvasRegions();
        this.saveRegions();

        window.showToast?.(`'${newRegion.title}' 영역이 캔버스에 추가되었습니다. 🔲`);
    }

    /**
     * 캔버스 그룹 영역 렌더링
     */
    renderCanvasRegions() {
        const container = document.getElementById('canvasContainer');
        if (!container) return;

        container.querySelectorAll('.canvas-region-box').forEach(el => el.remove());

        if (!this.canvasRegions || this.canvasRegions.length === 0) return;

        const svg = document.getElementById('nodeConnectionsSvg');

        this.canvasRegions.forEach(r => {
            const box = document.createElement('div');
            box.className = 'canvas-region-box';
            box.id = r.id;
            box.style.left = `${r.x}px`;
            box.style.top = `${r.y}px`;
            box.style.width = `${r.width}px`;
            box.style.height = `${r.height}px`;
            box.style.borderColor = r.color || '#58a6ff';
            
            const hexColor = r.color || '#58a6ff';
            box.style.backgroundColor = hexColor.startsWith('#') ? (hexColor + '10') : 'rgba(88, 166, 255, 0.05)';

            box.innerHTML = `
                <div class="canvas-region-header" style="background: ${r.color || '#58a6ff'};">
                    <span class="canvas-region-title" id="regionTitle_${r.id}" title="더블 클릭하여 이름 변경">🔲 ${this.escapeHtml(r.title)}</span>
                    <div class="canvas-region-actions">
                        <input type="color" class="canvas-region-color-picker" value="${r.color || '#58a6ff'}" title="영역 색상 변경">
                        <button class="canvas-region-btn delete-btn" title="영역 삭제">✕</button>
                    </div>
                </div>
                <div class="canvas-region-resize-handle nw" data-dir="nw" title="크기 조절"></div>
                <div class="canvas-region-resize-handle ne" data-dir="ne" title="크기 조절"></div>
                <div class="canvas-region-resize-handle sw" data-dir="sw" title="크기 조절"></div>
                <div class="canvas-region-resize-handle se" data-dir="se" title="크기 조절"></div>
            `;

            const colorPicker = box.querySelector('.canvas-region-color-picker');
            colorPicker?.addEventListener('change', (e) => {
                e.stopPropagation();
                r.color = e.target.value;
                this.renderCanvasRegions();
                this.saveRegions();
            });

            const deleteBtn = box.querySelector('.delete-btn');
            deleteBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`'${r.title}' 캔버스 영역을 삭제하시겠습니까?`)) {
                    this.canvasRegions = this.canvasRegions.filter(reg => reg.id !== r.id);
                    box.remove();
                    this.saveRegions();
                }
            });

            const titleEl = box.querySelector('.canvas-region-title');
            titleEl?.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'canvas-region-title-input';
                input.value = r.title;
                titleEl.replaceWith(input);
                input.focus();
                input.select();

                const finishRename = () => {
                    const newTitle = input.value.trim() || '이름 없음 영역';
                    r.title = newTitle;
                    this.renderCanvasRegions();
                    this.saveRegions();
                };

                input.addEventListener('blur', finishRename);
                input.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') finishRename();
                });
            });

            const header = box.querySelector('.canvas-region-header');
            const startDrag = (e) => {
                if (e.target.closest('.canvas-region-actions') || e.target.tagName === 'INPUT') return;
                e.stopPropagation();

                this.regionDragState = {
                    regionId: r.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: r.x,
                    origY: r.y
                };
            };

            header?.addEventListener('mousedown', startDrag);
            box.addEventListener('mousedown', (e) => {
                if (e.target === box) {
                    startDrag(e);
                }
            });

            box.querySelectorAll('.canvas-region-resize-handle').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    this.regionResizeState = {
                        regionId: r.id,
                        dir: handle.dataset.dir || 'se',
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: r.x,
                        origY: r.y,
                        origW: r.width,
                        origH: r.height
                    };
                });
            });

            if (svg && svg.nextSibling) {
                container.insertBefore(box, svg.nextSibling);
            } else {
                container.appendChild(box);
            }
        });
    }

    /**
     * fileId 타입(String vs Number)에 무관하게 윈도우 객체 검색
     */
    getWindowInfo(fileId) {
        if (!fileId && fileId !== 0) return null;
        if (this.windows.has(fileId)) return this.windows.get(fileId);
        if (this.windows.has(String(fileId))) return this.windows.get(String(fileId));
        if (this.windows.has(Number(fileId))) return this.windows.get(Number(fileId));
        return null;
    }

    /**
     * 특정 포트의 캔버스 기준 중심 좌표 (X, Y) 계산 (다중 포트 핀 1:1 바인딩)
     */
    getPortCoordinates(fileId, portType, portId = null) {
        const info = this.getWindowInfo(fileId);
        if (!info || !info.element) return null;

        const winEl = info.element;
        let selector = `.node-port.port-${portType}`;
        if (portId) {
            selector += `[data-port-id="${portId}"]`;
        }

        let portEl = winEl.querySelector(selector);
        if (!portEl) {
            portEl = winEl.querySelector(`.node-port.port-${portType}`);
        }

        if (portEl) {
            const container = document.getElementById('canvasContainer');
            const parentRect = container ? container.getBoundingClientRect() : (winEl.parentElement ? winEl.parentElement.getBoundingClientRect() : { left: 0, top: 0 });
            const portRect = portEl.getBoundingClientRect();
            const scale = this.scale || this.zoom || 1;
            return {
                x: (portRect.left + portRect.width / 2 - parentRect.left) / scale,
                y: (portRect.top + portRect.height / 2 - parentRect.top) / scale
            };
        }

        const winX = parseFloat(winEl.style.left) || winEl.offsetLeft || 0;
        const winY = parseFloat(winEl.style.top) || winEl.offsetTop || 0;
        const winW = parseFloat(winEl.style.width) || winEl.offsetWidth || 360;
        const winH = parseFloat(winEl.style.height) || winEl.offsetHeight || 280;

        const x = (portType === 'left') ? winX : (winX + winW);
        const y = winY + (winH / 2);

        return {
            x: isNaN(x) ? 0 : x,
            y: isNaN(y) ? 0 : y
        };
    }

    /**
     * 포트 드래그 연결 시작 (Input/Output 모든 포트에서 드래그 가능)
     */
    startConnectionDrag(e, fromId, fromPort, portEl) {
        const fromPortId = portEl?.dataset.portId || null;
        const coords = this.getPortCoordinates(fromId, fromPort, fromPortId);
        if (!coords) return;

        const svg = document.getElementById('nodeConnectionsSvg');
        const container = document.getElementById('canvasContainer');
        if (!svg || !container) return;

        if (container.firstChild !== svg) {
            container.insertBefore(svg, container.firstChild);
        }

        const portColor = portEl?.dataset?.portColor || '#00ffcc';
        let draftEl = svg.querySelector('#connectionDraftPath');
        if (!draftEl) {
            draftEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            draftEl.setAttribute('id', 'connectionDraftPath');
            draftEl.setAttribute('class', 'node-connection-draft');
            draftEl.setAttribute('stroke', portColor);
            draftEl.setAttribute('stroke-width', '4');
            draftEl.setAttribute('stroke-dasharray', '6 4');
            draftEl.setAttribute('fill', 'none');
            draftEl.setAttribute('marker-end', 'url(#arrowhead)');
            svg.appendChild(draftEl);
        } else {
            draftEl.setAttribute('stroke', portColor);
        }

        this.connectionDragState = {
            fromId,
            fromPort,
            fromPortId,
            startX: coords.x,
            startY: coords.y,
            draftEl
        };

        if (portEl) portEl.classList.add('connecting');
        document.body.style.cursor = 'crosshair';
    }

    /**
     * 드래그 중 임시 연결선 갱신 (반대쪽 포트만 타겟팅)
     */
    updateConnectionDrag(e) {
        const state = this.connectionDragState;
        if (!state || !state.draftEl) return;

        const canvasContainer = document.getElementById('canvasContainer');
        if (!canvasContainer) return;

        const containerRect = canvasContainer.getBoundingClientRect();
        const currentX = (e.clientX - containerRect.left) / (this.scale || 1);
        const currentY = (e.clientY - containerRect.top) / (this.scale || 1);

        let pathD = '';
        if (state.fromPort === 'right') {
            pathD = this.calculateBezierPath(state.startX, state.startY, 'right', currentX, currentY, 'left');
        } else {
            pathD = this.calculateBezierPath(currentX, currentY, 'right', state.startX, state.startY, 'left');
        }
        state.draftEl.setAttribute('d', pathD);

        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        const oppositePortClass = state.fromPort === 'right' ? '.node-port.port-left' : '.node-port.port-right';
        const targetPort = elemBelow ? elemBelow.closest(oppositePortClass) : null;
        
        document.querySelectorAll('.node-port.connecting').forEach(p => {
            if (p !== targetPort) p.classList.remove('connecting');
        });
        if (targetPort) targetPort.classList.add('connecting');
    }

    /**
     * 연결 드래그 종료 및 노드 연결 체결
     */
    endConnectionDrag(e) {
        const state = this.connectionDragState;
        if (!state) return;

        if (state.draftEl) state.draftEl.remove();

        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        const targetPort = elemBelow ? elemBelow.closest('.node-port') : null;

        // 드래그/연결 클래스 및 커서 스타일 먼저 정리
        document.querySelectorAll('.node-port.connecting').forEach(p => p.classList.remove('connecting'));
        this.connectionDragState = null;
        document.body.style.cursor = '';

        if (targetPort) {
            const toId = targetPort.dataset.fileId;
            const toPort = targetPort.dataset.portType || 'left';
            const toPortId = targetPort.dataset.portId || null;

            if (toId && String(toId) !== String(state.fromId)) {
                if (state.fromPort === toPort) {
                    if (toPort === 'left') {
                        window.showToast?.('Input 포트끼리는 연결할 수 없습니다. (Output 포트와 연결하세요)', 'warn');
                    } else {
                        window.showToast?.('Output 포트끼리는 연결할 수 없습니다. (Input 포트와 연결하세요)', 'warn');
                    }
                } else {
                    this.addNodeConnection(state.fromId, state.fromPort, state.fromPortId, toId, toPort, toPortId);
                }
            }
        }
    }

    /**
     * 노드 간 연결선 추가 (자동으로 Output -> Input 화살표 방향 정렬)
     */
    addNodeConnection(fromId, fromPort, fromPortId, toId, toPort, toPortId) {
        if (fromPort === toPort) {
            window.showToast?.('동일한 포트 타입끼리는 연결할 수 없습니다. (Input ↔ Output만 연결 가능)', 'warn');
            return;
        }

        let outputId = fromId;
        let inputId = toId;
        let outPortId = fromPortId;
        let inPortId = toPortId;

        // Input(left) 포트에서 드래그를 시작해 Output(right) 포트에 연결한 경우 방향 자동 조절
        if (fromPort === 'left' && toPort === 'right') {
            outputId = toId;
            inputId = fromId;
            outPortId = toPortId;
            inPortId = fromPortId;
        }

        if (!outPortId) {
            const outPin = this.getWindowInfo(outputId)?.element?.querySelector('.node-port.port-right');
            outPortId = outPin?.dataset.portId || 'out_1';
        }

        if (!inPortId) {
            const inPin = this.getWindowInfo(inputId)?.element?.querySelector('.node-port.port-left');
            inPortId = inPin?.dataset.portId || 'in_1';
        }

        const existingInConnIndex = this.nodeConnections.findIndex(c => 
            String(c.toId) === String(inputId) && c.toPortId === inPortId
        );

        let replacedOld = false;
        if (existingInConnIndex !== -1) {
            this.nodeConnections.splice(existingInConnIndex, 1);
            replacedOld = true;
        }

        const connId = 'conn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        this.nodeConnections.push({
            id: connId,
            fromId: outputId,
            fromPort: 'right',
            fromPortId: outPortId,
            toId: inputId,
            toPort: 'left',
            toPortId: inPortId
        });

        this.renderConnections();
        this.saveConnections();
        window.showToast?.(replacedOld ? 'Input 핀 연결이 새로 교체되었습니다! 🔗' : '노드 포트 핀이 연결되었습니다! 🔗', 'success');

        // 연결된 노드들 실시간 데이터 미리보기 갱신
        this.windows.forEach((info, fId) => {
            if (info.file.isTextFieldsNode || (info.file.content && typeof info.file.content === 'string' && info.file.content.includes('"isTextFieldsNode"'))) {
                this.renderTextFieldsNode(fId);
            }
        });

        // 포트 핀 CSS 애니메이션/트랜지션이 완전히 정돈된 후 연결선 위치 재동기화
        setTimeout(() => this.renderConnections(), 50);
        setTimeout(() => this.renderConnections(), 250);
    }

    /**
     * 연결선 삭제
     */
    deleteConnection(connId) {
        const idx = this.nodeConnections.findIndex(c => c.id === connId);
        if (idx !== -1) {
            this.nodeConnections.splice(idx, 1);
            if (this.selectedConnectionId === connId) {
                this.selectedConnectionId = null;
            }
            this.renderConnections();
            this.saveConnections();
            window.showToast?.('연결선이 삭제되었습니다.');

            // 연결 해제 시 노드 실시간 미리보기 갱신
            this.windows.forEach((info, fId) => {
                if (info.file.isTextFieldsNode || (info.file.content && typeof info.file.content === 'string' && info.file.content.includes('"isTextFieldsNode"'))) {
                    this.renderTextFieldsNode(fId);
                }
            });
        }
    }

    /**
     * 연결선 선택
     */
    selectConnection(connId) {
        this.selectedConnectionId = connId;
        this.renderConnections();
    }

    /**
     * 연결선 선택 해제
     */
    deselectConnection() {
        if (this.selectedConnectionId) {
            this.selectedConnectionId = null;
            this.renderConnections();
        }
    }

    /**
     * 베지에 곡선 SVG Path 데이터 생성 (NaN 방지)
     */
    calculateBezierPath(x1, y1, port1, x2, y2, port2) {
        x1 = Number(x1) || 0;
        y1 = Number(y1) || 0;
        x2 = Number(x2) || 0;
        y2 = Number(y2) || 0;

        const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40);
        const cx1 = (port1 === 'right') ? (x1 + dx) : (x1 - dx);
        const cy1 = y1;
        const cx2 = (port2 === 'left') ? (x2 - dx) : (x2 + dx);
        const cy2 = y2;

        return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
    }

    /**
     * 모든 연결선 SVG 렌더링
     */
    renderConnections() {
        const svg = document.getElementById('nodeConnectionsSvg');
        const container = document.getElementById('canvasContainer');
        if (!svg || !container) return;

        if (container.firstChild !== svg) {
            container.insertBefore(svg, container.firstChild);
        }

        const existingLines = svg.querySelectorAll('.node-connection-line');
        existingLines.forEach(l => l.remove());

        if (!Array.isArray(this.nodeConnections)) this.nodeConnections = [];

        // 창이 닫혀있거나 지워진 연결선 자동 필터링
        this.nodeConnections = this.nodeConnections.filter(c => {
            const hasFrom = !!this.getWindowInfo(c.fromId);
            const hasTo = !!this.getWindowInfo(c.toId);
            return hasFrom && hasTo;
        });

        this.nodeConnections.forEach(conn => {
            const start = this.getPortCoordinates(conn.fromId, conn.fromPort, conn.fromPortId);
            const end = this.getPortCoordinates(conn.toId, conn.toPort, conn.toPortId);

            if (!start || !end) return;

            const fromWin = this.getWindowInfo(conn.fromId);
            let fromPortEl = null;
            if (conn.fromPortId) {
                fromPortEl = fromWin?.element?.querySelector(`.node-port[data-port-id="${conn.fromPortId}"]`);
            }
            if (!fromPortEl) {
                fromPortEl = fromWin?.element?.querySelector(`.node-port.port-right`);
            }
            const strokeColor = fromPortEl?.dataset?.portColor || '#00ffcc';

            const pathD = this.calculateBezierPath(start.x, start.y, conn.fromPort, end.x, end.y, conn.toPort);
            
            const isSelected = (this.selectedConnectionId === conn.id);
            const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.setAttribute('d', pathD);
            pathEl.setAttribute('class', `node-connection-line${isSelected ? ' selected' : ''}`);
            pathEl.setAttribute('stroke', isSelected ? '#ffcc00' : strokeColor);
            pathEl.setAttribute('stroke-width', isSelected ? '5' : '4');
            pathEl.setAttribute('fill', 'none');
            pathEl.setAttribute('marker-end', isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
            pathEl.dataset.connId = conn.id;

            pathEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectConnection(conn.id);
            });

            pathEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm('이 노드 연결선을 삭제할까요?')) {
                    this.deleteConnection(conn.id);
                }
            });

            svg.appendChild(pathEl);
        });
    }

    renderSystemPromptNodeUI(file, win) {
        const container = win.querySelector(`#sysPromptContainer_${file.id}`);
        if (!container) return;

        let promptData = {
            command: "WRITE_CHAPTER",
            instruction: "아래의 [설정값]과 [지금까지의 줄거리]를 완벽히 분석하여, [현재 챕터 범위]에 해당하는 소설 본문을 즉시 작성하시오.",
            outputRequirements: "JSON 분석이나 사족(인사말)을 붙이지 말고, 오직 소설 제목과 본문 텍스트만을 일반적인 텍스트로 출력할 것."
        };

        try {
            if (file.content) {
                const parsed = JSON.parse(file.content);
                if (typeof parsed === 'object') {
                    promptData = { ...promptData, ...parsed };
                }
            }
        } catch (e) {
            console.warn('시스템 프롬프트 데이터 파싱 실패, 기본값 사용');
        }

        container.innerHTML = `
            <div class="sys-prompt-form" style="padding: 12px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; background: var(--color-bg-primary);">
                
                <div class="sys-prompt-field">
                    <label class="sys-prompt-label">📌 명령 (Command)</label>
                    <input type="text" class="input sys-input" data-key="command" value="${this.escapeHtml(promptData.command || '')}" style="width: 100%; font-weight: 600;">
                </div>

                <div class="sys-prompt-field">
                    <label class="sys-prompt-label">📜 지침 (Instruction)</label>
                    <textarea class="input sys-textarea" data-key="instruction" rows="3" style="width: 100%; resize: vertical;">${this.escapeHtml(promptData.instruction || '')}</textarea>
                </div>

                <div class="sys-prompt-field">
                    <label class="sys-prompt-label">📤 출력 요구사항 (Output Requirements)</label>
                    <textarea class="input sys-textarea" data-key="outputRequirements" rows="3" style="width: 100%; resize: vertical;">${this.escapeHtml(promptData.outputRequirements || '')}</textarea>
                </div>

            </div>
        `;

        const updatePromptData = async () => {
            const updated = {};
            container.querySelectorAll('[data-key]').forEach(el => {
                const key = el.dataset.key;
                updated[key] = el.value;
            });

            file.content = JSON.stringify(updated, null, 2);
            await storage.updateFile(file.id, { content: file.content });
        };

        container.querySelectorAll('input, textarea').forEach(inputEl => {
            inputEl.addEventListener('input', updatePromptData);
        });
    }

    renderAiMetaNodeUI(file, win) {
        const container = win.querySelector(`#aiMetaContainer_${file.id}`);
        if (!container) return;

        let metaData = {
            role: "대박을 친 한국의 웹소설 작가 (카카오페이지/네이버 시리즈 스타일)",
            task: "현재 챕터 소설 본문 작성",
            detailedInstructions: "1. 인물 간의 텐션 높은 대사와 빠른 스토리 전개감을 살릴 것.\n2. 챕터 마지막에 다음 회차에 대한 궁금증을 극대화하는 절벽엔딩(Cliffhanger)을 배치할 것.\n3. 설정 노드의 스탯/속성값들과 이전 챕터 줄거리를 완벽히 계승할 것."
        };

        try {
            if (file.content) {
                const parsed = JSON.parse(file.content);
                if (typeof parsed === 'object') {
                    metaData = { ...metaData, ...parsed };
                }
            }
        } catch (e) {
            console.warn('AI META 데이터 파싱 실패, 기본값 사용');
        }

        container.innerHTML = `
            <div class="sys-prompt-form" style="padding: 12px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; background: var(--color-bg-primary);">
                
                <div class="sys-prompt-field">
                    <label class="sys-prompt-label">🎭 역할 (Role)</label>
                    <input type="text" class="input sys-input" data-key="role" value="${this.escapeHtml(metaData.role || '')}" style="width: 100%; font-weight: 600;">
                </div>

                <div class="sys-prompt-field">
                    <label class="sys-prompt-label">🎯 임무 (Task)</label>
                    <input type="text" class="input sys-input" data-key="task" value="${this.escapeHtml(metaData.task || '')}" style="width: 100%;">
                </div>

                <div class="sys-prompt-field">
                    <label class="sys-prompt-label">📝 상세 지시사항 (Detailed Instructions)</label>
                    <textarea class="input sys-textarea" data-key="detailedInstructions" rows="5" style="width: 100%; resize: vertical;">${this.escapeHtml(metaData.detailedInstructions || '')}</textarea>
                </div>

            </div>
        `;

        const updateMetaData = async () => {
            const updated = {};
            container.querySelectorAll('[data-key]').forEach(el => {
                const key = el.dataset.key;
                updated[key] = el.value;
            });

            file.content = JSON.stringify(updated, null, 2);
            await storage.updateFile(file.id, { content: file.content });
        };

        container.querySelectorAll('input, textarea').forEach(inputEl => {
            inputEl.addEventListener('input', updateMetaData);
        });
    }

    /**
     * 폴더 자동 수집 노드 평가 및 렌더링
     */
    getEvaluatedFolderCollectorText(file) {
        if (!file || !file.content) return '';
        try {
            const data = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
            const targetFolderId = data.targetFolderId || 'root';
            const itemTemplate = data.itemTemplate || '';

            // 1) 양식이 비어 있으면 빈 텍스트(여백) 출력
            if (!itemTemplate.trim()) {
                return '';
            }

            const projectFiles = Array.from(this.windows.values()).map(w => w.file);
            let allFiles = window.fileTreeManager?.files || projectFiles;

            let targetFiles = [];
            if (targetFolderId === 'root') {
                targetFiles = allFiles.filter(f => f.type === 'file' && f.id !== file.id && f.template !== 'folder_collector');
            } else {
                targetFiles = allFiles.filter(f => f.parentId === targetFolderId && f.type === 'file' && f.id !== file.id);
            }

            if (targetFiles.length === 0) {
                return `(선택한 폴더에 수집할 파일 노드가 없습니다)`;
            }

            // 폴더 내 각 파일의 전체 내용 평가 및 Map 구성
            const fileContentMap = new Map();

            targetFiles.forEach(f => {
                let contentText = '';
                const outputs = f.portsConfig?.outputs || [];
                const firstPortId = (Array.isArray(outputs) && outputs.length > 0) ? outputs[0].id : null;

                if (f.isFolderCollectorNode || f.template === 'folder_collector' || (f.content && typeof f.content === 'string' && f.content.includes('"isFolderCollectorNode"'))) {
                    contentText = this.getEvaluatedFolderCollectorText(f);
                } else if (f.isTextFieldsNode || (f.content && typeof f.content === 'string' && f.content.includes('"isTextFieldsNode"'))) {
                    contentText = this.getEvaluatedTextFieldsText(f, firstPortId);
                } else if (f.template === 'stat' || f.isStatNode) {
                    try {
                        const uData = typeof f.content === 'string' ? JSON.parse(f.content) : f.content;
                        contentText = uData.outputTemplate || '';
                        if (!contentText) {
                            contentText = `《 ${f.name} 상태창 》\n` + (uData.stats || []).map(s => `[${s.name}: ${s.value}]`).join(' ');
                        } else {
                            contentText = contentText.replace(/\{\$이름\$\}/g, f.name);
                            (uData.stats || []).forEach(s => {
                                const escapedName = s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                contentText = contentText.replace(new RegExp(`\\{\\$${escapedName}\\$\\}`, 'g'), s.value);
                            });
                        }
                    } catch(e) {}
                } else {
                    contentText = typeof f.content === 'string' ? f.content : '';
                }

                const rawName = f.name || '';
                const cleanName = rawName.replace(/^[^\w\s가-힣]+\s*/, '').trim();

                fileContentMap.set(rawName, contentText);
                if (cleanName) fileContentMap.set(cleanName, contentText);
            });

            // 2) 양식에 {$CONTENT$}가 포함된 경우 (파일별 순차 반복 수집)
            if (itemTemplate.includes('{$CONTENT$}')) {
                return targetFiles.map(f => {
                    const textVal = fileContentMap.get(f.name) || '';
                    return itemTemplate.replace(/\{\$이름\$\}/g, f.name).replace(/\{\$CONTENT\$\}/g, textVal);
                }).join('\n\n');
            }

            // 3) 사용자가 양식에 {$파일명$} 형태로 원하는 파일들을 직접 자유롭게 배치한 경우
            let result = itemTemplate.replace(/\{\$이름\$\}/g, file.name);

            fileContentMap.forEach((textVal, nameKey) => {
                const escapedName = nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\{\\$${escapedName}\\$\\}`, 'g');
                result = result.replace(regex, textVal);
            });

            return result;
        } catch (e) {
            return typeof file.content === 'string' ? file.content : '';
        }
    }

    renderFolderCollectorNode(fileId) {
        const info = this.windows.get(fileId);
        const container = document.getElementById(`folderCollectorContainer_${fileId}`);
        if (!info || !container) return;

        let data;
        try {
            data = typeof info.file.content === 'string' ? JSON.parse(info.file.content || '{}') : (info.file.content || {});
            if (!data.targetFolderId) data.targetFolderId = 'root';
            if (data.itemTemplate === undefined) data.itemTemplate = '';
        } catch (e) {
            data = { targetFolderId: 'root', itemTemplate: '' };
        }

        const projectFolders = (window.fileTreeManager?.files || []).filter(f => f.type === 'folder');
        const evaluatedText = this.getEvaluatedFolderCollectorText(info.file);

        let allFiles = window.fileTreeManager?.files || Array.from(this.windows.values()).map(w => w.file);
        let targetFiles = [];
        if (data.targetFolderId === 'root') {
            targetFiles = allFiles.filter(f => f.type === 'file' && f.id !== fileId && f.template !== 'folder_collector');
        } else {
            targetFiles = allFiles.filter(f => f.parentId === data.targetFolderId && f.type === 'file' && f.id !== fileId);
        }

        const fileChipsHtml = targetFiles.map(f => {
            const cleanName = f.name.replace(/^[^\w\s가-힣]+\s*/, '').trim() || f.name;
            return `<button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; font-weight: 600;" 
                onclick="window.windowManager.insertFolderCollectorFileVar('${fileId}', '${this.escapeHtml(cleanName)}')" title="클릭 시 양식에 {$${this.escapeHtml(cleanName)}$} 삽입">+ {$${this.escapeHtml(cleanName)}$}</button>`;
        }).join(' ');

        container.innerHTML = `
            <div style="padding: 12px; display: flex; flex-direction: column; gap: 10px; height: 100%; box-sizing: border-box;">
                <div style="background: var(--color-surface-1); padding: 10px; border-radius: 8px; border: 1px solid var(--color-border);">
                    <label style="font-size: 12px; font-weight: 700; color: var(--color-accent-primary); display: block; margin-bottom: 6px;">📁 수집 대상 폴더 선택</label>
                    <select class="input" style="width: 100%; font-size: 12px; height: 34px; padding: 4px 8px; line-height: 1.4; box-sizing: border-box; cursor: pointer; text-overflow: ellipsis; white-space: nowrap;" onchange="window.windowManager.onFolderCollectorFolderChange('${fileId}', this.value)">
                        <option value="root" ${data.targetFolderId === 'root' ? 'selected' : ''}>📁 [프로젝트 전체 파일 노드]</option>
                        ${projectFolders.map(f => `<option value="${f.id}" ${data.targetFolderId === f.id ? 'selected' : ''}>📁 ${this.escapeHtml(f.name)}</option>`).join('')}
                    </select>
                </div>

                <div style="background: var(--color-surface-1); padding: 10px; border-radius: 8px; border: 1px solid var(--color-border); flex: 1; display: flex; flex-direction: column;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--color-text-secondary); margin-bottom: 6px;">
                        📌 감지된 파일 노드 (버튼 클릭 시 양식에 변수 삽입):
                    </div>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;">
                        ${fileChipsHtml || '<span style="font-size: 11px; color: var(--color-text-tertiary);">감지된 파일 없음</span>'}
                    </div>

                    <label style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 6px;">📝 파일 자유 배치 양식 (템플릿)</label>
                    <textarea class="input folder-collector-tmpl_${fileId}" style="width: 100%; height: 95px; font-family: inherit; font-size: 12px; line-height: 1.5; resize: vertical;" 
                        oninput="window.windowManager.onFolderCollectorTemplateChange('${fileId}', this.value)" placeholder="예: [메인 캐릭터]&#10;{$아인$}&#10;&#10;[서브 캐릭터]&#10;{$엘레나$}">${this.escapeHtml(data.itemTemplate)}</textarea>
                    <div style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 4px; line-height: 1.4;">
                      💡 위 파일 변수(<code>{$파일명$}</code>)를 원하는 위치에 배치하면 해당 파일의 전체 내용이 들어갑니다. (양식을 비워두면 빈 텍스트 출력)
                    </div>
                </div>

                <!-- 실시간 최종 수집 출력 미리보기 -->
                <div style="margin-top: 4px; border-top: 1px dashed var(--color-border); padding-top: 10px;">
                    <div style="font-size: 12px; font-weight: 700; color: #00ffcc; margin-bottom: 6px;">👁️ 배치 결과 최종 미리보기</div>
                    <pre style="background: var(--color-bg-primary); border: 1px solid var(--color-border); padding: 10px; border-radius: 8px; font-family: inherit; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; margin: 0; color: var(--color-text-primary); max-height: 150px; overflow-y: auto;">${this.escapeHtml(evaluatedText)}</pre>
                </div>
            </div>
        `;
    }

    insertFolderCollectorFileVar(fileId, fileName) {
        const textarea = document.querySelector(`.folder-collector-tmpl_${fileId}`);
        if (!textarea) return;
        const varStr = `{$${fileName}$}\n`;
        const start = textarea.selectionStart || textarea.value.length;
        const end = textarea.selectionEnd || textarea.value.length;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + varStr + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + varStr.length;
        textarea.focus();
        this.onFolderCollectorTemplateChange(fileId, textarea.value);
    }

    async onFolderCollectorFolderChange(fileId, folderId) {
        const info = this.windows.get(fileId);
        if (!info) return;
        let data = typeof info.file.content === 'string' ? JSON.parse(info.file.content || '{}') : (info.file.content || {});
        data.targetFolderId = folderId;
        info.file.content = JSON.stringify(data, null, 2);
        await window.storage?.updateFile(fileId, { content: info.file.content });
        this.renderFolderCollectorNode(fileId);
    }

    async onFolderCollectorTemplateChange(fileId, template) {
        const info = this.windows.get(fileId);
        if (!info) return;
        let data = typeof info.file.content === 'string' ? JSON.parse(info.file.content || '{}') : (info.file.content || {});
        data.itemTemplate = template;
        info.file.content = JSON.stringify(data, null, 2);
        await window.storage?.updateFile(fileId, { content: info.file.content });

        const container = document.getElementById(`folderCollectorContainer_${fileId}`);
        if (container) {
            const previewPre = container.querySelector('pre');
            if (previewPre) {
                previewPre.textContent = this.getEvaluatedFolderCollectorText(info.file);
            }
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.windowManager = new WindowManager();
