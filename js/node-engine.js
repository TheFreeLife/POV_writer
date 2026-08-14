/**
 * node-engine.js
 * 노드 실행 엔진 (Node Execution Engine - 새로 재구축 준비 모듈)
 */
class NodeEngine {
    constructor() {
        this.outputCache = new Map();
        this.isRunning = false;
        this.isAborted = false;
    }

    /**
     * 노드 데이터를 단일 대통합 노드 포맷(Unified Node Schema)으로 규격화합니다.
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
            if (nodeType === 'image') {
                widgets = [{ id: 'w_img', type: 'image_canvas', label: '🖼️ 이미지 뷰어' }];
            } else if (nodeType === 'manuscript') {
                widgets = [{ id: 'w_editor', type: 'editor_canvas', label: '📝 원고 에디터' }];
            }
        }

        let portsConfig = file.portsConfig || { inputs: [], outputs: [{ id: 'out_1', name: '결과물', color: '#00ffcc' }] };

        return { contentData, widgets, nodeType, portsConfig };
    }

    /** 캔버스 상의 모든 노드와 연결선 하이라이트 효과를 즉시 일괄 제거합니다. */
    clearAllHighlights() {
        document.querySelectorAll('.node-connection-line.exec-active').forEach(el => el.classList.remove('exec-active'));
        document.querySelectorAll('.editor-window.exec-node-active').forEach(el => el.classList.remove('exec-node-active'));
    }

    /**
     * 준비 중 토스트 안내 알림
     */
    notifyPreparing() {
        window.showToast?.('⚙️ 노드 연산 실행 기능은 새 연산 엔진으로 재구축 준비 중입니다.', 'warning');
    }

    // ─────────────────────────────────────────────
    // 실행 트리거 메소드들 (새 연산 엔진으로 재구축 준비)
    // ─────────────────────────────────────────────

    async runNode(fileId) {
        this.notifyPreparing();
        return { success: false, output: {} };
    }

    async runTargetNode(fileId) {
        this.notifyPreparing();
        return { success: false, output: {} };
    }

    async executeNodeCode(fileId) {
        this.notifyPreparing();
        return { output: {}, warnings: [] };
    }

    async evaluateAllNodes() {
        this.notifyPreparing();
        return { success: false };
    }

    getOrEvaluateNodeOutput(fileId) {
        return {};
    }

    stopExecution() {
        this.notifyPreparing();
    }
}

// 싱글톤 인스턴스 등록
const nodeEngine = new NodeEngine();
if (typeof window !== 'undefined') {
    window.nodeEngine = nodeEngine;
}
