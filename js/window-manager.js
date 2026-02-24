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

        // 하이퍼링크 맵 (파일명 -> fileId)
        this.hyperlinkMap = new Map();

        // 캔버스 줌/팬 상태
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.panState = null;
        this.minScale = 0.25;
        this.maxScale = 3;

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
        document.addEventListener('click', () => this.hideContextMenu());

        // 상단 헤더 저장 버튼
        document.getElementById('saveBtn')?.addEventListener('click', () => {
            this.saveActiveWindow();
        });

        // 텍스트 병합 모달 버튼
        document.getElementById('closeMergeModal')?.addEventListener('click', () => this.hideMergeModal());
        document.getElementById('cancelMergeBtn')?.addEventListener('click', () => this.hideMergeModal());
        document.getElementById('confirmMergeBtn')?.addEventListener('click', () => this.confirmMerge());

        // 전역 단축키 (저장)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                const editorScreen = document.getElementById('editorScreen');
                if (editorScreen && !editorScreen.classList.contains('hidden')) {
                    e.preventDefault();
                    this.saveActiveWindow();
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

        // 파일의 isOpen 상태 업데이트
        if (!restoreState) {
            await this.updateFileWindowState(fileId, { isOpen: true, x, y, width, height });
        }

        // 포커스
        this.focusWindow(fileId);

        // 수치 계산기인 경우 초기 렌더링
        if (file.template === 'stat') {
            this.renderStatCalculator(fileId);
        }

        // 초기 하이라이트 적용
        this.updateHighlighter(fileId);
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

        // 계단식 배열(Cascade)을 위한 오프셋 적용
        const offsetStep = 32;
        const x = viewCenterX - (width / 2) + (this.cascadeOffset * offsetStep) % 200;
        const y = viewCenterY - (height / 2) + (this.cascadeOffset * offsetStep) % 150;
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
        // 템플릿 속성 확인 또는 콘텐츠가 이미지 데이터(Base64)인 경우
        const isImage = file.template === 'image' || (file.content && file.content.startsWith('data:image'));
        const isStat = file.template === 'stat';
        
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
        } else if (isStat) {
            bodyContent = `
                <div class="stat-calculator-container" id="statContainer_${file.id}">
                    <!-- 계산기 UI가 여기에 렌더링됩니다 -->
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

        win.innerHTML = `
            <div class="window-titlebar" data-file-id="${file.id}">
                <div class="window-titlebar-left">
                    <span class="window-titlebar-icon">${icon}</span>
                    <span class="window-titlebar-name">${this.escapeHtml(file.name)}</span>
                    <span class="window-modified" data-indicator="${file.id}"></span>
                </div>
                <div class="window-titlebar-actions">
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
                if (info) {
                    targets.push({
                        id,
                        element: info.element,
                        origLeft: info.element.offsetLeft,
                        origTop: info.element.offsetTop
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

        // 버튼 (닫기, 접기)
        win.querySelectorAll('.window-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'close') this.closeWindow(fileId);
                if (action === 'collapse') this.toggleCollapse(fileId);
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
                const rect = win.getBoundingClientRect();
                const containerRect = win.parentElement.getBoundingClientRect();
                this.resizeState = {
                    fileId,
                    element: win,
                    dir: edge.dataset.dir,
                    startX: e.clientX,
                    startY: e.clientY,
                    origWidth: win.offsetWidth,
                    origHeight: win.offsetHeight,
                    origLeft: win.offsetLeft,
                    origTop: win.offsetTop
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
        });

        textarea.addEventListener('scroll', () => {
            this.updateHighlighter(fileId);
        });

        // 따옴표 자동 닫기 및 괄호 처리 (스마트 버전)
        textarea.addEventListener('keydown', (e) => {
            const settings = window.toolsPanel?.settings || {};
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

            // 1. 상태창 불러오기 트리거 패턴 확인 ({{...}})
            const settings = window.toolsPanel?.settings || window.toolsPanel?.loadSettingsSync() || {};
            const tOpen = settings.triggerStatOpen || '{{';
            const tClose = settings.triggerStatClose || '}}';
            
            const lastOpen = text.substring(0, pos + tOpen.length).lastIndexOf(tOpen);
            const firstClose = text.indexOf(tClose, Math.max(0, pos - tClose.length));
            
            if (lastOpen !== -1 && firstClose !== -1 && lastOpen < firstClose && pos >= lastOpen && pos <= firstClose + tClose.length) {
                e.preventDefault();
                
                const fullEndIdx = firstClose + tClose.length;
                const pattern = text.substring(lastOpen, fullEndIdx);
                const statName = pattern.replace(tOpen, '').replace(tClose, '').trim();
                
                const files = await storage.getProjectFiles(window.currentProjectId);
                const statFile = files.find(f => f.name === statName && f.template === 'stat');
                
                if (statFile) {
                    try {
                        const data = JSON.parse(statFile.content);
                        let resultText = data.outputTemplate || "";
                        
                        // 템플릿이 비어있으면 기본형 제공
                        if (!resultText) {
                            const statStrings = data.stats.map(s => `[${s.name}: ${s.value}]`).join(' ');
                            resultText = `《 ${statName} 상태창 》\n${statStrings}`;
                        } else {
                            // 변수 치환 ({$이름$} 및 {$스탯명$})
                            resultText = resultText.replace(/\{\$이름\$\}/g, statName);
                            data.stats.forEach(s => {
                                // 특수문자 이스케이프 후 {$스탯명$} 정규표현식 생성
                                const escapedName = s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                const regex = new RegExp(`\\{\\$${escapedName}\\$\\}`, 'g');
                                resultText = resultText.replace(regex, s.value);
                            });
                        }
                        
                        const newText = text.substring(0, lastOpen) + resultText + text.substring(fullEndIdx);
                        textarea.value = newText;
                        textarea.selectionStart = textarea.selectionEnd = lastOpen + resultText.length;
                        
                        this.onTextChange(fileId, newText);
                        this.updateHighlighter(fileId);
                        window.showToast?.(`"${statName}" 데이터를 불러왔습니다.`);
                        return; // 상태창 처리 완료 시 종료
                    } catch (err) {
                        console.error('상태창 데이터 파싱 실패:', err);
                    }
                }
            }

            // 2. 하이퍼링크 작동 (파일명 클릭 시 창 열기)
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

        // Ctrl 키를 누른 채 하이퍼링크 위에 마우스를 올리면 커서 변경
        textarea.addEventListener('mousemove', (e) => {
            if (!(e.ctrlKey || e.metaKey)) {
                if (textarea.style.cursor === 'pointer') textarea.style.cursor = 'text';
                return;
            }

            // 커서 아래에 파일명이나 상태창 트리거가 있는지 확인
            const pos = this.getTextOffsetFromPoint(textarea, e.clientX, e.clientY);
            const text = textarea.value;
            let found = false;

            if (pos !== -1) {
                // 상태창 트리거 확인
                const settings = window.toolsPanel?.settings || window.toolsPanel?.loadSettingsSync() || {};
                const tOpen = settings.triggerStatOpen || '{{';
                const tClose = settings.triggerStatClose || '}}';
                const lastOpen = text.substring(0, pos + tOpen.length).lastIndexOf(tOpen);
                const firstClose = text.indexOf(tClose, Math.max(0, pos - tClose.length));
                
                if (lastOpen !== -1 && firstClose !== -1 && lastOpen < firstClose && pos >= lastOpen && pos <= firstClose + tClose.length) {
                    found = true;
                }

                // 하이퍼링크 확인 (트리거가 아닐 때만)
                if (!found && this.hyperlinkMap.size > 0) {
                    for (const name of this.hyperlinkMap.keys()) {
                        let index = text.indexOf(name);
                        while (index !== -1) {
                            if (pos >= index && pos <= index + name.length) {
                                found = true;
                                break;
                            }
                            index = text.indexOf(name, index + 1);
                        }
                        if (found) break;
                    }
                }
            }
            textarea.style.cursor = found ? 'pointer' : 'text';
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
            const dx = (e.clientX - this.dragState.startX) / this.scale;
            const dy = (e.clientY - this.dragState.startY) / this.scale;
            this.dragState.targets.forEach(t => {
                t.element.style.left = `${t.origLeft + dx}px`;
                t.element.style.top = `${t.origTop + dy}px`;
            });
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
            const dx = (e.clientX - s.startX) / this.scale;
            const dy = (e.clientY - s.startY) / this.scale;
            const dir = s.dir;
            let newW = s.origWidth, newH = s.origHeight;
            let newL = s.origLeft, newT = s.origTop;

            if (dir.includes('e')) { newW = Math.max(360, s.origWidth + dx); }
            if (dir.includes('w')) { newW = Math.max(360, s.origWidth - dx); newL = s.origLeft + (s.origWidth - newW); }
            if (dir.includes('s')) { newH = Math.max(280, s.origHeight + dy); }
            if (dir.includes('n')) { newH = Math.max(280, s.origHeight - dy); newT = s.origTop + (s.origHeight - newH); }

            s.element.style.width = `${newW}px`;
            s.element.style.height = `${newH}px`;
            s.element.style.left = `${newL}px`;
            s.element.style.top = `${newT}px`;
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
        if (this.selectionState && this.selectionState.element) {
            this.selectionState.element.remove();
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

        // 캔버스 상태 리셋
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
    }

    /**
     * 컨텍스트 메뉴 표시
     */
    showContextMenu(x, y, fileId) {
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

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
    }

    /**
     * 컨텍스트 메뉴 숨기기
     */
    hideContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) menu.classList.add('hidden');
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

        const settings = window.toolsPanel?.settings || {};
        const trigger = settings.triggerLocation || '장소:';
        const locations = [];

        let mergedContent = '';
        for (let i = 0; i < fileIds.length; i++) {
            const info = this.windows.get(fileIds[i]);
            if (info) {
                let content = info.textarea.value;
                
                // 장소 추출 및 본문에서 제거
                const lines = content.split('\n');
                let processedLines = [];
                let locationFoundForThisFile = false;

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!locationFoundForThisFile && trimmedLine.startsWith(trigger)) {
                        const loc = trimmedLine.substring(trigger.length).trim();
                        if (loc) locations.push(loc);
                        locationFoundForThisFile = true;
                        continue; // 트리거 줄은 결과 본문에 포함하지 않음
                    }
                    processedLines.push(line);
                }

                content = processedLines.join('\n');

                // 첫 번째 파일인 경우 앞쪽 공백 제거
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
            }
            
            window.showToast?.('이미지가 업로드되었습니다.');
        };
        reader.readAsDataURL(file);
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

        // 수정됨 표시
        const indicator = info.element.querySelector(`[data-indicator="${fileId}"]`);
        if (indicator) indicator.classList.add('show');
    }

    /**
     * 수치 계산기 내부 리사이징 시작
     */
    startStatResizing(e, fileId) {
        e.preventDefault();
        e.stopPropagation();
        const historyEl = document.getElementById(`statHistory_${fileId}`);
        if (!historyEl) return;

        this.statResizeState = {
            fileId,
            startY: e.clientY,
            startHeight: historyEl.offsetHeight
        };
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    }

    onStatResizing(e) {
        if (!this.statResizeState) return;
        const { fileId, startY, startHeight } = this.statResizeState;
        const historyEl = document.getElementById(`statHistory_${fileId}`);
        if (!historyEl) return;

        // 마우스가 위로 올라가면(startY - clientY > 0) 높이가 커짐
        const delta = (startY - e.clientY) / this.scale;
        const newHeight = Math.max(50, Math.min(600, startHeight + delta));
        historyEl.style.height = `${newHeight}px`;
    }

    async stopStatResizing(e) {
        if (!this.statResizeState) return;
        const { fileId } = this.statResizeState;
        const historyEl = document.getElementById(`statHistory_${fileId}`);
        
        if (historyEl) {
            const finalHeight = historyEl.offsetHeight;
            const info = this.windows.get(fileId);
            if (info) {
                let data = JSON.parse(info.file.content || '{}');
                data.historyHeight = finalHeight;
                await this.saveStatData(fileId, data);
            }
        }

        this.statResizeState = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.windowManager = new WindowManager();
