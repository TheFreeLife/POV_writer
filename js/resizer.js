/**
 * 리사이저 관리
 * 패널 크기를 드래그로 조절할 수 있게 합니다.
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
    }

    setupFileTreeResizer() {
        const resizer = document.getElementById('fileTreeResizer');
        const leftPanel = document.getElementById('fileTreePanel');

        if (!resizer || !leftPanel) return;

        resizer.addEventListener('mousedown', (e) => {
            this.isResizing = true;
            this.currentResizer = 'fileTree';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing || this.currentResizer !== 'fileTree') return;

            const newWidth = e.clientX;
            if (newWidth >= 200 && newWidth <= 800) {
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
            this.isResizing = true;
            this.currentResizer = 'toolsPanel';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing || this.currentResizer !== 'toolsPanel') return;

            const newWidth = window.innerWidth - e.clientX;
            if (newWidth >= 280 && newWidth <= 900) {
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
}

// 인스턴스 생성
window.resizerManager = new ResizerManager();
