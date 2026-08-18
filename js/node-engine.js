/**
 * node-engine.js
 * 노드 역추적 비동기 데이터플로우 실행 엔진 (DAG Execution Engine)
 */
class NodeEngine {
    constructor() {
        this.outputCache = new Map();
        this.currentSession = null;
        this.isRunning = false;
    }

    /**
     * 현재 열린 프로젝트의 노드 간 연결선 목록을 조회합니다.
     */
    _getConnections() {
        return window.windowManager?.nodeConnections || [];
    }

    /**
     * ID로 파일(노드) 객체를 조회합니다.
     */
    _getFile(fileId) {
        const files = window.fileTreeManager?.files;
        if (!files) return null;
        if (Array.isArray(files)) {
            return files.find(f => String(f.id) === String(fileId)) || null;
        }
        if (typeof files.get === 'function') {
            return files.get(Number(fileId)) || files.get(String(fileId)) || null;
        }
        return null;
    }

    /**
     * 노드 데이터를 단일 대통합 노드 포맷(Unified Node Schema)으로 규격화합니다.
     */
    normalizeNodeData(file) {
        if (!file) return { contentData: {}, widgets: [], nodeType: 'custom', portsConfig: { inputs: [], outputs: [] } };

        let contentData = {};
        if (typeof file.content === 'string') {
            try {
                contentData = JSON.parse(file.content || '{}');
            } catch (e) {
                contentData = {
                    editorVal: file.content || '',
                    content: file.content || '',
                    text: file.content || '',
                    val: file.content || ''
                };
            }
        } else if (typeof file.content === 'object' && file.content) {
            contentData = { ...file.content };
        }

        const nodeType = file.nodeType || file.template || (file.isCustomNode ? 'custom' : 'manuscript');
        let widgets = Array.isArray(contentData.widgets) ? contentData.widgets : [];

        if (widgets.length === 0) {
            if (nodeType === 'image') {
                widgets = [{ id: 'w_img', type: 'image_canvas', label: '🖼️ 이미지 뷰어' }];
            } else if (nodeType === 'manuscript') {
                widgets = [{ id: 'w_editor', type: 'editor_canvas', label: '📝 원고 에디터' }];
            }
        }

        let portsConfig = file.portsConfig || { inputs: [], outputs: [{ id: 'out_1', name: '결과물', color: '#00ffcc' }] };

        return { contentData, widgets, nodeType, portsConfig };
    }

    /**
     * 캔버스 상의 모든 노드와 연결선 하이라이트 효과를 즉시 일괄 제거합니다.
     */
    clearAllHighlights() {
        document.querySelectorAll('.node-connection-line.exec-active').forEach(el => el.classList.remove('exec-active'));
        document.querySelectorAll('.editor-window.exec-running, .editor-window.exec-waiting').forEach(el => {
            el.classList.remove('exec-running', 'exec-waiting');
        });
    }

    /**
     * 특정 노드의 실행 상태(UI 하이라이트)를 변경합니다.
     * @param {string|number} nodeId 
     * @param {'running' | 'waiting' | 'completed' | 'idle'} state 
     */
    setNodeState(nodeId, state) {
        const winEl = document.querySelector(`.editor-window[data-file-id="${nodeId}"]`);
        if (!winEl) return;

        winEl.classList.remove('exec-running', 'exec-waiting');

        if (state === 'running') {
            winEl.classList.add('exec-running');
        } else if (state === 'waiting') {
            winEl.classList.add('exec-waiting');
            // 대기 노드로 화면 시야 유도
            window.windowManager?.scrollIntoViewIfNeeded?.(nodeId);
        }
    }

    /**
     * 연결선 하이라이트 토글
     */
    setConnectionActive(fromId, toId, active = true) {
        const lines = document.querySelectorAll(`.node-connection-line[data-from-id="${fromId}"][data-to-id="${toId}"]`);
        lines.forEach(el => {
            if (active) el.classList.add('exec-active');
            else el.classList.remove('exec-active');
        });
    }

