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
                    </div>
                </div>
            </div>
        `;
    }

    setupAgentEventListeners() {
        const inputEl = document.getElementById('agentInputText');
        const sendBtn = document.getElementById('agentSendBtn');
        const clearBtn = document.getElementById('agentClearChatBtn');

        // 드로어 토글
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

            // 로컬 스토리지 및 settings 저장
            localStorage.setItem('ai_provider', provider);
            localStorage.setItem('ai_model', model);
            localStorage.setItem('ai_api_key', apiKey);
            localStorage.setItem('global_gemini_api_key', apiKey);
            localStorage.setItem('ai_temperature', String(temperature));

            if (!this.settings) this.settings = {};
            this.settings.aiProvider = provider;
            this.settings.aiModel = model;
            this.settings.apiKey = apiKey;
            this.settings.temperature = temperature;

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

        return {
            provider: savedProvider,
            model: savedModel,
            apiKey: savedKey,
            temperature: savedTemp
        };
    }

    renderAgentMessagesHtml() {
        if (!this.agentHistory || this.agentHistory.length === 0) {
            return `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 140px; text-align: center; color: var(--color-text-tertiary); padding: 16px 10px; gap: 8px;">
                    <span style="font-size: 28px; opacity: 0.8;">🤖✨</span>
                    <div style="font-size: 12px; font-weight: bold; color: var(--color-text-primary);">POV 소설 총괄 비서</div>
                    <div style="font-size: 11px; line-height: 1.6; max-width: 240px;">
                        캔버스와 파일 트리의 모든 인물 카드, 세계관, 복선, 대본, 원고를 100% 실시간으로 꿰뚫고 답변해 드립니다.
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

            return `
                <div style="display: flex; flex-direction: column; align-items: ${align}; gap: 2px; width: 100%; box-sizing: border-box;">
                    <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: bold; color: var(--color-text-tertiary); padding: 0 4px;">
                        <span>${avatar}</span>
                        <span>${name}</span>
                    </div>
                    <div style="max-width: 92%; background: ${bubbleBg}; border: 1px solid ${bubbleBorder}; border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 1.6; color: var(--color-text-primary); word-break: break-word; box-sizing: border-box;">
                        ${isUser ? this.escapeHtml(msg.content).replace(/\n/g, '<br>') : this.formatAgentMarkdown(msg.content)}
                        ${citationsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    updateAgentMessagesView() {
        const listEl = document.getElementById('agentMessagesList');
        if (listEl) {
            listEl.innerHTML = this.renderAgentMessagesHtml();
            listEl.scrollTop = listEl.scrollHeight;
        }
    }

    setAgentToolStatus(show, text = '') {
        const bar = document.getElementById('agentToolStatusBar');
        const textEl = document.getElementById('agentToolStatusText');
        if (bar && textEl) {
            bar.style.display = show ? 'flex' : 'none';
            if (text) textEl.textContent = text;
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
        this.setAgentToolStatus(true, '🧠 질문 분석 및 지식 도구 탐색 중...');
        const referencedNodeNames = new Set();

        try {
            // 도구 정의 (Tool Declarations)
            const agentTools = [
                {
                    name: 'list_project_nodes',
                    description: '현재 소설 프로젝트에 존재하는 모든 노드(등장인물, 세계관, 씬 대본, 원고, 복선 등)의 목록과 카테고리를 조회합니다.',
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
                }
            ];

            const systemPrompt = `당신은 사용자의 웹소설 프로젝트를 100% 완벽히 파악하고 집필을 돕는 \'POV 소설 총괄 비서 (Story Copilot)\'입니다.
프로젝트의 모든 설정과 원고는 도구(Tool)를 통해 실시간으로 접근할 수 있습니다.

