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

        // ── aggregator 노드 전용 수집 ──
        const isAggregator = file.isAggregatorNode || file.template === 'aggregator' ||
            (typeof file.content === 'string' && file.content.includes('"isAggregatorNode"'));

        if (isAggregator) {
            let data = {};
            try { data = JSON.parse(file.content || '{}'); } catch (e) {}
            const disabledKeys = Array.isArray(data.disabledKeys) ? data.disabledKeys : [];

            const inConns = this._getConnections().filter(c => String(c.toId) === String(fileId));

            // 중복 이름 카운트
            const keyCount = {};
            const entries = inConns.map(conn => {
                const fromInfo = this._getInfo(conn.fromId);
                const fromFile = fromInfo?.file || allFiles.find(f => String(f.id) === String(conn.fromId));
                const rawName = fromFile?.name || String(conn.fromId);
                const cleanName = rawName.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/u, '').trim() || rawName;
                keyCount[cleanName] = (keyCount[cleanName] || 0) + 1;
                return { conn, fromFile, cleanName, rawName };
            });

            const keyIndex = {};
            const list = [];

            entries.forEach(({ conn, fromFile, cleanName }) => {
                let key;
                if (keyCount[cleanName] > 1) {
                    keyIndex[cleanName] = (keyIndex[cleanName] || 0) + 1;
                    key = keyIndex[cleanName] === 1 ? cleanName : `${cleanName}_${keyIndex[cleanName]}`;
                } else {
                    key = cleanName;
                }

                if (disabledKeys.includes(key)) return;

                const upstreamOutput = this.outputCache.get(String(conn.fromId));
                if (!upstreamOutput) return;

                const fromPorts = fromFile?.portsConfig?.outputs ?? [];
                const fromPort = fromPorts.find(p => p.id === conn.fromPortId) ?? fromPorts[0];
                const outPinName = fromPort?.name || 'out_1';
                
                const packet = upstreamOutput[outPinName];
                const pureValue = this.unwrapPacketValue(packet);

                list.push({ [key]: pureValue });
            });

            // aggregator 표준 input: 합산 리스트
            input['합산 리스트'] = list;
            return input;
        }

        // 1) DOM 직접 입력값
        info?.element?.querySelectorAll('.stat-input-field[data-var-name]').forEach(el => {
            const name = el.dataset.varName;
            const raw = el.value;
            input[name] = (raw !== '' && !isNaN(raw)) ? Number(raw) : raw;
        });

        // 2) 상위 노드 연결값 (메타데이터 래퍼를 벗겨내어 하위 노드의 완벽한 독립성 보장!)
        const inConns = this._getConnections().filter(c => String(c.toId) === String(fileId));

        inConns.forEach(conn => {
            const fromInfo = this._getInfo(conn.fromId);
            const fromFile = fromInfo?.file || allFiles.find(f => String(f.id) === String(conn.fromId));

            const fromPorts = fromFile?.portsConfig?.outputs ?? [];
            const fromPort = fromPorts.find(p => p.id === conn.fromPortId) ?? fromPorts[0];
            const outPinName = fromPort?.name;

            const toPorts = file.portsConfig?.inputs ?? [];
            const toPort = toPorts.find(p => p.id === conn.toPortId) ?? toPorts[0];
            const inPinName = toPort?.name;

            if (!inPinName) return;

            const upstreamOutput = this.outputCache.get(String(conn.fromId));
            if (upstreamOutput && outPinName !== undefined && upstreamOutput[outPinName] !== undefined) {
                const packet = upstreamOutput[outPinName];
                // 일반 노드에게는 _meta를 철저히 숨기고 순수한 value만 주입!
                input[inPinName] = this.unwrapPacketValue(packet);
            }
        });

        return input;
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

        const code = (file.code ?? '').trim();
        const outputPins = file.portsConfig?.outputs ?? [];
        const pinNames = outputPins.map(p => p.name).filter(Boolean);
        const warnings = [];

        // ── 코드 없음: 데이터 보관 노드 및 원고 노드 ──
        if (!code) {
            const input = this.collectInputVars(fileId);
            const isAggregator = file.isAggregatorNode || file.template === 'aggregator' ||
                (typeof file.content === 'string' && file.content.includes('"isAggregatorNode"'));
            if (isAggregator) {
                const listVal = input['합산 리스트'] ?? [];
                const packet = this.createDataPacket(listVal, fileId, file.name, 'out_1', '합산 리스트');
                const output = { '합산 리스트': packet };
                this.outputCache.set(String(fileId), output);
                return { output, warnings };
            }

            const isDataViewer = file.isDataViewerNode || file.template === 'viewer' ||
                (typeof file.content === 'string' && file.content.includes('"isDataViewerNode"'));
            if (isDataViewer) {
                const inVal = input['입력 데이터'] ?? input['input'] ?? Object.values(input)[0] ?? null;
                const outPinName = pinNames[0] || '출력 데이터';
                const portId = outputPins[0]?.id || 'out_1';

                const packet = this.createDataPacket(inVal, fileId, file.name, portId, outPinName);
                const output = { [outPinName]: packet };
                this.outputCache.set(String(fileId), output);
                return { output, warnings };
            }

            const isCustomNode = !isAggregator && (file.isCustomNode || file.template === 'custom_node' || file.template === 'text_fields' || file.isTextFieldsNode || (file.content && typeof file.content === 'string' && file.content.includes('"isCustomNode"')));
            const isImageNode = file.template === 'image' || (file.content && typeof file.content === 'string' && file.content.startsWith('data:image'));

            // 일반 원고 (에디터) 노드인 경우 적힌 텍스트 내용을 그대로 내보냄
            if (!isCustomNode && !isAggregator && !isImageNode) {
                const textarea = info?.element?.querySelector('.window-textarea');
                const textContent = textarea ? textarea.value : (file.content || '');
                const pinName = pinNames[0] || '원고 결과';
                const portId = outputPins[0]?.id || 'out_1';
                
                const packet = this.createDataPacket(textContent, fileId, file.name, portId, pinName);
                const output = { [pinName]: packet };
                this.outputCache.set(String(fileId), output);
                return { output, warnings };
            }

            const output = {};
            outputPins.forEach(p => {
                const val = input[p.name] ?? null;
                output[p.name] = this.createDataPacket(val, fileId, file.name, p.id, p.name);
            });

            this.outputCache.set(String(fileId), output);
            return { output, warnings };
        }

        // ── 코드 실행 ──
        const input = this.collectInputVars(fileId);
        let raw;
        try {
            const fn = new Function('input', `return (async () => { ${code} })()`);
            raw = await fn(input);
        } catch (err) {
            warnings.push(`코드 실행 오류: ${err.message}`);
            this.outputCache.set(String(fileId), {});
            return { output: {}, warnings };
        }

        const output = {};
        outputPins.forEach(p => {
            const val = raw && typeof raw === 'object' ? raw[p.name] ?? null : null;
            output[p.name] = this.createDataPacket(val, fileId, file.name, p.id, p.name);
        });

        this.outputCache.set(String(fileId), output);
        return { output, warnings };
    }

    // ─────────────────────────────────────────────
    // 그래프 실행
    // ─────────────────────────────────────────────

    /**
     * 위상 정렬로 실행 순서를 결정한 뒤 모든 노드를 순서대로 실행합니다.
     *
     * @param {string[]|null} fileIds - 실행할 노드 ID 목록. null이면 열린 창 전체.
     * @returns {Promise<{ order: string[], warnings: string[] }>}
     */
    async runGraph(fileIds = null) {
        const wm = window.windowManager;
        const ids = (fileIds ?? (wm ? [...wm.windows.keys()] : [])).map(String);

        if (ids.length === 0) {
            window.showToast?.('실행할 노드가 없습니다.', 'warning');
            return { order: [], warnings: [] };
        }

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

        // 순서대로 실행
        const allWarnings = [];
        for (const id of order) {
            const { warnings } = await this.runNode(id);
            if (warnings.length > 0) {
                const nodeName = this._getInfo(id)?.file?.name ?? id;
                allWarnings.push(...warnings.map(w => `[${nodeName}] ${w}`));
            }
        }

        if (allWarnings.length > 0) {
            console.warn('그래프 실행 경고:\n' + allWarnings.join('\n'));
            window.showToast?.(`실행 완료 — 경고 ${allWarnings.length}건 (콘솔 확인)`, 'warning');
        } else {
            window.showToast?.('✅ 모든 노드 실행 완료', 'success');
        }

        return { order, warnings: allWarnings };
    }

    /**
     * 캐시를 초기화합니다. 프로젝트 전환 시 호출하세요.
     */
    clearCache() {
        this.outputCache.clear();
    }
}

window.nodeEngine = new NodeEngine();