    /**
     * 지정된 타겟 노드(들)로부터 역방향으로 상위 노드들을 탐색하여 실행용 DAG를 구축합니다.
     * @param {Array<string|number>} targetNodeIds 
     */
    buildExecutionGraph(targetNodeIds) {
        const connections = this._getConnections();
        const visitedNodes = new Set();
        const involvedEdges = [];
        const queue = [...targetNodeIds.map(String)];

        // 1. 역방향(toId -> fromId) BFS 탐색으로 모든 조상 노드 및 엣지 수집
        while (queue.length > 0) {
            const currentId = queue.shift();
            if (visitedNodes.has(currentId)) continue;
            visitedNodes.add(currentId);

            // currentId로 들어오는 상위 연결선 찾기
            const incomingConns = connections.filter(c => String(c.toId) === currentId);
            for (const conn of incomingConns) {
                const parentId = String(conn.fromId);
                involvedEdges.push(conn);
                if (!visitedNodes.has(parentId)) {
                    queue.push(parentId);
                }
            }
        }

        // 2. 진입 차수(inDegree), 부모 노드(parents), 자식 노드(children) 맵 구성
        const inDegreeMap = new Map();
        const parentsMap = new Map();
        const childrenMap = new Map();

        for (const nodeId of visitedNodes) {
            inDegreeMap.set(nodeId, 0);
            parentsMap.set(nodeId, []);
            childrenMap.set(nodeId, []);
        }

        for (const conn of involvedEdges) {
            const fromId = String(conn.fromId);
            const toId = String(conn.toId);

            if (visitedNodes.has(fromId) && visitedNodes.has(toId)) {
                // toId의 진입차수 증가 및 관계 등록
                inDegreeMap.set(toId, (inDegreeMap.get(toId) || 0) + 1);
                
                if (!parentsMap.get(toId).includes(fromId)) {
                    parentsMap.get(toId).push(fromId);
                }
                if (!childrenMap.get(fromId).includes(toId)) {
                    childrenMap.get(fromId).push(toId);
                }
            }
        }

        // 3. 시작점(In-degree === 0인 Root 노드들) 식별
        const rootNodeIds = [];
        for (const [nodeId, deg] of inDegreeMap.entries()) {
            if (deg === 0) {
                rootNodeIds.push(nodeId);
            }
        }

        return {
            nodes: Array.from(visitedNodes),
            edges: involvedEdges,
            inDegreeMap,
            parentsMap,
            childrenMap,
            rootNodeIds
        };
    }

    /**
     * 실행 시작 전 및 실행 완료 후 노드 상태 초기화:
     * 참여 노드들의 승인 여부(isApproved = false) 및 흐름 제어 상태를 기본으로 복귀시킵니다.
     */
    async _resetNodesForExecution(nodeIds) {
        for (const id of nodeIds) {
            const file = this._getFile(id);
            if (file) {
                let contentData = {};
                if (typeof file.content === 'string') {
                    try {
                        contentData = JSON.parse(file.content || '{}');
                    } catch (e) {
                        contentData = {
                            editorVal: file.content || '',
                            content: file.content || '',
                            text: file.content || '',
                            val: file.content || ''
                        };
                    }
                } else if (typeof file.content === 'object' && file.content) {
                    contentData = { ...file.content };
                }

                let isStateChanged = false;
                if (contentData.isApproved !== undefined && contentData.isApproved !== false) {
                    contentData.isApproved = false;
                    isStateChanged = true;
                }
                if (contentData.isContinued !== undefined && contentData.isContinued !== false) {
                    contentData.isContinued = false;
                    isStateChanged = true;
                }

                file.content = contentData;

                const winInfo = window.windowManager?.getWindowInfo?.(id);
                if (winInfo && winInfo.file) {
                    winInfo.file.content = contentData;
                }

                if (isStateChanged) {
                    await window.storage?.saveFile?.(file);
                    window.windowManager?.refreshNodeUI?.(id);
                }
            }
        }
    }

