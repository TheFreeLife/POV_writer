/**
 * 단일 노드 개체 클래스 (NodeModel)
 * 하나의 노드가 가진 속성(ID, 이름, 데이터, 위젯, 핀 포트, 위치)을 캡슐화하고 상태 변경을 전담합니다.
 */
class NodeModel {
    constructor(fileData = {}) {
        this.id = String(fileData.id || ('node_' + Date.now()));
        this.projectId = fileData.projectId || null;
        this.name = fileData.name || '새 노드';
        this.type = fileData.type || 'file';
        this.template = fileData.template || 'custom_node';
        this.content = fileData.content || '{}';
        this.portsConfig = fileData.portsConfig || { inputs: [], outputs: [] };
        this.description = fileData.description || '';
        this.windowState = fileData.windowState || { x: 100, y: 100, width: 440, height: 360, collapsed: false, zIndex: 10 };
        this.icon = fileData.icon || '📄';
        this.createdAt = fileData.createdAt || Date.now();
        this.updatedAt = fileData.updatedAt || Date.now();
    }

    /** 위젯 입력 데이터 객체 반환 */
    getContentData() {
        const norm = window.nodeEngine?.normalizeNodeData(this);
        return norm?.contentData || {};
    }

    /** 특정 위젯 값 설정 */
    setValue(key, value) {
        const data = this.getContentData();
        data[key] = value;
        this.content = JSON.stringify(data, null, 2);
    }

