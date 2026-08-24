/**
 * 도구 패널 관리자 - 안정화 및 설정 저장 버튼 적용 버전
 */
class ToolsPanel {
    constructor() {
        this.currentTab = 'agent';
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
        this.settings = this.loadSettingsSync(); // 즉시 반영을 위한 동기 로드 (백업용)
        this.tempSettings = { ...this.settings };
        this.editingMemoId = null;
        this.isSelectionMode = false;

        // 🤖 AI 소설 총괄 비서 (Story Copilot) 상태
        this.agentHistory = [];
        this.isAgentLoading = false;
        this.lastReferencedNodes = [];
        this.agentMode = localStorage.getItem('agent_mode') || 'ask'; // 'ask' (기본: 승인 후 적용) | 'accept' (자동 적용) | 'plan' (계획 수립)
        this.pendingActionsMap = new Map(); // actionId -> { type, data, status: 'pending'|'applied'|'rejected', createdAt, diff, preview }

        this.init();
    }

    async init() {
        // IndexedDB에서 정식 설정 로드
        await this.loadSettingsAsync();
        
        this.setupEventListeners();
        this.renderTab('agent');

        // 앱 시작 시 저장된 에디터 설정(글자색, 배경색, 폰트 등) 초기 1회 즉시 적용
        if (this.settings) {
            this.applySettings(this.settings);
        }
    }

    setupEventListeners() {
        document.querySelectorAll('.tools-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.getAttribute('data-tab')));
        });