    /**
     * 단일 노드 연산 및 위젯 데이터 처리
     */
    async _processNodeComputation(nodeId, session, inputs) {
        const file = this._getFile(nodeId);
        if (!file) return { output: '' };

        const norm = this.normalizeNodeData(file);
        const contentData = norm.contentData || {};
        const widgets = norm.widgets || [];

        // 🌟 0. 현재 열려있는 DOM 창에서 사용자가 실시간 타이핑한 최신 입력값 동기화
        const winEl = document.querySelector(`.editor-window[data-file-id="${nodeId}"]`);
        if (winEl) {
            const textareas = winEl.querySelectorAll('textarea');
            textareas.forEach(ta => {
                const wKey = ta.dataset.widgetKey || 'editorVal';
                contentData[wKey] = ta.value;
                contentData.editorVal = ta.value;
                contentData.content = ta.value;
            });
            const inputFields = winEl.querySelectorAll('.widget-input-field');
            inputFields.forEach(inp => {
                const wKey = inp.dataset.widgetKey || 'val';
                contentData[wKey] = inp.value;
            });
            const toggleInputs = winEl.querySelectorAll('.widget-toggle-input');
            toggleInputs.forEach(chk => {
                const wKey = chk.dataset.widgetKey || 'isEnabled';
                contentData[wKey] = chk.checked;
            });
            const parentToggles = winEl.querySelectorAll('.parent-node-toggle-input');
            if (parentToggles.length > 0) {
                if (!contentData.inputToggles) contentData.inputToggles = {};
                parentToggles.forEach(chk => {
                    contentData.inputToggles[chk.dataset.parentId] = chk.checked;
                });
            }
            const activeChoice = winEl.querySelector('.choice-opt-btn.selected') || winEl.querySelector('.choice-opt-btn[style*="rgba(56, 189, 248"]');
            if (activeChoice && activeChoice.dataset.optCode) {
                contentData.selectedOption = activeChoice.dataset.optCode;
                contentData.selectedChoice = activeChoice.dataset.optCode;
            }
        }

        // 🌟 1. 선행 부모 노드들로부터 들어온 인풋 데이터 결합 (중복 방지: 부모 노드 ID 기반으로만 결합)
        const inputTexts = [];
        const inputToggles = contentData.inputToggles || {};
        const parents = session?.graph?.parentsMap?.get(String(nodeId)) || [];

        if (inputs && typeof inputs === 'object') {
            const parentKeySet = new Set(parents.map(String));
            for (const [pId, val] of Object.entries(inputs)) {
                // 부모 노드 ID가 아닌 포트명/포트ID로 들어온 중복 엔트리는 결합 텍스트에서 제외
                if (parentKeySet.size > 0 && !parentKeySet.has(String(pId))) {
                    continue;
                }

                // 토글 스위치가 명시적으로 꺼져(false)있는 상위 노드는 제외
                if (inputToggles[pId] === false) {
                    console.log(`[NodeEngine] 🚫 상위 노드 [${pId}] 토글 OFF로 출력에서 제외됨`);
                    continue;
                }

                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    inputTexts.push(typeof val === 'object' ? (val.output || JSON.stringify(val)) : String(val));
                }
            }
        }
        const aggregatedInput = inputTexts.join('\n\n');
        console.log(`[NodeEngine] 📦 노드 [${file.name || nodeId}] 입력 결합 결과:`, aggregatedInput);

        // 🌟 2. 위젯별 연산 및 데이터 반영
        let hasApprovalGate = false;
        let isApproved = !!contentData.isApproved;
        let hasContinueGate = false;
        let isContinued = !!contentData.isContinued;

        for (const w of widgets) {
            if (w.type === 'approval_gate') {
                hasApprovalGate = true;
            }
            if (w.type === 'continue_gate') {
                hasContinueGate = true;
            }
            if (w.type === 'text_viewer') {
                const viewerText = aggregatedInput || '(입력 데이터 전달됨)';
                contentData[w.key || 'displayVal'] = viewerText;
                contentData.output = aggregatedInput;

                // DOM 실시간 즉각 반영
                if (winEl) {
                    const preEl = winEl.querySelector('.widget-text-viewer-pre') || winEl.querySelector('pre');
                    if (preEl) preEl.textContent = viewerText;
                }
            }
        }

