/**
 * 도구 패널 관리자 - 안정화 및 설정 저장 버튼 적용 버전
 */
class ToolsPanel {
    constructor() {
        this.currentTab = 'stats';
        this.currentProjectId = null;
        this.memos = [];

        // 타이머 엔진 상태
        this.timerMode = 'stopwatch';
        this.timerInterval = null;
        this.elapsedTime = 0;
        this.remainingTime = 0;
        this.isRunning = false;
        this.customMinutes = 10;

        // 설정 저장소
        this.settings = this.loadSettings();
        this.tempSettings = { ...this.settings };
        this.editingMemoId = null;
        this.isSelectionMode = false;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderTab('stats');
    }

    setupEventListeners() {
        document.querySelectorAll('.tools-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.getAttribute('data-tab')));
        });
    }

    switchTab(tabName) {
        this.currentTab = tabName;
        document.querySelectorAll('.tools-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
        });
        this.renderTab(tabName);
    }

    renderTab(tabName) {
        const content = document.getElementById('toolsContent');
        if (!content) return;

        switch (tabName) {
            case 'stats':
                content.innerHTML = this.renderStats();
                this.updateStats();
                break;
            case 'tools':
                content.innerHTML = this.renderTools();
                this.setupToolsEventListeners();
                break;
            case 'memos':
                content.innerHTML = this.renderMemos();
                this.setupMemoEventListeners();
                break;
            case 'search':
                content.innerHTML = this.renderSearch();
                this.setupSearchEventListeners();
                break;
            case 'settings':
                content.innerHTML = this.renderSettings();
                this.setupSettingsEventListeners();
                break;
        }
    }

    renderStats() {
        return `
            <div class="stats-grid">
                <div class="stats-item"><span class="stats-label">글자 수</span><span class="stats-value" id="charCount">0</span></div>
                <div class="stats-item"><span class="stats-label">공백 제외</span><span class="stats-value" id="charCountNoSpace">0</span></div>
                <div class="stats-item"><span class="stats-label">단어 수</span><span class="stats-value" id="wordCount">0</span></div>
                <div class="stats-item"><span class="stats-label">문단 수</span><span class="stats-value" id="paragraphCount">0</span></div>
            </div>
        `;
    }

    async updateStats() {
        if (!this.currentProjectId) return;

        // 1. 저장소의 모든 파일 가져오기
        const files = await storage.getProjectFiles(this.currentProjectId);
        let totalText = '';

        for (const file of files) {
            if (file.type !== 'file') continue;

            // 2. 현재 창이 열려있으면 실시간 텍스트 사용, 아니면 저장된 텍스트 사용
            const openWindow = window.windowManager?.windows.get(file.id);
            if (openWindow) {
                totalText += openWindow.textarea.value + '\n';
            } else if (file.content) {
                totalText += file.content + '\n';
            }
        }

        const charCount = totalText.length;
        const charCountNoSpace = totalText.replace(/\s/g, '').length;

        // 단어 수 (한글/영문 공백 기준)
        const wordCount = totalText.trim().split(/\s+/).filter(w => w).length;

        // 문단 수 (두 번 이상의 줄바꿈 기준)
        const paragraphCount = totalText.split(/\n\n+/).filter(p => p.trim()).length;

        const charCountEl = document.getElementById('charCount');
        const charCountNoSpaceEl = document.getElementById('charCountNoSpace');
        const wordCountEl = document.getElementById('wordCount');
        const paragraphCountEl = document.getElementById('paragraphCount');

        if (charCountEl) charCountEl.textContent = charCount.toLocaleString();
        if (charCountNoSpaceEl) charCountNoSpaceEl.textContent = charCountNoSpace.toLocaleString();
        if (wordCountEl) wordCountEl.textContent = wordCount.toLocaleString();
        if (paragraphCountEl) paragraphCountEl.textContent = paragraphCount.toLocaleString();
    }

    renderTools() {
        const displayTime = this.timerMode === 'stopwatch' ? this.elapsedTime : this.remainingTime;

        return `
            <div class="tools-container">
                <div class="stopwatch-card">
                    <div class="stopwatch-modes">
                        <button class="mode-btn ${this.timerMode === 'stopwatch' ? 'active' : ''}" data-mode="stopwatch">스톱워치</button>
                        <button class="mode-btn ${this.timerMode === 'pomodoro' ? 'active' : ''}" data-mode="pomodoro">뽀모도로</button>
                        <button class="mode-btn ${this.timerMode === 'custom' ? 'active' : ''}" data-mode="custom">타이머</button>
                    </div>

                    ${this.timerMode === 'custom' && !this.isRunning ? `
                        <div class="timer-settings">
                            <input type="number" class="timer-input" id="customMin" value="${this.customMinutes}" min="1" max="999"> 분 설정
                        </div>
                    ` : ''}

                    <div class="stopwatch-display" id="mainDisplay">${this.formatTime(displayTime)}</div>
                    
                    <div class="stopwatch-controls">
                        <button class="btn ${this.isRunning ? 'btn-secondary' : 'btn-primary'}" id="timerStartBtn">
                            ${this.isRunning ? '일시정지' : '시작'}
                        </button>
                        <button class="btn btn-secondary" id="timerResetBtn">리셋</button>
                    </div>
                </div>
                
                <div style="font-size: 12px; color: var(--color-text-tertiary); text-align: center;">
                    ${this.timerMode === 'pomodoro' ? '💡 25분 집중 후 5분 휴식을 권장합니다.' : '창작에 몰입하는 시간을 기록하세요.'}
                </div>
            </div>
        `;
    }

    setupToolsEventListeners() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                if (this.isRunning) {
                    if (!confirm('작업 중인 타이머가 초기화됩니다. 변경할까요?')) return;
                }
                this.setTimerMode(mode);
            });
        });

        document.getElementById('timerStartBtn')?.addEventListener('click', () => {
            if (this.isRunning) this.stopTimer();
            else this.startTimer();
            this.renderTab('tools');
        });

        document.getElementById('timerResetBtn')?.addEventListener('click', () => {
            this.resetTimer();
            this.renderTab('tools');
        });

        document.getElementById('customMin')?.addEventListener('change', (e) => {
            this.customMinutes = parseInt(e.target.value) || 10;
            this.remainingTime = this.customMinutes * 60 * 1000;
            const display = document.getElementById('mainDisplay');
            if (display) display.textContent = this.formatTime(this.remainingTime);
        });
    }

    setTimerMode(mode) {
        this.stopTimer();
        this.timerMode = mode;
        this.elapsedTime = 0;

        if (mode === 'pomodoro') this.remainingTime = 25 * 60 * 1000;
        else if (mode === 'custom') this.remainingTime = this.customMinutes * 60 * 1000;
        else this.remainingTime = 0;

        this.renderTab('tools');
    }

    startTimer() {
        if (this.isRunning) return;
        this.isRunning = true;

        const startTime = Date.now();
        const initialValue = this.timerMode === 'stopwatch' ? this.elapsedTime : this.remainingTime;

        this.timerInterval = setInterval(() => {
            const now = Date.now();
            const delta = now - startTime;

            if (this.timerMode === 'stopwatch') {
                this.elapsedTime = initialValue + delta;
                this.updateDisplay(this.elapsedTime);
            } else {
                this.remainingTime = Math.max(0, initialValue - delta);
                this.updateDisplay(this.remainingTime);

                if (this.remainingTime === 0) {
                    this.stopTimer();
                    this.renderTab('tools');
                    alert('⏱️ 설정한 시간이 완료되었습니다!');
                }
            }
        }, 100);
    }

    stopTimer() {
        this.isRunning = false;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    resetTimer() {
        this.stopTimer();
        this.elapsedTime = 0;
        if (this.timerMode === 'pomodoro') this.remainingTime = 25 * 60 * 1000;
        else if (this.timerMode === 'custom') this.remainingTime = this.customMinutes * 60 * 1000;
        else this.remainingTime = 0;
    }

    updateDisplay(ms) {
        const display = document.getElementById('mainDisplay');
        if (display) {
            display.textContent = this.formatTime(ms);
            this.fitText(display);
        }
    }

    fitText(el) {
        const parent = el.parentElement;
        if (!parent) return;
        let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
        while (el.scrollWidth > parent.clientWidth - 10 && currentSize > 12) {
            currentSize -= 1;
            el.style.fontSize = currentSize + 'px';
        }
    }

    formatTime(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    renderMemos() {
        const hasMemos = this.memos.length > 0;
        return `
            <div style="margin-bottom: var(--spacing-md); display: flex; gap: 8px;">
                <button class="btn btn-primary" style="flex: 2; height: 44px; font-weight: 600;" id="addMemoBtn">+ 새 메모 작성</button>
                ${hasMemos ? `<button class="btn btn-secondary" style="flex: 1; height: 44px; font-size: 12px;" id="toggleSelectionModeBtn">${this.isSelectionMode ? '선택 취소' : '관리'}</button>` : ''}
            </div>
            
            ${(hasMemos && this.isSelectionMode) ? `
            <div id="memoActionBar" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--color-surface-2); border-radius: 12px; margin-bottom: 16px; border: 1px solid var(--color-border);">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: var(--color-text-primary); font-weight: 500;">
                    <input type="checkbox" id="selectAllMemos" style="width: 18px; height: 18px;"> 전체 선택
                </label>
                <button class="btn btn-danger" id="deleteBatchBtn" style="padding: 6px 14px; font-size: 12px; height: 32px; font-weight: 600; display: none;">0개 삭제</button>
            </div>
            ` : ''}

            <div class="memo-list" id="memoList">
                ${!hasMemos ? '<div class="text-muted text-center" style="padding: 40px; font-size: 13px; background: var(--color-surface-1); border-radius: 12px; border: 1px dashed var(--color-border);">작성된 메모가 없습니다.</div>' :
                this.memos.map(m => `
                    <div class="memo-item" data-memo-id="${m.id}" style="position: relative; cursor: pointer; padding: 16px; background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 12px; transition: all 0.2s;">
                        <div style="display: flex; align-items: flex-start; gap: 12px;">
                            ${this.isSelectionMode ? `<input type="checkbox" class="memo-checkbox" data-id="${m.id}" style="width: 18px; height: 18px; margin-top: 2px; cursor: pointer;">` : ''}
                            <div style="flex: 1;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <small style="color: var(--color-text-tertiary); font-size: 11px;">${this.formatDate(m.updatedAt)}</small>
                                </div>
                                <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: var(--color-text-primary); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;">${this.escapeHtml(m.content)}</div>
                            </div>
                        </div>
                    </div>`).join('')}
            </div>
        `;
    }

    setupMemoEventListeners() {
        const getEl = id => document.getElementById(id);
        const addBtn = getEl('addMemoBtn');
        const memoList = getEl('memoList');
        const selectAll = getEl('selectAllMemos');
        const deleteBatchBtn = getEl('deleteBatchBtn');
        const toggleBtn = getEl('toggleSelectionModeBtn');

        // 클론 교체로 중복 등록 방지
        if (addBtn) {
            const newBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newBtn, addBtn);
            newBtn.addEventListener('click', () => this.showMemoModal());
        }

        if (toggleBtn) {
            toggleBtn.onclick = () => {
                this.isSelectionMode = !this.isSelectionMode;
                this.renderTab('memos');
            };
        }

        if (memoList) {
            memoList.onclick = (e) => {
                const item = e.target.closest('.memo-item');
                const checkbox = e.target.closest('.memo-checkbox');

                if (checkbox) {
                    e.stopPropagation();
                    this.updateMemoBatchUI();
                    return;
                }

                if (item) {
                    if (this.isSelectionMode) {
                        const cb = item.querySelector('.memo-checkbox');
                        if (cb) {
                            cb.checked = !cb.checked;
                            this.updateMemoBatchUI();
                        }
                    } else {
                        const memoId = item.getAttribute('data-memo-id');
                        const memo = this.memos.find(m => m.id === memoId);
                        if (memo) this.showMemoModal(memo);
                    }
                }
            };
        }

        if (selectAll) {
            selectAll.onchange = (e) => {
                document.querySelectorAll('.memo-checkbox').forEach(cb => {
                    cb.checked = e.target.checked;
                });
                this.updateMemoBatchUI();
            };
        }

        if (deleteBatchBtn) {
            deleteBatchBtn.onclick = () => this.deleteBatchMemos();
        }

        // 모달 버튼들 (한번만 등록되도록 혹은 클론 처리)
        // 여기서는 이 리스너들이 모달 HTML이 바뀌지 않는 한 유지되므로 처음 한번만 등록하거나 클론함.
        // renderTab('memos')가 호출될 때마다 이 요소들이 새로 그려지지 않으므로(모달은 외부에 있음)
        // 하지만 안전을 위해 클론 처리 유지
        ['closeMemoModal', 'cancelMemoBtn', 'saveMemoBtn', 'deleteMemoBtn'].forEach(id => {
            const btn = getEl(id);
            if (btn) {
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                if (id === 'closeMemoModal' || id === 'cancelMemoBtn') newBtn.onclick = () => this.hideMemoModal();
                if (id === 'saveMemoBtn') newBtn.onclick = () => this.saveMemo();
                if (id === 'deleteMemoBtn') newBtn.onclick = () => this.deleteMemo();
            }
        });
    }

    updateMemoBatchUI() {
        const checked = document.querySelectorAll('.memo-checkbox:checked');
        const deleteBtn = document.getElementById('deleteBatchBtn');
        if (deleteBtn) {
            deleteBtn.style.display = checked.length > 0 ? 'block' : 'none';
            deleteBtn.textContent = `${checked.length}개 삭제`;
        }

        const selectAll = document.getElementById('selectAllMemos');
        if (selectAll) {
            const allCheckboxes = document.querySelectorAll('.memo-checkbox');
            selectAll.checked = allCheckboxes.length > 0 && checked.length === allCheckboxes.length;
        }
    }

    async deleteBatchMemos() {
        const checked = document.querySelectorAll('.memo-checkbox:checked');
        if (checked.length === 0) return;

        if (!confirm(`${checked.length}개의 메모를 삭제할까요?`)) return;

        const ids = Array.from(checked).map(cb => cb.getAttribute('data-id'));
        try {
            await window.storage?.deleteMemos(ids);
            await this.loadProjectData(this.currentProjectId);
            this.renderTab('memos');
            window.showToast?.(`${ids.length}개의 메모가 삭제되었습니다.`);
        } catch (error) {
            console.error('배치 삭제 실패:', error);
        }
    }

    showMemoModal(memo = null) {
        const modal = document.getElementById('memoModal');
        const title = document.getElementById('memoModalTitle');
        const content = document.getElementById('memoContent');
        const deleteBtn = document.getElementById('deleteMemoBtn');

        if (!modal || !content) return;

        this.editingMemoId = memo ? memo.id : null;
        title.textContent = memo ? '메모 수정' : '새 메모 작성';
        content.value = memo ? memo.content : '';
        deleteBtn.style.display = memo ? 'block' : 'none';

        modal.classList.remove('hidden');
        content.focus();
    }

    hideMemoModal() {
        document.getElementById('memoModal')?.classList.add('hidden');
        this.editingMemoId = null;
    }

    async saveMemo() {
        const content = document.getElementById('memoContent')?.value.trim();
        if (!content) return alert('내용을 입력해주세요.');

        try {
            if (this.editingMemoId) {
                await storage.updateMemo(this.editingMemoId, { content });
            } else {
                await storage.createMemo({ projectId: this.currentProjectId, content });
            }

            await this.loadProjectData(this.currentProjectId);
            this.renderTab('memos');
            this.hideMemoModal();
            window.showToast?.('메모가 저장되었습니다.');
        } catch (error) {
            console.error('메모 저장 실패:', error);
        }
    }

    async deleteMemo() {
        if (!this.editingMemoId) return;
        if (!confirm('이 메모를 정말 삭제할까요?')) return;

        try {
            await storage.deleteMemo(this.editingMemoId);
            await this.loadProjectData(this.currentProjectId);
            this.renderTab('memos');
            this.hideMemoModal();
            window.showToast?.('메모가 삭제되었습니다.');
        } catch (error) {
            console.error('메모 삭제 실패:', error);
        }
    }

    renderSearch() { return `<div class="search-box"><input type="text" class="input" id="searchInput" placeholder="검색어..."><button class="btn btn-primary" style="width: 100%; margin-top: 8px;" id="searchBtn">검색</button></div><div id="searchResults" style="padding-top: 10px;"></div>`; }
    setupSearchEventListeners() {
        document.getElementById('searchBtn')?.addEventListener('click', () => this.performSearch());
        document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });
    }

    async performSearch() {
        const query = document.getElementById('searchInput')?.value.trim();
        if (!query) return;
        const files = await storage.getProjectFiles(this.currentProjectId);
        const results = files.flatMap(f => f.type === 'file' && f.content ? f.content.split('\n').map((l, i) => l.includes(query) ? { id: f.id, name: f.name, line: i + 1, text: l } : null).filter(x => x) : []);
        const resDiv = document.getElementById('searchResults');
        if (results.length === 0) resDiv.innerHTML = '결과 없음';
        else resDiv.innerHTML = results.map(r => `<div class="search-result-item" onclick="window.fileTreeManager.selectFile('${r.id}')"><div style="font-size:11px; color:gray;">${r.name}:${r.line}</div><div>${r.text}</div></div>`).join('');
    }

    /**
     * 설정 탭 - 저장 버튼 명시적 추가 버전
     */
    renderSettings() {
        // 렌더링 시 현재 저장된 설정을 템플릿에 로드
        this.tempSettings = { ...this.settings };
        const s = this.tempSettings;

        return `
          <div class="settings-section">
            <h3 class="settings-section-title">에디터 기본</h3>
            <div class="form-group">
              <label class="form-label">배경색</label>
              <input type="color" class="input" id="editorBgColor" value="${s.backgroundColor}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group">
              <label class="form-label">폰트 색상</label>
              <input type="color" class="input" id="editorTextColor" value="${s.textColor}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group">
              <label class="form-label">에디터 너비 <span>${s.editorWidth}px</span></label>
              <input type="range" class="input-range" id="editorWidth" min="400" max="2000" step="50" value="${s.editorWidth}">
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">텍스트 스타일</h3>
            <div class="form-group">
              <label class="form-label">폰트 패밀리</label>
              <select class="input" id="editorFontFamily">
                <option value="'Noto Serif KR', serif" ${s.fontFamily.includes('Noto Serif') ? 'selected' : ''}>본명조</option>
                <option value="'Noto Sans KR', sans-serif" ${s.fontFamily.includes('Noto Sans') ? 'selected' : ''}>본고딕</option>
                <option value="Georgia, serif" ${s.fontFamily.includes('Georgia') ? 'selected' : ''}>Georgia</option>
                <option value="'Courier New', monospace" ${s.fontFamily.includes('Courier') ? 'selected' : ''}>Courier New</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">폰트 크기 <span>${s.fontSize}px</span></label>
              <input type="range" class="input-range" id="editorFontSize" min="12" max="48" value="${s.fontSize}">
            </div>
            <div class="form-group">
              <label class="form-label">행간 (Line Height) <span>${s.lineHeight}</span></label>
              <input type="range" class="input-range" id="editorLineHeight" min="1.0" max="3.0" step="0.1" value="${s.lineHeight}">
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">기능 및 하이라이트</h3>
            <div class="form-group">
              <label class="form-label">대사/생각 강조색</label>
              <input type="color" class="input" id="highlightColor" value="${s.highlightColor || '#2563eb'}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 8px 0;">
              <label for="autoSaveToggle" style="cursor: pointer; font-size: 14px; font-weight: 500;">실시간 자동 저장</label>
              <input type="checkbox" id="autoSaveToggle" ${s.autoSave !== false ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
            </div>
            <div class="form-group" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 8px 0;">
              <label for="autoCloseQuotes" style="cursor: pointer; font-size: 14px; font-weight: 500;">따옴표 자동 닫기</label>
              <input type="checkbox" id="autoCloseQuotes" ${s.autoCloseQuotes ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
            </div>
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--color-border);">
              <button class="btn btn-secondary" id="manageTemplatesBtn" style="width: 100%; height: 44px; justify-content: center; font-weight: 600; background: var(--color-bg-primary);">✨ 템플릿 마스터 관리</button>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">트리거 설정</h3>
            <div class="form-group">
              <label class="form-label">장소 표시 트리거 (예: 장소:)</label>
              <input type="text" class="input" id="triggerLocation" value="${s.triggerLocation || '장소:'}" placeholder="장소:">
            </div>
          </div>

          <div style="margin-top: var(--spacing-2xl); display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px;">
            <button class="btn btn-primary" id="saveSettingsBtn" style="width: 100%; height: 50px; font-size: 15px; font-weight: 700;">환경 설정 저장</button>
            <button class="btn btn-secondary" id="resetSettingsBtn" style="width: 100%; border-color: transparent;">초기화</button>
            <div style="height: 1px; background: var(--color-border); margin: 20px 0;"></div>
            <button class="btn btn-danger" id="resetDbBtn" style="width: 100%; font-size: 12px; opacity: 0.6;">데이터베이스 초기화</button>
          </div>
        `;
    }

    setupSettingsEventListeners() {
        const getEl = id => document.getElementById(id);

        // 실시간 미리보기 (저장은 안 함)
        const updatePreview = (key, val) => {
            this.tempSettings[key] = val;
            this.applySettings(this.tempSettings);
        };

        getEl('editorBgColor')?.addEventListener('input', (e) => updatePreview('backgroundColor', e.target.value));
        getEl('editorTextColor')?.addEventListener('input', (e) => updatePreview('textColor', e.target.value));
        getEl('editorFontFamily')?.addEventListener('change', (e) => updatePreview('fontFamily', e.target.value));

        getEl('editorFontSize')?.addEventListener('input', (e) => {
            getEl('fontSizeValue').textContent = e.target.value + 'px';
            updatePreview('fontSize', parseInt(e.target.value));
        });

        getEl('editorLineHeight')?.addEventListener('input', (e) => {
            getEl('lineHeightValue').textContent = e.target.value;
            updatePreview('lineHeight', parseFloat(e.target.value));
        });

        getEl('editorLetterSpacing')?.addEventListener('input', (e) => {
            getEl('letterSpacingValue').textContent = e.target.value + 'px';
            updatePreview('letterSpacing', parseFloat(e.target.value));
        });

        getEl('highlightColor')?.addEventListener('input', (e) => updatePreview('highlightColor', e.target.value));
        getEl('autoCloseQuotes')?.addEventListener('change', (e) => updatePreview('autoCloseQuotes', e.target.checked));
        getEl('autoSaveToggle')?.addEventListener('change', (e) => updatePreview('autoSave', e.target.checked));
        getEl('triggerLocation')?.addEventListener('input', (e) => updatePreview('triggerLocation', e.target.value));

        getEl('editorWidth')?.addEventListener('input', (e) => {
            getEl('editorWidthValue').textContent = e.target.value + 'px';
            updatePreview('editorWidth', parseInt(e.target.value));
        });

        // 실제 저장 버튼
        getEl('saveSettingsBtn')?.addEventListener('click', () => {
            this.settings = { ...this.tempSettings };
            localStorage.setItem('editorSettings', JSON.stringify(this.settings));
            alert('설정이 안전하게 저장되었습니다.');
        });

        getEl('resetSettingsBtn')?.addEventListener('click', () => {
            if (confirm('모든 설정을 기본값으로 되돌릴까요?')) {
                localStorage.removeItem('editorSettings');
                this.tempSettings = this.loadSettings();
                this.applySettings(this.tempSettings);
                this.renderTab('settings');
            }
        });

        getEl('resetDbBtn')?.addEventListener('click', () => {
            window.storage?.resetDatabase();
        });
    }

    loadSettings() {
        const defaults = {
            backgroundColor: '#ffffff',
            textColor: '#1f2937',
            fontFamily: "'Noto Serif KR', serif",
            fontSize: 18,
            lineHeight: 1.75,
            letterSpacing: 0,
            highlightColor: '#2563eb',
            autoCloseQuotes: true,
            autoSave: true,
            editorWidth: 900,
            triggerLocation: '장소:'
        };
        try {
            const saved = localStorage.getItem('editorSettings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch (e) {
            return defaults;
        }
    }

    applySettings(s) {
        // 다중 창 시스템: 모든 열린 창의 textarea에 설정 적용
        document.documentElement.style.setProperty('--color-highlight', s.highlightColor || '#58a6ff');

        const textareas = document.querySelectorAll('.window-textarea');
        textareas.forEach(textarea => {
            textarea.style.fontFamily = s.fontFamily;
            textarea.style.fontSize = s.fontSize + 'px';
            textarea.style.lineHeight = s.lineHeight;
            textarea.style.letterSpacing = s.letterSpacing + 'px';
        });

        // 레거시 호환 (단일 에디터 요소가 있는 경우)
        const textarea = document.getElementById('editorTextarea');
        const backdrop = document.getElementById('editorBackdrop');
        const wrapper = document.getElementById('editorWrapper');
        if (textarea) {
            textarea.style.backgroundColor = s.backgroundColor;
            textarea.style.color = 'transparent';
            textarea.style.caretColor = s.textColor;
            textarea.style.fontFamily = s.fontFamily;
            textarea.style.fontSize = s.fontSize + 'px';
            textarea.style.lineHeight = s.lineHeight;
            textarea.style.letterSpacing = s.letterSpacing + 'px';
        }
        if (wrapper) wrapper.style.maxWidth = s.editorWidth + 'px';
        if (backdrop) {
            backdrop.style.backgroundColor = s.backgroundColor;
            backdrop.style.color = s.textColor;
            backdrop.style.fontFamily = s.fontFamily;
            backdrop.style.fontSize = s.fontSize + 'px';
            backdrop.style.lineHeight = s.lineHeight;
            backdrop.style.letterSpacing = s.letterSpacing + 'px';
        }
    }

    async loadProjectData(projectId) {
        this.currentProjectId = projectId;
        this.memos = await storage.getProjectMemos(projectId);
        this.updateStats();
    }
    formatDate(t) { return new Date(t).toLocaleDateString(); }
    escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

window.toolsPanel = new ToolsPanel();