    /** 노드 직렬화 JSON 반환 */
    toJSON() {
        return {
            id: this.id,
            projectId: this.projectId,
            name: this.name,
            type: this.type,
            template: this.template,
            content: this.content,
            portsConfig: this.portsConfig,
            description: this.description,
            windowState: this.windowState,
            icon: this.icon,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

/**
 * 노드 중앙 총괄 매니저 (NodeManager)
 * 프로젝트 내 모든 노드 객체의 생성, 복제, 삭제, 템플릿 직렬화, 포트 핀 및 상태 관리를 전담하는 단일 창구(Facade)입니다.
 */
class NodeManager {
    constructor() {
        // 활성 노드 객체 맵 (Map<id, NodeModel>)
        this.nodes = new Map();
        this.maxZIndex = 10;
    }

    /**
     * 노드 신규 생성 (NodeModel 객체화 후 Storage 저장 및 캔버스 등록)
     */
    async createNode(fileData) {
        if (!window.storage) return null;
        try {
            let customW = fileData.defaultWidth;
            let customH = fileData.defaultHeight;
            if ((!customW || !customH) && typeof fileData.content === 'string') {
                try {
                    const parsed = JSON.parse(fileData.content);
                    if (parsed.defaultWidth) customW = parsed.defaultWidth;
                    if (parsed.defaultHeight) customH = parsed.defaultHeight;
                } catch(e) {}
            }

            const reqW = customW || 520;
            const reqH = customH || 650;

            const defaultState = {
                x: 120 + Math.floor(Math.random() * 60),
                y: 120 + Math.floor(Math.random() * 60),
                width: reqW,
                height: reqH,
                collapsed: false,
                zIndex: ++this.maxZIndex
            };

            const modelData = {
                ...fileData,
                windowState: fileData.windowState || defaultState
            };

            const createdFile = await window.storage.createFile(modelData);
            const nodeModel = new NodeModel(createdFile);
            this.nodes.set(nodeModel.id, nodeModel);

            window.showToast?.(`'${nodeModel.name}' 노드가 생성되었습니다! ✨`);
            return nodeModel;
        } catch (err) {
            console.error('노드 생성 실패:', err);
            return null;
        }
    }

    /**
     * 노드 복제 (현재 최신 위젯 데이터 수집 후 40px Offset 위치에 새 노드 생성)
     */
    async duplicateNode(fileId) {
        const node = this.getNode(fileId);
        const wm = window.windowManager;
        const info = wm?.getWindowInfo(fileId);

        if (!node && !info) return null;
        const targetFile = node ? node.toJSON() : info.file;

        // 1. 현재 DOM 최신 위젯 입력값 반영
        let currentContent = targetFile.content;
        const winEl = info?.element;
        const editorTextarea = winEl?.querySelector('.widget-editor-textarea, .window-textarea');
        if (editorTextarea) {
            const norm = window.nodeEngine?.normalizeNodeData(targetFile) || {};
            const contentData = norm.contentData || {};
            contentData.editorVal = editorTextarea.value;
            currentContent = JSON.stringify(contentData, null, 2);
            await window.storage?.updateFile(fileId, { content: currentContent });
        }

        // 2. 복제 위치 Offset (+40px, +40px)
        const origX = parseInt(winEl?.style.left, 10) || targetFile.windowState?.x || 100;
        const origY = parseInt(winEl?.style.top, 10) || targetFile.windowState?.y || 100;
        const origW = parseInt(winEl?.style.width, 10) || targetFile.windowState?.width || 440;
        const origH = parseInt(winEl?.style.height, 10) || targetFile.windowState?.height || 360;

        const newWindowState = {
            x: origX + 40,
            y: origY + 40,
            width: origW,
            height: origH,
            collapsed: false,
            zIndex: ++this.maxZIndex
        };

        const dupData = {
            projectId: targetFile.projectId,
            name: targetFile.name,
            type: targetFile.type || 'file',
            parentId: targetFile.parentId || null,
            content: currentContent,
            template: targetFile.template || 'custom_node',
            portsConfig: targetFile.portsConfig ? JSON.parse(JSON.stringify(targetFile.portsConfig)) : null,
            description: targetFile.description || '',
            windowState: newWindowState
        };

        const dupNodeModel = await this.createNode(dupData);

        // 3. UI 복원 및 갱신
        if (window.fileTreeManager) {
            await window.fileTreeManager.loadProjectFiles(targetFile.projectId);
        }

        if (dupNodeModel && wm) {
            await wm.openWindow(dupNodeModel.id);
            window.showToast?.(`'${targetFile.name}' 노드가 복제되었습니다! 📋`);
        }

        return dupNodeModel;
    }

    /**
     * 노드를 입력 보존 템플릿으로 저장
     */
    async saveNodeAsTemplate(fileId, customName = null) {
        const node = this.getNode(fileId);
        const wm = window.windowManager;
        const info = wm?.getWindowInfo(fileId);
        if (!node && !info) return null;

        const targetFile = node ? node.toJSON() : info.file;
        const winEl = info?.element;

        if (winEl) {
            const editorTextarea = winEl.querySelector('.widget-editor-textarea, .window-textarea');
            if (editorTextarea) {
                const norm = window.nodeEngine?.normalizeNodeData(targetFile) || {};
                const contentData = norm.contentData || {};
                contentData.editorVal = editorTextarea.value;
                targetFile.content = JSON.stringify(contentData, null, 2);
                await window.storage?.updateFile(fileId, { content: targetFile.content });
            }
        }

        const rawName = (targetFile.name || '새 노드').replace(/^[^\w\s가-힣]+\s*/, '').trim();
        const tplName = customName || prompt('이 노드를 어떤 이름의 템플릿으로 저장하시겠습니까?', rawName);
        if (!tplName || !tplName.trim()) return null;

        const templateObj = {
            id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: tplName.trim(),
            icon: targetFile.icon || '📄',
            desc: `입력 칸이 채워진 노드 템플릿 (${new Date().toLocaleDateString()})`,
            wizardType: targetFile.template || 'custom_node',
            template: targetFile.template || 'custom_node',
            content: targetFile.content || '',
            portsConfig: targetFile.portsConfig || null,
            createdAt: Date.now()
        };

        await window.storage?.createTemplate(templateObj);
        window.showToast?.(`'${templateObj.name}' 노드가 입력 보존 템플릿으로 저장되었습니다! ⭐`);
        return templateObj;
    }

    /**
     * 노드 삭제 (DOM, 연결선, DB, 파일 트리 일괄 제거)
     */
    async deleteNode(fileId, skipConfirm = false) {
        const wm = window.windowManager;
        const info = wm?.getWindowInfo(fileId);
        const node = this.getNode(fileId);
        const file = node ? node.toJSON() : (info?.file || (window.fileTreeManager?.files || []).find(f => String(f.id) === String(fileId)) || { id: fileId, name: '이 노드' });
        const fileName = file.name || '이 노드';

        if (skipConfirm || confirm(`'${fileName}' 노드를 완전히 삭제할까요?\n연결된 핀과 데이터도 함께 제거됩니다.`)) {
            // 1. DOM 및 레지스트리 제거
            if (info?.element) {
                info.element.remove();
            }
            this.nodes.delete(String(fileId));

            if (wm) {
                wm.windows.delete(fileId);
                wm.selectedWindowIds?.delete(fileId);
                await wm.destroyNodeState(fileId);
            }

            // 2. DB 삭제
            await window.storage?.deleteFile(fileId);

            // 3. 파일 트리 갱신
            if (window.fileTreeManager) {
                if (window.fileTreeManager.currentFileId === fileId) {
                    window.fileTreeManager.currentFileId = null;
                }
                await window.fileTreeManager.loadProjectFiles(window.fileTreeManager.currentProjectId || window.currentProjectId);
            }

            window.showToast?.(`'${fileName}' 노드가 삭제되었습니다. 🗑️`);
            return true;
        }
        return false;
    }

    /**
     * 노드 상태 및 위치 업데이트
     */
    async updateNodeState(fileId, patchState) {
        const node = this.getNode(fileId);
        if (node) {
            node.windowState = { ...node.windowState, ...patchState };
            await window.storage?.updateFile(fileId, { windowState: node.windowState });
        }
    }

    /**
     * 노드 포트 핀 구성 정보 조회
     */
    getNodePorts(fileId) {
        const node = this.getNode(fileId);
        if (node) return node.portsConfig;
        const info = window.windowManager?.getWindowInfo(fileId);
        return info?.file?.portsConfig || { inputs: [], outputs: [] };
    }

    /**
     * 노드 객체 등록 (NodeModel 변환 등록)
     */
    registerNode(fileData) {
        if (!fileData) return null;
        const model = fileData instanceof NodeModel ? fileData : new NodeModel(fileData);
        this.nodes.set(model.id, model);

        if (model.windowState?.zIndex) {
            const z = parseInt(model.windowState.zIndex, 10);
            if (!isNaN(z) && z > this.maxZIndex) {
                this.maxZIndex = z;
            }
        }
        return model;
    }

    /**
     * 노드 객체 제거
     */
    unregisterNode(fileId) {
        this.nodes.delete(String(fileId));
    }

    /**
     * ID로 노드 객체 조회
     */
    getNode(fileId) {
        if (!fileId && fileId !== 0) return null;
        return this.nodes.get(String(fileId)) || this.nodes.get(Number(fileId)) || null;
    }

    /**
     * 활성 노드 객체 리스트 반환
     */
    getAllNodes() {
        return Array.from(this.nodes.values());
    }
}

window.NodeModel = NodeModel;
window.nodeManager = new NodeManager();