        // 텍스트/원고 에디터 노드에 인풋 자동 반영 (비어있거나 전달값이 있을 때)
        if (aggregatedInput && !contentData.editorVal && !contentData.val) {
            if (norm.nodeType === 'manuscript') {
                contentData.editorVal = aggregatedInput;
            }
        }

        file.content = contentData;

        // WindowManager의 메모리상 윈도우 객체도 동기화
        const winInfo = window.windowManager?.getWindowInfo?.(nodeId);
        if (winInfo && winInfo.file) {
            winInfo.file.content = contentData;
        }

        await window.storage?.saveFile?.(file);
        window.windowManager?.refreshNodeUI?.(nodeId);

        // 🌟 3. 사용자 검수/입력/흐름제어 대기가 필요한 경우
        const needsApprovalWait = hasApprovalGate && !isApproved;
        const needsContinueWait = hasContinueGate && !isContinued;

        if (needsApprovalWait || needsContinueWait) {
            const waitReason = needsApprovalWait ? '사용자 승인 대기' : '사용자 계속 진행 확인 대기';
            console.log(`[NodeEngine] ⏸️ 노드 [${file.name || nodeId}] ${waitReason} 시작`);
            this.setNodeState(nodeId, 'waiting');

            // 대기 Promise 등록
            await new Promise((resolve, reject) => {
                session.waitingResolvers.set(String(nodeId), { resolve, reject });
            });

            console.log(`[NodeEngine] ▶️ 노드 [${file.name || nodeId}] 확인 완료로 실행 재개`);
            this.setNodeState(nodeId, 'running');
        }

        // 🌟 4. 노드 동작 코드(연산 스크립트) 실행
        const userCode = file.code || contentData.code || '';
        let outputText = contentData.editorVal || contentData.val || contentData.content || contentData.text || aggregatedInput || '';

        if (userCode) {
            try {
                // scriptInput 객체 구성: 위젯들의 key 및 label, 토글 상태(true/false), 포트별 상위 인풋 데이터 바인딩
                const scriptInput = {
                    ...contentData,
                    ...(typeof inputs === 'object' ? inputs : {}),
                    input: aggregatedInput,
                    rawInputs: inputs
                };
                widgets.forEach(w => {
                    const val = contentData[w.key];
                    if (val !== undefined) {
                        scriptInput[w.key] = val;
                        if (w.label) scriptInput[w.label] = val;
                    }
                });

                // 연산 스크립트 함수 실행
                const scriptRunner = new Function('input', 'inputs', `
                    "use strict";
                    ${userCode}
                `);
                const scriptResult = scriptRunner(scriptInput, inputs);

                if (scriptResult !== undefined && scriptResult !== null) {
                    if (typeof scriptResult === 'object') {
                        const firstVal = Object.values(scriptResult)[0];
                        outputText = typeof firstVal === 'string' ? firstVal : JSON.stringify(scriptResult, null, 2);
                    } else {
                        outputText = String(scriptResult);
                    }
                }
                console.log(`[NodeEngine] ⚡ 노드 [${file.name || nodeId}] 연산 스크립트 실행 완료:`, outputText);
            } catch (scriptErr) {
                console.error(`[NodeEngine] ⚠️ 노드 [${file.name || nodeId}] 연산 스크립트 실행 오류:`, scriptErr);
                window.showToast?.(`노드 [${file.name || nodeId}] 스크립트 오류: ${scriptErr.message}`, 'error');
            }
        } else {
            // 텍스트 뷰어 위젯(모니터링/디버깅 노드)의 경우 상위에서 들어온 인풋을 그대로 바이패스 전달
            if (widgets.some(w => w.type === 'text_viewer') && aggregatedInput) {
                outputText = aggregatedInput;
            }
        }

        console.log(`[NodeEngine] 📤 노드 [${file.name || nodeId}] 최종 출력값:`, outputText);

