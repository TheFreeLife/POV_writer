/**
 * node-engine.js
 * 노드 실행 엔진 (Node Execution Engine)
 *
 * 역할:
 *   - 노드의 JS 코드를 실행하고 output을 생성합니다.
 *   - input 변수를 직접 입력값 + 연결된 상위 노드 output에서 수집합니다.
 *   - output 매칭 방식: 이름 매칭 (return 키 === output 핀 이름)
 *   - 전체 그래프를 위상 정렬 순서로 실행합니다.
 *
 * 의존성:
 *   - window.windowManager (WindowManager 인스턴스)
 *   - window.showToast (선택)
 */
class NodeEngine {
    constructor() {
        /**
         * 각 노드의 실행 결과 캐시
         * Map<fileId, { [pinName]: value }>
         */
        this.outputCache = new Map();
        this.isRunning = false;
        this.isAborted = false;
    }

    /**
     * 노드 데이터를 단일 대통합 노드 포맷(Unified Node Schema)으로 자동 보정/규격화합니다.
     * 구버전 데이터(isApprovalNode, isDataViewer, isAggregator 등)를 신규 단일 포맷으로 마이그레이션합니다.
     *
     * @param {Object} file - 노드 파일 객체
     * @returns {{ contentData: Object, widgets: Array, nodeType: string, portsConfig: Object }}
     */
    normalizeNodeData(file) {
        if (!file) return { contentData: {}, widgets: [], nodeType: 'custom', portsConfig: { inputs: [], outputs: [] } };

        let contentData = {};
        if (typeof file.content === 'string') {
            try { contentData = JSON.parse(file.content || '{}'); } catch (e) { contentData = { text: file.content || '' }; }
        } else if (typeof file.content === 'object' && file.content) {
            contentData = file.content;
        }

        const nodeType = file.nodeType || file.template || (file.isCustomNode ? 'custom' : 'manuscript');
        let widgets = Array.isArray(contentData.widgets) ? contentData.widgets : [];

        if (widgets.length === 0) {
            if (nodeType === 'approval') {
                widgets = [
                    { id: 'w_view', type: 'text_viewer', label: '🔍 검수 대상 데이터', key: 'displayVal' },
                    { id: 'w_appr', type: 'approval_gate', label: '검수 및 진행 제어' }
                ];
            } else if (nodeType === 'viewer') {
                widgets = [{ id: 'w_view', type: 'text_viewer', label: '👁️ 데이터 출력 결과', key: 'displayVal' }];
            } else if (nodeType === 'aggregator') {
                widgets = [{ id: 'w_aggr', type: 'text_viewer', label: '➕ 리스트 합산 결과', key: 'displayVal' }];
            } else if (nodeType === 'choice') {
                widgets = [{ id: 'w_chce', type: 'choice_select', label: '🔀 분기 선택 옵션' }];
            } else if (nodeType === 'image') {
                widgets = [{ id: 'w_img', type: 'image_canvas', label: '🖼️ 이미지 뷰어' }];
            } else if (nodeType === 'manuscript') {
                widgets = [{ id: 'w_editor', type: 'editor_canvas', label: '📝 원고 에디터' }];
            }
        }

        let portsConfig = file.portsConfig;
        if (!portsConfig || (!portsConfig.inputs && !portsConfig.outputs)) {
            if (nodeType === 'approval') {
                portsConfig = {
                    inputs: [{ id: 'in_1', name: '검수 데이터', color: '#f1c40f' }],
                    outputs: [{ id: 'appr_out', name: '승인 데이터', color: '#2ecc71' }]
                };
            } else if (nodeType === 'viewer') {
                portsConfig = {
                    inputs: [{ id: 'in_1', name: '입력 데이터', color: '#3498db' }],
                    outputs: [{ id: 'out_1', name: '출력 데이터', color: '#9b59b6' }]
                };
            } else if (nodeType === 'aggregator') {
                portsConfig = {
                    inputs: [{ id: 'in_1', name: '입력 1', color: '#00ffcc' }, { id: 'in_2', name: '입력 2', color: '#00ffcc' }],
                    outputs: [{ id: 'out_1', name: '합산 결과', color: '#2ecc71' }]
                };
            } else if (nodeType === 'image') {
                portsConfig = {
                    inputs: [],
                    outputs: [{ id: 'out_1', name: '이미지 데이터', color: '#e74c3c' }]
                };
            } else if (nodeType === 'manuscript') {
                portsConfig = {
                    inputs: [],
                    outputs: [{ id: 'out_1', name: '원고 텍스트', color: '#00ffcc' }]
                };
            } else {
                portsConfig = { inputs: [], outputs: [{ id: 'out_1', name: '결과물', color: '#00ffcc' }] };
            }
        }

        return { contentData, widgets, nodeType, portsConfig };
    }

