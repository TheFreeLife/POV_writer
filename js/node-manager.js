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
            presetId: targetFile.presetId || (typeof targetFile.contentData === 'object' ? targetFile.contentData?.presetId : null) || null,
            nodeType: targetFile.nodeType || 'general',
            category: targetFile.category || 'general',
            code: targetFile.code || '',
            isCustomNode: targetFile.isCustomNode,
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

    /**
     * 🎯 해당 노드의 실제 입력값(위젯 데이터)만 순수 Key-Value 객체로 추출
     * 인풋 핀 및 내부 시스템 메타데이터는 제외하고 사용자가 입력한 데이터만 정제
     */
    getNodeInputValues(fileId) {
        const wm = window.windowManager;
        const info = wm?.getWindowInfo(fileId);
        const node = this.getNode(fileId);
        const file = node ? node.toJSON() : (info?.file || null);
        if (!file) return {};

        const norm = window.nodeEngine?.normalizeNodeData(file) || {};
        let contentData = { ...(norm.contentData || {}) };
        const widgets = norm.widgets || [];

        // 1. 현재 화면 DOM에서 사용자가 수정한 실시간 입력값 동기화
        const winEl = info?.element || document.querySelector(`.editor-window[data-file-id="${fileId}"]`);
        if (winEl) {
            const textareas = winEl.querySelectorAll('textarea');
            textareas.forEach(ta => {
                const wKey = ta.dataset.widgetKey;
                if (wKey) {
                    contentData[wKey] = ta.value;
                } else if (ta.classList.contains('widget-editor-textarea') || ta.classList.contains('window-textarea')) {
                    contentData.editorVal = ta.value;
                    contentData.content = ta.value;
                }
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
            const selectDropdowns = winEl.querySelectorAll('.widget-dropdown-select');
            selectDropdowns.forEach(sel => {
                const wKey = sel.dataset.widgetKey || 'selectVal';
                contentData[wKey] = sel.value;
            });
        }

        // 2. 위젯에 정의된 key 목록을 우선하여 순수 입력값만 추출
        const cleanValues = {};
        if (widgets.length > 0) {
            widgets.forEach(w => {
                // 섹션 헤더, 뷰어, 게이트 등 표시 전용 위젯은 제외
                if (w.type === 'section_header' || w.type === 'text_viewer' || w.type === 'approval_gate' || w.type === 'continue_gate') {
                    return;
                }
                const key = w.key || w.id || w.label || 'val';
                let val = contentData[key] !== undefined ? contentData[key] :
                          (w.label && contentData[w.label] !== undefined ? contentData[w.label] :
                          (contentData.val !== undefined ? contentData.val : (w.defaultVal || '')));
                cleanValues[key] = val;
            });
        }

        // 위젯 정의가 없거나 manuscript(원고)/일반 텍스트 노드인 경우
        if (Object.keys(cleanValues).length === 0) {
            if (contentData.editorVal !== undefined) cleanValues.editorVal = contentData.editorVal;
            else if (contentData.content !== undefined) cleanValues.content = contentData.content;
            else if (typeof file.content === 'string') cleanValues.content = file.content;
            else if (typeof file.content === 'object') {
                Object.entries(file.content).forEach(([k, v]) => {
                    if (!k.startsWith('_') && k !== 'widgets' && k !== 'isApproved' && k !== 'isContinued') {
                        cleanValues[k] = v;
                    }
                });
            }
        }

        return cleanValues;
    }

    /**
     * 📋 해당 노드의 입력값 데이터를 예쁘게 포맷팅된 JSON 문자열로 반환
     */
    getNodeInputValuesJson(fileId) {
        const values = this.getNodeInputValues(fileId);
        return JSON.stringify(values, null, 2);
    }

    /**
     * 🤖 외부 AI 응답(마크다운 코드블록, 앞뒤 사족, 후행 쉼표 등)에서 순수 JSON을 안전하게 추출
     */
    extractJsonFromAiResponse(rawText) {
        if (!rawText || typeof rawText !== 'string') return null;

        let text = rawText.trim();

        // 1단계: ```json ... ``` 또는 ``` ... ``` 마크다운 코드블록 추출
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch && codeBlockMatch[1]) {
            text = codeBlockMatch[1].trim();
        }

        // 2단계: 시작 { (또는 [) 와 끝 } (또는 ]) 범위 탐색
        const firstBrace = text.indexOf('{');
        const firstBracket = text.indexOf('[');
        
        let startIdx = -1;
        if (firstBrace !== -1 && firstBracket !== -1) {
            startIdx = Math.min(firstBrace, firstBracket);
        } else if (firstBrace !== -1) {
            startIdx = firstBrace;
        } else if (firstBracket !== -1) {
            startIdx = firstBracket;
        }

        if (startIdx !== -1) {
            const isObject = text[startIdx] === '{';
            const lastIdx = isObject ? text.lastIndexOf('}') : text.lastIndexOf(']');
            if (lastIdx > startIdx) {
                text = text.substring(startIdx, lastIdx + 1);
            }
        }

        // 3단계: JSON 파싱 및 후행 쉼표 보정
        try {
            return JSON.parse(text);
        } catch (err) {
            try {
                // AI 오타(마지막 쉼표 ,}) 보정
                const sanitized = text.replace(/,\s*([}\]])/g, '$1');
                return JSON.parse(sanitized);
            } catch (finalErr) {
                console.error('[NodeManager] JSON 파싱 실패:', text);
                return null;
            }
        }
    }

    /**
     * 📥 JSON 데이터를 특정 노드의 입력 필드들에 스마트하게 주입(Inject) 및 저장
     */
    async injectValuesToNode(fileId, jsonOrText) {
        let dataObj = typeof jsonOrText === 'object' && jsonOrText !== null ? jsonOrText : this.extractJsonFromAiResponse(jsonOrText);
        if (!dataObj || typeof dataObj !== 'object') {
            throw new Error('유효한 JSON 데이터를 인식할 수 없습니다.');
        }

        // 배열로 온 경우 첫 번째 요소 사용
        if (Array.isArray(dataObj)) {
            dataObj = dataObj[0] || {};
        }

        const wm = window.windowManager;
        const info = wm?.getWindowInfo(fileId);
        const node = this.getNode(fileId);
        const file = node ? node.toJSON() : (info?.file || await window.storage?.getFile(fileId));
        if (!file) throw new Error('대상 노드를 찾을 수 없습니다.');

        const norm = window.nodeEngine?.normalizeNodeData(file) || {};
        const contentData = norm.contentData || {};
        const widgets = norm.widgets || [];

        let matchedCount = 0;

        // 1. 위젯 필드 매핑 및 값 채우기 (정확한 키 매칭 + 라벨 매칭 + 대소문자 무시 매칭)
        const lowerDataKeys = {};
        Object.entries(dataObj).forEach(([k, v]) => {
            lowerDataKeys[k.toLowerCase().replace(/[\s_-]/g, '')] = v;
        });

        widgets.forEach(w => {
            const key = w.key || w.id || w.label;
            const label = w.label;
            
            let assignedVal = undefined;
            if (dataObj[key] !== undefined) {
                assignedVal = dataObj[key];
            } else if (label && dataObj[label] !== undefined) {
                assignedVal = dataObj[label];
            } else {
                // 유사 키 매칭
                const normK = (key || '').toLowerCase().replace(/[\s_-]/g, '');
                const normL = (label || '').toLowerCase().replace(/[\s_-]/g, '');
                if (lowerDataKeys[normK] !== undefined) assignedVal = lowerDataKeys[normK];
                else if (lowerDataKeys[normL] !== undefined) assignedVal = lowerDataKeys[normL];
            }

            if (assignedVal !== undefined) {
                const finalStr = typeof assignedVal === 'object' ? JSON.stringify(assignedVal, null, 2) : assignedVal;
                contentData[key] = finalStr;
                if (w.key) contentData[w.key] = finalStr;
                if (w.label) contentData[w.label] = finalStr;
                matchedCount++;
            }
        });

        // 2. 위젯에 직접 매핑되지 않은 키들도 contentData에 보존
        Object.entries(dataObj).forEach(([k, v]) => {
            if (contentData[k] === undefined) {
                contentData[k] = typeof v === 'object' ? JSON.stringify(v, null, 2) : v;
            }
        });

        // 3. 원고(manuscript) 또는 단일 텍스트 노드인 경우 editorVal 지원
        if (widgets.length === 0 || norm.nodeType === 'manuscript') {
            const possibleVal = dataObj.editorVal || dataObj.content || dataObj.text || dataObj.val || (typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj, null, 2));
            if (possibleVal) {
                contentData.editorVal = possibleVal;
                contentData.content = possibleVal;
                matchedCount++;
            }
        }

        // 4. DB 및 활성 노드 인스턴스 갱신
        file.content = JSON.stringify(contentData, null, 2);
        await window.storage?.updateFile(fileId, { content: file.content });

        if (node) {
            node.content = file.content;
        }
        if (info && info.file) {
            info.file.content = file.content;
        }

        // 5. DOM 화면 즉시 리프레시
        if (wm) {
            wm.refreshNodeUI(fileId);
        }

        window.showToast?.(`'${file.name || '노드'}'에 ${matchedCount}개 필드 값이 성공적으로 주입되었습니다! ✨`);
        return { matchedCount, contentData };
    }

    /**
     * 💾 윈도우 탐색기 저장 창(showSaveFilePicker)을 띄워 사용자가 지정한 위치에 파일 저장
     */
    async saveJsonWithDirectoryPicker(suggestedFilename, jsonString) {
        const cleanName = suggestedFilename.endsWith('.json') ? suggestedFilename : `${suggestedFilename}.json`;

        // 1. 최신 브라우저 File System Access API (폴더 위치 선택 탐색기 창 열림)
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: cleanName,
                    types: [{
                        description: 'JSON 파일 (*.json)',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(jsonString);
                await writable.close();
                window.showToast?.(`'${handle.name || cleanName}' 파일이 성공적으로 저장되었습니다! 💾`);
                return true;
            } catch (err) {
                if (err.name === 'AbortError') return false; // 사용자가 저장을 취소한 경우
                console.warn('[NodeManager] showSaveFilePicker 오류, 표준 다운로드로 전환:', err);
            }
        }

        // 2. Fallback: 표준 브라우저 다운로드
        const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = cleanName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.showToast?.(`'${cleanName}' 파일 다운로드가 시작되었습니다! 💾`);
        return true;
    }
}

window.NodeModel = NodeModel;
window.nodeManager = new NodeManager();