        return {
            output: outputText,
            contentData
        };
    }

    /**
     * 노드 실행 핵심 파이프라인 (Join 배리어 및 후속 노드 트리거)
     */
    async _executeNode(nodeId, session) {
        nodeId = String(nodeId);
        if (session.isAborted) return;
        if (session.nodeStates.get(nodeId) === 'completed') return;

        const file = this._getFile(nodeId);
        const norm = this.normalizeNodeData(file);
        const nodeName = file?.name || nodeId;

        console.log(`[NodeEngine] 🟢 노드 실행 시작: [${nodeName}] (ID: ${nodeId})`);
        session.nodeStates.set(nodeId, 'running');
        this.setNodeState(nodeId, 'running');

        try {
            // 상위 부모 노드들로부터 출력값 취합 (노드 ID별 + 포트 핀별 매핑)
            const parents = session.graph.parentsMap.get(nodeId) || [];
            const collectedInputs = {};
            const inputPorts = norm.portsConfig?.inputs || [];

            // 1) 부모 노드 ID별 매핑
            for (const parentId of parents) {
                this.setConnectionActive(parentId, nodeId, true);
                const outVal = session.nodeOutputs.get(parentId);
                collectedInputs[parentId] = outVal;
            }

            // 2) 포트 핀 ID(in_1, in_2) 및 포트 이름(선택지 A 데이터)별 매핑
            const inConns = session.graph.edges.filter(c => String(c.toId) === nodeId);
            inConns.forEach(conn => {
                const parentVal = session.nodeOutputs.get(String(conn.fromId));
                if (parentVal !== undefined) {
                    const portId = conn.toPortId || 'in_1';
                    collectedInputs[portId] = parentVal;

                    const matchedPort = inputPorts.find(p => p.id === portId);
                    if (matchedPort && matchedPort.name) {
                        collectedInputs[matchedPort.name] = parentVal;
                    }
                }
            });

            // 약간의 시각적 실행 딜레이 (애니메이션 체감 효과)
            await new Promise(r => setTimeout(r, 200));
            if (session.isAborted) return;

            // 노드 연산 및 대기 처리
            const result = await this._processNodeComputation(nodeId, session, collectedInputs);
            if (session.isAborted) return;

            // 실행 완료 처리
            session.nodeOutputs.set(nodeId, result.output);
            session.nodeStates.set(nodeId, 'completed');
            this.setNodeState(nodeId, 'completed');

            for (const parentId of parents) {
                this.setConnectionActive(parentId, nodeId, false);
            }

            console.log(`[NodeEngine] ⚪ 노드 실행 완료: [${nodeName}] (ID: ${nodeId})`);

            // 하위(Children) 노드들 확인 및 Join 배리어 갱신
            const children = session.graph.childrenMap.get(nodeId) || [];
            const readyToRunNext = [];

            for (const childId of children) {
                const currentRemaining = (session.inDegreeRemaining.get(childId) || 1) - 1;
                session.inDegreeRemaining.set(childId, currentRemaining);

                console.log(`[NodeEngine] 🔗 하위 노드 [${childId}] 인풋 대기 잔여: ${currentRemaining}`);

                // 모든 인풋이 준비되면 다음 실행 목록에 추가
                if (currentRemaining === 0) {
                    readyToRunNext.push(childId);
                }
            }

            // 준비된 하위 노드들을 동시 병렬(Promise.all) 실행
            if (readyToRunNext.length > 0) {
                await Promise.all(readyToRunNext.map(nextId => this._executeNode(nextId, session)));
            }

        } catch (err) {
            if (err?.name === 'AbortError') {
                console.log(`[NodeEngine] ⏹️ 노드 [${nodeName}] 실행이 사용자에 의해 중단되었습니다.`);
            } else {
                console.error(`[NodeEngine] ❌ 노드 [${nodeName}] 실행 중 오류:`, err);
                window.showToast?.(`노드 [${nodeName}] 실행 오류: ${err.message}`, 'error');
            }
        }
    }

    /**
     * 대기(Waiting) 상태의 노드를 사용자의 승인/입력으로 재개합니다.
     */
    resumeWaitingNode(nodeId, customOutput) {
        nodeId = String(nodeId);
        if (!this.currentSession || !this.isRunning) {
            return false;
        }

        const resolver = this.currentSession.waitingResolvers.get(nodeId);
        if (resolver) {
            this.currentSession.waitingResolvers.delete(nodeId);
            resolver.resolve(customOutput || true);
            return true;
        }
        return false;
    }

    /**
     * 반려 및 상위 노드 재연산 (Reject & Retry)
     */
    async rejectAndRetry(nodeId) {
        nodeId = String(nodeId);
        if (!this.currentSession || !this.isRunning) {
            return;
        }

        const file = this._getFile(nodeId);
        const parents = this.currentSession.graph.parentsMap.get(nodeId) || [];

        if (parents.length === 0) {
            window.showToast?.('⚠️ 연결된 상위 노드가 없습니다.', 'warning');
            return;
        }

        window.showToast?.('🔄 상위 작업을 다시 실행하고 입력을 초기화합니다...');

        // 1. 현재 노드의 인풋 및 데이터 초기화
        if (file) {
            const norm = this.normalizeNodeData(file);
            const contentData = norm.contentData || {};
            contentData.isApproved = false;
            contentData.editorVal = '';
            contentData.val = '';
            contentData.output = '';
            file.content = contentData;
            await window.storage?.saveFile?.(file);
            window.windowManager?.refreshNodeUI?.(nodeId);
        }

        // 2. 상위 노드 캐시 무효화 및 재실행
        for (const parentId of parents) {
            this.currentSession.nodeStates.set(parentId, 'idle');
            this.currentSession.nodeOutputs.delete(parentId);
        }
        this.currentSession.inDegreeRemaining.set(nodeId, parents.length);

        // 상위 노드 병렬 재실행
        await Promise.all(parents.map(parentId => this._executeNode(parentId, this.currentSession)));
    }

    /**
     * 단일 타겟 엔드포인트(또는 지정된 엔드포인트 목록) 노드 기준 역추적 실행
     */
    async runTargetNode(targetNodeId) {
        if (this.isRunning) {
            window.showToast?.('이미 다른 노드 그래프가 실행 중입니다.', 'warning');
            return { success: false };
        }

        if (!targetNodeId) {
            // 활성 창 조회
            targetNodeId = window.windowManager?.activeWindowId;
        }

        if (!targetNodeId) {
            window.showToast?.('실행할 타겟(엔드포인트) 노드를 먼저 선택해주세요.', 'warning');
            return { success: false };
        }

        return await this._runExecutionPipeline([targetNodeId], '단일 엔드포인트');
    }

    /**
     * 전체 그래프 실행 (모든 말단/Sink 노드들을 기준으로 역추적 통합 실행)
     */
    async evaluateAllNodes() {
        if (this.isRunning) {
            window.showToast?.('이미 노드 그래프가 실행 중입니다.', 'warning');
            return { success: false };
        }

        const connections = this._getConnections();
        const rawFiles = window.fileTreeManager?.files;
        const allFiles = Array.isArray(rawFiles) ? rawFiles : (rawFiles ? Array.from(rawFiles.values()) : []);
        
        if (allFiles.length === 0) {
            window.showToast?.('실행할 노드가 없습니다.', 'warning');
            return { success: false };
        }

        // 후속 출력 연결선이 없는 말단(Sink) 노드들 탐색
        const fromSet = new Set(connections.map(c => String(c.fromId)));
        let endNodeIds = allFiles
            .map(f => String(f.id))
            .filter(id => !fromSet.has(id));

        // 모든 노드가 서로 순환하거나 연결선이 없는 경우 열려있는 전체 노드를 타겟으로
        if (endNodeIds.length === 0) {
            endNodeIds = allFiles.map(f => String(f.id));
        }

        return await this._runExecutionPipeline(endNodeIds, '전체 노드 그래프');
    }

    /**
     * 공통 실행 파이프라인
     */
    async _runExecutionPipeline(targetNodeIds, runLabel) {
        console.log(`[NodeEngine] 🚀 ${runLabel} 실행 파이프라인 가동 (타겟: ${targetNodeIds.join(', ')})`);
        this.isRunning = true;
        this.clearAllHighlights();

        const graph = this.buildExecutionGraph(targetNodeIds);

        if (graph.nodes.length === 0) {
            window.showToast?.('실행에 필요한 노드를 찾을 수 없습니다.', 'warning');
            this.isRunning = false;
            return { success: false };
        }

        // 실행 세션 객체 생성
        const session = {
            id: Date.now(),
            graph,
            nodeStates: new Map(),
            nodeOutputs: new Map(),
            waitingResolvers: new Map(),
            inDegreeRemaining: new Map(graph.inDegreeMap),
            isAborted: false
        };
        this.currentSession = session;

        try {
            window.showToast?.(`🚀 [${runLabel}] 실행을 시작합니다. (총 ${graph.nodes.length}개 노드)`, 'success');

            // 1. 실행 전 대상 노드들의 상태 및 이전 승인 여부 초기화
            await this._resetNodesForExecution(graph.nodes);

            // 2. 시작점(In-degree === 0) 노드들 식별 및 동시 병렬 실행
            const rootPromises = graph.rootNodeIds.map(rootId => this._executeNode(rootId, session));
            await Promise.all(rootPromises);

            if (!session.isAborted) {
                window.showToast?.(`✅ [${runLabel}] 모든 노드 실행이 성공적으로 완료되었습니다!`, 'success');
            }

            return { success: !session.isAborted };
        } catch (error) {
            console.error(`[NodeEngine] 실행 파이프라인 에러:`, error);
            window.showToast?.(`실행 중 오류 발생: ${error.message}`, 'error');
            return { success: false, error };
        } finally {
            this.isRunning = false;
            this.clearAllHighlights();
            this.currentSession = null;

            // 🌟 최종 세션 완료 후 참여 노드들의 승인 상태를 '승인 대기 중'으로 복귀 및 UI 갱신
            await this._resetNodesForExecution(graph.nodes);
        }
    }

    /**
     * 진행 중인 노드 실행을 즉시 중단합니다.
     */
    stopExecution() {
        if (!this.isRunning || !this.currentSession) {
            window.showToast?.('진행 중인 실행 작업이 없습니다.');
            return;
        }

        console.log(`[NodeEngine] ⏹️ 사용자에 의해 실행 중단 요청됨.`);
        this.currentSession.isAborted = true;

        // 대기 중인 모든 Promise Abort 처리
        for (const [nodeId, resolver] of this.currentSession.waitingResolvers.entries()) {
            const abortErr = new Error('Execution aborted by user');
            abortErr.name = 'AbortError';
            resolver.reject(abortErr);
        }
        this.currentSession.waitingResolvers.clear();

        this.isRunning = false;
        this.clearAllHighlights();
        this.currentSession = null;

        window.showToast?.('⏹️ 노드 실행이 중단되었습니다.', 'warning');
    }

    /**
     * 특정 노드(또는 전체)의 연산 캐시를 제거합니다.
     */
    clearNodeCache(fileId) {
        if (fileId) {
            this.outputCache.delete(String(fileId));
        } else {
            this.outputCache.clear();
        }
    }

    /**
     * 특정 노드로부터 뻗어나가는 직속 하위(Downstream) 노드 ID 목록을 반환합니다.
     */
    getDownstreamNodeIds(fileId) {
        const fileIdStr = String(fileId);
        const connections = this._getConnections();
        const childIds = new Set();
        connections.forEach(c => {
            if (String(c.fromId) === fileIdStr && c.toId) {
                childIds.add(String(c.toId));
            }
        });
        return Array.from(childIds);
    }

    /**
     * 특정 노드로 들어오는 직속 상위(Upstream) 노드 ID 목록을 반환합니다.
     */
    getUpstreamNodeIds(fileId) {
        const fileIdStr = String(fileId);
        const connections = this._getConnections();
        const parentIds = new Set();
        connections.forEach(c => {
            if (String(c.toId) === fileIdStr && c.fromId) {
                parentIds.add(String(c.fromId));
            }
        });
        return Array.from(parentIds);
    }

    /**
     * 노드 실행 준비 알림 (하위 호환)
     */
    notifyPreparing() {
        window.showToast?.('노드 실행 기능이 활성화되었습니다.');
    }

    runNode(fileId) {
        return this.runTargetNode(fileId);
    }
}

// 싱글톤 인스턴스 등록
const nodeEngine = new NodeEngine();
if (typeof window !== 'undefined') {
    window.nodeEngine = nodeEngine;
}