    /** 캔버스 상의 모든 노드와 연결선 하이라이트 효과를 즉시 일괄 제거합니다. */
    clearAllVisuals() {
        document.querySelectorAll('.editor-window').forEach(el => {
            el.classList.remove('node-executing', 'node-paused', 'node-success-pulse');
        });
        document.querySelectorAll('.connection-line').forEach(el => {
            el.classList.remove('animating-flow');
        });
    }

    /** 현재 진행 중인 노드 그래프 실행을 즉시 강제 중단합니다. */
    stopExecution() {
        this.isAborted = true;
        this.isRunning = false;
        this.clearAllVisuals();
        window.showToast?.('🛑 노드 그래프 실행이 중단되었습니다.', 'warning');
    }

    /** 특정 노드의 output 캐시를 삭제합니다. */
    clearNodeCache(fileId) {
        if (fileId) {
            this.outputCache.delete(String(fileId));
        }
    }

    /** 전체 output 캐시를 초기화합니다. */
    clearAllCache() {
        this.outputCache.clear();
    }

    /**
     * 특정 노드의 하위(Downstream)로 연결된 모든 노드 ID 목록을 DFS로 탐색하여 반환합니다.
     */
    getDownstreamNodeIds(startFileId) {
        const downstream = new Set();
        const stack = [String(startFileId)];
        const conns = this._getConnections();

        while (stack.length > 0) {
            const currId = stack.pop();
            const childConns = conns.filter(c => String(c.fromId) === currId);
            childConns.forEach(c => {
                const childId = String(c.toId);
                if (!downstream.has(childId)) {
                    downstream.add(childId);
                    stack.push(childId);
                }
            });
        }
        return Array.from(downstream);
    }

    // ─────────────────────────────────────────────
    // 내부 헬퍼
    // ─────────────────────────────────────────────

    /** WindowManager에서 노드 정보를 가져옵니다. */
    _getInfo(fileId) {
        return window.windowManager?.getWindowInfo(fileId) ?? null;
    }

    /** 현재 프로젝트의 연결 목록을 가져옵니다. */
    _getConnections() {
        return window.windowManager?.nodeConnections ?? [];
    }

    _isAggregator(file) {
        if (!file) return false;
        if (file.isAggregatorNode || file.template === 'aggregator') return true;
        if (typeof file.content === 'string') return file.content.includes('"isAggregatorNode"');
        if (typeof file.content === 'object' && file.content) return !!file.content.isAggregatorNode;
        return false;
    }

    _isDataViewer(file) {
        return this.normalizeNodeData(file).nodeType === 'viewer';
    }

    _isApproval(file) {
        return this.normalizeNodeData(file).nodeType === 'approval';
    }

    _isChoice(file) {
        return this.normalizeNodeData(file).nodeType === 'choice';
    }

    _isAggregator(file) {
        return this.normalizeNodeData(file).nodeType === 'aggregator';
    }

    // ─────────────────────────────────────────────
    // JSON 메타 데이터 패킷 (Data Envelope) 헬퍼
    // ─────────────────────────────────────────────