[도구 사용 원칙]
1. 사용자가 인물, 세계관, 아이템, 특정 회차 사건, 복선 등에 대해 질문하면 스스로 \'search_story_nodes\' 또는 \'list_project_nodes\'를 호출하여 관련 노드를 찾으세요.
2. 정확한 팩트 확인이 필요하면 \'read_node_detail\'을 호출하여 해당 노드의 상세 설정을 읽은 후 답변하세요.
3. 지어내지 말고, 노드에서 확인된 정확한 팩트에 기반하여 친절하고 명쾌하게 답변하세요.
4. 마크다운 서식(굵은 글씨, 목록, 인용구 등)을 활용하여 가독성 높게 답변하세요.`;

            // 도구 실행 핸들러 (Tool Executor)
            const toolExecutor = async (name, args) => {
                this.setAgentToolStatus(true, `🔍 [도구 실행] ${name === 'read_node_detail' ? (args.nodeName || args.nodeId) + ' 노드 열람 중' : '프로젝트 지식 탐색 중'}...`);
                const result = await this.executeAgentTool(name, args);
                if (name === 'read_node_detail' && result?.nodeName) {
                    referencedNodeNames.add(result.nodeName);
                } else if (name === 'search_story_nodes' && Array.isArray(result)) {
                    result.forEach(r => r.name && referencedNodeNames.add(r.name));
                }
                return result;
            };

            // AI 호출 (Function Calling 지원 엔진)
            let answer = '';
            if (window.aiApi?.callWithTools) {
                const toolCallsLog = [];
                const res = await window.aiApi.callWithTools(
                    aiConfig,
                    systemPrompt,
                    userPrompt,
                    agentTools,
                    toolExecutor,
                    5,
                    toolCallsLog
                );
                answer = (res && typeof res === 'object') ? (res.finalText || JSON.stringify(res)) : String(res || '');
            } else {
                answer = await window.aiApi.call(aiConfig, systemPrompt, userPrompt);
            }

            // 응답 추가
            this.agentHistory.push({
                role: 'assistant',
                content: answer || '답변을 생성하지 못했습니다.',
                citations: Array.from(referencedNodeNames)
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
     * 🛠️ 에이전트 전용 로컬 도구 실행 함수
     */
    async executeAgentTool(name, args = {}) {
        const projectId = this.currentProjectId || window.currentProjectId || window.fileTreeManager?.currentProjectId || window.projectManager?.currentProjectId;
        if (!projectId) {
            return { error: '활성화된 프로젝트가 없습니다.' };
        }

        try {
            const files = await window.storage.getProjectFiles(projectId);
            const nonFolderFiles = (files || []).filter(f => f.type !== 'folder');

            if (name === 'list_project_nodes') {
                const nodes = nonFolderFiles.map(f => {
                    const norm = window.nodeEngine?.normalizeNodeData(f);
                    return {
                        id: f.id,
                        name: f.name,
                        category: f.category || norm?.category || f.template || 'general'
                    };
                });
                if (args.category) {
                    const cat = String(args.category).toLowerCase();
                    return nodes.filter(n => String(n.category).toLowerCase().includes(cat));
                }
                return nodes;
            }

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

            if (name === 'read_node_detail') {
                const target = nonFolderFiles.find(f => 
                    (args.nodeId && String(f.id) === String(args.nodeId)) ||
                    (args.nodeName && f.name.toLowerCase().includes(String(args.nodeName).toLowerCase()))
                );

                if (!target) {
                    return { error: `노드 \'${args.nodeName || args.nodeId}\'를 프로젝트에서 찾을 수 없습니다.` };
                }

                // 🌟 [핵심 정제]: 창 좌표(windowState), code, portsConfig, widgets 스키마 100% 필터링!
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

            return { error: `지원하지 않는 도구: ${name}` };

        } catch (error) {
            return { error: `도구 실행 실패: ${error.message}` };
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
        const savedModel = this.settings?.aiModel || localStorage.getItem('ai_model') || 'gemini-2.0-flash';

        return {
            provider: savedProvider,
            model: savedModel,
            apiKey: savedKey,
            temperature: 0.7
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
