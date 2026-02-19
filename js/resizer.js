/**
 * 리사이저 및 사이드바 토글 관리
 */

class ResizerManager {
    constructor() {
        this.isResizing = false;
        this.currentResizer = null;
        this.init();
    }

    init() {
        this.setupFileTreeResizer();
        this.setupToolsPanelResizer();
        this.setupSidebarToggles();
    }

    setupFileTreeResizer() {
        const resizer = document.getElementById('fileTreeResizer');
        const leftPanel = document.getElementById('fileTreePanel');

        if (!resizer || !leftPanel) return;

        resizer.addEventListener('mousedown', (e) => {
            if (leftPanel.classList.contains('collapsed')) return;
            this.isResizing = true;
            this.currentResizer = 'fileTree';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing || this.currentResizer !== 'fileTree') return;

            const newWidth = e.clientX;
            if (newWidth >= 180 && newWidth <= 600) {
                leftPanel.style.width = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.currentResizer === 'fileTree') {
                this.isResizing = false;
                this.currentResizer = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    setupToolsPanelResizer() {
        const resizer = document.getElementById('toolsPanelResizer');
        const rightPanel = document.getElementById('toolsPanel');

        if (!resizer || !rightPanel) return;

        resizer.addEventListener('mousedown', (e) => {
            if (rightPanel.classList.contains('collapsed')) return;
            this.isResizing = true;
            this.currentResizer = 'toolsPanel';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing || this.currentResizer !== 'toolsPanel') return;

            const newWidth = window.innerWidth - e.clientX;
            if (newWidth >= 200 && newWidth <= 600) {
                rightPanel.style.width = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.currentResizer === 'toolsPanel') {
                this.isResizing = false;
                this.currentResizer = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    setupSidebarToggles() {
        // 좌측 파일 트리 토글
        const toggleFileTree = document.getElementById('toggleFileTree');
        const fileTreePanel = document.getElementById('fileTreePanel');
        const fileTreeResizer = document.getElementById('fileTreeResizer');

        if (toggleFileTree && fileTreePanel) {
            toggleFileTree.addEventListener('click', () => {
                const isCollapsed = fileTreePanel.classList.toggle('collapsed');
                toggleFileTree.textContent = isCollapsed ? '▶' : '◀';
                toggleFileTree.title = isCollapsed ? '파일 트리 펼치기' : '파일 트리 접기';
                if (fileTreeResizer) fileTreeResizer.style.display = isCollapsed ? 'none' : 'block';
            });
        }

        // 우측 도구 패널 토글
        const toggleToolsPanel = document.getElementById('toggleToolsPanel');
        const toolsPanel = document.getElementById('toolsPanel');
        const toolsPanelResizer = document.getElementById('toolsPanelResizer');

        if (toggleToolsPanel && toolsPanel) {
            toggleToolsPanel.addEventListener('click', () => {
                const isCollapsed = toolsPanel.classList.toggle('collapsed');
                toggleToolsPanel.textContent = isCollapsed ? '◀' : '▶';
                toggleToolsPanel.title = isCollapsed ? '도구 패널 펼치기' : '도구 패널 접기';
                if (toolsPanelResizer) toolsPanelResizer.style.display = isCollapsed ? 'none' : 'block';
            });
        }
    }
}

// 인스턴스 생성
window.resizerManager = new ResizerManager();
