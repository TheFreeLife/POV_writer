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
        this.dragState = null;
        this.resizeState = null;
        this.autoSaveTimers = new Map();

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
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));

        // 상단 헤더 저장 버튼
        document.getElementById('saveBtn')?.addEventListener('click', () => {
            this.saveActiveWindow();
        });

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

        // 캔버스 배경 클릭 시 모든 포커스 해제
        canvasArea.addEventListener('mousedown', (e) => {
            if (e.target === canvasArea || e.target === container) {
                if (e.button === 0) { // 좌클릭
                    this.unfocusAll();
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
        // 이미 열린 경우 포커스
        if (this.windows.has(fileId)) {
            this.focusWindow(fileId);
            return;
        }

        // 파일 로드
        const file = await storage.getFile(fileId);
        if (!file || file.type === 'folder') return;

        // 창 위치 계산
        const container = document.getElementById('canvasContainer');
        const canvasArea = document.getElementById('canvasArea');
        if (!container) return;

        let x, y, width = 520, height = 400;

        // 저장된 상태가 있거나 파일 객체에 저장된 위치 정보가 있는 경우 사용
        const state = restoreState || file.windowState;

        if (state && typeof state.x === 'number') {
            x = state.x;
            y = state.y;
            width = state.width || 520;
            height = state.height || 400;
        } else {
            const areaRect = canvasArea ? canvasArea.getBoundingClientRect() : { width: 800, height: 600 };
            const viewCenterX = (areaRect.width / 2 - this.panX) / this.scale;
            const viewCenterY = (areaRect.height / 2 - this.panY) / this.scale;

            const offsetStep = 32;
            x = viewCenterX - 260 + (this.cascadeOffset * offsetStep) % 200;
            y = viewCenterY - 200 + (this.cascadeOffset * offsetStep) % 150;
            this.cascadeOffset++;
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

        // 초기 하이라이트 적용
        this.updateHighlighter(fileId);
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
        const win = document.createElement('div');
        win.className = 'editor-window';
        win.dataset.fileId = file.id;
        win.style.left = `${x}px`;
        win.style.top = `${y}px`;
        win.style.width = `${width}px`;
        win.style.height = `${height}px`;
        win.style.zIndex = ++this.zIndexCounter;

        // 아이콘 결정
        const icon = file.icon || (file.template ? this.getTemplateIcon(file.template) : '📄');

        win.innerHTML = `
            <div class="window-titlebar" data-file-id="${file.id}">
                <div class="window-titlebar-left">
                    <span class="window-titlebar-icon">${icon}</span>
                    <span class="window-titlebar-name">${this.escapeHtml(file.name)}</span>
                    <span class="window-modified" data-indicator="${file.id}"></span>
                </div>
                <div class="window-titlebar-actions">
                    <button class="window-btn window-btn-maximize" data-action="maximize" title="최대화">□</button>
                    <button class="window-btn window-btn-close" data-action="close" title="닫기">✕</button>
                </div>
            </div>
            <div class="window-editor">
                <div class="window-backdrop"></div>
                <textarea class="window-textarea" 
                    placeholder="여기에 이야기를 작성하세요..." 
                    spellcheck="false">${this.escapeHtml(file.content || '')}</textarea>
            </div>
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
                const settings = window.toolsPanel.loadSettings();
                this.applySettingsToWindow(win, settings);
            }
        }, 0);

        // 이벤트 바인딩
        this.bindWindowEvents(win, file.id);

        // 초기 글자수 업데이트
        this.updateCharCount(file.id, file.content || '', win);

        return win;
    }

    applySettingsToWindow(win, s) {
        const textarea = win.querySelector('.window-textarea');
        const backdrop = win.querySelector('.window-backdrop');
        if (!textarea) return;

        [textarea, backdrop].forEach(el => {
            if (!el) return;
            el.style.fontFamily = s.fontFamily;
            el.style.fontSize = s.fontSize + 'px';
            el.style.lineHeight = s.lineHeight;
            el.style.letterSpacing = s.letterSpacing + 'px';
        });
    }

    /**
     * 하이라이터 업데이트 (다이얼로그/생각 강조)
     */
    updateHighlighter(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.backdrop) return;

        const text = info.textarea.value;
        const highlighted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"([^"]*)"/g, '<span class="hl-dialogue">"$1"</span>')
            .replace(/'([^']*)'/g, '<span class="hl-thought">\'$1\'</span>')
            .replace(/\(([^)]*)\)/g, '<span class="hl-thought">($1)</span>')
            .replace(/\n/g, '<br>');

        info.backdrop.innerHTML = highlighted + (text.endsWith('\n') ? '<br>' : '');

        // 스크롤 동기화
        info.backdrop.scrollTop = info.textarea.scrollTop;
    }

    /**
     * 창 이벤트 바인딩
     */
    bindWindowEvents(win, fileId) {
        // 포커스 (클릭 시)
        win.addEventListener('mousedown', () => this.focusWindow(fileId));

        // 타이틀 바 드래그
        const titlebar = win.querySelector('.window-titlebar');
        titlebar.addEventListener('mousedown', (e) => {
            if (e.target.closest('.window-btn')) return;
            e.preventDefault();
            const rect = win.getBoundingClientRect();
            const containerRect = win.parentElement.getBoundingClientRect();
            this.dragState = {
                fileId,
                element: win,
                startX: e.clientX,
                startY: e.clientY,
                origLeft: win.offsetLeft,
                origTop: win.offsetTop
            };
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';

            // 드래그 종료 시 위치 저장
            window.addEventListener('mouseup', () => {
                if (this.dragState && this.dragState.fileId === fileId) {
                    this.updateFileWindowState(fileId, {
                        x: win.offsetLeft,
                        y: win.offsetTop
                    });
                }
            }, { once: true });
        });

        // 버튼 (닫기, 최대화)
        win.querySelectorAll('.window-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'close') this.closeWindow(fileId);
                if (action === 'maximize') this.toggleMaximize(fileId);
            });
        });

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

        // 텍스트 편집
        const textarea = win.querySelector('.window-textarea');
        textarea.addEventListener('input', () => {
            this.onTextChange(fileId, textarea.value);
            this.updateHighlighter(fileId);
        });

        textarea.addEventListener('scroll', () => {
            this.updateHighlighter(fileId);
        });

        // 텍스트 영역에서 드래그 방지 및 포커스 처리
        textarea.addEventListener('mousedown', (e) => {
            this.focusWindow(fileId);
            e.stopPropagation();
        });

        textarea.addEventListener('focus', () => {
            this.focusWindow(fileId);
        });
    }

    /**
     * 마우스 이동 처리
     */
    onMouseMove(e) {
        // 드래그
        if (this.dragState) {
            const dx = (e.clientX - this.dragState.startX) / this.scale;
            const dy = (e.clientY - this.dragState.startY) / this.scale;
            this.dragState.element.style.left = `${this.dragState.origLeft + dx}px`;
            this.dragState.element.style.top = `${this.dragState.origTop + dy}px`;
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
            // 팬 이동 시 상태 저장 (디바운스 고려 가능하지만 일단 즉시 저장)
            this.saveProjectCanvasState();
        }
    }

    /**
     * 마우스 놓기 처리
     */
    onMouseUp(e) {
        if (this.dragState || this.resizeState || this.panState) {
            this.dragState = null;
            this.resizeState = null;
            this.panState = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }

    /**
     * 창 포커스
     */
    focusWindow(fileId) {
        // 이전 포커스 제거
        this.windows.forEach((info) => {
            info.element.classList.remove('focused');
        });

        const info = this.windows.get(fileId);
        if (!info) return;

        info.element.style.zIndex = ++this.zIndexCounter;
        info.element.classList.add('focused');
        this.activeWindowId = fileId;

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
        const settings = window.toolsPanel?.loadSettings();
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
            const settings = window.toolsPanel?.settings || window.toolsPanel?.loadSettings();
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

        // 다른 창으로 포커스 이동
        if (this.activeWindowId === fileId) {
            this.activeWindowId = null;
            const remaining = Array.from(this.windows.keys());
            if (remaining.length > 0) {
                this.focusWindow(remaining[remaining.length - 1]);
            }
        }

        // 통계 업데이트
        window.toolsPanel?.updateStats();
    }

    /**
     * 최대화/복원 토글
     */
    toggleMaximize(fileId) {
        const info = this.windows.get(fileId);
        if (!info) return;

        const el = info.element;
        if (el.dataset.maximized === 'true') {
            // 복원
            el.style.left = el.dataset.prevLeft;
            el.style.top = el.dataset.prevTop;
            el.style.width = el.dataset.prevWidth;
            el.style.height = el.dataset.prevHeight;
            el.dataset.maximized = 'false';
        } else {
            // 최대화
            el.dataset.prevLeft = el.style.left;
            el.dataset.prevTop = el.style.top;
            el.dataset.prevWidth = el.style.width;
            el.dataset.prevHeight = el.style.height;
            el.style.left = '8px';
            el.style.top = '8px';

            const container = document.getElementById('canvasContainer');
            if (container) {
                el.style.width = `${container.clientWidth - 16}px`;
                el.style.height = `${container.clientHeight - 16}px`;
            }
            el.dataset.maximized = 'true';
        }
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
     * 현재 활성 창의 텍스트 반환 (통계 등에서 사용)
     */
    getActiveText() {
        if (!this.activeWindowId) return '';
        const info = this.windows.get(this.activeWindowId);
        return info ? info.textarea.value : '';
    }

    getTemplateIcon(template) {
        const icons = { item: '📦', place: '🗺️', character: '👤' };
        return icons[template] || '📄';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.windowManager = new WindowManager();
