/**
 * 위젯 전용 관리자 (WidgetRegistry & Manager)
 * 노드 내 모든 위젯의 형태(HTML)와 동작(이벤트)을 독립적이고 객체지향적으로 관리합니다.
 */
class WidgetManager {
    constructor() {
        // 등록된 위젯 처리기 맵 (6종)
        this.widgets = new Map();
        this.registerDefaultWidgets();
    }

    /**
     * 기본 6종 위젯 렌더러 & 이벤트 핸들러 등록
     */
    registerDefaultWidgets() {
        // 1) 한줄 / 여러줄 텍스트 입력 위젯
        this.register('input_text', {
            render: (w, contentData, fileId) => {
                const rows = w.rows || 1;
                const key = w.key || 'val';
                const currentVal = contentData[key] !== undefined ? contentData[key] : (w.defaultVal || '');
                const minHeight = rows === 1 ? '32px' : `${Math.max(38, rows * 22)}px`;
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">
                            📝 ${this.escapeHtml(w.label || '텍스트 입력')}
                        </label>
                        <textarea class="input widget-input-field" data-widget-key="${this.escapeHtml(key)}" rows="${rows}" style="font-family: inherit; font-size: 12px; padding: 6px 8px; resize: vertical; min-height: ${minHeight}; background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text-primary);" placeholder="${this.escapeHtml(w.placeholder || '내용을 입력하세요...')}">${this.escapeHtml(currentVal)}</textarea>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {
                const key = w.key || 'val';
                const inputEl = container.querySelector(`.widget-input-field[data-widget-key="${key}"]`);
                if (inputEl) {
                    inputEl.addEventListener('input', () => {
                        contentData[key] = inputEl.value;
                        onUpdate(contentData);
                    });
                }
            }
        });

        // 2) 소설/원고 작성 에디터 위젯
        this.register('editor_canvas', {
            render: (w, contentData, fileId) => {
                const key = w.key || 'editorVal';
                const rows = w.rows || 5;
                const val = contentData[key] !== undefined ? contentData[key] : (w.defaultVal || contentData.content || '');
                const ph = w.placeholder || '원고 본문을 작성하세요...';
                const minHeight = `${Math.max(100, rows * 24)}px`;
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 4px; width: 100%; box-sizing: border-box;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">
                            🖋️ ${this.escapeHtml(w.label || '소설 원고 작성 에디터')}
                        </label>
                        <textarea class="widget-editor-textarea" data-widget-key="${this.escapeHtml(key)}" rows="${rows}" style="width: 100%; min-height: ${minHeight}; font-size: 14px; line-height: 1.8; padding: 12px; resize: vertical !important; border-radius: 8px; border: 1px solid var(--color-border); outline: none; box-sizing: border-box; background: var(--color-bg-primary); color: var(--color-text-primary);" placeholder="${this.escapeHtml(ph)}">${this.escapeHtml(val)}</textarea>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {
                const key = w.key || 'editorVal';
                const textarea = container.querySelector(`.widget-editor-textarea[data-widget-key="${key}"]`);
                if (textarea) {
                    textarea.addEventListener('input', () => {
                        contentData[key] = textarea.value;
                        contentData.content = textarea.value;
                        onUpdate(contentData);
                    });
                }
            }
        });

        // 3) 이미지 / 지도 뷰어 위젯
        this.register('image_canvas', {
            render: (w, contentData, fileId) => {
                const key = w.key || 'image_val';
                const imgSrc = contentData[key] || contentData.image || w.defaultSrc || '';
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">
                            🖼️ ${this.escapeHtml(w.label || '이미지 자원')}
                        </label>
                        <div class="widget-image-container" style="background: var(--color-bg-primary); border: 1px dashed var(--color-border); border-radius: 8px; padding: 8px; text-align: center;">
                            ${imgSrc ? `
                                <img src="${this.escapeHtml(imgSrc)}" class="widget-image-preview" style="max-width: 100%; max-height: 220px; border-radius: 6px; object-fit: contain;">
                            ` : `
                                <div style="padding: 24px; color: var(--color-text-tertiary); font-size: 12px;">🖼️ 등록된 이미지가 없습니다.</div>
                            `}
                        </div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {}
        });

        // 4) 데이터 모니터링 뷰어 위젯
        this.register('text_viewer', {
            render: (w, contentData, fileId) => {
                const key = w.key || 'displayVal';
                const val = contentData[key] !== undefined ? contentData[key] : (contentData.output || '(결과 데이터 없음)');
                const displayStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">
                            👁️ ${this.escapeHtml(w.label || '모니터링 뷰어')}
                        </label>
                        <pre class="widget-text-viewer-pre" data-widget-key="${this.escapeHtml(key)}" style="font-family: var(--font-family-mono); font-size: 11px; background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 6px; padding: 8px; white-space: pre-wrap; word-break: break-all; margin: 0; color: var(--color-text-primary); max-height: 160px; overflow-y: auto;">${this.escapeHtml(displayStr)}</pre>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {}
        });

        // 5) 사용자 검수 승인 위젯
        this.register('approval_gate', {
            render: (w, contentData, fileId) => {
                const isApproved = !!contentData.isApproved;
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 8px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 8px; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 11px; font-weight: bold; color: ${isApproved ? '#2ecc71' : '#f39c12'};">
                                ${isApproved ? '✅ 검수 승인 완료' : '⏸️ 승인 대기 중'}
                            </span>
                            <button type="button" class="btn btn-xs reset-appr-btn" style="font-size: 10px; padding: 2px 6px;">🔄 초기화</button>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button type="button" class="btn btn-warning btn-xs reject-retry-btn" style="flex: 1; padding: 6px; font-weight: bold; font-size: 11px;" title="결과물이 마음에 들지 않을 경우 상위 노드의 작업을 다시 수행합니다">
                                🛑 반려 및 재시도
                            </button>
                            <button type="button" class="btn btn-success btn-xs approve-gate-btn" style="flex: 1; padding: 6px; font-weight: bold; font-size: 11px; background: ${isApproved ? '#27ae60' : '#2ecc71'};">
                                ${isApproved ? '✅ 승인 상태' : '✅ 승인 및 진행'}
                            </button>
                        </div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate, fileId) => {
                const apprBtn = container.querySelector('.approve-gate-btn');
                const rejectBtn = container.querySelector('.reject-retry-btn');
                const resetBtn = container.querySelector('.reset-appr-btn');

                // 승인 및 하위 전파 실행
                if (apprBtn) {
                    apprBtn.addEventListener('click', async () => {
                        contentData.isApproved = true;
                        onUpdate(contentData);

                        if (fileId && window.nodeEngine) {
                            const downstreamIds = window.nodeEngine.getDownstreamNodeIds(fileId);
                            if (downstreamIds.length > 0) {
                                window.showToast?.('승인 완료! 하위 노드 연산을 진행합니다... 🚀', 'success');
                                for (const dId of downstreamIds) {
                                    await window.nodeEngine.runNode(dId);
                                }
                            } else {
                                window.showToast?.('검수가 승인 완료되었습니다! ✅', 'success');
                            }
                        }
                    });
                }

                // 반려 및 상위 노드 연산 재시도
                if (rejectBtn) {
                    rejectBtn.addEventListener('click', async () => {
                        if (!fileId || !window.nodeEngine) return;

                        const connections = window.nodeEngine._getConnections() || [];
                        const inConns = connections.filter(c => String(c.toId) === String(fileId));

                        if (inConns.length === 0) {
                            window.showToast?.('⚠️ 연결된 상위 노드가 없습니다.', 'warning');
                            return;
                        }

                        window.showToast?.('🔄 상위 작업 연산을 재시도합니다...');
                        contentData.isApproved = false;
                        onUpdate(contentData);

                        for (const conn of inConns) {
                            window.nodeEngine.clearNodeCache(conn.fromId);
                            await window.nodeEngine.runNode(conn.fromId);
                            window.windowManager?.refreshNodeUI(conn.fromId);
                        }

                        window.showToast?.('✨ 상위 작업이 새로 연산되었습니다!', 'success');
                    });
                }

                // 초기화
                if (resetBtn) {
                    resetBtn.addEventListener('click', () => {
                        contentData.isApproved = false;
                        onUpdate(contentData);
                        window.showToast?.('승인 상태가 초기화되었습니다. 🔄');
                    });
                }
            }
        });

        // 6) 사용자 선택 분기 위젯
        this.register('choice_select', {
            render: (w, contentData, fileId) => {
                const choices = w.options || ['선택지 A', '선택지 B'];
                const selected = contentData.selectedChoice || choices[0];
                const btnsHtml = choices.map(opt => {
                    const isSel = opt === selected;
                    return `
                        <button type="button" class="btn choice-opt-btn" data-opt="${this.escapeHtml(opt)}" style="padding: 8px 10px; font-size: 11px; font-weight: bold; text-align: left; display: flex; justify-content: space-between; border-radius: 6px; border: 1.5px solid ${isSel ? '#3498db' : 'var(--color-border)'}; background: ${isSel ? 'rgba(52, 152, 219, 0.15)' : 'var(--color-surface-1)'}; color: ${isSel ? '#ffffff' : 'var(--color-text-secondary)'};">
                            <span>🔀 ${this.escapeHtml(opt)}</span>
                            <span>${isSel ? '선택됨 🎯' : '선택'}</span>
                        </button>
                    `;
                }).join('');
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">🔀 경로 선택</label>
                        <div style="display: flex; flex-direction: column; gap: 6px;">${btnsHtml}</div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {
                container.querySelectorAll('.choice-opt-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        contentData.selectedChoice = btn.dataset.opt;
                        onUpdate(contentData);
                    });
                });
            }
        });
    }

    /** 위젯 타입 추가/등록 */
    register(type, handler) {
        this.widgets.set(type, handler);
    }

    /** 위젯 HTML 렌더링 */
    renderWidget(widget, contentData, fileId) {
        const handler = this.widgets.get(widget.type);
        if (handler) {
            return handler.render(widget, contentData, fileId);
        }
        return `<div class="widget-item" style="font-size: 11px; color: var(--color-accent-danger);">알 수 없는 위젯 타입: ${this.escapeHtml(widget.type)}</div>`;
    }

    /** 위젯 이벤트 바인딩 */
    bindWidgetEvents(container, widget, contentData, onUpdate, fileId) {
        const handler = this.widgets.get(widget.type);
        if (handler && handler.bindEvents) {
            handler.bindEvents(container, widget, contentData, onUpdate, fileId);
        }
    }

    /**
     * DOM 파괴 및 재생성 없이 이미 존재하는 위젯 element의 값(Text/Value/Src)만 선택적으로 차분 갱신합니다.
     */
    updateWidgetValueInPlace(container, widget, contentData) {
        if (!container) return;
        const key = widget.key;

        if (widget.type === 'text_viewer') {
            const k = key || 'displayVal';
            const val = contentData[k] !== undefined ? contentData[k] : (contentData.output || '(결과 데이터 없음)');
            const displayStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
            const preEl = container.querySelector(`.widget-text-viewer-pre[data-widget-key="${k}"]`) || container.querySelector('pre');
            if (preEl && preEl.textContent !== displayStr) {
                preEl.textContent = displayStr;
            }
        } else if (widget.type === 'input_text') {
            const k = key || 'val';
            const val = contentData[k] !== undefined ? contentData[k] : (widget.defaultVal || '');
            const inputEl = container.querySelector(`.widget-input-field[data-widget-key="${k}"]`);
            if (inputEl && document.activeElement !== inputEl && inputEl.value !== val) {
                inputEl.value = val;
            }
        } else if (widget.type === 'editor_canvas') {
            const k = key || 'editorVal';
            const val = contentData[k] !== undefined ? contentData[k] : (contentData.content || '');
            const textarea = container.querySelector(`.widget-editor-textarea[data-widget-key="${k}"]`);
            if (textarea && document.activeElement !== textarea && textarea.value !== val) {
                textarea.value = val;
            }
        } else if (widget.type === 'image_canvas') {
            const k = key || 'image_val';
            const imgSrc = contentData[k] || contentData.image || widget.defaultSrc || '';
            const imgEl = container.querySelector('.widget-image-preview');
            if (imgEl && imgEl.getAttribute('src') !== imgSrc) {
                if (imgSrc) {
                    imgEl.src = imgSrc;
                }
            }
        } else if (widget.type === 'approval_gate') {
            const isApproved = !!contentData.isApproved;
            const statusLabel = container.querySelector('.widget-item span[style*="font-weight: bold"]');
            const apprBtn = container.querySelector('.approve-gate-btn');
            if (statusLabel) {
                statusLabel.style.color = isApproved ? '#2ecc71' : '#f39c12';
                statusLabel.textContent = isApproved ? '✅ 검수 승인 완료' : '⏸️ 승인 대기 중';
            }
            if (apprBtn) {
                apprBtn.style.background = isApproved ? '#27ae60' : '#2ecc71';
                apprBtn.textContent = isApproved ? '✅ 승인 상태' : '✅ 승인 및 진행';
            }
        }
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

window.widgetManager = new WidgetManager();
