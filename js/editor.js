/**
 * 에디터 관리자
 */
class EditorManager {
    constructor() {
        this.currentFile = null;
        this.autoSaveTimer = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        textarea.addEventListener('input', () => {
            const settings = window.toolsPanel?.loadSettings();
            if (settings?.autoSave !== false) {
                clearTimeout(this.autoSaveTimer);
                this.autoSaveTimer = setTimeout(() => this.saveCurrentFile(true), 3000);
            }
            this.updateHighlighter();
            window.toolsPanel?.updateStats();
        });

        textarea.addEventListener('scroll', () => {
            const backdrop = document.getElementById('editorBackdrop');
            if (backdrop) backdrop.scrollTop = textarea.scrollTop;
        });

        document.getElementById('saveBtn')?.addEventListener('click', () => this.saveCurrentFile());

        // 전역 단축키 (Ctrl + S)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                // 에디터 화면이 보일 때만 작동
                const editorScreen = document.getElementById('editorScreen');
                if (editorScreen && !editorScreen.classList.contains('hidden')) {
                    e.preventDefault();
                    this.saveCurrentFile();
                }
            }
        });

        // 텍스트 입력 관련 편의 기능 (자동 따옴표 등)
        textarea.addEventListener('keydown', (e) => {
            const settings = window.toolsPanel?.loadSettings();
            if (settings?.autoCloseQuotes && (e.key === '"' || e.key === "'")) {
                e.preventDefault();
                const quote = e.key;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = textarea.value;

                textarea.value = value.substring(0, start) + quote + quote + value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 1;
                textarea.dispatchEvent(new Event('input'));
            }
        });
    }

    async loadFile(fileId) {
        const file = await storage.getFile(fileId);
        if (!file || file.type === 'folder') return;

        this.currentFile = file;
        const textarea = document.getElementById('editorTextarea');
        const placeholder = document.getElementById('editorPlaceholder');
        const wrapper = document.getElementById('editorWrapper');

        if (textarea) {
            textarea.value = file.content || '';
            textarea.style.display = 'block';
        }
        if (wrapper) wrapper.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        window.toolsPanel?.applySettings(window.toolsPanel.loadSettings());
        this.updateHighlighter();

        const fileNameEl = document.getElementById('currentFileName');
        if (fileNameEl) fileNameEl.textContent = file.name;

        window.toolsPanel?.updateStats();
    }

    async saveCurrentFile(isAuto = false) {
        if (!this.currentFile) return;

        // 자동 저장 요청인데 설정에서 꺼져있으면 중단
        const settings = window.toolsPanel?.settings || window.toolsPanel?.loadSettings();
        if (isAuto && settings?.autoSave === false) return;

        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        const content = textarea.value;

        try {
            const result = await storage.updateFile(this.currentFile.id, { content });
            if (!result) return;
            this.currentFile.content = content;
            if (window.currentProjectId) await storage.updateProject(window.currentProjectId, {});

            if (isAuto) {
                this.showAutoSaveIndicator();
            } else {
                window.showToast?.('저장되었습니다.');
            }
            console.log(isAuto ? '자동 저장 완료' : '수동 저장 완료');
        } catch (error) {
            console.error('저장 실패:', error);
        }
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

    hideEditor() {
        this.currentFile = null;
        const textarea = document.getElementById('editorTextarea');
        const placeholder = document.getElementById('editorPlaceholder');
        const wrapper = document.getElementById('editorWrapper');

        if (textarea) {
            textarea.value = '';
            textarea.style.display = 'none';
        }
        if (wrapper) wrapper.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';

        const fileNameEl = document.getElementById('currentFileName');
        if (fileNameEl) fileNameEl.textContent = '파일을 선택하세요';
    }

    getText() { return document.getElementById('editorTextarea')?.value || ''; }

    updateHighlighter() {
        const textarea = document.getElementById('editorTextarea');
        const backdrop = document.getElementById('editorBackdrop');
        if (!textarea || !backdrop) return;

        let content = textarea.value;
        content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        content = content.replace(/"([^"]*)"/g, '<span class="hl-dialogue">"$1"</span>');
        content = content.replace(/'([^']*)'/g, "<span class=\"hl-thought\">'$1'</span>");
        if (content.endsWith('\n')) content += ' ';

        backdrop.innerHTML = content;
        backdrop.scrollTop = textarea.scrollTop;
    }
}

window.editorManager = new EditorManager();
