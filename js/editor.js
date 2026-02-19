/**
 * 에디터 관리자 - 다중 창 시스템 호환 버전
 * WindowManager에서 활성 창을 참조하여 동작합니다.
 */
class EditorManager {
    constructor() {
        this.currentFile = null;
        this.currentTextarea = null;
        this.autoSaveTimer = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 저장 버튼
        document.getElementById('saveBtn')?.addEventListener('click', () => {
            if (window.windowManager) {
                window.windowManager.saveActiveWindow();
            }
        });

        // 전역 단축키 (Ctrl + S)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                const editorScreen = document.getElementById('editorScreen');
                if (editorScreen && !editorScreen.classList.contains('hidden')) {
                    e.preventDefault();
                    if (window.windowManager) {
                        window.windowManager.saveActiveWindow();
                    }
                }
            }
        });
    }

    /**
     * 현재 활성 텍스트 가져오기 (통계 등에서 사용)
     */
    getText() {
        if (window.windowManager) {
            return window.windowManager.getActiveText();
        }
        return '';
    }

    hideEditor() {
        this.currentFile = null;
        this.currentTextarea = null;
    }

    showAutoSaveIndicator() {
        const indicator = document.getElementById('autoSaveIndicator');
        if (!indicator) return;
        indicator.textContent = '자동 저장됨';
        indicator.classList.add('show');
        clearTimeout(this.indicatorTimer);
        this.indicatorTimer = setTimeout(() => {
            indicator.classList.remove('show');
        }, 2000);
    }
}

window.editorManager = new EditorManager();
