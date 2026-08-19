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
        this.targetEndNodeId = null; // 🎯 지정된 목표 노드 ID

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

        // 노드 레이더 (화면 밖 노드 가이드) 상태
        this.isNodeGuideEnabled = false;

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
            if (this.regionDragState || this.regionResizeState) {
                this.regionDragState = null;
                this.regionResizeState = null;
                this.saveRegions();
            }
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });

        // 캔버스 상단 그래프 실행 제어 미니 팝업 메뉴 이벤트
        const execMenuBtn = document.getElementById('toggleGraphExecMenuBtn');
        const execPopmenu = document.getElementById('graphExecPopmenu');

        if (execMenuBtn && execPopmenu) {
            execMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                execPopmenu.classList.toggle('hidden');
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#graphExecPopmenu') && !e.target.closest('#toggleGraphExecMenuBtn')) {
                    execPopmenu.classList.add('hidden');
                }
            });
        }

        document.getElementById('runAllGraphBtn')?.addEventListener('click', async () => {
            execPopmenu?.classList.add('hidden');
            if (window.nodeEngine) {
                await window.nodeEngine.evaluateAllNodes();
            }
        });

        document.getElementById('runTargetNodeBtn')?.addEventListener('click', async () => {
            execPopmenu?.classList.add('hidden');
            if (window.nodeEngine) {
                const targetId = this.targetEndNodeId || this.activeWindowId;
                await window.nodeEngine.runTargetNode(targetId);
            }
        });

        document.getElementById('stopGraphExecBtn')?.addEventListener('click', () => {
            execPopmenu?.classList.add('hidden');
            if (window.nodeEngine) {
                window.nodeEngine.stopExecution();
            }
        });

        // 단축키 (Ctrl + Enter로 전체 그래프 실행)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('runAllGraphBtn')?.click();
            }
        });

        // 상단 헤더 저장 버튼
        document.getElementById('saveBtn')?.addEventListener('click', () => {
            this.saveActiveWindow();
        });

        // 캔버스 그룹 영역 추가 버튼
        document.getElementById('addCanvasRegionBtn')?.addEventListener('click', () => {
            this.addCanvasRegion();
        });

        // 노드 레이더 (화면 밖 노드 가이드) 토글 버튼
        document.getElementById('toggleNodeGuideBtn')?.addEventListener('click', () => {
            this.toggleNodeGuide();
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
            // 노드 레이더 토글 단축키 (Ctrl+Shift+F)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
                const editorScreen = document.getElementById('editorScreen');
                if (editorScreen && !editorScreen.classList.contains('hidden')) {
                    e.preventDefault();
                    this.toggleNodeGuide();
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
     * 파일의 이모지 아이콘과 텍스트 이름을 분리 정돈
     */
    parseFileIconAndName(file) {
        if (!file) return { icon: '', cleanName: '' };
        
        let rawName = (file.name || '').trim();
        let fileIcon = file.icon;
        
        const emojiRegex = /^([\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}])\s*/u;
        const match = rawName.match(emojiRegex);
        
        let icon = fileIcon;
        let cleanName = rawName;
        
        if (match) {
            icon = fileIcon || match[1];
            cleanName = rawName.replace(emojiRegex, '').trim() || rawName;
        } else {
            if (!icon) {
                if (file.type === 'folder') icon = '📁';
                else if (file.template === 'stat') icon = '📊';
                else if (file.template === 'image' || (file.content && typeof file.content === 'string' && file.content.startsWith('data:image'))) icon = '🖼️';
                else if (file.template === 'aggregator' || file.isAggregatorNode) icon = '🔗';
                else icon = '📄';
            }
        }
        
        return { icon: icon || '📄', cleanName: cleanName || rawName };
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
     * 노드 레이더 (화면 밖 노드 가이드) 토글
     */
    toggleNodeGuide(forceState = null) {
        this.isNodeGuideEnabled = forceState !== null ? forceState : !this.isNodeGuideEnabled;
        const btn = document.getElementById('toggleNodeGuideBtn');
        if (btn) {
            if (this.isNodeGuideEnabled) {
                btn.classList.add('active');
                window.showToast?.('🧭 노드 레이더 ON: 화면 밖 노드 위치가 가장자리에 표시됩니다.', 'info');
            } else {
                btn.classList.remove('active');
                window.showToast?.('🧭 노드 레이더 OFF', 'info');
            }
        }
        this.updateNodeEdgeIndicators();
    }

    /**
     * 특정 노드를 캔버스 화면 중앙으로 이동 (Pan만 수행)
     */
    panToWindow(fileId) {
        const info = this.getWindowInfo(fileId);
        if (!info || !info.element) return;

        const el = info.element;
        const canvasArea = document.getElementById('canvasArea');
        if (!canvasArea) return;

        const areaRect = canvasArea.getBoundingClientRect();
        const w = parseFloat(el.style.width) || el.offsetWidth || 400;
        const h = parseFloat(el.style.height) || el.offsetHeight || 300;
        const nodeX = parseFloat(el.style.left) || 0;
        const nodeY = parseFloat(el.style.top) || 0;

        const nodeCenterX = nodeX + w / 2;
        const nodeCenterY = nodeY + h / 2;
        const scale = this.scale || 1;

        this.panX = areaRect.width / 2 - (nodeCenterX * scale);
        this.panY = areaRect.height / 2 - (nodeCenterY * scale);

        this.applyTransform();
        this.saveProjectCanvasState();
        this.focusWindow(fileId);
    }

    /**
     * 노드 실행 시 시야 포커스 유틸리티
     */
    scrollIntoViewIfNeeded(fileId) {
        try {
            this.panToWindow(fileId);
        } catch (e) {
            console.warn('[WindowManager] scrollIntoViewIfNeeded 실패:', e);
        }
    }

    /**
     * 화면 밖 노드 위치 레이더 (Edge Indicators) 실시간 갱신
     */
    updateNodeEdgeIndicators() {
        const overlay = document.getElementById('nodeGuideOverlay');
        if (!overlay) return;

        if (!this.isNodeGuideEnabled) {
            overlay.innerHTML = '';
            return;
        }

        const canvasArea = document.getElementById('canvasArea');
        if (!canvasArea) return;

        const areaRect = canvasArea.getBoundingClientRect();
        const viewW = areaRect.width;
        const viewH = areaRect.height;
        if (viewW <= 0 || viewH <= 0) return;

        const centerX = viewW / 2;
        const centerY = viewH / 2;
        const PADDING = 45; // 화면 가장자리 여백

        let html = '';

        this.windows.forEach((info, fileId) => {
            const el = info.element;
            if (!el) return;

            const nodeX = parseFloat(el.style.left) || 0;
            const nodeY = parseFloat(el.style.top) || 0;
            const w = parseFloat(el.style.width) || el.offsetWidth || 400;
            const h = parseFloat(el.style.height) || el.offsetHeight || 300;

            // 노드의 화면상 실제 경계
            const screenLeft = nodeX * this.scale + this.panX;
            const screenTop = nodeY * this.scale + this.panY;
            const screenRight = screenLeft + w * this.scale;
            const screenBottom = screenTop + h * this.scale;

            // 노드가 화면 내부에 일정 부분 보이면 스킵
            const isInView = (
                screenRight > 30 &&
                screenLeft < viewW - 30 &&
                screenBottom > 30 &&
                screenTop < viewH - 30
            );

            if (isInView) return;

            // 노드의 화면 중심 좌표
            const nodeScreenCenterX = (nodeX + w / 2) * this.scale + this.panX;
            const nodeScreenCenterY = (nodeY + h / 2) * this.scale + this.panY;

            // 방향 벡터
            const dx = nodeScreenCenterX - centerX;
            const dy = nodeScreenCenterY - centerY;

            // 화면 경계 박스 교점 계산 (Ray-Box intersection)
            const halfW = Math.max(10, viewW / 2 - PADDING);
            const halfH = Math.max(10, viewH / 2 - PADDING);

            const scaleFactor = Math.min(
                halfW / Math.abs(dx || 0.0001),
                halfH / Math.abs(dy || 0.0001)
            );

            const edgeX = centerX + dx * scaleFactor;
            const edgeY = centerY + dy * scaleFactor;

            // 화살표 회전 각도 (도)
            const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

            // 노드 이름 & 아이콘
            const parsed = this.parseFileIconAndName(info.file);
            const iconHtml = parsed.icon ? `<span>${parsed.icon}</span>` : '';

            html += `
                <div class="node-guide-badge" data-file-id="${fileId}" style="left: ${edgeX}px; top: ${edgeY}px;" title="'${this.escapeHtml(parsed.cleanName)}' 노드로 이동">
                    <span class="node-guide-arrow" style="transform: rotate(${angleDeg}deg);">➔</span>
                    ${iconHtml}
                    <span class="node-guide-title">${this.escapeHtml(parsed.cleanName)}</span>
                </div>
            `;
        });

        overlay.innerHTML = html;

        // 클릭 이벤트 바인딩
        overlay.querySelectorAll('.node-guide-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const fileId = badge.dataset.fileId;
                if (fileId) {
                    this.panToWindow(fileId);
                }
            });
        });
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

        // 화면 밖 노드 위치 레이더 갱신
        this.updateNodeEdgeIndicators();
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

        // 프로젝트 내의 모든 노드 파일들 캔버스 복구 (숨김 노드 없음)
        const files = await storage.getProjectFiles(window.currentProjectId);
        const nodeFiles = files.filter(f => f.type === 'file');

        for (const file of nodeFiles) {
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
            
            // 수동 선택 시 노드 위치는 보존하고 카메라(뷰포트)를 해당 노드 쪽으로 이동
            if (isManualOpen) {
                this.panViewportToNode(fileId);
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

        let contentData = file.contentData;
        if (!contentData && typeof file.content === 'string') {
            try {
                contentData = JSON.parse(file.content);
            } catch(e) {
                contentData = {};
            }
        }
        contentData = contentData || {};

        const customDefW = contentData.defaultWidth || file.defaultWidth || file.windowState?.width;
        const customDefH = contentData.defaultHeight || file.defaultHeight || file.windowState?.height;
        const defW = customDefW || 520;
        const defH = customDefH || 650;

        let x, y, width = defW, height = defH;

        const savedState = restoreState || file.windowState;

        // 저장된 x, y 위치 정보가 있다면 100% 저장된 위치 사용
        if (savedState && typeof savedState.x === 'number' && typeof savedState.y === 'number') {
            x = savedState.x;
            y = savedState.y;
            // 사용자가 직접 창을 드래그해서 크기를 바꾼 적이 있는 경우만 savedState 크기 사용, 아니면 정의 시 지정한 기본 크기(defW/defH) 사용
            width = (savedState.isUserResized && savedState.width) ? savedState.width : defW;
            height = (savedState.isUserResized && savedState.height) ? savedState.height : defH;
        } else {
            // 위치 저장이 전혀 없던 신규 노드만 화면 중앙 배치
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
        window.nodeManager?.registerNode(fileId, windowInfo);

        // 파일의 isOpen 상태 업데이트
        if (!restoreState) {
            await this.updateFileWindowState(fileId, { isOpen: true, x, y, width, height });
            // 막 새로 생성된 신규 노드는 카메라(뷰포트)를 해당 노드가 서 있는 위치로 이동하여 즉시 화면에 노출!
            this.panViewportToNode(fileId);
        }

        // 포커스
        this.focusWindow(fileId);

        // 노드 타입별 초기 UI 렌더링 (합산기, 데이터 뷰어, 승인 노드, 분기 노드, 커스텀 노드 등)
        this.refreshNodeUI(fileId);



        // 초기 하이라이트 적용
        this.updateHighlighter(fileId);
        // 이미지 창인 경우 원본 크기 표시
        const isImage = file.template === 'image' || (typeof file.content === 'string' && file.content.startsWith('data:image'));
        if (isImage && file.content) {
            this.updateImageSizeInfo(fileId, file.content);
        }

        this.renderConnections();
        this.updateNodeEdgeIndicators();
    }

    /**
     * 현재 노드의 입력값 및 모든 설정 상태를 그대로 보존하여 노드 템플릿으로 저장
     */
    async saveNodeAsTemplate(fileId) {
        if (window.nodeManager) {
            return await window.nodeManager.saveNodeAsTemplate(fileId);
        }
    }

    /**
     * 캔버스에 이미 꺼내둔 노드의 작성 데이터는 100% 보존하면서,
     * 내부 실행 코드(code), 포트 구성(portsConfig), 위젯 설정을 최신 프리셋으로 스마트 동기화합니다.
     */
    async syncNodeWithLatestPreset(fileId) {
        const file = await storage.getFile(fileId);
        if (!file) return;

        // 1. 시스템 및 커스텀 프리셋 로드
        let systemPresets = [];
        try {
            const res = await fetch('data/default-nodes.json?t=' + Date.now());
            if (res.ok) systemPresets = await res.json();
        } catch (e) {
            console.warn('default-nodes.json 로드 실패:', e);
        }

        let customPresets = [];
        try {
            if (window.storage?.getCustomNodePresets) {
                customPresets = await window.storage.getCustomNodePresets() || [];
            }
        } catch (e) {
            console.warn('custom presets 로드 실패:', e);
        }

        const allPresets = [...systemPresets, ...customPresets];

        // 2. 매칭되는 프리셋 탐색 (presetId -> 이름 유사도)
        const cleanName = (file.name || '').replace(/^[^\w가-힣a-zA-Z0-9]+/, '').trim();
        let targetPreset = allPresets.find(p => p.id && (p.id === file.presetId || p.id === file.contentData?.presetId));
        if (!targetPreset) {
            targetPreset = allPresets.find(p => p.name === file.name || p.name === cleanName || file.name.includes(p.name) || (cleanName && p.name.includes(cleanName)));
        }

        if (!targetPreset) {
            window.showToast?.('이 노드와 일치하는 최신 프리셋을 찾을 수 없습니다. ⚠️');
            return;
        }

        // 3. 기존 사용자가 입력한 값(contentData)은 100% 보존하면서 프리셋 설정 동기화
        let contentObj = file.contentData;
        if (!contentObj && typeof file.content === 'string') {
            try { contentObj = JSON.parse(file.content); } catch(e) { contentObj = {}; }
        }
        contentObj = contentObj || {};

        if (Array.isArray(targetPreset.widgets)) {
            contentObj.widgets = targetPreset.widgets;
        }
        if (targetPreset.defaultWidth) contentObj.defaultWidth = targetPreset.defaultWidth;
        if (targetPreset.defaultHeight) contentObj.defaultHeight = targetPreset.defaultHeight;
        if (targetPreset.color) contentObj.color = targetPreset.color;
        contentObj.presetId = targetPreset.id;

        const updates = {
            presetId: targetPreset.id,
            code: targetPreset.code || '',
            portsConfig: targetPreset.portsConfig || null,
            defaultWidth: targetPreset.defaultWidth || file.defaultWidth || 520,
            defaultHeight: targetPreset.defaultHeight || file.defaultHeight || 650,
            contentData: contentObj,
            content: JSON.stringify(contentObj, null, 2)
        };

        await storage.updateFile(fileId, updates);

        // 4. 노드 UI 즉시 새로고침 (DB 삭제 없이 DOM 창만 안전하게 재생성)
        const winInfo = this.windows.get(fileId);
        if (winInfo && winInfo.element) {
            const currentRect = {
                x: parseInt(winInfo.element.style.left, 10) || 0,
                y: parseInt(winInfo.element.style.top, 10) || 0,
                width: parseInt(winInfo.element.style.width, 10) || targetPreset.defaultWidth || 520,
                height: parseInt(winInfo.element.style.height, 10) || targetPreset.defaultHeight || 650,
                isUserResized: true
            };
            // 🌟 DB 파일 삭제(closeWindow)를 절대 호출하지 않고, 순수 DOM만 안전 교체!
            winInfo.element.remove();
            this.windows.delete(fileId);
            window.nodeManager?.unregisterNode(fileId);
            await this.openWindow(fileId, currentRect);
        }

        window.showToast?.(`'${targetPreset.name}' 노드가 최신 프리셋 코드 및 포트로 동기화되었습니다! ✨`);
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
     * 특정 노드의 🎯 TARGET(End Point) 지정을 해제합니다.
     */
    unsetTargetEndNode() {
        if (this.targetEndNodeId && this.windows.has(this.targetEndNodeId)) {
            const el = this.windows.get(this.targetEndNodeId).element;
            el.classList.remove('target-end-node');
            el.querySelector('.target-end-badge')?.remove();
        }
        this.targetEndNodeId = null;
        window.showToast?.('목표(End Point) 노드 지정이 해제되었습니다. 🚫');
    }

    /**
     * 특정 노드를 🎯 TARGET(End Point) 노드로 지정하거나 토글 해제합니다.
     */
    setTargetEndNode(fileId) {
        const fileIdStr = String(fileId);
        if (this.targetEndNodeId === fileIdStr) {
            this.unsetTargetEndNode();
            return;
        }

        const prevTarget = this.targetEndNodeId;
        this.targetEndNodeId = fileIdStr;

        // 이전 지정 노드 배지 제거
        if (prevTarget && this.windows.has(prevTarget)) {
            const prevEl = this.windows.get(prevTarget).element;
            prevEl.classList.remove('target-end-node');
            prevEl.querySelector('.target-end-badge')?.remove();
        }

        // 신규 지정 노드 배지 부여
        const currInfo = this.windows.get(this.targetEndNodeId);
        if (currInfo && currInfo.element) {
            currInfo.element.classList.add('target-end-node');
            const titlebarLeft = currInfo.element.querySelector('.window-titlebar-left');
            if (titlebarLeft && !titlebarLeft.querySelector('.target-end-badge')) {
                const badge = document.createElement('span');
                badge.className = 'target-end-badge';
                badge.style.cssText = 'font-size:10px; font-weight:800; color:#0f141d; background:#00ffcc; padding:2px 6px; border-radius:4px; margin-left:6px; box-shadow:0 0 8px rgba(0,255,204,0.6);';
                badge.innerText = '🎯 TARGET';
                titlebarLeft.appendChild(badge);
            }
        }
        window.showToast?.(`'${currInfo?.file?.name || '노드'}'가 목표(End Point) 노드로 지정되었습니다. 🎯`);
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
     * 노드의 배치 위치(x, y)는 절대로 건드리지 않고, 카메라(뷰포트 panX, panY)를 해당 노드가 있는 곳으로 이동시킵니다.
     */
    panViewportToNode(fileId) {
        const info = this.windows.get(fileId);
        if (!info || !info.element) return;

        const canvasArea = document.getElementById('canvasArea');
        const areaRect = canvasArea ? canvasArea.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };

        const posX = parseFloat(info.element.style.left) || info.element.offsetLeft;
        const posY = parseFloat(info.element.style.top) || info.element.offsetTop;
        const width = info.element.offsetWidth || 520;
        const height = info.element.offsetHeight || 400;

        // 노드의 캔버스 좌표계 상 중심점
        const nodeCenterX = posX + width / 2;
        const nodeCenterY = posY + height / 2;

        // 노드가 화면 중앙에 오도록 panX, panY 계산 (스케일 반영)
        this.panX = areaRect.width / 2 - (nodeCenterX * this.scale);
        this.panY = areaRect.height / 2 - (nodeCenterY * this.scale);

        // 카메라 트랜스폼 적용 및 세션 상태 저장
        this.applyTransform();
        if (window.currentProjectId && window.storage) {
            window.storage.updateProject(window.currentProjectId, {
                canvasState: { scale: this.scale, panX: this.panX, panY: this.panY }
            });
        }
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

        // 메모리 상의 file 객체들도 즉시 동기화하여 저장소 덮어쓰기 방지
        const info = this.getWindowInfo(fileId);
        if (info) {
            info.file.windowState = newWindowState;
        }
        const treeFile = window.fileTreeManager?.files?.find(f => String(f.id) === String(fileId));
        if (treeFile) {
            treeFile.windowState = newWindowState;
        }
    }

    /**
     * 창 DOM 생성
     */
    createWindowDOM(file, x, y, width, height) {
        let contentData = file.contentData;
        if (!contentData && typeof file.content === 'string') {
            try {
                contentData = JSON.parse(file.content);
            } catch(e) {
                contentData = {};
            }
        }
        contentData = contentData || {};

        const isCollapsed = file.windowState?.isCollapsed || false;
        const norm = window.nodeEngine?.normalizeNodeData(file);
        const nodeType = norm?.nodeType || 'manuscript';
        const isImage = nodeType === 'image';
        
        const win = document.createElement('div');
        win.className = `editor-window${isCollapsed ? ' collapsed' : ''}${isImage ? ' image-window' : ''}`;
        win.dataset.fileId = file.id;
        win.style.left = `${x}px`;
        win.style.top = `${y}px`;
        win.style.width = isCollapsed ? '180px' : `${width}px`;
        win.style.height = isCollapsed ? '50px' : `${height}px`;
        win.style.zIndex = ++this.zIndexCounter;

        // 아이콘 및 이름 정돈
        const parsed = this.parseFileIconAndName(file);
        const iconHtml = parsed.icon ? `<span class="window-titlebar-icon">${parsed.icon}</span>` : '';
        const collapseChar = isCollapsed ? '+' : '−';

        let bodyContent = '';
        if (nodeType === 'image') {
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
        } else if (nodeType === 'manuscript') {
            bodyContent = `
                <div class="window-editor">
                    <div class="window-backdrop"></div>
                    <textarea class="window-textarea" 
                        placeholder="여기에 이야기를 작성하세요..." 
                        spellcheck="false">${this.escapeHtml(file.content || '')}</textarea>
                </div>
            `;
        } else {
            bodyContent = `
                <div class="window-body custom-node-body" style="padding:0; height:calc(100% - 35px); overflow-y:auto; box-sizing:border-box;"></div>
            `;
        }


        const isImageNode = nodeType === 'image';
        const isManuscriptNode = nodeType === 'manuscript';

        const defaultInputs = (isImageNode || isManuscriptNode) ? [] : [{ id: 'in_1', name: '입력 데이터' }];
        const defaultOutputs = isManuscriptNode ? [{ id: 'out_1', name: '원고 결과', color: '#00ffcc' }] : [{ id: 'out_1', name: '출력 데이터', color: '#00ffcc' }];

        const portsConfig = norm?.portsConfig || file.portsConfig || {
            inputs: defaultInputs,
            outputs: defaultOutputs
        };

        const inputsArr = (isImageNode || isManuscriptNode) ? [] : (Array.isArray(portsConfig.inputs) ? portsConfig.inputs : defaultInputs);
        const outputsArr = Array.isArray(portsConfig.outputs) ? portsConfig.outputs : defaultOutputs;

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

        const accentColor = contentData.color || file.color || norm?.color;
        if (accentColor) {
            win.style.boxShadow = `0 4px 20px rgba(0,0,0,0.3), 0 0 12px ${accentColor}44`;
        }

        win.innerHTML = `
            <div class="node-ports-wrapper-left">${inputsHtml}</div>
            <div class="node-ports-wrapper-right">${outputsHtml}</div>
            <div class="window-titlebar" data-file-id="${file.id}" style="${accentColor ? `border-top: 4px solid ${accentColor}; background: linear-gradient(180deg, ${accentColor}25 0%, ${accentColor}08 80%, var(--color-surface-2) 100%);` : ''}">
                <div class="window-titlebar-left">
                    ${iconHtml}
                    <span class="window-titlebar-name">${this.escapeHtml(parsed.cleanName)}</span>
                    ${isImage ? `<span class="window-image-size" id="imageSize_${file.id}"></span>` : ''}
                    <span class="window-modified" data-indicator="${file.id}"></span>
                </div>
                <div class="window-titlebar-actions">
                    <button class="window-btn window-btn-save-template" data-action="save-template" title="⭐ 현재 채워진 입력 상태 그대로 노드 템플릿 저장">⭐</button>
                    <button class="window-btn window-btn-sync-preset" data-action="sync-preset" title="🔄 최신 프리셋으로 코드 및 설정 동기화 (작성 데이터 100% 보존)">🔄</button>
                    ${isImage ? `<button class="window-btn window-btn-rotate" data-action="rotate" title="90도 회전">🔄</button>` : ''}
                    <button class="window-btn window-btn-collapse" data-action="collapse" title="접기/펴기">${collapseChar}</button>
                    <button class="window-btn window-btn-close" data-action="close" title="🗑️ 노드 완전 삭제">✕</button>
                </div>
            </div>
            ${bodyContent}
            ${!isImage ? `
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
        });

        // 버튼 (닫기, 접기, 회전)
        win.querySelectorAll('.window-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'close') this.closeWindow(fileId);
                if (action === 'collapse') this.toggleCollapse(fileId);
                if (action === 'rotate') this.rotateImage(fileId);
                if (action === 'save-template') this.saveNodeAsTemplate(fileId);
                if (action === 'sync-preset') this.syncNodeWithLatestPreset(fileId);
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
     * 마우스 이동 처리 (rAF 고속 동기화 최적화)
     */
    onMouseMove(e) {
        this._lastMouseMoveEvent = e;
        if (!this._isRafPending) {
            this._isRafPending = true;
            requestAnimationFrame(() => {
                this._isRafPending = false;
                if (this._lastMouseMoveEvent) {
                    this._processMouseMove(this._lastMouseMoveEvent);
                }
            });
        }
    }

    _processMouseMove(e) {
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

        // 캔버스 그룹 영역 리사이즈
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

        if (this.dragState) {
            this.dragState.targets.forEach(t => {
                const posX = parseFloat(t.element.style.left);
                const posY = parseFloat(t.element.style.top);
                this.updateFileWindowState(t.id, {
                    x: !isNaN(posX) ? posX : t.element.offsetLeft,
                    y: !isNaN(posY) ? posY : t.element.offsetTop
                });
            });
            this.dragState = null;
            this.renderConnections({ forceRefreshUI: true });
        }

        if (this.resizeState) {
            const win = this.resizeState.element;
            const fileId = this.resizeState.fileId;
            if (win && fileId) {
                const posX = parseFloat(win.style.left);
                const posY = parseFloat(win.style.top);
                const wVal = parseFloat(win.style.width);
                const hVal = parseFloat(win.style.height);
                this.updateFileWindowState(fileId, {
                    x: !isNaN(posX) ? posX : win.offsetLeft,
                    y: !isNaN(posY) ? posY : win.offsetTop,
                    width: !isNaN(wVal) ? wVal : win.offsetWidth,
                    height: !isNaN(hVal) ? hVal : win.offsetHeight,
                    isUserResized: true
                });
            }
            this.resizeState = null;
        }

        // 캔버스 그룹 영역 드래그 & 리사이즈 종료 처리
        if (this.regionDragState) {
            this.regionDragState = null;
            this.saveRegions();
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        if (this.regionResizeState) {
            this.regionResizeState = null;
            this.saveRegions();
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        if (this.panState || this.selectionState) {
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

        const content = info.textarea ? info.textarea.value : (info.file?.content || '');

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
     * 노드 삭제 (닫기 클릭 시 숨기지 않고 노드 완전 삭제)
     */
    async closeWindow(fileId, skipConfirm = false) {
        const info = this.windows.get(fileId);
        const file = info?.file || (window.fileTreeManager?.files || []).find(f => String(f.id) === String(fileId)) || { id: fileId, name: '이 노드' };
        const fileName = file.name || '이 노드';

        if (skipConfirm || confirm(`'${fileName}' 노드를 완전히 삭제할까요?\n연결된 핀과 데이터도 함께 제거됩니다.`)) {
            // DOM 창 제거
            if (info && info.element) {
                info.element.remove();
            }
            this.windows.delete(fileId);
            window.nodeManager?.unregisterNode(fileId);
            this.selectedWindowIds.delete(fileId);

            // 연결선 및 캐시 상태 파괴
            await this.destroyNodeState(fileId);

            // DB에서 파일 완전 삭제
            await storage.deleteFile(fileId);

            // 파일 트리 새로고침
            if (window.fileTreeManager) {
                if (window.fileTreeManager.currentFileId === fileId) {
                    window.fileTreeManager.currentFileId = null;
                }
                await window.fileTreeManager.loadProjectFiles(window.fileTreeManager.currentProjectId || window.currentProjectId);
            }
            window.showToast?.(`'${fileName}' 노드가 삭제되었습니다. 🗑️`);
        }
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

        let textStr = '';
        if (typeof content === 'string') {
            textStr = content;
        } else if (typeof content === 'object' && content !== null) {
            textStr = content.editorVal || content.content || content.text || content.val || '';
        } else {
            textStr = String(content || '');
        }

        const total = textStr.length;
        const noSpace = textStr.replace(/\s/g, '').length;

        // 문장: . ! ? 기준으로 분리 (다중 구두점 고려)
        const sentences = textStr.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

        // 단락: 줄바꿈 기준
        const paragraphs = textStr.split(/\n+/).filter(p => p.trim().length > 0).length;

        const totalEl = statsEl.querySelector('.total');
        const noSpaceEl = statsEl.querySelector('.nospace');
        const sentencesEl = statsEl.querySelector('.sentences');
        const paragraphsEl = statsEl.querySelector('.paragraphs');

        if (totalEl) totalEl.textContent = `${total.toLocaleString()}자`;
        if (noSpaceEl) noSpaceEl.textContent = `(공백제외 ${noSpace.toLocaleString()})`;
        if (sentencesEl) sentencesEl.textContent = `${sentences.toLocaleString()}문장`;
        if (paragraphsEl) paragraphsEl.textContent = `${paragraphs.toLocaleString()}단락`;
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
        const isImage = info && (info.file.template === 'image' || (typeof info.file.content === 'string' && info.file.content.startsWith('data:image')));
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
            const isTarget = this.targetEndNodeId === String(fileId);
            menuHtml += `
                <div class="context-menu-item" data-action="target-set" style="color:${isTarget ? '#e74c3c' : '#00ffcc'}; font-weight:bold;">
                    <span class="context-menu-icon">${isTarget ? '🚫' : '🎯'}</span>
                    <span>${isTarget ? '목표(End) 지정 해제' : '이 노드를 목표(End)로 지정'}</span>
                </div>
                <div class="context-menu-item" data-action="target-run" style="color:#2ecc71; font-weight:bold;">
                    <span class="context-menu-icon">▶️</span>
                    <span>이 노드를 목표(End)로 즉시 실행</span>
                </div>
                <div class="context-menu-item" data-action="edit-node-info">
                    <span class="context-menu-icon">✏️</span>
                    <span>노드 정보 수정 (이름/설명)...</span>
                </div>
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
        const targetSetBtn = menu.querySelector('[data-action="target-set"]');
        targetSetBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideContextMenu();
            this.setTargetEndNode(fileId);
        });

        const targetRunBtn = menu.querySelector('[data-action="target-run"]');
        targetRunBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            this.hideContextMenu();
            this.setTargetEndNode(fileId);
            if (window.nodeEngine) {
                await window.nodeEngine.runTargetNode(fileId);
            }
        });

        const editInfoBtn = menu.querySelector('[data-action="edit-node-info"]');
        editInfoBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditNodeInfoModal(fileId);
            this.hideContextMenu();
        });

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
        if (window.nodeManager) {
            return await window.nodeManager.duplicateNode(fileId);
        }
    }

    /**
     * 파일 ID로부터 파일 객체 안전하게 조회
     */
    async _getFile(fileId) {
        if (!fileId) return null;
        const winInfo = this.windows.get(fileId);
        if (winInfo && winInfo.file) return winInfo.file;
        if (window.fileTreeManager?.files) {
            const found = window.fileTreeManager.files.find(f => String(f.id) === String(fileId));
            if (found) return found;
        }
        if (window.nodeEngine?._getFile) {
            const found = window.nodeEngine._getFile(fileId);
            if (found) return found;
        }
        if (window.storage?.getFile) {
            return await window.storage.getFile(fileId);
        }
        return null;
    }

    /**
     * 노드 기본 정보(이름, 상세 설명) 수정 모달
     */
    async showEditNodeInfoModal(fileId) {
        const file = await this._getFile(fileId);
        if (!file) {
            window.showToast?.('노드 정보를 찾을 수 없습니다.', 'warning');
            return;
        }

        const existingModal = document.getElementById('editNodeInfoModal');
        if (existingModal) existingModal.remove();

        const parsed = this.parseFileIconAndName(file);
        let contentData = {};
        if (typeof file.content === 'string') {
            try { contentData = JSON.parse(file.content); } catch (e) { contentData = {}; }
        } else if (typeof file.content === 'object' && file.content) {
            contentData = file.content;
        }

        const currentColor = file.color || contentData.color || '#8b5cf6';
        const currentDesc = file.description || contentData.description || '';

        const hasImage = file.template === 'image' || (typeof file.content === 'string' && file.content.startsWith('data:image')) || contentData.image_val || (Array.isArray(contentData.widgets) && contentData.widgets.some(w => w.type === 'image_canvas'));
        let currentImage = (file.template === 'image' && typeof file.content === 'string' && file.content.startsWith('data:image')) ? file.content : (contentData.image_val || '');

        let imageFieldHtml = '';
        if (hasImage) {
            imageFieldHtml = `
                <div style="border: 1px dashed var(--color-border, #313244); border-radius: 8px; padding: 10px; background: rgba(0,0,0,0.15);">
                    <label style="font-size: 11px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 6px;">🖼️ 노드 이미지 / 썸네일</label>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div id="editNodeImagePreview" style="width: 52px; height: 52px; border-radius: 6px; border: 1px solid var(--color-border); background: #111; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
                            ${currentImage ? `<img src="${currentImage}" style="width: 100%; height: 100%; object-fit: cover;">` : `<span style="font-size: 20px; color: var(--color-text-tertiary);">🖼️</span>`}
                        </div>
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                            <input id="editNodeImageFileInput" type="file" accept="image/*" style="font-size: 11px; color: var(--color-text-secondary);">
                            ${currentImage ? `<button type="button" id="editNodeImageRemoveBtn" style="align-self: flex-start; background: transparent; border: none; font-size: 11px; color: var(--color-accent-danger, #f38ba8); cursor: pointer; padding: 0;">이미지 삭제</button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        const overlay = document.createElement('div');
        overlay.id = 'editNodeInfoModal';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
        `;

        overlay.innerHTML = `
            <div style="background: var(--color-surface-1, #1e1e2e); border: 1px solid var(--color-border, #313244); border-radius: 12px; padding: 22px; width: 440px; max-width: 92vw; box-shadow: 0 16px 36px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 14px; color: var(--color-text-primary, #cdd6f4);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border, #313244); padding-bottom: 10px;">
                    <div style="font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span>✏️ 노드 정보 수정</span>
                    </div>
                    <button id="closeEditNodeInfoBtn" style="background: transparent; border: none; font-size: 16px; color: var(--color-text-tertiary); cursor: pointer;">✕</button>
                </div>

                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 11px; font-weight: 700; color: var(--color-text-secondary); display: block;">노드 이름</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 18px; padding: 4px 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--color-border); border-radius: 6px; flex-shrink: 0;" title="노드 기본 아이콘">${this.escapeHtml(parsed.icon)}</span>
                        <input id="editNodeNameInput" type="text" class="input" value="${this.escapeHtml(parsed.cleanName)}" placeholder="노드 이름을 입력하세요" style="flex: 1; font-size: 13px; font-weight: 600; height: 34px;">
                    </div>
                </div>

                ${imageFieldHtml}

                <div>
                    <label style="font-size: 11px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 4px;">노드 상세 설명 / 메모 (선택)</label>
                    <textarea id="editNodeDescInput" class="input" rows="4" placeholder="해당 노드의 역할이나 설명, 메모를 입력하세요..." style="width: 100%; font-size: 12px; line-height: 1.6; resize: vertical;">${this.escapeHtml(currentDesc)}</textarea>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
                    <button id="cancelEditNodeInfoBtn" class="btn btn-secondary" style="padding: 6px 14px; font-size: 12px;">취소</button>
                    <button id="saveEditNodeInfoBtn" class="btn btn-primary" style="padding: 6px 16px; font-size: 12px; font-weight: 600;">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const nameInp = overlay.querySelector('#editNodeNameInput');
        const descInp = overlay.querySelector('#editNodeDescInput');
        const imageFileInput = overlay.querySelector('#editNodeImageFileInput');
        const imagePreview = overlay.querySelector('#editNodeImagePreview');
        const imageRemoveBtn = overlay.querySelector('#editNodeImageRemoveBtn');

        let updatedImageData = currentImage;

        imageFileInput?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    updatedImageData = evt.target.result;
                    if (imagePreview) {
                        imagePreview.innerHTML = `<img src="${updatedImageData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    }
                };
                reader.readAsDataURL(f);
            }
        });

        imageRemoveBtn?.addEventListener('click', () => {
            updatedImageData = '';
            if (imagePreview) {
                imagePreview.innerHTML = `<span style="font-size: 20px; color: var(--color-text-tertiary);">🖼️</span>`;
            }
            if (imageFileInput) imageFileInput.value = '';
        });

        nameInp?.focus();
        nameInp?.select();

        const closeModal = () => overlay.remove();
        overlay.querySelector('#closeEditNodeInfoBtn')?.addEventListener('click', closeModal);
        overlay.querySelector('#cancelEditNodeInfoBtn')?.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        const saveInfo = async () => {
            const newCleanName = (nameInp?.value || '').trim() || parsed.cleanName || '이름 없음 노드';
            const nodeIcon = parsed.icon || '';
            const newFullName = nodeIcon ? `${nodeIcon} ${newCleanName}` : newCleanName;
            const newDesc = (descInp?.value || '').trim();

            // 1. 파일 객체 데이터 갱신
            file.name = newFullName;
            file.description = newDesc;

            // contentData 내 설명/이미지 동기화
            contentData.description = newDesc;
            if (hasImage) {
                contentData.image_val = updatedImageData;
                if (Array.isArray(contentData.widgets)) {
                    contentData.widgets.forEach(w => {
                        if (w.type === 'image_canvas') contentData[w.key] = updatedImageData;
                    });
                }
                if (file.template === 'image' || (typeof file.content === 'string' && file.content.startsWith('data:image'))) {
                    file.content = updatedImageData;
                } else {
                    file.content = typeof file.content === 'string' ? JSON.stringify(contentData, null, 2) : contentData;
                }
            } else {
                file.content = typeof file.content === 'string' ? JSON.stringify(contentData, null, 2) : contentData;
            }

            // 2. 스토리지 저장
            await window.storage?.updateFile?.(fileId, {
                name: newFullName,
                description: newDesc,
                content: file.content
            });

            // 3. 열려있는 윈도우 UI(타이틀바 및 이미지 뷰어) 즉각 갱신
            const info = this.getWindowInfo(fileId);
            if (info && info.element) {
                const titleNameEl = info.element.querySelector('.window-titlebar-name');
                const titleIconEl = info.element.querySelector('.window-titlebar-icon');

                if (titleNameEl) titleNameEl.textContent = newCleanName;
                if (titleIconEl && newIcon) titleIconEl.textContent = newIcon;
                else if (titleIconEl && !newIcon) titleIconEl.textContent = '';

                if (titleBar && newColor) {
                    titleBar.style.borderTop = `4px solid ${newColor}`;
                    titleBar.style.background = `linear-gradient(180deg, ${newColor}25 0%, ${newColor}08 80%, var(--color-surface-2) 100%)`;
                    info.element.style.boxShadow = `0 4px 20px rgba(0,0,0,0.3), 0 0 12px ${newColor}44`;
                }

                // 이미지 뷰어 엘리먼트가 열려있다면 즉시 이미지 갱신
                const imgEl = info.element.querySelector(`#imageViewer_${fileId}`) || info.element.querySelector('.image-viewer-content img');
                if (imgEl && updatedImageData) {
                    imgEl.src = updatedImageData;
                }
            }

            // 4. 좌측 파일 트리 갱신
            if (window.fileTreeManager) {
                await window.fileTreeManager.loadProjectFiles?.(window.fileTreeManager.currentProjectId || window.currentProjectId);
            }

            // 5. 연쇄 이벤트 통보
            await this.notifyNodeChanged(fileId, 'nameChange');

            closeModal();
            window.showToast?.(`'${newCleanName}' 노드 정보가 수정되었습니다. ✏️`, 'success');
        };

        overlay.querySelector('#saveEditNodeInfoBtn')?.addEventListener('click', saveInfo);
        nameInp?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveInfo();
            if (e.key === 'Escape') closeModal();
        });
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

    // ─────────────────────────────────────────────
    // 전역 노드 라이프사이클 및 이벤트 브로드캐스터
    // ─────────────────────────────────────────────

    /**
     * 사용자 승인 노드 (Approval Gate Node) UI 렌더링
     */




    /**
     * 특정 노드의 UI를 타입에 구애받지 않고 자동으로 판단하여 갱신합니다.
     */
    /**
     * 특정 노드의 UI를 단일 노드 스키마(normalizeNodeData)로 렌더링합니다.
     */
    refreshNodeUI(fileId) {
        const info = this.getWindowInfo(fileId);
        if (!info || !info.file) return;

        this.renderCustomNode(fileId);
    }

    /**
     * 캔버스에 열려있는 모든 노드의 UI를 일괄 재렌더링합니다.
     */
    refreshAllNodesUI() {
        this.windows.forEach((_, fileId) => {
            this.refreshNodeUI(fileId);
        });
    }

    /**
     * 노드 상태 변경 (이름 변경, 내용 수정, 핀 연결/해제 등) 발생 시
     * 해당 노드와 하위 연관 노드들에게 상태 변경을 연쇄 통보(Cascade Propagation)합니다.
     */
    async notifyNodeChanged(sourceFileId, eventType = 'contentChange') {
        const fileIdStr = String(sourceFileId);

        // 1) 변경된 노드의 캐시 무효화
        if (window.nodeEngine) {
            window.nodeEngine.clearNodeCache(fileIdStr);

            // 2) 하위(Downstream) 연결 노드의 캐시도 무효화
            const downstreamIds = window.nodeEngine.getDownstreamNodeIds(fileIdStr);
            downstreamIds.forEach(dId => window.nodeEngine.clearNodeCache(dId));

            // 3) '⚡ 실시간 연산' 스위치가 켜져 있다면 하위 노드로 자동 전파 실행!
            const isAutoRun = document.getElementById('autoRunToggleSwitch')?.checked ?? false;
            if (isAutoRun && downstreamIds.length > 0) {
                downstreamIds.forEach(dId => window.nodeEngine.runNode(dId));
            }
        }

        // 4) 연결선 다시 그리기
        this.renderConnections();

        // 5) 캔버스 UI 일괄 갱신 (구조적 변경인 connectionChange/delete 등일 때만 전체 UI 갱신)
        if (eventType !== 'outputChange' && eventType !== 'contentChange') {
            this.refreshAllNodesUI();
        }
    }

    /**
     * 특정 노드가 완전 삭제되거나 파괴될 때 일괄 세션 및 연결 정리 (Cascade Cleanup)
     */
    async destroyNodeState(fileId) {
        if (!fileId) return;
        const fileIdStr = String(fileId);

        // 1) 핀 연결선 일괄 정리
        if (Array.isArray(this.nodeConnections)) {
            const initialLen = this.nodeConnections.length;
            this.nodeConnections = this.nodeConnections.filter(c => String(c.fromId) !== fileIdStr && String(c.toId) !== fileIdStr);
            if (this.nodeConnections.length !== initialLen) {
                await this.saveConnections();
            }
        }

        // 2) 캐시 정리 및 하위 전파
        await this.notifyNodeChanged(fileIdStr, 'delete');
    }

    /**
     * 커스텀 정의 노드의 UI를 렌더링합니다.
     * (수치/텍스트 입력 항목 + 동작 코드 실행/보기 + Output 결과)
     */
    /**
     * 포커스가 맞춰져 있거나 이미 DOM이 생성된 상태에서 DOM 재생성 없이 위젯 값만 선택적(In-place)으로 갱신합니다.
     */
    _updateViewerElementsOnly(container, file) {
        const norm = window.nodeEngine?.normalizeNodeData(file);
        const { contentData, widgets } = norm || {};
        (widgets || []).forEach(w => {
            window.widgetManager?.updateWidgetValueInPlace(container, w, contentData, file?.id);
        });
    }

    /**
     * 조립된 UI 위젯 목록(widgets)을 기반으로 노드 윈도우 UI를 통합 렌더링합니다.
     */
    async renderCustomNode(fileId) {
        const info = this.getWindowInfo(fileId);
        if (!info || !info.file) return;

        const container = info.element.querySelector('.custom-node-body') || info.element.querySelector('.window-body');
        if (!container) return;

        const norm = window.nodeEngine?.normalizeNodeData(info.file);
        const { contentData, widgets } = norm || {};

        // 🌟 1) 이미 DOM 구성이 완료되어 있는 노드인 경우 (단순 값/데이터 업데이트 시)
        // DOM 파괴/재생성(innerHTML) 없이 변경된 데이터 값만 선택적 차분 갱신(In-Place Update)하여 성능 최적화!
        const existingWrapper = container.querySelector('.custom-node-widgets-wrapper');
        if (existingWrapper) {
            this._updateViewerElementsOnly(container, info.file);
            return;
        }

        // 🌟 2) 최초 렌더링 시에만 HTML 구조 조립 및 DOM 배치
        const onUpdate = (updatedContentData) => {
            info.file.content = JSON.stringify(updatedContentData, null, 2);
            window.storage?.updateFile(fileId, { content: info.file.content });
            this.notifyNodeChanged(fileId, 'outputChange');
        };

        let widgetsHtml = (widgets || []).map(w => window.widgetManager ? window.widgetManager.renderWidget(w, contentData, fileId) : '').join('');

        if (!widgetsHtml) {
            widgetsHtml = `<div style="font-size: 11px; color: var(--color-text-tertiary); text-align: center; padding: 12px;">등록된 UI 위젯이 없습니다.</div>`;
        }

        container.innerHTML = `
            <div class="custom-node-widgets-wrapper" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: 100%;">
                ${widgetsHtml}
            </div>
        `;

        // 위젯 전용 이벤트 바인딩 (widgetManager로 위임)
        (widgets || []).forEach(w => {
            window.widgetManager?.bindWidgetEvents(container, w, contentData, onUpdate, fileId);
        });

        // 환경 설정 에디터 스타일 적용
        if (typeof window.toolsPanel?.applySettings === 'function' && window.toolsPanel?.currentSettings) {
            window.toolsPanel.applySettings(window.toolsPanel.currentSettings);
        }
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

        container.querySelectorAll('.canvas-region-box').forEach(el => {
            if (el && el.parentNode) {
                el.remove();
            }
        });

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

                let isFinished = false;
                const finishRename = () => {
                    if (isFinished) return;
                    isFinished = true;
                    const newTitle = input.value.trim() || '이름 없음 영역';
                    r.title = newTitle;
                    this.renderCanvasRegions();
                    this.saveRegions();
                };

                input.addEventListener('blur', finishRename, { once: true });
                input.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        finishRename();
                    } else if (evt.key === 'Escape') {
                        evt.preventDefault();
                        isFinished = true;
                        this.renderCanvasRegions();
                    }
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
                document.body.style.cursor = 'move';
                document.body.style.userSelect = 'none';
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
                    document.body.style.userSelect = 'none';
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

        // 모든 노드의 입력 핀에 대해 다중 연결선을 허용하되, 완전히 동일한 핀 간 중복 선만 방지
        const isExactDuplicate = this.nodeConnections.some(c =>
            String(c.fromId) === String(outputId) && c.fromPortId === outPortId &&
            String(c.toId) === String(inputId) && c.toPortId === inPortId
        );

        if (isExactDuplicate) {
            window.showToast?.('이미 동일하게 연결된 포트 핀선입니다. 🔗', 'warning');
            return;
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
        window.showToast?.('노드 포트 핀이 연결되었습니다! 🔗', 'success');

        // 중앙 이벤트 통보 시스템을 통해 상위/하위 연관 노드 및 UI 연쇄 자동 새로고침!
        this.notifyNodeChanged(outputId, 'connectionChange');
        this.notifyNodeChanged(inputId, 'connectionChange');

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
            const deletedConn = this.nodeConnections[idx];
            this.nodeConnections.splice(idx, 1);
            if (this.selectedConnectionId === connId) {
                this.selectedConnectionId = null;
            }
            this.saveConnections();
            window.showToast?.('연결선이 삭제되었습니다.');

            // 중앙 이벤트 통보 시스템을 통해 연쇄 자동 새로고침!
            this.notifyNodeChanged(deletedConn.fromId, 'connectionChange');
            this.notifyNodeChanged(deletedConn.toId, 'connectionChange');
        }
    }

    /**
     * 특정 노드가 삭제될 때 연결되어 있던 모든 핀 연결선 제거
     */
    async removeConnectionsForFile(fileId) {
        if (!Array.isArray(this.nodeConnections)) return;
        const targetIdStr = String(fileId);
        const originalLength = this.nodeConnections.length;

        this.nodeConnections = this.nodeConnections.filter(c => String(c.fromId) !== targetIdStr && String(c.toId) !== targetIdStr);

        if (this.nodeConnections.length !== originalLength) {
            this.renderConnections();
            await this.saveConnections();
            
            this.refreshAllNodesUI();
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
    /**
     * 노드 간 연결선 SVG 렌더링 (In-place DOM 최적화 & rAF 고속 연산)
     */
    renderConnections(options = {}) {
        const svg = document.getElementById('nodeConnectionsSvg');
        const container = document.getElementById('canvasContainer');
        if (!svg || !container) return;

        if (container.firstChild !== svg) {
            container.insertBefore(svg, container.firstChild);
        }

        if (!Array.isArray(this.nodeConnections)) this.nodeConnections = [];

        const activeConnIds = new Set(this.nodeConnections.map(c => String(c.id)));

        // 1) 삭제된 연결선 엘리먼트만 선별 제거
        const existingLines = svg.querySelectorAll('.node-connection-line');
        existingLines.forEach(l => {
            if (!activeConnIds.has(l.dataset.connId)) {
                l.remove();
            }
        });

        // 2) 연결선 좌표 속성만 갱신 (In-place DOM Reuse)
        this.nodeConnections.forEach(conn => {
            const fromWin = this.getWindowInfo(conn.fromId);
            const toWin = this.getWindowInfo(conn.toId);
            if (!fromWin || !toWin) return;
            const start = this.getPortCoordinates(conn.fromId, conn.fromPort, conn.fromPortId);
            const end = this.getPortCoordinates(conn.toId, conn.toPort, conn.toPortId);

            if (!start || !end) return;

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

            let pathEl = svg.querySelector(`.node-connection-line[data-conn-id="${conn.id}"]`);
            if (pathEl) {
                pathEl.setAttribute('d', pathD);
                pathEl.setAttribute('class', `node-connection-line${isSelected ? ' selected' : ''}`);
                pathEl.setAttribute('stroke', isSelected ? '#ffcc00' : strokeColor);
                pathEl.setAttribute('stroke-width', isSelected ? '5' : '4');
                pathEl.setAttribute('marker-end', isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
            } else {
                pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
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
            }
        });

        // 3) 캔버스 노드들의 UI 연결 갱신은 드래그 중에는 생략하고 명시적 요청 시에만 실행
        if (options.forceRefreshUI) {
            this.windows.forEach((info, fId) => {
                this.refreshNodeUI(fId);
            });
        }
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

        if (container.contains(document.activeElement)) return;

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

        if (container.contains(document.activeElement)) return;

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
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.windowManager = new WindowManager();