    /**
     * 노드 간 데이터 전달 시 사용되는 JSON 규격 데이터 패킷을 생성합니다.
     */
    createDataPacket(value, nodeId, nodeName, portId, portName) {
        let safeValue;
        try {
            safeValue = JSON.parse(JSON.stringify(value ?? null));
        } catch (e) {
            safeValue = value ?? null;
        }

        const rawName = String(nodeName || '');
        const cleanName = rawName.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/u, '').trim() || rawName;

        return {
            value: safeValue,
            _meta: {
                nodeId: String(nodeId || ''),
                nodeName: cleanName,
                rawNodeName: rawName,
                portId: String(portId || ''),
                portName: String(portName || '')
            }
        };
    }

    /**
     * 일반 하위 노드에게 입력 데이터를 전달할 때 _meta를 숨기고 순수 value만 추출하여 독립성을 보장합니다.
     */
    unwrapPacketValue(packet) {
        if (packet && typeof packet === 'object' && '_meta' in packet && 'value' in packet) {
            return packet.value;
        }
        return packet;
    }

    /**
     * 특정 상위 노드의 실행 결과(outputCache)를 가져옵니다.
     * 실행 버튼/순서에 의해 실행되기 전까지는 output 데이터를 조기 전파하지 않습니다.
     */
    getOrEvaluateNodeOutput(fileId) {
        const fileIdStr = String(fileId);
        
        // 캐시에 연산 결과가 남아있는 경우에만 반환
        if (this.outputCache.has(fileIdStr)) {
            return this.outputCache.get(fileIdStr);
        }

        // '⚡ 실시간 연산' 옵션이 켜져 있거나 뷰어 노드 실시간 갱신 시에만 온디맨드 획득 지원
        const isAutoRun = document.getElementById('autoRunToggleSwitch')?.checked ?? false;
        if (isAutoRun) {
            const info = this._getInfo(fileIdStr);
            const allFiles = window.fileTreeManager?.files || Array.from(window.windowManager?.windows.values() || []).map(w => w.file);
            const file = info?.file || allFiles.find(f => String(f.id) === fileIdStr);
            if (!file) return {};

            const outputPins = file.portsConfig?.outputs ?? [{ id: 'out_1', name: '출력 데이터' }];
            const pinName = outputPins[0]?.name || '출력 데이터';
            const portId = outputPins[0]?.id || 'out_1';

            const textarea = info?.element?.querySelector('.window-textarea');
            const textContent = textarea ? textarea.value : (file.content || '');
            const pkt = this.createDataPacket(textContent, fileIdStr, file.name, portId, pinName);
            const res = { [pinName]: pkt, '원고 결과': pkt, '합산 리스트': [ { [file.name]: textContent } ] };
            this.outputCache.set(fileIdStr, res);
            return res;
        }

        // 자기 차례에 실행되기 전까지는 빈 맵을 반환하여 output 전파를 철저히 차단
        return {};
    }

    // ─────────────────────────────────────────────
    // input 수집
    // ─────────────────────────────────────────────

    /**
     * 특정 노드의 input 변수 객체를 수집합니다.
     * 일반 노드는 상위 노드의 정보(_meta)를 알 수 없도록 순수 value만 독립적으로 수집합니다.
     * aggregator 노드는 _meta 정보를 통해 상위 노드 이름을 식별하여 리스트로 합성합니다.
     *
     * @param {string} fileId
     * @returns {Object}
     */
    collectInputVars(fileId) {
        const info = this._getInfo(fileId);
        const allFiles = window.fileTreeManager?.files || Array.from(window.windowManager?.windows.values() || []).map(w => w.file);
        const file = info?.file || allFiles.find(f => String(f.id) === String(fileId));
        if (!file) return {};

        const input = {};
        const norm = this.normalizeNodeData(file);
        const { contentData, widgets } = norm;
        
        // 1) 노드 자체 contentData 및 위젯 키값 수집
        Object.assign(input, contentData);
        (widgets || []).forEach(w => {
            if (w.key && contentData[w.key] !== undefined) {
                input[w.key] = contentData[w.key];
            }
        });

        // 2) 상위 연결선(Connections) 유입 데이터 수집 (핀별 다중 연결 수용)
        const inConns = this._getConnections().filter(c => String(c.toId) === String(fileId));
        const portInputsMap = {};

        inConns.forEach(conn => {
            const fromInfo = this._getInfo(conn.fromId);
            const fromFile = fromInfo?.file || allFiles.find(f => String(f.id) === String(conn.fromId));
            
            const upstreamOutput = this.getOrEvaluateNodeOutput(conn.fromId);
            const fromPorts = fromFile?.portsConfig?.outputs ?? [];
            const fromPort = fromPorts.find(p => p.id === conn.fromPortId) ?? fromPorts[0];
            const outPinName = fromPort?.name || 'out_1';

            const packet = upstreamOutput[outPinName] ?? Object.values(upstreamOutput)[0];
            const pureValue = this.unwrapPacketValue(packet);

            // 도착 포트 핀 이름
            const toPorts = norm.portsConfig?.inputs ?? [];
            const toPort = toPorts.find(p => p.id === conn.toPortId) ?? toPorts[0];
            const targetPortName = toPort?.name || '입력 데이터';

            if (!portInputsMap[targetPortName]) {
                portInputsMap[targetPortName] = [];
            }
            portInputsMap[targetPortName].push(pureValue);
        });

        // 3) 핀별 유입 데이터 바인딩: 1개면 단일값, 2개 이상이면 배열([])로 자동 통일
        Object.entries(portInputsMap).forEach(([portName, values]) => {
            input[portName] = values.length === 1 ? values[0] : values;
        });

        // 리스트 합산기 호환 키
        if (norm.nodeType === 'aggregator') {
            input['합산 리스트'] = Object.values(portInputsMap).flat();
        }

    }

    // ─────────────────────────────────────────────
    // 노드 실행
    // ─────────────────────────────────────────────

    /**
     * 단일 노드를 실행합니다.
     *
     * @param {string} fileId
     * @returns {Promise<{ output: Object, warnings: string[] }>}
     */
    async runNode(fileId) {
        const info = this._getInfo(fileId);
        const allFiles = window.fileTreeManager?.files || Array.from(window.windowManager?.windows.values() || []).map(w => w.file);
        const file = info?.file || allFiles.find(f => String(f.id) === String(fileId));

        if (!file) return { output: {}, warnings: [`노드 '${fileId}'를 찾을 수 없습니다.`] };

        // 🌟 연산 시각 피드백: 기존 대기 클래스 제거 후 파랑/청록 Glowing 추가
        if (info?.element) {
            info.element.classList.remove('node-paused');
            info.element.classList.add('node-executing');
        }

        // SVG 연결선 파동 빛 흐름 애니메이션 추가
        const connLines = document.querySelectorAll(`.connection-line[data-from-id="${fileId}"], .connection-line[data-to-id="${fileId}"]`);
        connLines.forEach(el => el.classList.add('animating-flow'));

        const code = (file.code ?? '').trim();
        const outputPins = file.portsConfig?.outputs ?? [];
        const pinNames = outputPins.map(p => p.name).filter(Boolean);
        const warnings = [];

        const finishVisuals = (isPaused = false) => {
            if (info?.element) {
                info.element.classList.remove('node-executing');
                if (isPaused) {
                    // 🌟 대기(일시 정지) 중인 노드는 금빛/주황 펄스를 계속 유지!
                    info.element.classList.add('node-paused');
                } else {
                    info.element.classList.remove('node-paused');
                    info.element.classList.add('node-success-pulse');
                    setTimeout(() => info.element.classList.remove('node-success-pulse'), 800);
                }
            }
            connLines.forEach(el => el.classList.remove('animating-flow'));
            // 🌟 노드 연산 완료/대기 시 노드 UI 즉시 갱신
            window.windowManager?.refreshNodeUI(fileId);
        };

        const input = this.collectInputVars(fileId);
        const norm = this.normalizeNodeData(file);

        let raw = null;
        if (code) {
            try {
                const fn = new Function('input', `return (async () => { ${code} })()`);
                raw = await fn(input);
            } catch (err) {
                warnings.push(`코드 연산 오류: ${err.message}`);
            }
        } else {
            raw = input;
        }

        const output = {};
        outputPins.forEach(p => {
            let val = null;
            if (raw && typeof raw === 'object' && raw[p.name] !== undefined) {
                val = raw[p.name];
            } else if (input[p.name] !== undefined) {
                val = input[p.name];
            } else {
                val = raw && typeof raw === 'object' ? Object.values(raw)[0] : raw;
            }
            output[p.name] = this.createDataPacket(val, fileId, file.name, p.id, p.name);
        });

        this.outputCache.set(String(fileId), output);
        finishVisuals();
        return { output, warnings };
    }

    // ─────────────────────────────────────────────
    // 그래프 실행
    // ─────────────────────────────────────────────

    /**
     * 위상 정렬로 실행 순서를 결정한 뒤 모든 노드를 순서대로 실행합니다.
     *
     * @param {string[]|null} targetEndNodeId - 실행할 노드 ID 목록. null이면 열린 창 전체.
     * @param {boolean} keepApprovalState - true인 경우 기존 승인 노드의 승인 상태(isApproved)를 리셋하지 않고 유지
     * @returns {Promise<{ order: string[], warnings: string[] }>}
     */
    async runGraph(targetEndNodeId = null, keepApprovalState = false) {
        const wm = window.windowManager;
        let ids;

        const conns = this._getConnections();

        if (typeof targetEndNodeId === 'string' || typeof targetEndNodeId === 'number') {
            // 🎯 목표(End) 노드가 지정된 경우: 역방향 의존성 탐색 (Upstream Traversal)
            const targetId = String(targetEndNodeId);
            const neededNodes = new Set([targetId]);
            const stack = [targetId];

            while (stack.length > 0) {
                const curr = stack.pop();
                const parentConns = conns.filter(c => String(c.toId) === curr);
                parentConns.forEach(c => {
                    const pId = String(c.fromId);
                    if (!neededNodes.has(pId)) {
                        neededNodes.add(pId);
                        stack.push(pId);
                    }
                });
            }
            ids = Array.from(neededNodes);
        } else if (Array.isArray(targetEndNodeId)) {
            ids = targetEndNodeId.map(String);
        } else {
            // ⚡ 전체 그래프 실행: 연결선(Wire)이 하나라도 얽혀있는 유효 파이프라인 노드들만 실행!
            // (연결선이 아예 없는 외딴 미연결 노드들에 초록색 펄스가 무차별적으로 튀는 현상 방지)
            const openIds = (wm ? [...wm.windows.keys()] : []).map(String);
            const connectedSet = new Set();
            conns.forEach(c => {
                connectedSet.add(String(c.fromId));
                connectedSet.add(String(c.toId));
            });
            const pipelineIds = openIds.filter(id => connectedSet.has(id));
            ids = (pipelineIds.length > 0) ? pipelineIds : openIds;
        }

        if (ids.length === 0) {
            window.showToast?.('실행할 노드가 없습니다.', 'warning');
            return { order: [], warnings: [] };
        }

        // 🌟 최신 데이터 연산을 위해 실행 대상 노드들의 캐시 초기화
        ids.forEach(id => this.clearNodeCache(id));

        // 위상 정렬 (Kahn's algorithm)
        const inDegree = new Map(ids.map(id => [id, 0]));
        const adj = new Map(ids.map(id => [id, []]));

        this._getConnections().forEach(conn => {
            const from = String(conn.fromId);
            const to = String(conn.toId);
            if (inDegree.has(from) && inDegree.has(to)) {
                adj.get(from).push(to);
                inDegree.set(to, inDegree.get(to) + 1);
            }
        });

        const queue = [...inDegree.entries()]
            .filter(([, deg]) => deg === 0)
            .map(([id]) => id);
        const order = [];

        while (queue.length > 0) {
            const cur = queue.shift();
            order.push(cur);
            adj.get(cur)?.forEach(next => {
                const newDeg = inDegree.get(next) - 1;
                inDegree.set(next, newDeg);
                if (newDeg === 0) queue.push(next);
            });
        }

        // 사이클 감지
        if (order.length < ids.length) {
            const cycleNodes = ids.filter(id => !order.includes(id));
            window.showToast?.(`⚠️ 노드 간 순환 참조가 감지되었습니다: ${cycleNodes.join(', ')}`, 'error');
            return { order, warnings: [`순환 참조 감지: ${cycleNodes.join(', ')}`] };
        }

        this.isRunning = true;
        this.isAborted = false;

        try {
            // 순서대로 실행
            const allWarnings = [];
            let pausedByApproval = false;
            let pausedNodeName = '';

            for (const id of order) {
                if (this.isAborted) break;

                const { warnings, isPaused } = await this.runNode(id);

                if (this.isAborted) break;

                if (warnings && warnings.length > 0) {
                    const nodeName = this._getInfo(id)?.file?.name ?? id;
                    allWarnings.push(...warnings.map(w => w.startsWith('[') ? w : `[${nodeName}] ${w}`));
                }

                if (isPaused) {
                    pausedByApproval = true;
                    pausedNodeName = this._getInfo(id)?.file?.name ?? id;
                    break;
                }
            }

            if (this.isAborted) {
                this.clearAllVisuals();
                window.windowManager?.refreshAllNodesUI();
                return { order, warnings: ['실행이 사용자에 의해 중단되었습니다.'], isAborted: true };
            }

            if (pausedByApproval) {
                window.windowManager?.refreshAllNodesUI();
                window.showToast?.(`⏸️ '${pausedNodeName}' 승인 노드에서 진행이 일시 정지되었습니다. 검수 후 [승인 및 진행]을 누르고 다시 [▶️ 실행]을 눌러주세요.`, 'warning');
                return { order, warnings: allWarnings, isPaused: true };
            }

            // 🌟 맨 뒤까지 모든 실행이 완전히 다 끝난 경우:
            // 승인 노드들의 상태를 다음 연산/실행을 위해 자동으로 다시 승인 대기(isApproved = false) 상태로 리셋!
            ids.forEach(id => {
                const info = this._getInfo(id);
                const file = info?.file || (window.fileTreeManager?.files || []).find(f => String(f.id) === String(id));
                if (file && this._isApproval(file)) {
                    let data = {};
                    if (typeof file.content === 'string') {
                        try { data = JSON.parse(file.content || '{}'); } catch(e){}
                    } else if (typeof file.content === 'object' && file.content) {
                        data = file.content;
                    }
                    data.isApproved = false;
                    file.isApproved = false;
                    file.content = JSON.stringify(data);
                    window.storage?.updateFile(id, { content: file.content });
                }
            });

            // 🌟 최종 UI 갱신
            window.windowManager?.refreshAllNodesUI();

            if (allWarnings.length > 0) {
                console.warn('그래프 실행 경고:\n' + allWarnings.join('\n'));
                window.showToast?.(`실행 완료 — 경고 ${allWarnings.length}건 (콘솔 확인)`, 'warning');
            } else {
                window.showToast?.('✅ 모든 노드 실행 완료 (승인 노드가 대기 상태로 자동 준비되었습니다)', 'success');
            }

            return { order, warnings: allWarnings, isPaused: false };
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 캐시를 초기화합니다. 프로젝트 전환 시 호출하세요.
     */
    clearCache() {
        this.outputCache.clear();
    }
}

window.nodeEngine = new NodeEngine();