        // 패널 크기 변경 감지하여 그래프 리사이즈
        if (window.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (entry.target.id === 'statsChartContainer' && this.currentTab === 'stats') {
                        // 성능을 위해 디바운싱 없이 즉시 업데이트 (부드러운 연결)
                        this.renderWorkloadChart();
                    }
                }
            });
        }
    }

    switchTab(tabName) {
        this.currentTab = tabName;
        document.querySelectorAll('.tools-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
        });
        
        // 설정 탭으로 진입할 때만 임시 설정을 현재 설정으로 동기화
        if (tabName === 'settings') {
            this.tempSettings = { ...this.settings };
        }
        
        this.renderTab(tabName);



        // 통계 탭으로 전환될 때 관찰 시작
        const chartContainer = document.getElementById('statsChartContainer');
        if (tabName === 'stats' && chartContainer && this.resizeObserver) {
            this.resizeObserver.observe(chartContainer);
        } else if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }

    async renderTab(tabName) {
        const content = document.getElementById('toolsContent');
        if (!content) return;

        switch (tabName) {
            case 'stats':
                content.innerHTML = this.renderStats();
                this.updateStats();
                
                // 렌더링 직후 관찰 시작 (약간의 지연으로 DOM 안정화)
                setTimeout(() => {
                    const chartContainer = document.getElementById('statsChartContainer');
                    if (chartContainer && this.resizeObserver) {
                        this.resizeObserver.observe(chartContainer);
                    }
                }, 50);
                break;
            case 'agent':
            case 'tools':
                content.innerHTML = this.renderAgent();
                this.setupAgentEventListeners();
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
                content.innerHTML = await this.renderSettings();
                this.setupSettingsEventListeners();
                break;
        }
    }

    renderStats() {
        return `
            <div class="stats-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="stats-item"><span class="stats-label">총 글자 수</span><span class="stats-value" id="charCount">0</span></div>
                <div class="stats-item"><span class="stats-label">공백 제외</span><span class="stats-value" id="charCountNoSpace">0</span></div>
                <div class="stats-item"><span class="stats-label">문장 수</span><span class="stats-value" id="sentenceCount">0</span></div>
                <div class="stats-item"><span class="stats-label">단락 수</span><span class="stats-value" id="paragraphCount">0</span></div>
                <div class="stats-item"><span class="stats-label">노드 / 폴더</span><span class="stats-value" id="fileFolderCount">0 / 0</span></div>
            </div>

            <div class="stats-section-title" style="margin-top: 24px; margin-bottom: 16px; font-size: 13px; font-weight: 700; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px;">
                📈 최근 7일 작업량 추이
            </div>
            
            <div id="statsChartContainer" style="height: 180px; width: 100%; background: var(--color-surface-2); border-radius: 12px; border: 1px solid var(--color-border); padding: 20px 15px 10px 15px; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px;">
                <!-- 그래프가 여기에 동적으로 생성됩니다 -->
            </div>
            <div id="statsChartLabels" style="display: flex; justify-content: space-between; padding: 8px 5px; color: var(--color-text-tertiary); font-size: 10px; font-family: var(--font-mono);">
                <!-- 날짜 라벨이 여기에 추가됩니다 -->
            </div>

            <div style="margin-top: 20px; font-size: 11px; color: var(--color-text-tertiary); line-height: 1.6; background: var(--color-bg-tertiary); padding: 12px; border-radius: 8px;">
                💡 <b>팁:</b> 날짜별 작업량은 각 파일의 최종 수정 시간을 기준으로 집계됩니다. 꾸준한 집필은 훌륭한 작품의 밑거름이 됩니다!
            </div>
        `;
    }

    async updateStats() {
        if (!this.currentProjectId) return;

        try {
            const files = await storage.getProjectFiles(this.currentProjectId);
            let totalText = '';
            let fileCount = 0;
            let folderCount = 0;
            
            for (const file of files) {
                if (file.type === 'folder') {
                    folderCount++;
                    continue;
                }

                // [수정] 일반 텍스트 파일만 통계에 포함 (stat, image 등 특수 템플릿 제외)
                const isSpecialFile = ['stat', 'image'].includes(file.template) || 
                                     (typeof file.content === 'string' && file.content.startsWith('data:image'));
                
                if (isSpecialFile) {
                    continue; 
                }
                
                fileCount++;
                const openWindow = window.windowManager?.windows.get(file.id);
                // 에디터가 열려있다면(이미지 창이 아닐 경우) 그 내용을 사용
                const content = (openWindow && openWindow.textarea) ? openWindow.textarea.value : (file.content || '');
                totalText += content + '\n';
            }

            // 1. 기본 수치 업데이트
            const charCount = totalText.length;
            const charCountNoSpace = totalText.replace(/\s/g, '').length;
            const sentenceCount = totalText.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
            const paragraphCount = totalText.split(/\n\n+/).filter(p => p.trim().length > 0).length;
            const dialogueMatches = totalText.match(/"[^"\n]*"/g);
            const dialogueCount = dialogueMatches ? dialogueMatches.length : 0;

            const getEl = id => document.getElementById(id);
            if (getEl('charCount')) getEl('charCount').textContent = charCount.toLocaleString();
            if (getEl('charCountNoSpace')) getEl('charCountNoSpace').textContent = charCountNoSpace.toLocaleString();
            if (getEl('sentenceCount')) getEl('sentenceCount').textContent = sentenceCount.toLocaleString();
            if (getEl('paragraphCount')) getEl('paragraphCount').textContent = paragraphCount.toLocaleString();
            if (getEl('fileFolderCount')) getEl('fileFolderCount').textContent = `${fileCount} / ${folderCount}`;
            if (getEl('dialogueCount')) getEl('dialogueCount').textContent = `${dialogueCount.toLocaleString()}회`;

            // 2. 날짜별 기록 업데이트 및 추이 계산
            this.updateStatsHistory(charCount);

            // 3. 꺾은선 그래프 그리기
            this.renderWorkloadChart();

        } catch (error) {
            console.error('통계 갱신 실패:', error);
        }
    }

    /**
     * 날짜별 글자 수 기록 저장 (최근 14일치 유지)
     */
    updateStatsHistory(currentTotal) {
        if (!this.currentProjectId) return;
        
        const historyKey = `statsHistory_${this.currentProjectId}`;
        let history = {};
        try {
            history = JSON.parse(localStorage.getItem(historyKey) || '{}');
        } catch (e) { history = {}; }

        const today = new Date().toISOString().split('T')[0];
        history[today] = currentTotal;

        // 14일 이상 된 데이터 삭제 (관리용)
        const dates = Object.keys(history).sort();
        if (dates.length > 14) {
            delete history[dates[0]];
        }

        localStorage.setItem(historyKey, JSON.stringify(history));
    }

    renderWorkloadChart() {
        const container = document.getElementById('statsChartContainer');
        const labelContainer = document.getElementById('statsChartLabels');
        if (!container || !labelContainer) return;

        const historyKey = `statsHistory_${this.currentProjectId}`;
        let history = {};
        try {
            history = JSON.parse(localStorage.getItem(historyKey) || '{}');
        } catch (e) { history = {}; }

        const data = [];
        const labels = [];
        const now = new Date();
        
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
            
            if (history[dateStr] !== undefined) {
                data.push(history[dateStr]);
            } else {
                const prevDates = Object.keys(history).filter(date => date < dateStr).sort();
                data.push(prevDates.length > 0 ? history[prevDates[prevDates.length - 1]] : 0);
            }
        }

        const maxVal = Math.max(...data, 100) * 1.35; // 상단 텍스트 공간을 위해 여백 확대
        const minVal = Math.min(...data);
        const yMin = Math.max(0, minVal * 0.9);

        container.innerHTML = '';
        labelContainer.innerHTML = '';

        const width = container.clientWidth;
        const height = container.clientHeight;

        const svgNamespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.style.overflow = "visible";

        // 막대 그래프 계산 (7일 기준)
        const barCount = 7;
        const slotWidth = width / barCount;
        const barWidth = slotWidth * 0.7; // 슬롯의 70% 너비 사용
        const gap = slotWidth * 0.3;

        data.forEach((val, i) => {
            const x = i * slotWidth + gap / 2;
            const barHeight = Math.max(4, ((val - yMin) / (maxVal - yMin)) * height);
            const y = height - barHeight;
            const centerX = x + barWidth / 2;

            const prevVal = i > 0 ? data[i - 1] : val;
            const diff = val - prevVal;

            // 1. 막대 (Rect)
            const rect = document.createElementNS(svgNamespace, "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", barWidth);
            rect.setAttribute("height", barHeight);
            rect.setAttribute("rx", "6"); // 부드러운 라운드
            rect.setAttribute("fill", "var(--color-accent-primary)");
            rect.style.opacity = "0.75";
            rect.style.transition = "all 0.2s ease";
            rect.style.cursor = "pointer";
            
            // 호버 효과
            rect.onmouseover = () => {
                rect.style.opacity = "1";
                rect.setAttribute("fill", "var(--color-accent-secondary)");
            };
            rect.onmouseout = () => {
                rect.style.opacity = "0.75";
                rect.setAttribute("fill", "var(--color-accent-primary)");
            };

            const title = document.createElementNS(svgNamespace, "title");
            const diffText = diff >= 0 ? `(+${diff})` : `(${diff})`;
            title.textContent = `${labels[i]}: ${val.toLocaleString()}자 ${diff !== 0 ? diffText : ''}`;
            rect.appendChild(title);
            svg.appendChild(rect);

            // 2. 값 표시 (막대 위 고정)
            const textGroup = document.createElementNS(svgNamespace, "g");
            const textY = y - 10;
            const subTextY = y - 24;

            const createText = (content, ty, color, size, weight) => {
                const halo = document.createElementNS(svgNamespace, "text");
                const txt = document.createElementNS(svgNamespace, "text");
                [halo, txt].forEach(el => {
                    el.setAttribute("x", centerX);
                    el.setAttribute("y", ty);
                    el.setAttribute("text-anchor", "middle");
                    el.setAttribute("font-size", size);
                    el.setAttribute("font-weight", weight);
                    el.setAttribute("font-family", "var(--font-mono)");
                    el.textContent = content;
                });
                halo.setAttribute("stroke", "var(--color-bg-primary)");
                halo.setAttribute("stroke-width", "4");
                halo.style.opacity = "0.9";
                txt.setAttribute("fill", color);
                textGroup.appendChild(halo);
                textGroup.appendChild(txt);
            };

            // 총 글자 수
            if (val > 0) {
                createText(val.toLocaleString(), textY, "var(--color-text-primary)", "11px", "700");
            }
            // 증감량
            if (i > 0 && diff !== 0) {
                const diffColor = diff > 0 ? "var(--color-accent-success)" : "var(--color-accent-danger)";
                const diffSymbol = diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString();
                createText(diffSymbol, subTextY, diffColor, "10px", "600");
            }
            svg.appendChild(textGroup);
        });

        container.appendChild(svg);

        // X축 라벨 (막대 위치에 맞게 균등 배분)
        labels.forEach(label => {
            const labelEl = document.createElement('div');
            labelEl.textContent = label;
            labelEl.style.width = slotWidth + 'px';
            labelEl.style.textAlign = 'center';
            labelContainer.appendChild(labelEl);
        });
    }

    // ==========================================
    // 🤖 [AI 소설 총괄 비서 (Story Copilot)] 엔진
    // ==========================================

    renderAgent() {
        const currentConfig = this.getAiConfigSync();
        const isDrawerOpen = !!this.isAgentConfigDrawerOpen;
        const mode = this.agentMode || 'ask';

        return `
            <div class="agent-panel-container" style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; gap: 6px;">
                <!-- 1. 헤더: 비서 소개 및 대화 비우기 -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--color-surface-2); border-radius: 8px; border: 1px solid var(--color-border); flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 16px;">🤖</span>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 12px; font-weight: bold; color: var(--color-text-primary);">POV 스토리 비서</span>
                            <span style="font-size: 9px; color: var(--color-accent-primary, #38bdf8);">⚡ 프로젝트 전체 지식 연동 (Tool-Use)</span>
                        </div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-xs" id="agentClearChatBtn" style="font-size: 10px; padding: 2px 6px;" title="대화 기록 비우기">
                        🔄 비우기
                    </button>
                </div>

                <!-- 1-1. 🎛️ 에이전트 작업 모드 선택 바 (Ask / Accept / Plan) -->
                <div class="agent-mode-selector" style="display: flex; gap: 4px; background: var(--color-surface-2); padding: 3px; border-radius: 8px; border: 1px solid var(--color-border); flex-shrink: 0;">
                    <button type="button" class="btn-agent-mode ${mode === 'ask' ? 'active' : ''}" data-mode="ask" style="flex: 1; padding: 4px 2px; font-size: 10px; font-weight: 700; border-radius: 5px; border: 1px solid ${mode === 'ask' ? 'rgba(56, 189, 248, 0.4)' : 'transparent'}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s; background: ${mode === 'ask' ? 'rgba(56, 189, 248, 0.2)' : 'transparent'}; color: ${mode === 'ask' ? '#38bdf8' : 'var(--color-text-tertiary)'};" title="AI의 노드 추가/수정/삭제 제안을 확인하고 승인 후 적용합니다. (기본 모드)">
                        <span>🛡️</span> <span>승인 후 적용</span>
                    </button>
                    <button type="button" class="btn-agent-mode ${mode === 'accept' ? 'active' : ''}" data-mode="accept" style="flex: 1; padding: 4px 2px; font-size: 10px; font-weight: 700; border-radius: 5px; border: 1px solid ${mode === 'accept' ? 'rgba(16, 185, 129, 0.4)' : 'transparent'}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s; background: ${mode === 'accept' ? 'rgba(16, 185, 129, 0.2)' : 'transparent'}; color: ${mode === 'accept' ? '#10b981' : 'var(--color-text-tertiary)'};" title="노드 생성/수정/삭제를 확인 없이 즉시 자동 적용합니다. (accept-edits)">
                        <span>⚡</span> <span>자동 적용</span>
                    </button>
                    <button type="button" class="btn-agent-mode ${mode === 'plan' ? 'active' : ''}" data-mode="plan" style="flex: 1; padding: 4px 2px; font-size: 10px; font-weight: 700; border-radius: 5px; border: 1px solid ${mode === 'plan' ? 'rgba(168, 85, 247, 0.4)' : 'transparent'}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s; background: ${mode === 'plan' ? 'rgba(168, 85, 247, 0.2)' : 'transparent'}; color: ${mode === 'plan' ? '#c084fc' : 'var(--color-text-tertiary)'};" title="노드를 직접 변경하지 않고 현황 분석 및 단계별 수정 계획서만 작성합니다. (Plan)">
                        <span>📋</span> <span>계획 수립</span>
                    </button>
                </div>

                <!-- 2. 메시지 말풍선 스크롤 영역 -->
                <div id="agentMessagesList" style="flex: 1; min-height: 120px; max-height: calc(100vh - 270px); overflow-y: auto; padding: 8px 4px; display: flex; flex-direction: column; gap: 10px; border-radius: 8px; background: var(--color-bg-primary); border: 1px solid var(--color-border);">
                    ${this.renderAgentMessagesHtml()}
                </div>

                <!-- 3. 실시간 도구 실행 상태 표시 바 -->
                <div id="agentToolStatusBar" style="display: none; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(56, 189, 248, 0.1); border-radius: 6px; font-size: 10px; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); flex-shrink: 0;">
                    <span class="agent-tool-spinner" style="display: inline-block;">⏳</span>
                    <span id="agentToolStatusText">관련 노드 탐색 중...</span>
                </div>

                <!-- 4. 하단 입력창 및 전송 버튼 -->
                <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;">
                    <div style="display: flex; gap: 6px; align-items: flex-end; background: var(--color-surface-2); padding: 6px; border-radius: 8px; border: 1px solid var(--color-border);">
                        <textarea id="agentInputText" placeholder="인물, 세계관, 복선, 줄거리 등 무엇이든 물어보세요... (Shift+Enter 줄바꿈, Enter 전송)" rows="2" style="flex: 1; border: none; background: transparent; color: var(--color-text-primary); font-size: 12px; line-height: 1.5; resize: none; outline: none; padding: 4px; max-height: 100px; font-family: inherit;"></textarea>
                        <button type="button" class="btn btn-primary btn-sm" id="agentSendBtn" style="padding: 6px 12px; font-size: 11px; font-weight: bold; flex-shrink: 0; border-radius: 6px;">
                            전송 🚀
                        </button>
                    </div>
                </div>

                <!-- 5. ⚙️ AI 설정 드로어 (채팅 입력창 바로 밑) -->
                <div class="agent-config-drawer" style="background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                    <!-- 드로어 헤더 바 (클릭 시 열림/닫힘 토글) -->
                    <div id="agentConfigToggleHeader" style="display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; cursor: pointer; user-select: none; background: rgba(0,0,0,0.15);">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 12px;">⚙️</span>
                            <span style="font-size: 10px; font-weight: bold; color: var(--color-text-secondary);">AI 설정</span>
                            <span id="agentConfigSummaryBadge" style="font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
                                ${this.escapeHtml(currentConfig.model || 'Gemini')}
                            </span>
                            ${!currentConfig.apiKey ? '<span style="font-size: 9px; color: #ef4444; font-weight: bold;">⚠️ Key 필요</span>' : '<span style="font-size: 9px; color: #10b981;">🟢 Key 준비됨</span>'}
                        </div>
                        <span id="agentConfigToggleIcon" style="font-size: 9px; color: var(--color-text-tertiary); transition: transform 0.2s; transform: ${isDrawerOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">▼</span>
                    </div>

                    <!-- 드로어 본문 설정 폼 -->
                    <div id="agentConfigBody" style="display: ${isDrawerOpen ? 'flex' : 'none'}; padding: 8px; flex-direction: column; gap: 6px; border-top: 1px solid var(--color-border); background: var(--color-bg-primary);">
                        <!-- 플랫폼 & 모델 가로 2단 배치 -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 9px; font-weight: bold; color: var(--color-text-tertiary);">AI 플랫폼</label>
                                <select id="agentProviderSelect" class="input" style="font-size: 11px; padding: 2px 6px; height: 26px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-primary);">
                                    <option value="Google (Gemini)" ${currentConfig.provider === 'Google (Gemini)' ? 'selected' : ''}>Google (Gemini)</option>
                                    <option value="OpenAI (ChatGPT)" ${currentConfig.provider === 'OpenAI (ChatGPT)' ? 'selected' : ''}>OpenAI (ChatGPT)</option>
                                    <option value="Anthropic (Claude)" ${currentConfig.provider === 'Anthropic (Claude)' ? 'selected' : ''}>Anthropic (Claude)</option>
                                    <option value="Ollama (로컬 AI)" ${currentConfig.provider === 'Ollama (로컬 AI)' ? 'selected' : ''}>Ollama (로컬 AI)</option>
                                    <option value="Custom (사용자 정의)" ${currentConfig.provider === 'Custom (사용자 정의)' ? 'selected' : ''}>Custom (사용자 정의)</option>
                                </select>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 9px; font-weight: bold; color: var(--color-text-tertiary);">AI 모델 선택</label>
                                <select id="agentModelPresetSelect" class="input" style="font-size: 11px; padding: 2px 6px; height: 26px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-primary);">
                                    <option value="gemini-3.6-flash" ${currentConfig.model === 'gemini-3.6-flash' || !currentConfig.model || currentConfig.model.includes('2.0') ? 'selected' : ''}>gemini-3.6-flash (최신 추천)</option>
                                    <option value="gemini-1.5-flash" ${currentConfig.model === 'gemini-1.5-flash' ? 'selected' : ''}>gemini-1.5-flash (안정)</option>
                                    <option value="gemini-1.5-pro" ${currentConfig.model === 'gemini-1.5-pro' ? 'selected' : ''}>gemini-1.5-pro</option>
                                    <option value="gpt-4o-mini" ${currentConfig.model === 'gpt-4o-mini' ? 'selected' : ''}>gpt-4o-mini</option>
                                    <option value="gpt-4o" ${currentConfig.model === 'gpt-4o' ? 'selected' : ''}>gpt-4o</option>
                                    <option value="claude-3-5-sonnet" ${currentConfig.model === 'claude-3-5-sonnet' ? 'selected' : ''}>claude-3-5-sonnet</option>
                                    <option value="custom">✏️ 직접 입력...</option>
                                </select>
                                <input type="text" id="agentModelInput" class="input" value="${this.escapeHtml(currentConfig.model || 'gemini-3.6-flash')}" placeholder="직접 모델명 입력" style="display: none; font-size: 11px; padding: 2px 6px; height: 24px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-primary); margin-top: 2px;">
                            </div>
                        </div>

                        <!-- API Key 입력 -->
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 9px; font-weight: bold; color: var(--color-text-tertiary);">API Key</label>
                                <span id="agentKeySavedStatus" style="font-size: 9px; color: #10b981; display: none;">✅ 자동 저장됨</span>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <input type="password" id="agentApiKeyInput" class="input" value="${this.escapeHtml(currentConfig.apiKey || '')}" placeholder="API Key 입력" style="flex: 1; font-size: 11px; padding: 2px 6px; height: 26px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-primary); font-family: monospace;">
                                <button type="button" class="btn btn-secondary btn-xs" id="agentToggleKeyVisibility" style="padding: 0 6px; font-size: 10px;" title="API Key 보기/숨기기">👁️</button>
                            </div>
                        </div>

                        <!-- 창의성 (Temperature) -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px;">
                            <span style="font-size: 9px; font-weight: bold; color: var(--color-text-tertiary); white-space: nowrap;">창의성 (<span id="agentTempDisplay">${currentConfig.temperature ?? 0.7}</span>)</span>
                            <input type="range" id="agentTempSlider" min="0" max="1" step="0.05" value="${currentConfig.temperature ?? 0.7}" style="flex: 1; cursor: pointer; height: 14px;">
                        </div>

                        <!-- 최대 도구 탐색 횟수 (Max Turns) -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px;">
                            <span style="font-size: 9px; font-weight: bold; color: var(--color-text-tertiary); white-space: nowrap;">최대 탐색 턴 (<span id="agentMaxTurnsDisplay">${currentConfig.maxTurns ?? 5}턴</span>)</span>
                            <input type="range" id="agentMaxTurnsSlider" min="1" max="15" step="1" value="${currentConfig.maxTurns ?? 5}" style="flex: 1; cursor: pointer; height: 14px;" title="질문 1개당 AI가 프로젝트 노드를 연속으로 탐색할 수 있는 최대 횟수">
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    setupAgentEventListeners() {
        const inputEl = document.getElementById('agentInputText');
        const sendBtn = document.getElementById('agentSendBtn');
        const clearBtn = document.getElementById('agentClearChatBtn');
        // 모드 전환 버튼 핸들러
        document.querySelectorAll('.btn-agent-mode').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetMode = btn.getAttribute('data-mode') || 'ask';
                this.agentMode = targetMode;
                localStorage.setItem('agent_mode', targetMode);

                // 버튼 활성화 상태 갱신
                document.querySelectorAll('.btn-agent-mode').forEach(b => {
                    const m = b.getAttribute('data-mode');
                    const isActive = m === targetMode;
                    b.classList.toggle('active', isActive);
                    if (m === 'ask') {
                        b.style.background = isActive ? 'rgba(56, 189, 248, 0.2)' : 'transparent';
                        b.style.color = isActive ? '#38bdf8' : 'var(--color-text-tertiary)';
                        b.style.borderColor = isActive ? 'rgba(56, 189, 248, 0.4)' : 'transparent';
                    } else if (m === 'accept') {
                        b.style.background = isActive ? 'rgba(16, 185, 129, 0.2)' : 'transparent';
                        b.style.color = isActive ? '#10b981' : 'var(--color-text-tertiary)';
                        b.style.borderColor = isActive ? 'rgba(16, 185, 129, 0.4)' : 'transparent';
                    } else if (m === 'plan') {
                        b.style.background = isActive ? 'rgba(168, 85, 247, 0.2)' : 'transparent';
                        b.style.color = isActive ? '#c084fc' : 'var(--color-text-tertiary)';
                        b.style.borderColor = isActive ? 'rgba(168, 85, 247, 0.4)' : 'transparent';
                    }
                });

                const modeLabels = {
                    ask: '🛡️ 승인 후 적용 모드 (기본)',
                    accept: '⚡ 자동 적용 모드 (accept-edits)',
                    plan: '📋 계획 수립 모드 (Plan)'
                };
                window.showToast?.(`${modeLabels[targetMode]}로 전환되었습니다.`);
            });
        });

        // 인터랙티브 액션 카드 (승인 / 거절) 이벤트 위임
        const messagesList = document.getElementById('agentMessagesList');
        if (messagesList && !messagesList._actionBound) {
            messagesList._actionBound = true;
            messagesList.addEventListener('click', async (e) => {
                const approveBtn = e.target.closest('.btn-agent-action-approve');
                const rejectBtn = e.target.closest('.btn-agent-action-reject');

                if (approveBtn) {
                    const actionId = approveBtn.getAttribute('data-action-id');
                    if (actionId) {
                        approveBtn.disabled = true;
                        approveBtn.textContent = '⏳ 적용 중...';
                        await this.handleApproveAction(actionId);
                    }
                } else if (rejectBtn) {
                    const actionId = rejectBtn.getAttribute('data-action-id');
                    if (actionId) {
                        this.handleRejectAction(actionId);
                    }
                }
            });
        }
        const drawerHeader = document.getElementById('agentConfigToggleHeader');
        const drawerBody = document.getElementById('agentConfigBody');
        const drawerIcon = document.getElementById('agentConfigToggleIcon');

        if (drawerHeader && drawerBody) {
            drawerHeader.addEventListener('click', () => {
                const isCurrentlyOpen = drawerBody.style.display !== 'none';
                drawerBody.style.display = isCurrentlyOpen ? 'none' : 'flex';
                if (drawerIcon) {
                    drawerIcon.style.transform = isCurrentlyOpen ? 'rotate(0deg)' : 'rotate(180deg)';
                }
                this.isAgentConfigDrawerOpen = !isCurrentlyOpen;
            });
        }

        // 플랫폼 변경 시 모델 기본값 자동 제안
        const providerSelect = document.getElementById('agentProviderSelect');
        const modelInput = document.getElementById('agentModelInput');
        const apiKeyInput = document.getElementById('agentApiKeyInput');
        const tempSlider = document.getElementById('agentTempSlider');
        const tempDisplay = document.getElementById('agentTempDisplay');
        const maxTurnsSlider = document.getElementById('agentMaxTurnsSlider');
        const maxTurnsDisplay = document.getElementById('agentMaxTurnsDisplay');
        const keySavedStatus = document.getElementById('agentKeySavedStatus');

        const showSavedBadge = () => {
            if (keySavedStatus) {
                keySavedStatus.style.display = 'inline';
                setTimeout(() => { if (keySavedStatus) keySavedStatus.style.display = 'none'; }, 2000);
            }
        };

        const saveCurrentAiSettings = () => {
            const provider = providerSelect?.value || 'Google (Gemini)';
            const model = modelInput?.value?.trim() || 'gemini-3.6-flash';
            const apiKey = apiKeyInput?.value?.trim() || '';
            const temperature = tempSlider ? Number(tempSlider.value) : 0.7;
            const maxTurns = maxTurnsSlider ? Number(maxTurnsSlider.value) : 5;

            // 로컬 스토리지 및 settings 저장
            localStorage.setItem('ai_provider', provider);
            localStorage.setItem('ai_model', model);
            localStorage.setItem('ai_api_key', apiKey);
            localStorage.setItem('global_gemini_api_key', apiKey);
            localStorage.setItem('ai_temperature', String(temperature));
            localStorage.setItem('ai_max_turns', String(maxTurns));

            if (!this.settings) this.settings = {};
            this.settings.aiProvider = provider;
            this.settings.aiModel = model;
            this.settings.apiKey = apiKey;
            this.settings.temperature = temperature;
            this.settings.maxTurns = maxTurns;

            // 요약 뱃지 갱신
            const badge = document.getElementById('agentConfigSummaryBadge');
            if (badge) badge.textContent = model;

            showSavedBadge();

            // 만약 현재 프로젝트에 AI 설정 노드가 있다면 그 내용도 함께 동기화
            this.syncWithAiConfigNode(provider, model, apiKey, temperature);
        };

        if (providerSelect) {
            providerSelect.addEventListener('change', () => {
                const val = providerSelect.value;
                if (modelInput) {
                    if (val.includes('Google') || val.includes('Gemini')) modelInput.value = 'gemini-3.6-flash';
                    else if (val.includes('OpenAI')) modelInput.value = 'gpt-4o-mini';
                    else if (val.includes('Anthropic') || val.includes('Claude')) modelInput.value = 'claude-3-5-sonnet';
                    else if (val.includes('Ollama')) modelInput.value = 'llama3.2';
                }
                saveCurrentAiSettings();
            });
        }

        const modelPresetSelect = document.getElementById('agentModelPresetSelect');
        if (modelPresetSelect) {
            modelPresetSelect.addEventListener('change', () => {
                const selected = modelPresetSelect.value;
                if (selected === 'custom') {
                    if (modelInput) {
                        modelInput.style.display = 'block';
                        modelInput.focus();
                    }
                } else {
                    if (modelInput) {
                        modelInput.style.display = 'none';
                        modelInput.value = selected;
                    }
                    saveCurrentAiSettings();
                }
            });
        }

        if (modelInput) {
            modelInput.addEventListener('change', saveCurrentAiSettings);
        }

        if (apiKeyInput) {
            apiKeyInput.addEventListener('change', saveCurrentAiSettings);
            apiKeyInput.addEventListener('input', () => {
                // 타이핑 중에도 저장
                localStorage.setItem('global_gemini_api_key', apiKeyInput.value.trim());
                localStorage.setItem('ai_api_key', apiKeyInput.value.trim());
                if (this.settings) this.settings.apiKey = apiKeyInput.value.trim();
            });
        }

        // 비밀번호 보이기/숨기기 토글
        const toggleKeyBtn = document.getElementById('agentToggleKeyVisibility');
        if (toggleKeyBtn && apiKeyInput) {
            toggleKeyBtn.addEventListener('click', () => {
                if (apiKeyInput.type === 'password') {
                    apiKeyInput.type = 'text';
                    toggleKeyBtn.textContent = '🔒';
                } else {
                    apiKeyInput.type = 'password';
                    toggleKeyBtn.textContent = '👁️';
                }
            });
        }

        if (tempSlider) {
            tempSlider.addEventListener('input', () => {
                if (tempDisplay) tempDisplay.textContent = tempSlider.value;
                saveCurrentAiSettings();
            });
        }

        if (maxTurnsSlider) {
            maxTurnsSlider.addEventListener('input', () => {
                if (maxTurnsDisplay) maxTurnsDisplay.textContent = maxTurnsSlider.value + '턴';
                saveCurrentAiSettings();
            });
        }

        // 엔터키 전송 (Shift+Enter 줄바꿈)
        if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = inputEl.value.trim();
                    if (text && !this.isAgentLoading) {
                        inputEl.value = '';
                        this.askAgent(text);
                    }
                }
            });

            // 입력창 자동 높이 조절
            inputEl.addEventListener('input', () => {
                inputEl.style.height = 'auto';
                inputEl.style.height = Math.min(100, Math.max(36, inputEl.scrollHeight)) + 'px';
            });
        }

        // 전송 버튼 클릭
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const text = inputEl?.value?.trim();
                if (text && !this.isAgentLoading) {
                    if (inputEl) inputEl.value = '';
                    this.askAgent(text);
                }
            });
        }

        // 대화 비우기 버튼
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (this.agentHistory.length === 0) return;
                if (confirm('AI 비서와의 대화 기록을 모두 비울까요?')) {
                    this.agentHistory = [];
                    this.lastReferencedNodes = [];
                    this.updateAgentMessagesView();
                }
            });
        }
    }

    /**
     * 🔄 캔버스 상의 AI 설정 노드(preset_sys_ai_config)와 양방향 동기화
     */
    async syncWithAiConfigNode(provider, model, apiKey, temperature) {
        const projectId = this.currentProjectId || window.currentProjectId || window.fileTreeManager?.currentProjectId || window.projectManager?.currentProjectId;
        if (!projectId || !window.storage) return;

        try {
            const files = await window.storage.getProjectFiles(projectId);
            const aiNode = files?.find(f => {
                const norm = window.nodeEngine?.normalizeNodeData(f);
                return f.presetId === 'preset_sys_ai_config' || norm?.presetId === 'preset_sys_ai_config' || f.name.includes('AI 설정') || f.name.includes('AI 환경');
            });

            if (aiNode) {
                const norm = window.nodeEngine?.normalizeNodeData(aiNode);
                const cd = norm?.contentData || {};
                cd.provider = provider;
                cd.model = model;
                cd.apiKey = apiKey;
                cd.temperature = temperature;
                aiNode.content = JSON.stringify(cd, null, 2);
                aiNode.contentData = cd;
                await window.storage.updateFile(aiNode.id, { content: aiNode.content, contentData: cd });
                window.windowManager?.renderCustomNode(aiNode.id);
            }
        } catch (err) {
            console.warn('AI 설정 노드 동기화 건너뜀:', err);
        }
    }

    /**
     * ⚡ 동기식 AI 설정 조회 (렌더링 시 사용)
     */
    getAiConfigSync() {
        const savedKey = this.settings?.apiKey || localStorage.getItem('global_gemini_api_key') || localStorage.getItem('ai_api_key') || '';
        const savedProvider = this.settings?.aiProvider || localStorage.getItem('ai_provider') || 'Google (Gemini)';
        const savedModel = this.settings?.aiModel || localStorage.getItem('ai_model') || 'gemini-3.6-flash';
        const savedTemp = localStorage.getItem('ai_temperature') ? Number(localStorage.getItem('ai_temperature')) : 0.7;
        const savedMaxTurns = localStorage.getItem('ai_max_turns') ? Number(localStorage.getItem('ai_max_turns')) : (this.settings?.maxTurns || 5);

        return {
            provider: savedProvider,
            model: savedModel,
            apiKey: savedKey,
            temperature: savedTemp,
            maxTurns: savedMaxTurns
        };
    }

    renderAgentMessagesHtml() {
        if (!this.agentHistory || this.agentHistory.length === 0) {
            const mode = this.agentMode || 'ask';
            const modeDesc = {
                ask: '🛡️ <b>승인 후 적용 모드</b>: 대화하며 필요한 노드 생성·수정·삭제를 제안하고 승인 시 적용합니다.',
                accept: '⚡ <b>자동 적용 모드</b>: 대화 중 노드 생성·수정·삭제를 스스로 판단하여 즉시 캔버스에 반영합니다.',
                plan: '📋 <b>계획 수립 모드</b>: 프로젝트를 심층 분석하여 체계적인 작업 계획서를 먼저 작성합니다.'
            };

            return `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 140px; text-align: center; color: var(--color-text-tertiary); padding: 16px 10px; gap: 8px;">
                    <span style="font-size: 28px; opacity: 0.8;">🤖✨</span>
                    <div style="font-size: 12px; font-weight: bold; color: var(--color-text-primary);">POV 소설 총괄 비서 (Story Copilot)</div>
                    <div style="font-size: 11px; line-height: 1.6; max-width: 260px; color: var(--color-text-secondary);">
                        캔버스와 파일 트리의 모든 인물 카드, 세계관, 복선, 대본, 원고를 실시간으로 꿰뚫고 집필을 돕습니다.
                    </div>
                    <div style="font-size: 10px; line-height: 1.5; max-width: 260px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); padding: 6px 8px; border-radius: 6px; color: var(--color-text-primary); margin-top: 4px;">
                        ${modeDesc[mode] || modeDesc.ask}
                    </div>
                </div>
            `;
        }

        return this.agentHistory.map((msg) => {
            const isUser = msg.role === 'user';
            const avatar = isUser ? '👤' : '🤖';
            const name = isUser ? '작가님' : '스토리 비서';
            const bubbleBg = isUser ? 'var(--color-surface-2)' : 'rgba(56, 189, 248, 0.05)';
            const bubbleBorder = isUser ? 'var(--color-border)' : 'rgba(56, 189, 248, 0.2)';
            const align = isUser ? 'flex-end' : 'flex-start';

            const citationsHtml = (!isUser && Array.isArray(msg.citations) && msg.citations.length > 0) ? `
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 10px;">
                    <span style="color: var(--color-text-tertiary);">🔍 참조 노드:</span>
                    ${msg.citations.map(c => `<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.3);">${this.escapeHtml(c)}</span>`).join('')}
                </div>
            ` : '';

            const thinkingHtml = (!isUser && Array.isArray(msg.toolCallsLog) && msg.toolCallsLog.length > 0) ? `
                <details style="margin-bottom: 6px; background: rgba(0,0,0,0.2); border-radius: 6px; padding: 4px 8px; border: 1px solid rgba(255,255,255,0.06); font-size: 10px;">
                    <summary style="cursor: pointer; color: var(--color-accent-primary, #38bdf8); font-weight: bold; user-select: none; font-size: 10px; display: flex; align-items: center; gap: 4px;">
                        <span>💭 AI 사고 과정 & 도구 실행 기록</span>
                        <span style="background: rgba(56, 189, 248, 0.15); padding: 1px 5px; border-radius: 8px; font-size: 9px;">${msg.toolCallsLog.length}회</span>
                    </summary>
                    <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px; font-size: 10px; color: var(--color-text-secondary);">
                        ${msg.toolCallsLog.map(t => {
                            const argStr = Object.entries(t.args || {}).map(([k, v]) => `${k}="${typeof v === 'object' ? JSON.stringify(v) : v}"`).join(', ');
                            return `
                                <div style="display: flex; gap: 4px; align-items: baseline; flex-wrap: wrap;">
                                    <span style="color: #38bdf8; font-weight: bold;">[${t.turn}턴]</span>
                                    <span style="font-family: monospace; color: var(--color-text-primary);"><b>${t.name}</b>(${this.escapeHtml(argStr)})</span>
                                    ${t.resultSummary ? `<span style="color: var(--color-text-tertiary);">➔ ${this.escapeHtml(t.resultSummary)}</span>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </details>
            ` : '';

            // 📦 승인 대기 / 실행된 액션 카드 렌더링
            const actionCardsHtml = (!isUser && Array.isArray(msg.actions) && msg.actions.length > 0) ? `
                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
                    ${msg.actions.map(actId => this.renderSingleActionCardHtml(actId)).join('')}
                </div>
            ` : '';

            return `
                <div style="display: flex; flex-direction: column; align-items: ${align}; gap: 2px; width: 100%; box-sizing: border-box;">
                    <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: bold; color: var(--color-text-tertiary); padding: 0 4px;">
                        <span>${avatar}</span>
                        <span>${name}</span>
                    </div>
                    <div style="max-width: 92%; background: ${bubbleBg}; border: 1px solid ${bubbleBorder}; border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 1.6; color: var(--color-text-primary); word-break: break-word; box-sizing: border-box;">
                        ${thinkingHtml}
                        ${isUser ? this.escapeHtml(msg.content).replace(/\n/g, '<br>') : this.formatAgentMarkdown(msg.content)}
                        ${actionCardsHtml}
                        ${citationsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * 📦 개별 액션 카드(승인/거절/완료) 렌더링
     */
    renderSingleActionCardHtml(actionId) {
        const act = this.pendingActionsMap.get(actionId);
        if (!act) return '';

        const type = act.type;
        const status = act.status || 'pending';
        const data = act.data || {};

        let title = '';
        let badgeColor = '#38bdf8';
        let icon = '⚡';
        let bodyHtml = '';

        if (type === 'create_node') {
            title = `새 노드 생성: '${data.name || '새 노드'}'`;
            badgeColor = '#10b981';
            icon = '✨';

            const fieldsList = data.fields ? Object.entries(data.fields).map(([k, v]) => `
                <div style="display: flex; gap: 6px; font-size: 11px;">
                    <span style="color: var(--color-text-tertiary); min-width: 60px;">• ${this.escapeHtml(k)}:</span>
                    <span style="color: var(--color-text-primary); font-weight: 500;">${this.escapeHtml(String(v))}</span>
                </div>
            `).join('') : '';

            bodyHtml = `
                <div style="font-size: 11px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; gap: 6px;"><span style="color: var(--color-text-tertiary);">카테고리:</span> <span style="color: #38bdf8; font-weight: bold;">${this.escapeHtml(data.category || data.presetId || 'general')}</span></div>
                    ${data.description ? `<div style="display: flex; gap: 6px;"><span style="color: var(--color-text-tertiary);">설명:</span> <span>${this.escapeHtml(data.description)}</span></div>` : ''}
                    ${fieldsList ? `<div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 2px;">${fieldsList}</div>` : ''}
                    ${data.content ? `<div style="margin-top: 4px; padding: 4px 6px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 10px; font-family: monospace; white-space: pre-wrap; max-height: 80px; overflow-y: auto;">${this.escapeHtml(data.content.slice(0, 150))}${data.content.length > 150 ? '...' : ''}</div>` : ''}
                </div>
            `;
        } else if (type === 'update_node') {
            title = `노드 수정: '${data.nodeName || '지정 노드'}'`;
            badgeColor = '#f59e0b';
            icon = '📝';

            const diffList = (act.diff && Array.isArray(act.diff)) ? act.diff.map(d => `
                <div style="display: flex; flex-direction: column; gap: 1px; font-size: 11px; background: rgba(0,0,0,0.15); padding: 3px 6px; border-radius: 4px;">
                    <span style="color: #f59e0b; font-weight: bold;">• ${this.escapeHtml(d.key)}</span>
                    <div style="display: flex; gap: 4px; font-size: 10px;">
                        <span style="color: #ef4444; text-decoration: line-through;">${this.escapeHtml(String(d.oldVal || '(비어있음)'))}</span>
                        <span style="color: var(--color-text-tertiary);">➔</span>
                        <span style="color: #10b981; font-weight: bold;">${this.escapeHtml(String(d.newVal || ''))}</span>
                    </div>
                </div>
            `).join('') : (data.fields ? Object.entries(data.fields).map(([k, v]) => `
                <div style="display: flex; gap: 6px; font-size: 11px;">
                    <span style="color: var(--color-text-tertiary);">• ${this.escapeHtml(k)}:</span>
                    <span style="color: #10b981; font-weight: bold;">${this.escapeHtml(String(v))}</span>
                </div>
            `).join('') : '');

            bodyHtml = `
                <div style="font-size: 11px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 4px;">
                    ${data.newName && data.newName !== data.nodeName ? `<div style="font-size: 11px; color: #38bdf8;">📌 이름 변경: <b>${this.escapeHtml(data.nodeName)}</b> ➔ <b>${this.escapeHtml(data.newName)}</b></div>` : ''}
                    <div style="display: flex; flex-direction: column; gap: 3px;">${diffList}</div>
                    ${data.content ? `<div style="margin-top: 4px; padding: 4px 6px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 10px; font-family: monospace; white-space: pre-wrap; max-height: 80px; overflow-y: auto;">${this.escapeHtml(data.content.slice(0, 150))}${data.content.length > 150 ? '...' : ''}</div>` : ''}
                </div>
            `;
        } else if (type === 'delete_node') {
            title = `노드 삭제: '${data.nodeName || '지정 노드'}'`;
            badgeColor = '#ef4444';
            icon = '🗑️';

            bodyHtml = `
                <div style="font-size: 11px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 3px;">
                    <div style="color: #ef4444; font-weight: bold;">⚠️ 주의: 노드 및 캔버스 창, 연결선이 완전히 삭제됩니다.</div>
                    ${data.reason ? `<div><span style="color: var(--color-text-tertiary);">사유:</span> <span>${this.escapeHtml(data.reason)}</span></div>` : ''}
                </div>
            `;
        }

        let actionFooter = '';
        if (status === 'pending') {
            actionFooter = `
                <div style="display: flex; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); justify-content: flex-end;">
                    <button type="button" class="btn btn-secondary btn-xs btn-agent-action-reject" data-action-id="${actionId}" style="padding: 3px 8px; font-size: 10px; border-radius: 4px; cursor: pointer;">
                        ❌ 거절
                    </button>
                    <button type="button" class="btn btn-primary btn-xs btn-agent-action-approve" data-action-id="${actionId}" style="padding: 3px 10px; font-size: 10px; font-weight: bold; background: #10b981; border: 1px solid #059669; color: #fff; border-radius: 4px; cursor: pointer;">
                        ✅ 승인 및 적용
                    </button>
                </div>
            `;
        } else if (status === 'applied') {
            actionFooter = `
                <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #10b981; font-weight: bold;">
                    <span>✅ 적용 완료 (캔버스에 반영됨)</span>
                    <span style="font-size: 9px; opacity: 0.8;">${new Date(act.appliedAt || Date.now()).toLocaleTimeString()}</span>
                </div>
            `;
        } else if (status === 'rejected') {
            actionFooter = `
                <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 10px; color: var(--color-text-tertiary);">
                    <span>❌ 제안이 거절/취소되었습니다.</span>
                </div>
            `;
        }

        return `
            <div class="agent-action-card" data-action-id="${actionId}" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.12); border-left: 3px solid ${badgeColor}; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: bold; color: var(--color-text-primary);">
                        <span>${icon}</span>
                        <span>${this.escapeHtml(title)}</span>
                    </div>
                    <span style="font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.08); color: ${badgeColor}; border: 1px solid rgba(255,255,255,0.1); font-weight: bold;">
                        ${status === 'pending' ? '승인 대기' : (status === 'applied' ? '적용 완료' : '거절됨')}
                    </span>
                </div>
                <div style="margin-top: 4px;">
                    ${bodyHtml}
                </div>
                ${actionFooter}
            </div>
        `;
    }

    scrollAgentToBottom(smooth = true) {
        const listEl = document.getElementById('agentMessagesList');
        if (listEl) {
            requestAnimationFrame(() => {
                listEl.scrollTo({
                    top: listEl.scrollHeight,
                    behavior: smooth ? 'smooth' : 'auto'
                });
            });
            setTimeout(() => {
                if (listEl) listEl.scrollTop = listEl.scrollHeight;
            }, 60);
        }
    }

    updateAgentMessagesView(scrollSmooth = true) {
        const listEl = document.getElementById('agentMessagesList');
        if (listEl) {
            listEl.innerHTML = this.renderAgentMessagesHtml();
            this.scrollAgentToBottom(scrollSmooth);
        }
    }

    setAgentToolStatus(show, text = '') {
        const bar = document.getElementById('agentToolStatusBar');
        const textEl = document.getElementById('agentToolStatusText');
        if (bar && textEl) {
            bar.style.display = show ? 'flex' : 'none';
            if (text) textEl.textContent = text;
            if (show) this.scrollAgentToBottom(true);
        }
    }

    /**
     * 🤖 AI 에이전트 질문 전송 및 도구 호출 루프
     */
    async askAgent(userPrompt) {
        if (!userPrompt || this.isAgentLoading) return;
        this.isAgentLoading = true;
        if (!Array.isArray(this.agentHistory)) this.agentHistory = [];

        // 1. 사용자 메시지 추가
        this.agentHistory.push({ role: 'user', content: userPrompt });
        this.updateAgentMessagesView();

        // 2. AI 설정 조회 (프로젝트 내 AI 설정 노드 우선)
        const aiConfig = await this.getAiConfigForAgent();
        if (!aiConfig.apiKey) {
            this.agentHistory.push({
                role: 'assistant',
                content: '⚠️ **AI API Key가 설정되지 않았습니다.**\n\n프로젝트 캔버스에 `[AI 설정 노드]`를 추가하여 API Key를 입력하시거나, 우측 `[환경 설정]` 탭에서 API Key를 입력해 주시면 소설 지식을 실시간으로 탐색할 수 있습니다!'
            });
            this.isAgentLoading = false;
            this.updateAgentMessagesView();
            return;
        }

        // 3. 로딩 상태 및 도구 바 표시
        const currentMode = this.agentMode || 'ask';
        this.setAgentToolStatus(true, '🧠 질문 분석 및 지식 도구 탐색 중...');
        const referencedNodeNames = new Set();
        const triggeredActionIds = [];

        try {
            // 도구 정의 (Tool Declarations)
            const agentTools = [
                {
                    name: 'list_project_nodes',
                    description: '현재 소설 프로젝트에 존재하는 모든 노드(등장인물, 세계관, 씬 대본, 원고, 복선 등)의 목록과 카테고리, 1줄 요약을 조회합니다. 특정 키워드가 없는 질문이나 전체 설정을 파악할 때 가장 먼저 호출하세요.',
                    parameters: {
                        type: 'object',
                        properties: {
                            category: { type: 'string', description: '선택사항: 특정 카테고리만 필터링 (character, lore, plot, manuscript, prompt 등)' }
                        }
                    }
                },
                {
                    name: 'search_story_nodes',
                    description: '소설 속 사건, 키워드, 고유명사, 인물 이름 등으로 프로젝트 내 노드를 고속 검색합니다.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: '검색할 키워드 또는 질의어 (예: 카일 치유약, 마법 체계 등)' },
                            limit: { type: 'number', description: '최대 결과 개수 (기본값: 5)' }
                        },
                        required: ['query']
                    }
                },
                {
                    name: 'read_node_detail',
                    description: '특정 노드의 상세 소설 본문과 설정 데이터를 메타데이터 없이 순수하게 정제하여 열람합니다.',
                    parameters: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string', description: '열람할 노드의 ID (선택)' },
                            nodeName: { type: 'string', description: '열람할 노드의 이름 (예: 카일, 아르카디아 대륙, 제 1화 등)' }
                        }
                    }
                },
                {
                    name: 'create_node',
                    description: '소설 프로젝트에 새로운 노드(등장인물, 세계관/설정, 고유명사, 플롯/씬, 원고 등)를 새로 생성하여 캔버스에 추가합니다. fields 객체에 성격, 외모, 설정, 배경 등 상세 내용을 알차게 채워서 호출하세요.',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '생성할 노드의 이름 (예: 카일, 아르카디아 제국, 백은 기사단, 제 1화 - 시작)' },
                            category: { type: 'string', description: '노드 카테고리: character (인물), lore (세계관), proper (고유명사/아이템/세력/장소), plot (플롯/시나리오), manuscript (원고) 중 하나' },
                            fields: {
                                type: 'object',
                                description: '노드 유형별 상세 설정 필드 객체:\n• character (인물): { role: "역할/직업", profile_summary: "나이/성별/신분", personality: "성격 및 내면", appearance: "외모/복장", speech_tone: "말투/호칭", special_ability: "특수능력/스킬", past_and_motivation: "과거사/동기", dialogue_examples: "대표 대사 예시", relationships: "인간관계" }\n• proper (고유명사/세력/장소/아이템): { term: "명칭", type: "장소|세력 / 길드|사건 / 역사|특수 현상 / 법칙|마도구 / 아이템", desc: "상세 정의 및 설정 설명", keywords: "트리거 키워드" }\n• lore (세계관): { title: "세계관 제목", tags: "태그", logline: "한줄소개", background_lore: "시대/마법/사회체계 등 상세 배경" }\n• plot (플롯/시나리오): { scenario_title: "소제목", core_goal: "핵심 목표", main_conflict: "주요 갈등", climax_turning_point: "절정/전환점", resolution_outcome: "결말" }\n• manuscript (원고): { editorVal: "소설 본문 텍스트" }'
                            },
                            content: { type: 'string', description: '원고 본문 내용 또는 일반 텍스트' },
                            description: { type: 'string', description: '노드에 대한 간략한 설명' }
                        },
                        required: ['name', 'fields']
                    }
                },
                {
                    name: 'update_node',
                    description: '기존 노드의 설정 필드값, 본문 텍스트, 또는 노드 이름을 부분/전체 수정합니다.',
                    parameters: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string', description: '수정할 대상 노드의 ID' },
                            nodeName: { type: 'string', description: '수정할 대상 노드의 이름 (nodeId가 없을 경우 사용)' },
                            name: { type: 'string', description: '노드의 새 이름 (이름을 변경할 때만 지정)' },
                            fields: { type: 'object', description: '수정하거나 추가할 위젯 필드들의 키-값 객체 (기존 필드는 보존되고 전달된 필드만 병합)' },
                            content: { type: 'string', description: '일반 텍스트나 원고 노드일 경우 수정할 전체 본문 내용' }
                        }
                    }
                },
                {
                    name: 'delete_node',
                    description: '더 이상 필요 없거나 중복/삭제를 요청받은 노드를 프로젝트와 캔버스에서 안전하게 삭제합니다.',
                    parameters: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string', description: '삭제할 노드의 ID' },
                            nodeName: { type: 'string', description: '삭제할 노드의 이름 (nodeId가 없을 경우 사용)' },
                            reason: { type: 'string', description: '노드 삭제 사유' }
                        }
                    }
                }
            ];

            let modeSystemInstruction = '';
            if (currentMode === 'plan') {
                modeSystemInstruction = `
[🚨 현재 작업 모드: 📋 계획 수립 모드 (PLANNING MODE)]
- 당신은 '계획 수립 모드'입니다. 실제 노드를 생성, 수정, 삭제하는 쓰기 도구('create_node', 'update_node', 'delete_node')는 절대 호출하지 마세요.
- 오직 읽기 도구('list_project_nodes', 'search_story_nodes', 'read_node_detail')만을 활용하여 프로젝트 현황을 완벽히 분석하세요.
- 분석을 바탕으로, 앞으로 수행할 단계별 작업 계획서(추가/수정할 노드 구성안, 설정 내용, 체크리스트 등)를 마크다운으로 체계적이고 구체적으로 작성하세요.
- 답변 마지막에 "계획이 마음에 드시면 상단의 [승인 후 적용] 또는 [자동 적용] 모드로 전환하여 작업을 요청해주세요."라고 안내하세요.`;
            } else if (currentMode === 'accept') {
                modeSystemInstruction = `
[⚡ 현재 작업 모드: 자동 적용 모드 (ACCEPT-EDITS MODE)]
- 당신은 '자동 적용 모드'입니다. 사용자의 요청이나 스토리 보완 작업에 맞춰 'create_node', 'update_node', 'delete_node' 도구를 즉시 호출하여 실제 캔버스와 프로젝트에 자율 반영하세요.
- 반영 후 어떤 노드가 어떻게 생성·수정·삭제되었는지 명확하고 깔끔하게 요약 보고하세요.`;
            } else {
                modeSystemInstruction = `
[🛡️ 현재 작업 모드: 승인 후 적용 모드 (ASK BEFORE EDIT - 기본)]
- 당신은 '승인 후 적용 모드'입니다. 사용자의 요청이나 스토리 보완에 필요한 경우 'create_node', 'update_node', 'delete_node' 도구를 자유롭게 호출하세요.
- 도구를 호출하면 시스템이 사용자에게 확인/승인 카드를 자동으로 띄웁니다.
- 제안 후 사용자에게 어떤 내용을 왜 변경/추가하도록 제안했는지 명확하고 친절하게 설명하세요.`;
            }

            const systemPrompt = `당신은 사용자의 웹소설 프로젝트를 100% 완벽히 파악하고 집필을 돕는 최고급 'POV 소설 총괄 비서 (Story Copilot)'입니다.
프로젝트의 모든 설정과 원고는 도구(Tool)를 통해 실시간으로 접근 및 조작할 수 있습니다.

${modeSystemInstruction}

[도구 사용 및 지식 탐색 핵심 원칙]
1. 인사(예: "안녕", "반가워"), 잡담, 일반적 창작 조언 등 프로젝트 노드 조회가 불필요한 대화에는 도구를 절대 호출하지 말고 즉시 친절하게 답변하세요.
2. "지금 설정 어때?", "등장인물 누구 있냐", "설정 뭐뭐 있냐" 같이 프로젝트 목록/현황을 묻는 질문에는 'list_project_nodes'를 호출하세요. 'list_project_nodes'가 반환하는 노드 이름과 요약 목록만으로도 충분히 답변할 수 있으므로, 모든 노드를 불필요하게 'read_node_detail'로 하나하나 열람하여 턴을 낭비하지 마세요.
3. 특정 인물(예: 카일)이나 사건에 대한 상세 설정 및 본문 팩트 확인이 구체적으로 필요할 때만 'read_node_detail'을 호출하여 확인하세요.
4. 노드를 새로 만들 때는 'create_node'를 호출하고, 인물은 character, 세계관은 lore, 고유명사는 proper, 플롯/씬은 plot 카테고리를 적절히 지정하고 fields에 성격/설정 등을 풍부하게 채우세요.
5. 기존 노드를 변경할 때는 'update_node'를 호출하여 변경할 필드(fields)를 명시하세요.
6. 도구를 호출한 뒤에는 반드시 사용자에게 작업 내용이나 조회된 사실을 친절하게 한국어 문장으로 설명해야 합니다. (텍스트 없이 종료 금지)
7. 마크다운 서식(굵은 글씨, 목록, 인용구 등)을 활용하여 가독성 높게 답변하세요.`;

            // 도구 실행 핸들러 (Tool Executor)
            const toolExecutor = async (name, args) => {
                let statusText = '프로젝트 지식 탐색 중...';
                if (name === 'read_node_detail') statusText = `'${args.nodeName || args.nodeId}' 노드 열람 중...`;
                else if (name === 'create_node') statusText = `'${args.name}' 노드 생성 작업 중...`;
                else if (name === 'update_node') statusText = `'${args.nodeName || args.nodeId}' 노드 수정 작업 중...`;
                else if (name === 'delete_node') statusText = `'${args.nodeName || args.nodeId}' 노드 삭제 작업 중...`;

                this.setAgentToolStatus(true, `🔍 [도구 실행] ${statusText}`);
                const result = await this.executeAgentTool(name, args);

                if (name === 'read_node_detail' && result?.nodeName) {
                    referencedNodeNames.add(result.nodeName);
                } else if (name === 'search_story_nodes' && Array.isArray(result)) {
                    result.forEach(r => r.name && referencedNodeNames.add(r.name));
                }

                if (result?.actionId) {
                    triggeredActionIds.push(result.actionId);
                }

                return result;
            };

            // AI 호출 (Function Calling 지원 엔진)
            let answer = '';
            let res = null;
            const toolCallsLog = [];

            if (window.aiApi?.callWithTools) {
                const maxTurns = aiConfig.maxTurns || 10;
                res = await window.aiApi.callWithTools(
                    aiConfig,
                    systemPrompt,
                    userPrompt,
                    agentTools,
                    toolExecutor,
                    maxTurns,
                    toolCallsLog
                );
                answer = (res && typeof res === 'object') ? (res.finalText || JSON.stringify(res)) : String(res || '');
            } else {
                answer = await window.aiApi.call(aiConfig, systemPrompt, userPrompt);
            }

            // 응답 추가
            const logEntries = (res && typeof res === 'object' && Array.isArray(res.toolCallsLog)) ? res.toolCallsLog : (Array.isArray(toolCallsLog) ? toolCallsLog : []);
            this.agentHistory.push({
                role: 'assistant',
                content: answer || '답변을 생성하지 못했습니다.',
                citations: Array.from(referencedNodeNames),
                actions: triggeredActionIds.length > 0 ? triggeredActionIds : undefined,
                toolCallsLog: logEntries
            });

        } catch (err) {
            console.error('AI 에이전트 질의 오류:', err);
            this.agentHistory.push({
                role: 'assistant',
                content: `❌ **오류가 발생했습니다:** ${err.message || 'AI 서버 응답 실패'}`
            });
        } finally {
            this.isAgentLoading = false;
            this.setAgentToolStatus(false);
            this.updateAgentMessagesView();
        }
    }

    /**
     * 🛠️ 에이전트 전용 로컬 도구 실행 함수 (CRUD 및 검색 지원)
     */
    async executeAgentTool(name, args = {}) {
        const projectId = this.currentProjectId || window.currentProjectId || window.fileTreeManager?.currentProjectId || window.projectManager?.currentProjectId;
        if (!projectId) {
            return { error: '활성화된 프로젝트가 없습니다.' };
        }

        try {
            const files = await window.storage.getProjectFiles(projectId);
            const nonFolderFiles = (files || []).filter(f => f.type !== 'folder');
            const currentMode = this.agentMode || 'ask';

            // 지능형 노드 카테고리 분류 헬퍼
            const classifyNode = (file, norm) => {
                const nameLower = String(file.name || '').toLowerCase();
                const presetLower = String(file.presetId || norm?.presetId || '').toLowerCase();
                const templateLower = String(file.template || norm?.template || '').toLowerCase();
                const cd = norm?.contentData || {};
                const keys = Object.keys(cd).join(' ').toLowerCase();

                if (
                    nameLower.includes('인물') || nameLower.includes('캐릭터') || nameLower.includes('주인공') || 
                    nameLower.includes('조연') || nameLower.includes('악역') || nameLower.includes('페르소나') ||
                    presetLower.includes('char') || templateLower.includes('char') ||
                    keys.includes('charname') || keys.includes('persona') || keys.includes('personality') || keys.includes('appearance')
                ) {
                    return 'character';
                }

                if (
                    nameLower.includes('세계관') || nameLower.includes('설정') || nameLower.includes('지리') || 
                    nameLower.includes('마법') || nameLower.includes('아이템') || nameLower.includes('세력') ||
                    presetLower.includes('lore') || templateLower.includes('lore') || keys.includes('world') || keys.includes('lore')
                ) {
                    return 'lore';
                }

                if (
                    nameLower.includes('플롯') || nameLower.includes('대본') || nameLower.includes('씬') || 
                    nameLower.includes('시나리오') || nameLower.includes('갈등') ||
                    presetLower.includes('plot') || presetLower.includes('scene') || templateLower.includes('plot')
                ) {
                    return 'plot';
                }

                if (
                    nameLower.includes('원고') || nameLower.includes('본문') || nameLower.includes('소설') ||
                    nameLower.includes('화') || nameLower.includes('에피소드') ||
                    presetLower.includes('novel') || presetLower.includes('manuscript') || templateLower.includes('manuscript')
                ) {
                    return 'manuscript';
                }

                return file.category || norm?.category || 'general';
            };

            // 1줄 요약 추출 헬퍼 (0토큰 무비용)
            const extractSummary = (norm) => {
                const cd = norm?.contentData || {};
                const priority = cd.role || cd.summary || cd.traits || cd.sceneGoal || cd.outline || cd.topic || cd.charName || cd.title;
                if (priority && typeof priority === 'string' && priority.trim()) {
                    return priority.trim().replace(/\n/g, ' ').slice(0, 50);
                }
                const body = cd.content || cd.editorVal || cd.text || '';
                if (typeof body === 'string' && body.trim()) {
                    return body.trim().replace(/\n/g, ' ').slice(0, 35) + '...';
                }
                return '';
            };

            // 1. 전체 노드 목록 조회
            if (name === 'list_project_nodes') {
                const categorized = {
                    characters: [],
                    lore: [],
                    plots: [],
                    manuscripts: [],
                    others: []
                };

                for (const f of nonFolderFiles) {
                    const norm = window.nodeEngine?.normalizeNodeData(f);
                    const cat = classifyNode(f, norm);
                    const summary = extractSummary(norm);
                    const item = {
                        id: f.id,
                        name: f.name,
                        summary: summary || undefined
                    };

                    if (cat === 'character') categorized.characters.push(item);
                    else if (cat === 'lore') categorized.lore.push(item);
                    else if (cat === 'plot') categorized.plots.push(item);
                    else if (cat === 'manuscript') categorized.manuscripts.push(item);
                    else categorized.others.push(item);
                }

                if (args.category) {
                    const q = String(args.category).toLowerCase().trim();
                    if (q.includes('char') || q.includes('인물') || q.includes('등장') || q.includes('캐릭터')) {
                        return { category: 'characters', total: categorized.characters.length, items: categorized.characters };
                    }
                    if (q.includes('lore') || q.includes('세계관') || q.includes('설정') || q.includes('지리') || q.includes('마법')) {
                        return { category: 'lore', total: categorized.lore.length, items: categorized.lore };
                    }
                    if (q.includes('plot') || q.includes('플롯') || q.includes('대본') || q.includes('씬') || q.includes('시나리오')) {
                        return { category: 'plots', total: categorized.plots.length, items: categorized.plots };
                    }
                    if (q.includes('novel') || q.includes('원고') || q.includes('본문') || q.includes('소설')) {
                        return { category: 'manuscripts', total: categorized.manuscripts.length, items: categorized.manuscripts };
                    }
                }

                return {
                    message: '프로젝트 전체 노드 목록과 요약입니다.',
                    characters: categorized.characters,
                    lore: categorized.lore,
                    plots: categorized.plots,
                    manuscripts: categorized.manuscripts,
                    others: categorized.others
                };
            }

            // 2. 키워드 검색
            if (name === 'search_story_nodes') {
                const query = String(args.query || '').toLowerCase().trim();
                const limit = Number(args.limit) || 5;
                if (!query) return { message: '검색어가 비어있습니다.' };

                const scored = [];
                for (const file of nonFolderFiles) {
                    const norm = window.nodeEngine?.normalizeNodeData(file);
                    const contentStr = JSON.stringify(norm?.contentData || {});
                    const nameMatch = file.name.toLowerCase().includes(query);
                    const textMatch = contentStr.toLowerCase().includes(query);

                    if (nameMatch || textMatch) {
                        let score = 0;
                        if (nameMatch) score += 10;
                        if (textMatch) score += 5;
                        scored.push({
                            id: file.id,
                            name: file.name,
                            category: file.category || norm?.category || 'general',
                            score
                        });
                    }
                }

                scored.sort((a, b) => b.score - a.score);
                const top = scored.slice(0, limit);
                if (top.length === 0) {
                    return { message: `\'${query}\'에 대한 정확한 일치 노드가 없습니다. list_project_nodes 도구로 전체 노드 목록을 확인해 보세요.` };
                }
                return top;
            }

            // 3. 노드 세부 본문 열람
            if (name === 'read_node_detail') {
                const target = nonFolderFiles.find(f => 
                    (args.nodeId && String(f.id) === String(args.nodeId)) ||
                    (args.nodeName && f.name.toLowerCase().includes(String(args.nodeName).toLowerCase()))
                );

                if (!target) {
                    return { error: `노드 \'${args.nodeName || args.nodeId}\'를 프로젝트에서 찾을 수 없습니다.` };
                }

                const norm = window.nodeEngine?.normalizeNodeData(target);
                const contentData = norm?.contentData || {};
                const cleanFields = {};

                if (Array.isArray(norm?.widgets) && norm.widgets.length > 0) {
                    norm.widgets.forEach(w => {
                        const k = w.key || w.id;
                        if (k && !['code', 'script', 'rawInputs', 'rawVal'].includes(k)) {
                            const val = contentData[k] !== undefined ? contentData[k] : (w.defaultVal || '');
                            if (val !== '' && val !== null && val !== undefined) {
                                cleanFields[w.label || k] = val;
                            }
                        }
                    });
                } else {
                    Object.entries(contentData).forEach(([k, v]) => {
                        if (!['widgets', 'code', 'script', 'windowState', 'portsConfig', 'presetId', 'rawInputs'].includes(k)) {
                            if (v !== '' && v !== null && v !== undefined) {
                                cleanFields[k] = v;
                            }
                        }
                    });
                }

                if (Object.keys(cleanFields).length === 0 && target.content) {
                    try {
                        const parsed = JSON.parse(target.content);
                        Object.entries(parsed).forEach(([k, v]) => {
                            if (!['widgets', 'code', 'script', 'windowState', 'portsConfig'].includes(k)) {
                                cleanFields[k] = v;
                            }
                        });
                    } catch (e) {
                        cleanFields['content'] = target.content;
                    }
                }

                return {
                    nodeId: target.id,
                    nodeName: target.name,
                    category: target.category || 'general',
                    storyContent: cleanFields
                };
            }

            // 4. ✨ 노드 신규 생성 (create_node)
            if (name === 'create_node') {
                const nodeName = String(args.name || '새 노드').trim();
                const category = args.category || 'general';
                const presetId = args.presetId || null;
                const fields = (typeof args.fields === 'object' && args.fields) ? args.fields : {};
                const content = args.content || '';
                const description = args.description || '';

                if (currentMode === 'ask') {
                    const actionId = 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    const actData = {
                        id: actionId,
                        type: 'create_node',
                        status: 'pending',
                        createdAt: Date.now(),
                        data: {
                            projectId,
                            name: nodeName,
                            category,
                            presetId,
                            fields,
                            content,
                            description
                        }
                    };
                    this.pendingActionsMap.set(actionId, actData);

                    return {
                        status: 'pending_approval',
                        actionId,
                        message: `'${nodeName}' 노드 생성 제안 카드를 생성했습니다. 사용자에게 변경 제안 내용을 설명하고 승인을 요청하세요.`,
                        nodeName
                    };
                }

                // accept 모드 (즉시 자동 생성)
                const created = await this.applyCreateNode({
                    projectId,
                    name: nodeName,
                    category,
                    presetId,
                    fields,
                    content,
                    description
                });

                return {
                    status: 'success',
                    message: `'${nodeName}' 노드가 성공적으로 캔버스에 생성되었습니다.`,
                    nodeId: created?.id,
                    nodeName: created?.name || nodeName
                };
            }

            // 5. 📝 노드 수정 (update_node)
            if (name === 'update_node') {
                const target = nonFolderFiles.find(f => 
                    (args.nodeId && String(f.id) === String(args.nodeId)) ||
                    (args.nodeName && f.name.toLowerCase().includes(String(args.nodeName).toLowerCase()))
                );

                if (!target) {
                    return { error: `수정할 노드 \'${args.nodeName || args.nodeId}\'를 찾을 수 없습니다.` };
                }

                const norm = window.nodeEngine?.normalizeNodeData(target);
                const prevContentData = norm?.contentData || {};
                const fields = (typeof args.fields === 'object' && args.fields) ? args.fields : {};
                const newName = args.name ? String(args.name).trim() : target.name;
                const content = args.content !== undefined ? args.content : null;

                // Diff 계산
                const diff = [];
                Object.entries(fields).forEach(([k, v]) => {
                    const oldVal = prevContentData[k];
                    if (String(oldVal) !== String(v)) {
                        diff.push({ key: k, oldVal: oldVal !== undefined ? oldVal : '', newVal: v });
                    }
                });

                if (currentMode === 'ask') {
                    const actionId = 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    const actData = {
                        id: actionId,
                        type: 'update_node',
                        status: 'pending',
                        createdAt: Date.now(),
                        diff,
                        data: {
                            nodeId: target.id,
                            nodeName: target.name,
                            newName,
                            fields,
                            content
                        }
                    };
                    this.pendingActionsMap.set(actionId, actData);

                    return {
                        status: 'pending_approval',
                        actionId,
                        message: `'${target.name}' 노드 수정 제안 카드를 생성했습니다. 사용자에게 변경 제안 내용을 설명하고 승인을 요청하세요.`,
                        nodeName: target.name
                    };
                }

                // accept 모드 (즉시 자동 수정)
                await this.applyUpdateNode({
                    nodeId: target.id,
                    targetFile: target,
                    newName,
                    fields,
                    content
                });

                return {
                    status: 'success',
                    message: `'${target.name}' 노드가 성공적으로 수정되었습니다.`,
                    nodeId: target.id,
                    nodeName: newName
                };
            }

            // 6. 🗑️ 노드 삭제 (delete_node)
            if (name === 'delete_node') {
                const target = nonFolderFiles.find(f => 
                    (args.nodeId && String(f.id) === String(args.nodeId)) ||
                    (args.nodeName && f.name.toLowerCase().includes(String(args.nodeName).toLowerCase()))
                );

                if (!target) {
                    return { error: `삭제할 노드 \'${args.nodeName || args.nodeId}\'를 찾을 수 없습니다.` };
                }

                const reason = args.reason || '사용자 요청에 의한 삭제';

                if (currentMode === 'ask') {
                    const actionId = 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    const actData = {
                        id: actionId,
                        type: 'delete_node',
                        status: 'pending',
                        createdAt: Date.now(),
                        data: {
                            nodeId: target.id,
                            nodeName: target.name,
                            reason
                        }
                    };
                    this.pendingActionsMap.set(actionId, actData);

                    return {
                        status: 'pending_approval',
                        actionId,
                        message: `'${target.name}' 노드 삭제 제안 카드를 생성했습니다. 사용자에게 확인을 요청하세요.`,
                        nodeName: target.name
                    };
                }

                // accept 모드 (즉시 자동 삭제)
                await this.applyDeleteNode(target.id, target.name);

                return {
                    status: 'success',
                    message: `'${target.name}' 노드가 성공적으로 삭제되었습니다.`
                };
            }

            return { error: `지원하지 않는 도구: ${name}` };

        } catch (error) {
            return { error: `도구 실행 실패: ${error.message}` };
        }
    }

    /**
     * 🚀 승인된 액션 실제 실행 처리기
     */
    async handleApproveAction(actionId) {
        const act = this.pendingActionsMap.get(actionId);
        if (!act || act.status !== 'pending') return;

        try {
            if (act.type === 'create_node') {
                await this.applyCreateNode(act.data);
            } else if (act.type === 'update_node') {
                await this.applyUpdateNode(act.data);
            } else if (act.type === 'delete_node') {
                await this.applyDeleteNode(act.data.nodeId, act.data.nodeName);
            }

            act.status = 'applied';
            act.appliedAt = Date.now();
            this.updateAgentMessagesView(false);
            window.showToast?.(`'${act.data.name || act.data.nodeName}' 작업이 성공적으로 적용되었습니다! ✨`);
        } catch (err) {
            console.error('액션 적용 실패:', err);
            window.showToast?.(`적용 실패: ${err.message}`);
        }
    }

    /**
     * ❌ 제안 거절 처리기
     */
    handleRejectAction(actionId) {
        const act = this.pendingActionsMap.get(actionId);
        if (!act) return;
        act.status = 'rejected';
        this.updateAgentMessagesView(false);
        window.showToast?.(`제안이 취소되었습니다.`);
    }

    /**
     * 🛠️ 실제 노드 생성 함수 (Storage DB + Canvas Node)
     */
    async applyCreateNode(data) {
        const projectId = data.projectId || this.currentProjectId || window.currentProjectId || window.fileTreeManager?.currentProjectId;
        if (!projectId || !window.storage) throw new Error('프로젝트 저장소에 접근할 수 없습니다.');

        let presetId = data.presetId;
        const cat = String(data.category || '').toLowerCase();
        const rawFields = (typeof data.fields === 'object' && data.fields) ? { ...data.fields } : {};
        if (data.content && !rawFields.content && !rawFields.editorVal) {
            rawFields.content = data.content;
        }

        // 1. 프리셋 ID 정밀 자동 매핑
        if (!presetId) {
            if (cat.includes('char') || cat.includes('인물') || cat.includes('캐릭터') || cat.includes('주인공')) {
                presetId = 'preset_sys_detailed_character';
            } else if (cat.includes('proper') || cat.includes('item') || cat.includes('아이템') || cat.includes('장소') || cat.includes('세력') || cat.includes('고유명사')) {
                presetId = 'preset_sys_proper_nouns';
            } else if (cat.includes('world') || cat.includes('lore') || cat.includes('세계관') || cat.includes('설정')) {
                presetId = 'preset_sys_world_settings';
            } else if (cat.includes('plot') || cat.includes('플롯') || cat.includes('대본') || cat.includes('씬') || cat.includes('시나리오')) {
                presetId = 'preset_sys_scenario_planner';
            } else if (cat.includes('foreshadow') || cat.includes('복선')) {
                presetId = 'preset_sys_foreshadowing';
            } else if (cat.includes('novel') || cat.includes('manuscript') || cat.includes('원고')) {
                presetId = 'preset_sys_manuscript';
            } else {
                presetId = 'preset_sys_detailed_character'; // 기본값 인물/페르소나 카드
            }
        }

        // 2. 기본 템플릿 로드
        let defaultTpls = [];
        try {
            if (window.templateManager?.getDefaultNodeTemplates) {
                defaultTpls = await window.templateManager.getDefaultNodeTemplates();
            }
        } catch (e) {}

        const matchedPreset = defaultTpls.find(p => p.id === presetId) || defaultTpls.find(p => p.id === 'preset_sys_detailed_character');
        let widgets = matchedPreset?.widgets ? JSON.parse(JSON.stringify(matchedPreset.widgets)) : [];
        const portsConfig = matchedPreset?.portsConfig ? JSON.parse(JSON.stringify(matchedPreset.portsConfig)) : { inputs: [], outputs: [{ id: 'out_1', name: '출력', color: '#00ffcc' }] };

        // 3. 지능형 스마트 필드 매핑 (Smart Field Mapper)
        const contentData = {};
        const nodeName = data.name || rawFields.name || rawFields.charName || rawFields.term || rawFields.title || '새 노드';

        // 프리셋 기본값 먼저 채우기
        if (widgets.length > 0) {
            widgets.forEach(w => {
                const k = w.key || w.id;
                if (k) contentData[k] = w.defaultVal !== undefined ? w.defaultVal : '';
            });
        }

        // 프리셋별 전용 키 매핑
        if (presetId === 'preset_sys_detailed_character' || matchedPreset?.id === 'preset_sys_detailed_character') {
            const role = rawFields.role || rawFields.job || rawFields.position || '등장인물';
            contentData.name_role = rawFields.name_role || `${nodeName} / ${role}`;
            contentData.profile_summary = rawFields.profile_summary || rawFields.profile || rawFields.age_gender || (rawFields.age ? `${rawFields.age} / ${rawFields.gender || '미상'}` : '') || '';
            contentData.appearance = rawFields.appearance || rawFields.look || rawFields.외모 || '';
            contentData.personality = rawFields.personality || rawFields.traits || rawFields.성격 || '';
            contentData.speech_tone = rawFields.speech_tone || rawFields.tone || rawFields.말투 || '';
            contentData.behavior_patterns = rawFields.behavior_patterns || rawFields.habits || rawFields.버릇 || '';
            contentData.dialogue_examples = rawFields.dialogue_examples || rawFields.dialogue || rawFields.대사 || '';
            contentData.relationships = rawFields.relationships || rawFields.relation || rawFields.관계 || '';
            contentData.knowledge = rawFields.knowledge || rawFields.지식 || '';
            contentData.memories = rawFields.memories || rawFields.기억 || '';
            contentData.special_ability = rawFields.special_ability || rawFields.ability || rawFields.skill || rawFields.능력 || '';
            contentData.preferences = rawFields.preferences || rawFields.likes_dislikes || rawFields.호불호 || '';
            contentData.past_and_motivation = rawFields.past_and_motivation || rawFields.past || rawFields.background || rawFields.과거사 || '';
            contentData.extra_notes = rawFields.extra_notes || rawFields.memo || rawFields.기타 || '';
        } else if (presetId === 'preset_sys_world_settings' || matchedPreset?.id === 'preset_sys_world_settings') {
            contentData.title = rawFields.title || nodeName;
            contentData.tags = rawFields.tags || rawFields.genre || '#세계관';
            contentData.logline = rawFields.logline || rawFields.summary || rawFields.한줄소개 || '';
            contentData.background_lore = rawFields.background_lore || rawFields.lore || rawFields.description || rawFields.content || rawFields.설정 || '';
        } else if (presetId === 'preset_sys_proper_nouns' || matchedPreset?.id === 'preset_sys_proper_nouns') {
            contentData.term = rawFields.term || nodeName;
            contentData.type = rawFields.type || rawFields.category || '장소';
            contentData.keywords = rawFields.keywords || '';
            contentData.desc = rawFields.desc || rawFields.description || rawFields.content || rawFields.설정 || '';
        } else if (presetId === 'preset_sys_scenario_planner' || matchedPreset?.id === 'preset_sys_scenario_planner') {
            contentData.scenario_title = rawFields.scenario_title || nodeName;
            contentData.core_goal = rawFields.core_goal || rawFields.goal || '';
            contentData.main_conflict = rawFields.main_conflict || rawFields.conflict || '';
            contentData.climax_turning_point = rawFields.climax_turning_point || rawFields.climax || '';
            contentData.resolution_outcome = rawFields.resolution_outcome || rawFields.resolution || '';
        } else if (presetId === 'preset_sys_manuscript' || matchedPreset?.id === 'preset_sys_manuscript') {
            contentData.editorVal = rawFields.editorVal || rawFields.content || rawFields.text || '';
        }

        // 원본 fields 객체도 전부 보존 병합
        Object.entries(rawFields).forEach(([k, v]) => {
            if (contentData[k] === undefined || contentData[k] === '') {
                contentData[k] = v;
            }
        });

        // 4. 만약 프리셋이 없거나 위젯이 없는 경우, 동적 위젯 자동 생성 (Fallback)
        if (widgets.length === 0) {
            widgets = Object.entries(rawFields).map(([k, v]) => ({
                id: 'w_' + k,
                type: 'input_text',
                label: k,
                key: k,
                rows: String(v).length > 40 ? 3 : 1,
                defaultVal: v
            }));
            if (widgets.length === 0) {
                widgets = [{ id: 'w_content', type: 'input_text', label: '내용', key: 'content', rows: 4, defaultVal: '' }];
            }
        }

        contentData.widgets = widgets;
        contentData.presetId = presetId;

        const newFileData = {
            projectId,
            name: nodeName,
            type: 'file',
            template: 'custom_node',
            presetId: presetId || matchedPreset?.id || null,
            nodeType: cat || 'general',
            category: cat || 'general',
            content: JSON.stringify(contentData, null, 2),
            contentData,
            widgets: widgets,
            portsConfig,
            code: matchedPreset?.code || '',
            description: data.description || matchedPreset?.desc || '',
            icon: matchedPreset?.icon || (cat === 'character' ? '👤' : (cat === 'lore' ? '📜' : (cat === 'plot' ? '🎬' : '📄'))),
            windowState: {
                x: 140 + Math.floor(Math.random() * 80),
                y: 140 + Math.floor(Math.random() * 80),
                width: matchedPreset?.defaultWidth || 540,
                height: matchedPreset?.defaultHeight || 700,
                collapsed: false
            }
        };

        const created = await window.storage.createFile(newFileData);

        // 파일 트리 새로고침
        if (window.fileTreeManager) {
            await window.fileTreeManager.loadProjectFiles(projectId);
        }

        // 캔버스 창 자동 열기 및 리렌더링
        if (window.windowManager && created?.id) {
            await window.windowManager.openWindow(created.id);
            // DOM 생성 안정화 후 즉시 최신 데이터 리렌더링
            setTimeout(() => {
                const info = window.windowManager.windows.get(created.id);
                if (info && info.element) {
                    const container = info.element.querySelector('.custom-node-body') || info.element.querySelector('.window-body');
                    if (container) container.innerHTML = ''; // 강제 재조립 트리거
                    window.windowManager.renderCustomNode(created.id);
                }
            }, 80);
        }

        return created;
    }

    /**
     * 🛠️ 실제 노드 수정 함수 (Storage DB + Canvas Window 갱신)
     */
    async applyUpdateNode({ nodeId, targetFile, newName, fields, content }) {
        if (!nodeId || !window.storage) throw new Error('노드 ID가 없거나 스토리지에 접근할 수 없습니다.');

        let file = targetFile;
        if (!file) {
            const files = await window.storage.getProjectFiles(this.currentProjectId || window.currentProjectId);
            file = files?.find(f => String(f.id) === String(nodeId));
        }
        if (!file) throw new Error(`노드 ID ${nodeId}를 찾을 수 없습니다.`);

        const norm = window.nodeEngine?.normalizeNodeData(file);
        const contentData = norm?.contentData || {};
        let widgets = norm?.widgets || [];

        // 스마트 필드 매핑 및 병합
        if (fields && typeof fields === 'object') {
            const presetId = file.presetId || norm?.presetId;
            if (presetId === 'preset_sys_detailed_character') {
                if (fields.name || fields.role) {
                    const prevNameRole = contentData.name_role || '';
                    const parts = prevNameRole.split('/');
                    const n = fields.name || parts[0]?.trim() || file.name;
                    const r = fields.role || parts[1]?.trim() || '';
                    contentData.name_role = `${n} / ${r}`;
                }
                if (fields.profile || fields.age) contentData.profile_summary = fields.profile || fields.profile_summary || fields.age;
                if (fields.appearance || fields.look) contentData.appearance = fields.appearance || fields.look;
                if (fields.personality || fields.traits) contentData.personality = fields.personality || fields.traits;
                if (fields.speech_tone || fields.tone) contentData.speech_tone = fields.speech_tone || fields.tone;
                if (fields.dialogue || fields.dialogue_examples) contentData.dialogue_examples = fields.dialogue || fields.dialogue_examples;
                if (fields.special_ability || fields.ability || fields.skill) contentData.special_ability = fields.special_ability || fields.ability || fields.skill;
                if (fields.past || fields.past_and_motivation || fields.background) contentData.past_and_motivation = fields.past || fields.past_and_motivation || fields.background;
            } else if (presetId === 'preset_sys_world_settings') {
                if (fields.lore || fields.description) contentData.background_lore = fields.lore || fields.description || fields.background_lore;
                if (fields.logline || fields.summary) contentData.logline = fields.logline || fields.summary;
            } else if (presetId === 'preset_sys_proper_nouns') {
                if (fields.desc || fields.description) contentData.desc = fields.desc || fields.description;
                if (fields.type || fields.category) contentData.type = fields.type || fields.category;
            }

            // 모든 fields 직접 병합
            Object.assign(contentData, fields);

            // 기존 위젯에 없는 새 필드인 경우 위젯 동적 추가
            Object.keys(fields).forEach(k => {
                if (!widgets.some(w => (w.key || w.id) === k)) {
                    widgets.push({
                        id: 'w_' + k,
                        type: 'input_text',
                        label: k,
                        key: k,
                        rows: 2,
                        defaultVal: fields[k]
                    });
                }
            });
        }

        if (content !== null && content !== undefined) {
            contentData.editorVal = content;
            contentData.content = content;
        }

        contentData.widgets = widgets;

        const updatePayload = {
            content: JSON.stringify(contentData, null, 2),
            contentData,
            widgets
        };

        if (newName && newName !== file.name) {
            updatePayload.name = newName;
            file.name = newName;
        }

        await window.storage.updateFile(nodeId, updatePayload);

        // 열려 있는 창이 있다면 실시간 UI 리렌더링
        if (window.windowManager) {
            const info = window.windowManager.windows.get(nodeId);
            if (info) {
                info.file = { ...info.file, ...updatePayload };
                if (updatePayload.name) {
                    const titleEl = info.element?.querySelector('.window-title-text');
                    if (titleEl) titleEl.textContent = updatePayload.name;
                }
                const container = info.element?.querySelector('.custom-node-body') || info.element?.querySelector('.window-body');
                if (container) container.innerHTML = ''; // 강제 재조립
                window.windowManager.renderCustomNode(nodeId);
            }
        }

        // 파일 트리 갱신
        if (window.fileTreeManager) {
            const currentProjId = this.currentProjectId || window.currentProjectId;
            if (currentProjId) await window.fileTreeManager.loadProjectFiles(currentProjId);
        }
    }

    /**
     * 🛠️ 실제 노드 삭제 함수 (Storage DB + Canvas Window 제거)
     */
    async applyDeleteNode(nodeId, nodeName = '') {
        if (!nodeId || !window.storage) throw new Error('삭제할 노드 ID가 없습니다.');

        if (window.windowManager) {
            await window.windowManager.deleteFile(nodeId, true);
        } else {
            await window.storage.deleteFile(nodeId);
            if (window.fileTreeManager) {
                await window.fileTreeManager.loadProjectFiles(this.currentProjectId || window.currentProjectId);
            }
        }
    }

    /**
     * 🔑 AI 에이전트용 AI 설정 및 API Key 자동 검색
     */
    async getAiConfigForAgent() {
        const projectId = this.currentProjectId || window.currentProjectId || window.fileTreeManager?.currentProjectId || window.projectManager?.currentProjectId;
        if (projectId) {
            try {
                const files = await window.storage?.getProjectFiles(projectId);
                const aiNode = files?.find(f => {
                    const norm = window.nodeEngine?.normalizeNodeData(f);
                    return f.presetId === 'preset_sys_ai_config' || norm?.presetId === 'preset_sys_ai_config' || f.name.includes('AI 설정') || f.name.includes('AI 환경');
                });
                if (aiNode) {
                    const norm = window.nodeEngine?.normalizeNodeData(aiNode);
                    const cd = norm?.contentData || {};
                    const apiKey = cd.apiKey || cd.w_api_key || cd.val;
                    if (apiKey && apiKey !== '(API Key 미설정)') {
                        return {
                            provider: cd.provider || 'Google (Gemini)',
                            model: cd.model || 'gemini-3.6-flash',
                            apiKey: apiKey,
                            temperature: cd.temperature !== undefined ? Number(cd.temperature) : 0.7,
                            endpoint: cd.endpoint || ''
                        };
                    }
                }
            } catch (e) {
                console.warn('AI 설정 노드 검색 실패:', e);
            }
        }

        const savedKey = this.settings?.apiKey || localStorage.getItem('global_gemini_api_key') || localStorage.getItem('ai_api_key') || '';
        const savedProvider = this.settings?.aiProvider || localStorage.getItem('ai_provider') || 'Google (Gemini)';
        const savedModel = this.settings?.aiModel || localStorage.getItem('ai_model') || 'gemini-3.6-flash';
        const savedTemp = localStorage.getItem('ai_temperature') ? Number(localStorage.getItem('ai_temperature')) : 0.7;
        const savedMaxTurns = localStorage.getItem('ai_max_turns') ? Number(localStorage.getItem('ai_max_turns')) : (this.settings?.maxTurns || 5);

        return {
            provider: savedProvider,
            model: savedModel,
            apiKey: savedKey,
            temperature: savedTemp,
            maxTurns: savedMaxTurns
        };
    }

    /**
     * 📝 가벼운 에이전트 마크다운 파서
     */
    formatAgentMarkdown(text) {
        if (!text) return '';
        let escaped = this.escapeHtml(text);

        // 코드 블록 (```...```)
        escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; overflow-x: auto; margin: 6px 0;"><code>$1</code></pre>');

        // 인라인 코드 (`...`)
        escaped = escaped.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #38bdf8;">$1</code>');

        // 헤딩 (###, ##, #)
        escaped = escaped.replace(/^### (.*$)/gim, '<div style="font-size: 12px; font-weight: bold; color: var(--color-accent-primary, #38bdf8); margin: 6px 0 2px 0;">$1</div>');
        escaped = escaped.replace(/^## (.*$)/gim, '<div style="font-size: 13px; font-weight: bold; color: var(--color-text-primary); margin: 8px 0 3px 0;">$1</div>');
        escaped = escaped.replace(/^# (.*$)/gim, '<div style="font-size: 14px; font-weight: bold; color: var(--color-text-primary); margin: 10px 0 4px 0;">$1</div>');

        // 굵게 (**...**)
        escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--color-text-primary); font-weight: 700;">$1</strong>');

        // 기울임 (*...*)
        escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 인용문 (> ...)
        escaped = escaped.replace(/^> (.*$)/gim, '<blockquote style="border-left: 3px solid var(--color-accent-primary, #38bdf8); padding-left: 8px; margin: 4px 0; color: var(--color-text-secondary); background: rgba(56, 189, 248, 0.04);">$1</blockquote>');

        // 목록 (- ... 또는 * ...)
        escaped = escaped.replace(/^[\-*] (.*$)/gim, '<div style="display: flex; gap: 4px; margin: 2px 0;"><span style="color: #38bdf8;">•</span><span>$1</span></div>');

        // 줄바꿈
        escaped = escaped.replace(/\n/g, '<br>');

        return escaped;
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

    async renderSettings() {
        const s = this.tempSettings;
        const presets = await this.loadColorPresets();

        return `
          <div style="background: rgba(52, 152, 219, 0.1); border: 1px solid rgba(52, 152, 219, 0.3); padding: 10px 12px; border-radius: 8px; font-size: 11px; color: var(--color-text-secondary); margin-bottom: 14px; line-height: 1.5;">
            💡 에디터 스타일 및 집필 옵션을 통합 관리하는 환경 설정입니다.
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">📖 원고 에디터 기본 색상</h3>
            <div class="form-group">
              <label class="form-label">원고 배경색</label>
              <input type="color" class="input" id="editorBgColor" value="${s.backgroundColor}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group">
              <label class="form-label">원고 폰트 색상</label>
              <input type="color" class="input" id="editorTextColor" value="${s.textColor}" style="height: 40px; padding: 4px;">
            </div>
            
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--color-border);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <span style="font-size: 13px; font-weight: 600; color: var(--color-text-primary);">원고 색상 프리셋</span>
                    <button class="btn btn-secondary" id="savePresetBtn" style="padding: 4px 10px; font-size: 11px; height: 28px;">현재 조합 저장</button>
                </div>
                
                <div id="presetsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 10px;">
                    ${presets.map((p, idx) => `
                        <div class="color-preset-item" data-idx="${idx}" title="배경: ${p.bg}, 글자: ${p.text}"
                            style="width: 40px; height: 40px; border-radius: 8px; cursor: pointer; border: 2px solid var(--color-border); position: relative; overflow: hidden; background: ${p.bg};">
                            <div style="position: absolute; bottom: 4px; right: 4px; width: 12px; height: 12px; border-radius: 2px; background: ${p.text}; border: 1px solid rgba(0,0,0,0.1);"></div>
                            <button class="delete-preset-btn" data-idx="${idx}" 
                                style="position: absolute; top: 0; right: 0; width: 16px; height: 16px; background: rgba(0,0,0,0.5); color: white; border: none; font-size: 10px; display: none; align-items: center; justify-content: center; border-bottom-left-radius: 6px;">✕</button>
                        </div>
                    `).join('')}
                    ${presets.length === 0 ? '<div style="grid-column: 1/-1; font-size: 11px; color: var(--color-text-tertiary); text-align: center; padding: 10px;">저장된 프리셋이 없습니다.</div>' : ''}
                </div>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">✍️ 원고 본문 텍스트 스타일</h3>
            <div class="form-group">
              <label class="form-label">원고 폰트 종류</label>
              <select class="input" id="editorFontFamily">
                <option value="'Noto Serif KR', serif" ${s.fontFamily.includes('Noto Serif') ? 'selected' : ''}>본명조 (소설용)</option>
                <option value="'Noto Sans KR', sans-serif" ${s.fontFamily.includes('Noto Sans') ? 'selected' : ''}>본고딕 (가독성)</option>
                <option value="Georgia, serif" ${s.fontFamily.includes('Georgia') ? 'selected' : ''}>Georgia</option>
                <option value="'Courier New', monospace" ${s.fontFamily.includes('Courier') ? 'selected' : ''}>Courier New</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">원고 글자 크기 <span id="fontSizeValue">${s.fontSize}px</span></label>
              <input type="range" class="input-range" id="editorFontSize" min="12" max="48" value="${s.fontSize}">
            </div>
            <div class="form-group">
              <label class="form-label">원고 줄 간격 (Line Height) <span id="lineHeightValue">${s.lineHeight}</span></label>
              <input type="range" class="input-range" id="editorLineHeight" min="1.0" max="3.0" step="0.1" value="${s.lineHeight}">
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">✨ 원고 강조색 및 집필 옵션</h3>
            <div class="form-group">
              <label class="form-label">대사/생각 강조색</label>
              <input type="color" class="input" id="highlightColor" value="${s.highlightColor || '#2563eb'}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group">
              <label class="form-label">하이퍼링크 색상</label>
              <input type="color" class="input" id="hyperlinkColor" value="${s.hyperlinkColor || '#58a6ff'}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 8px 0;">
              <label for="autoSaveToggle" style="cursor: pointer; font-size: 14px; font-weight: 500;">실시간 자동 저장</label>
              <input type="checkbox" id="autoSaveToggle" ${s.autoSave !== false ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
            </div>
            <div class="form-group" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 8px 0;">
              <label for="autoIndentToggle" style="cursor: pointer; font-size: 14px; font-weight: 500;">엔터 시 자동 들여쓰기</label>
              <input type="checkbox" id="autoIndentToggle" ${s.autoIndent ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
            </div>
            <div class="form-group" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 8px 0;">
              <label for="autoCloseQuotes" style="cursor: pointer; font-size: 14px; font-weight: 500;">따옴표 자동 닫기</label>
              <input type="checkbox" id="autoCloseQuotes" ${s.autoCloseQuotes ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
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

        const updatePreview = (key, val) => {
            this.tempSettings[key] = val;
            this.applySettings(this.tempSettings);
        };

        getEl('editorBgColor')?.addEventListener('input', (e) => updatePreview('backgroundColor', e.target.value));
        getEl('editorTextColor')?.addEventListener('input', (e) => updatePreview('textColor', e.target.value));
        getEl('editorFontFamily')?.addEventListener('change', (e) => updatePreview('fontFamily', e.target.value));

        getEl('editorFontSize')?.addEventListener('input', (e) => {
            const valEl = getEl('fontSizeValue');
            if (valEl) valEl.textContent = e.target.value + 'px';
            updatePreview('fontSize', parseInt(e.target.value));
        });

        getEl('editorLineHeight')?.addEventListener('input', (e) => {
            const valEl = getEl('lineHeightValue');
            if (valEl) valEl.textContent = e.target.value;
            updatePreview('lineHeight', parseFloat(e.target.value));
        });

        getEl('highlightColor')?.addEventListener('input', (e) => updatePreview('highlightColor', e.target.value));
        getEl('hyperlinkColor')?.addEventListener('input', (e) => updatePreview('hyperlinkColor', e.target.value));
        getEl('autoCloseQuotes')?.addEventListener('change', (e) => updatePreview('autoCloseQuotes', e.target.checked));
        getEl('autoSaveToggle')?.addEventListener('change', (e) => updatePreview('autoSave', e.target.checked));
        getEl('autoIndentToggle')?.addEventListener('change', (e) => updatePreview('autoIndent', e.target.checked));

        // 프리셋 관련 이벤트
        getEl('savePresetBtn')?.addEventListener('click', async () => {
            await this.saveColorPreset(this.tempSettings.backgroundColor, this.tempSettings.textColor);
            this.renderTab('settings');
        });

        const presetsGrid = getEl('presetsGrid');
        if (presetsGrid) {
            presetsGrid.addEventListener('click', async (e) => {
                const item = e.target.closest('.color-preset-item');
                const deleteBtn = e.target.closest('.delete-preset-btn');
                
                if (deleteBtn) {
                    e.stopPropagation();
                    const idx = parseInt(deleteBtn.dataset.idx);
                    await this.deleteColorPreset(idx);
                    this.renderTab('settings');
                    return;
                }

                if (item) {
                    const idx = parseInt(item.dataset.idx);
                    const presets = await this.loadColorPresets();
                    const p = presets[idx];
                    if (p) {
                        getEl('editorBgColor').value = p.bg;
                        getEl('editorTextColor').value = p.text;
                        updatePreview('backgroundColor', p.bg);
                        updatePreview('textColor', p.text);
                    }
                }
            });

            // 마우스 우클릭 시 삭제 버튼 토글 (또는 호버 처리 CSS로 가능하지만 여기선 간단히)
            presetsGrid.addEventListener('contextmenu', (e) => {
                const item = e.target.closest('.color-preset-item');
                if (item) {
                    e.preventDefault();
                    const btn = item.querySelector('.delete-preset-btn');
                    if (btn) btn.style.display = btn.style.display === 'none' ? 'flex' : 'none';
                }
            });
        }

        getEl('saveSettingsBtn')?.addEventListener('click', async () => {
            this.settings = { ...this.tempSettings };
            // LocalStorage와 IndexedDB 둘 다 저장 (이중 안전)
            localStorage.setItem('editorSettings', JSON.stringify(this.settings));
            if (window.storage) {
                await window.storage.saveGlobalSettings('editorSettings', this.settings);
            }
            alert('설정이 안전하게 저장되었습니다.');
        });

        getEl('resetSettingsBtn')?.addEventListener('click', async () => {
            if (confirm('모든 설정을 기본값으로 되돌릴까요?')) {
                localStorage.removeItem('editorSettings');
                if (window.storage) {
                    // IndexedDB에서도 제거 (기본값으로 덮어씌움)
                    await window.storage.saveGlobalSettings('editorSettings', null);
                }
                this.tempSettings = this.loadSettingsSync();
                this.applySettings(this.tempSettings);
                this.renderTab('settings');
            }
        });

        getEl('resetDbBtn')?.addEventListener('click', () => {
            window.storage?.resetDatabase();
        });
    }

    loadSettingsSync() {
        const defaults = {
            backgroundColor: '#ffffff',
            textColor: '#1f2937',
            fontFamily: "'Noto Serif KR', serif",
            fontSize: 18,
            lineHeight: 1.75,
            letterSpacing: 0,
            highlightColor: '#2563eb',
            hyperlinkColor: '#58a6ff',
            autoCloseQuotes: true,
            autoSave: true
        };
        try {
            const saved = localStorage.getItem('editorSettings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch (e) {
            return defaults;
        }
    }

    async loadSettingsAsync() {
        if (!window.storage) return;
        const idbSettings = await window.storage.getGlobalSettings('editorSettings');
        if (idbSettings) {
            this.settings = { ...this.loadSettingsSync(), ...idbSettings };
            this.tempSettings = { ...this.settings };
            this.applySettings(this.settings);
        }
    }

    async loadColorPresets() {
        // IndexedDB 우선 시도
        if (window.storage) {
            const idbPresets = await window.storage.getGlobalSettings('editorColorPresets');
            if (idbPresets) return idbPresets;
        }
        // 없으면 LocalStorage (하위 호환)
        try {
            return JSON.parse(localStorage.getItem('editorColorPresets') || '[]');
        } catch (e) { return []; }
    }

    async saveColorPreset(bg, text) {
        const presets = await this.loadColorPresets();
        // 중복 체크
        if (presets.some(p => p.bg === bg && p.text === text)) {
            window.showToast?.('이미 저장된 조합입니다.');
            return;
        }
        presets.push({ bg, text });
        
        // 이중 저장
        localStorage.setItem('editorColorPresets', JSON.stringify(presets));
        if (window.storage) {
            await window.storage.saveGlobalSettings('editorColorPresets', presets);
        }
        window.showToast?.('새 색상 프리셋이 저장되었습니다.');
    }

    async deleteColorPreset(idx) {
        const presets = await this.loadColorPresets();
        presets.splice(idx, 1);
        
        // 이중 저장
        localStorage.setItem('editorColorPresets', JSON.stringify(presets));
        if (window.storage) {
            await window.storage.saveGlobalSettings('editorColorPresets', presets);
        }
    }

    applySettings(s) {
        if (!s) return;
        this.currentSettings = s;
        const root = document.documentElement;
        root.style.setProperty('--color-highlight', s.highlightColor || '#2563eb');
        root.style.setProperty('--color-hyperlink', s.hyperlinkColor || '#58a6ff');
        
        // UI 전체 색상이 아닌 에디터 내부용 텍스트 색상 변수만 설정
        root.style.setProperty('--color-editor-text', s.textColor || '#e6edf3');

        const textareas = document.querySelectorAll('.window-textarea');
        const backdrops = document.querySelectorAll('.window-backdrop');
        const editors = document.querySelectorAll('.window-editor');
        const widgetEditors = document.querySelectorAll('.widget-editor-textarea');
        
        editors.forEach(ed => {
            ed.style.backgroundColor = s.backgroundColor;
        });

        [...textareas, ...backdrops, ...widgetEditors].forEach(el => {
            if (!el) return;
            el.style.fontFamily = s.fontFamily;
            el.style.fontSize = s.fontSize + 'px';
            el.style.lineHeight = s.lineHeight;
            el.style.letterSpacing = s.letterSpacing + 'px';
        });

        widgetEditors.forEach(we => {
            if (!we) return;
            we.style.color = s.textColor || '#e6edf3';
            we.style.caretColor = s.textColor || '#e6edf3';
            if (s.backgroundColor) {
                we.style.backgroundColor = s.backgroundColor;
            }
        });

        textareas.forEach(ta => {
            ta.style.color = 'transparent';
            ta.style.webkitTextFillColor = 'transparent';
            // 커서 색상은 에디터 텍스트 설정색을 따름
            ta.style.caretColor = s.textColor || '#e6edf3';
        });

        backdrops.forEach(bd => {
            // 강조창 글자색은 에디터 텍스트 설정색을 따름
            bd.style.color = s.textColor || '#e6edf3';
        });

        if (window.windowManager && window.windowManager.updateAllHighlighters) {
            window.windowManager.updateAllHighlighters();
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
