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
                const key = w.key || w.label || 'val';
                const currentVal = contentData[w.key] !== undefined ? contentData[w.key] :
                                  (w.label && contentData[w.label] !== undefined ? contentData[w.label] :
                                  (contentData[key] !== undefined ? contentData[key] :
                                  (contentData.val !== undefined ? contentData.val : (w.defaultVal || ''))));
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
                const key = w.key || w.label || 'val';
                const inputEl = container.querySelector(`.widget-input-field[data-widget-key="${key}"]`) || container.querySelector('.widget-input-field');
                if (inputEl) {
                    inputEl.addEventListener('input', () => {
                        const val = inputEl.value;
                        contentData[key] = val;
                        if (w.key) contentData[w.key] = val;
                        if (w.label) contentData[w.label] = val;
                        contentData.val = val;
                        onUpdate(contentData);
                    });
                }
            }
        });

        // 1-2) 드롭다운 선택 위젯
        this.register('dropdown_select', {
            render: (w, contentData, fileId) => {
                const key = w.key || w.label || 'selectVal';
                let options = [];
                if (Array.isArray(w.options) && w.options.length > 0) {
                    options = w.options;
                } else if (typeof w.optionsStr === 'string' && w.optionsStr.trim()) {
                    options = w.optionsStr.split(',').map(s => s.trim()).filter(Boolean);
                } else if (typeof w.defaultVal === 'string' && w.defaultVal.includes(',')) {
                    options = w.defaultVal.split(',').map(s => s.trim()).filter(Boolean);
                } else {
                    options = ['옵션 1', '옵션 2', '옵션 3'];
                }

                const currentVal = contentData[w.key] !== undefined ? contentData[w.key] :
                                  (w.label && contentData[w.label] !== undefined ? contentData[w.label] :
                                  (contentData[key] !== undefined ? contentData[key] :
                                  (contentData.selectVal !== undefined ? contentData.selectVal : (w.defaultVal || options[0] || ''))));

                const optsHtml = options.map(opt => {
                    const optVal = typeof opt === 'object' ? opt.value || opt.name : String(opt);
                    const optLabel = typeof opt === 'object' ? opt.label || opt.name : String(opt);
                    const isSelected = String(optVal) === String(currentVal) || String(optLabel) === String(currentVal);
                    return `<option value="${this.escapeHtml(optVal)}" ${isSelected ? 'selected' : ''}>${this.escapeHtml(optLabel)}</option>`;
                }).join('');

                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">
                            🔽 ${this.escapeHtml(w.label || '드롭다운 선택')}
                        </label>
                        <select class="input widget-dropdown-select" data-widget-key="${this.escapeHtml(key)}" style="width: 100%; height: 32px; font-size: 12px; padding: 4px 8px; background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text-primary); cursor: pointer; outline: none;">
                            ${optsHtml}
                        </select>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {
                const key = w.key || w.label || 'selectVal';
                const selectEl = container.querySelector(`.widget-dropdown-select[data-widget-key="${key}"]`) || container.querySelector('.widget-dropdown-select');
                if (selectEl) {
                    selectEl.addEventListener('change', () => {
                        const val = selectEl.value;
                        contentData[key] = val;
                        if (w.key) contentData[w.key] = val;
                        if (w.label) contentData[w.label] = val;
                        contentData.selectVal = val;
                        onUpdate(contentData);
                    });
                }
            }
        });

        // 2) 소설/원고 작성 에디터 위젯
        this.register('editor_canvas', {
            render: (w, contentData, fileId) => {
                const key = w.key || w.label || 'editorVal';
                const rows = w.rows || 5;
                const val = contentData[w.key] !== undefined ? contentData[w.key] :
                            (w.label && contentData[w.label] !== undefined ? contentData[w.label] :
                            (contentData[key] !== undefined ? contentData[key] :
                            (contentData.editorVal !== undefined ? contentData.editorVal :
                            (contentData.content !== undefined ? contentData.content :
                            (contentData.text !== undefined ? contentData.text : (w.defaultVal || ''))))));
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
                const key = w.key || w.label || 'editorVal';
                const textarea = container.querySelector(`.widget-editor-textarea[data-widget-key="${key}"]`) || container.querySelector('.widget-editor-textarea');
                if (textarea) {
                    textarea.addEventListener('input', () => {
                        const val = textarea.value;
                        contentData[key] = val;
                        if (w.key) contentData[w.key] = val;
                        if (w.label) contentData[w.label] = val;
                        contentData.editorVal = val;
                        contentData.content = val;
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

        // 4-2) 원형 데이터 구조 인스펙터 위젯 (Raw Data Inspector - 객체/JSON 구조 그대로 출력)
        this.register('raw_data_viewer', {
            render: (w, contentData, fileId) => {
                const key = w.key || w.label || 'rawVal';
                const val = contentData[w.key] !== undefined ? contentData[w.key] :
                            (w.label && contentData[w.label] !== undefined ? contentData[w.label] :
                            (contentData[key] !== undefined ? contentData[key] :
                            (contentData.rawVal !== undefined ? contentData.rawVal :
                            (contentData.rawInputs !== undefined ? contentData.rawInputs :
                            (contentData.output !== undefined ? contentData.output : null)))));

                let typeName = 'null';
                let formattedJson = 'null';

                if (val !== null && val !== undefined) {
                    if (Array.isArray(val)) {
                        typeName = `Array(${val.length})`;
                        formattedJson = JSON.stringify(val, null, 2);
                    } else if (typeof val === 'object') {
                        typeName = `Object {${Object.keys(val).length}}`;
                        formattedJson = JSON.stringify(val, null, 2);
                    } else {
                        typeName = typeof val;
                        formattedJson = String(val);
                    }
                } else {
                    formattedJson = '(입력된 원형 데이터 없음)';
                }

                const rows = parseInt(w.rows || 10, 10) || 10;
                const minHeight = `${Math.max(120, rows * 22)}px`;

                return `
                    <div class="widget-item raw-data-inspector-widget" style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px;">
                                🧬 ${this.escapeHtml(w.label || '원형 데이터 인스펙터')}
                                <span class="raw-data-type-badge" style="font-size: 10px; font-weight: 700; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; padding: 1px 6px;">${this.escapeHtml(typeName)}</span>
                            </label>
                            <button type="button" class="btn btn-secondary btn-xs copy-raw-json-btn" data-file-id="${fileId}" style="font-size: 10px; padding: 2px 8px; display: flex; align-items: center; gap: 4px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 4px; cursor: pointer; color: var(--color-text-secondary);">
                                📋 복사
                            </button>
                        </div>
                        <pre class="widget-raw-data-pre" data-widget-key="${this.escapeHtml(key)}" style="font-family: var(--font-family-mono, Consolas, monospace); font-size: 11px; line-height: 1.5; background: #0d1117; color: #7ee787; border: 1px solid var(--color-border); border-radius: 6px; padding: 10px; white-space: pre-wrap; word-break: break-all; margin: 0; min-height: ${minHeight}; height: ${minHeight}; resize: vertical !important; overflow: auto; tab-size: 2; box-sizing: border-box;">${this.escapeHtml(formattedJson)}</pre>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate, fileId) => {
                const copyBtn = container.querySelector('.copy-raw-json-btn');
                const preEl = container.querySelector('.widget-raw-data-pre');
                if (copyBtn && preEl) {
                    copyBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const textToCopy = preEl.textContent;
                        navigator.clipboard?.writeText(textToCopy).then(() => {
                            const originalText = copyBtn.innerHTML;
                            copyBtn.innerHTML = '✅ 복사됨!';
                            copyBtn.style.color = '#10b981';
                            setTimeout(() => {
                                copyBtn.innerHTML = originalText;
                                copyBtn.style.color = 'var(--color-text-secondary)';
                            }, 1500);
                        }).catch(() => {
                            window.showToast?.('클립보드 복사 실패', 'error');
                        });
                    });
                }
            }
        });

        // 5) 사용자 검수 승인 위젯
        this.register('approval_gate', {
            render: (w, contentData, fileId) => {
                const isApproved = !!contentData.isApproved;
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 8px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 8px; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span class="approval-gate-status-label" style="font-size: 11px; font-weight: bold; color: ${isApproved ? '#2ecc71' : '#f39c12'};">
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
                        const isWaitingInEngine = window.nodeEngine?.currentSession?.waitingResolvers?.has(String(fileId));
                        if (!window.nodeEngine?.isRunning || !isWaitingInEngine) {
                            window.showToast?.('⚠️ 노드 그래프 실행 중 승인 대기(주황색) 상태일 때만 승인이 가능합니다.', 'warning');
                            return;
                        }

                        contentData.isApproved = true;
                        onUpdate(contentData);

                        if (fileId && window.nodeEngine) {
                            window.nodeEngine.resumeWaitingNode(fileId);
                            window.showToast?.('승인 완료! 하위 노드 연산을 진행합니다... 🚀', 'success');
                        }
                    });
                }

                // 반려 및 상위 노드 연산 재시도
                if (rejectBtn) {
                    rejectBtn.addEventListener('click', async () => {
                        const isWaitingInEngine = window.nodeEngine?.currentSession?.waitingResolvers?.has(String(fileId));
                        if (!window.nodeEngine?.isRunning || !isWaitingInEngine) {
                            window.showToast?.('⚠️ 노드 그래프 실행 중 승인 대기(주황색) 상태일 때만 반려/재시도가 가능합니다.', 'warning');
                            return;
                        }

                        if (fileId && window.nodeEngine) {
                            await window.nodeEngine.rejectAndRetry(fileId);
                        }
                    });
                }

                // 초기화
                if (resetBtn) {
                    resetBtn.addEventListener('click', () => {
                        if (window.nodeEngine?.isRunning) {
                            window.showToast?.('⚠️ 실행 중에는 수동 초기화할 수 없습니다. 상단 실행 중지를 이용해주세요.', 'warning');
                            return;
                        }
                        contentData.isApproved = false;
                        onUpdate(contentData);
                        window.showToast?.('승인 상태가 초기화되었습니다. 🔄');
                    });
                }
            }
        });

        // 6) 사용자 선택 분기 위젯 (A/B 선택 및 다중 경로 선택)
        this.register('choice_select', {
            render: (w, contentData, fileId) => {
                const key = w.key || 'selectedOption';
                const defaultChoices = [
                    { id: 'in_1', code: 'A', name: '선택지 A (상단 핀)', color: '#a855f7' },
                    { id: 'in_2', code: 'B', name: '선택지 B (하단 핀)', color: '#38bdf8' }
                ];
                const choices = w.options || defaultChoices;
                const selected = contentData[key] || choices[0]?.code || choices[0]?.id || choices[0] || 'A';

                // 연결선에서 각 포트에 꽂힌 상위 노드 이름 조회
                const connections = window.nodeEngine?._getConnections() || window.windowManager?.nodeConnections || [];
                const targetConns = fileId ? connections.filter(c => String(c.toId) === String(fileId)) : [];

                const btnsHtml = choices.map((opt, idx) => {
                    const optCode = typeof opt === 'object' ? (opt.code || opt.id) : opt;
                    const optId = typeof opt === 'object' ? (opt.id || `in_${idx + 1}`) : `in_${idx + 1}`;
                    const optName = typeof opt === 'object' ? opt.name : opt;
                    const optColor = typeof opt === 'object' ? (opt.color || '#38bdf8') : (idx === 0 ? '#a855f7' : '#38bdf8');
                    const isSel = (optCode === selected || optId === selected || optName === selected);

                    // 포트에 연결된 상위 노드 이름
                    const matchedConn = targetConns.find(c => (c.toPortId || 'in_1') === optId);
                    let parentInfoText = '연결된 노드 없음';
                    if (matchedConn) {
                        const parentFile = window.nodeEngine?._getFile(matchedConn.fromId) || window.fileTreeManager?.files?.find?.(f => String(f.id) === String(matchedConn.fromId));
                        parentInfoText = `🔗 ${parentFile?.name || '상위 노드'}`;
                    }

                    return `
                        <div class="choice-opt-card choice-opt-btn ${isSel ? 'selected' : ''}" data-opt-code="${this.escapeHtml(optCode)}" data-opt-id="${this.escapeHtml(optId)}" style="display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; border: 1.5px solid ${isSel ? optColor : 'var(--color-border)'}; background: ${isSel ? 'rgba(56, 189, 248, 0.12)' : 'var(--color-surface-1)'}; cursor: pointer; transition: all 0.15s ease;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${optColor};"></span>
                                    <span style="font-size: 12px; font-weight: 700; color: ${isSel ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'};">${this.escapeHtml(optName)}</span>
                                </div>
                                <span style="font-size: 11px; font-weight: 700; color: ${isSel ? optColor : 'var(--color-text-tertiary)'}; background: ${isSel ? 'var(--color-bg-primary)' : 'transparent'}; padding: 2px 8px; border-radius: 12px; border: 1px solid ${isSel ? optColor : 'transparent'};">
                                    ${isSel ? '✓ 채택됨 🎯' : '선택하기'}
                                </span>
                            </div>
                            <div style="font-size: 11px; color: ${matchedConn ? 'var(--color-accent-primary)' : 'var(--color-text-tertiary)'}; font-weight: ${matchedConn ? '600' : '400'};">
                                ${this.escapeHtml(parentInfoText)}
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="widget-item choice-select-widget-container" style="display: flex; flex-direction: column; gap: 8px; background: var(--color-bg-secondary); padding: 10px; border-radius: 8px; border: 1px solid var(--color-border);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">
                                🔀 ${this.escapeHtml(w.label || '진행 경로 / 선택지 분기')}
                            </label>
                            <span style="font-size: 10px; color: var(--color-text-tertiary);">원하는 경로를 클릭하세요</span>
                        </div>
                        <div class="choice-cards-list" style="display: flex; flex-direction: column; gap: 6px;">${btnsHtml}</div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate, fileId) => {
                const key = w.key || 'selectedOption';
                container.querySelectorAll('.choice-opt-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const optCode = btn.dataset.optCode;
                        contentData[key] = optCode;
                        contentData.selectedChoice = optCode;
                        contentData.selectedOption = optCode;
                        onUpdate(contentData);

                        // 실시간 UI 하이라이트 동기화
                        const widgetBox = btn.closest('.choice-select-widget-container');
                        if (widgetBox) {
                            widgetBox.querySelectorAll('.choice-opt-btn').forEach(b => {
                                const isTarget = b === btn;
                                if (isTarget) b.classList.add('selected');
                                else b.classList.remove('selected');
                                b.style.borderColor = isTarget ? '#38bdf8' : 'var(--color-border)';
                                b.style.background = isTarget ? 'rgba(56, 189, 248, 0.12)' : 'var(--color-surface-1)';
                                const badge = b.querySelector('span[style*="border-radius: 12px"]');
                                if (badge) {
                                    badge.textContent = isTarget ? '✓ 채택됨 🎯' : '선택하기';
                                    badge.style.color = isTarget ? '#38bdf8' : 'var(--color-text-tertiary)';
                                    badge.style.borderColor = isTarget ? '#38bdf8' : 'transparent';
                                }
                            });
                        }
                    });
                });
            }
        });

        // 7) 일시 정지 및 계속 진행 게이트 위젯 (반려 없이 사용자가 확인 후 계속 진행)
        this.register('continue_gate', {
            render: (w, contentData, fileId) => {
                const isContinued = !!contentData.isContinued;
                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 8px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 8px; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span class="continue-gate-status-label" style="font-size: 11px; font-weight: bold; color: ${isContinued ? '#2ecc71' : '#38bdf8'};">
                                ${isContinued ? '✅ 진행 완료' : '⏸️ 진행 대기 중'}
                            </span>
                            <span style="font-size: 10px; color: var(--color-text-tertiary);">흐름 제어</span>
                        </div>
                        <div>
                            <button type="button" class="btn btn-primary btn-xs continue-gate-btn" style="width: 100%; padding: 8px; font-weight: bold; font-size: 12px; background: ${isContinued ? '#27ae60' : 'linear-gradient(135deg, #0284c7, #0ea5e9)'}; border: none; border-radius: 6px;">
                                ${isContinued ? '✅ 다음 단계로 전달됨' : '▶️ 확인 및 계속 진행'}
                            </button>
                        </div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate, fileId) => {
                const continueBtn = container.querySelector('.continue-gate-btn');
                if (continueBtn) {
                    continueBtn.addEventListener('click', async () => {
                        const isWaitingInEngine = window.nodeEngine?.currentSession?.waitingResolvers?.has(String(fileId));
                        if (!window.nodeEngine?.isRunning || !isWaitingInEngine) {
                            window.showToast?.('⚠️ 노드 그래프 실행 중 진행 대기(주황색) 상태일 때만 동작합니다.', 'warning');
                            return;
                        }

                        contentData.isContinued = true;
                        onUpdate(contentData);

                        if (fileId && window.nodeEngine) {
                            window.nodeEngine.resumeWaitingNode(fileId);
                            window.showToast?.('확인 완료! 다음 노드로 진행합니다... 🚀', 'success');
                        }
                    });
                }
            }
        });

        // 8) 스위치 토글 위젯 (특정 옵션/입력값을 켜고 끄는 토글 스위치)
        this.register('toggle_switch', {
            render: (w, contentData, fileId) => {
                const key = w.key || 'isEnabled';
                const label = w.label || '옵션 활성화';
                const isChecked = contentData[key] !== undefined ? !!contentData[key] : (w.defaultVal !== undefined ? !!w.defaultVal : false);
                const onText = w.onText || 'ON';
                const offText = w.offText || 'OFF';
                const desc = w.desc || '';

                return `
                    <div class="widget-item" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 8px; gap: 10px;">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <label style="font-size: 11px; font-weight: bold; color: var(--color-text-primary); cursor: pointer;" for="toggle_${fileId}_${this.escapeHtml(key)}">
                                🔘 ${this.escapeHtml(label)}
                            </label>
                            ${desc ? `<span style="font-size: 10px; color: var(--color-text-tertiary);">${this.escapeHtml(desc)}</span>` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span class="toggle-status-text" style="font-size: 10px; font-weight: bold; color: ${isChecked ? 'var(--color-accent-success, #10b981)' : 'var(--color-text-tertiary)'};">
                                ${isChecked ? onText : offText}
                            </span>
                            <label class="switch" style="position: relative; display: inline-block; width: 36px; height: 20px; margin: 0;">
                                <input type="checkbox" id="toggle_${fileId}_${this.escapeHtml(key)}" class="widget-toggle-input" data-widget-key="${this.escapeHtml(key)}" ${isChecked ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                                <span class="slider round" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isChecked ? '#10b981' : '#4b5563'}; transition: 0.3s; border-radius: 20px;">
                                    <span class="slider-thumb" style="position: absolute; height: 14px; width: 14px; left: ${isChecked ? '19px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate) => {
                const key = w.key || 'isEnabled';
                const checkbox = container.querySelector(`.widget-toggle-input[data-widget-key="${key}"]`);
                const statusText = container.querySelector('.toggle-status-text');
                const slider = container.querySelector('.slider');
                const thumb = container.querySelector('.slider-thumb');

                if (checkbox) {
                    checkbox.addEventListener('change', () => {
                        const checked = checkbox.checked;
                        contentData[key] = checked;
                        if (statusText) {
                            statusText.textContent = checked ? (w.onText || 'ON') : (w.offText || 'OFF');
                            statusText.style.color = checked ? 'var(--color-accent-success, #10b981)' : 'var(--color-text-tertiary)';
                        }
                        if (slider) slider.style.backgroundColor = checked ? '#10b981' : '#4b5563';
                        if (thumb) thumb.style.left = checked ? '19px' : '3px';
                        onUpdate(contentData);
                    });
                }
            }
        });

        // 9) 동적 연결 노드별 개별 선택 목록 위젯 (연결된 각 노드의 데이터를 개별적으로 ON/OFF 선택)
        const filterHandler = {
            render: (w, contentData, fileId) => {
                const connections = window.nodeEngine?._getConnections() || window.windowManager?.nodeConnections || [];
                const incomingConns = connections.filter(c => String(c.toId) === String(fileId));
                const inputToggles = contentData.inputToggles || {};

                if (incomingConns.length === 0) {
                    return `
                        <div class="widget-item" style="display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--color-bg-primary); border: 1px dashed var(--color-border); border-radius: 8px; text-align: center;">
                            <div style="font-size: 11px; font-weight: bold; color: var(--color-text-secondary);">🔗 연결된 상위 노드 목록</div>
                            <div style="font-size: 11px; color: var(--color-text-tertiary);">
                                연결된 상위 노드가 없습니다.<br>다른 노드의 출력(Output) 핀을 이 노드의 입력(Input) 핀에 연결하면 각 노드별 선택 스위치가 여기에 자동으로 나타납니다!
                            </div>
                        </div>
                    `;
                }

                // 상위 노드별 토글 리스트 아이템 생성
                const itemsHtml = incomingConns.map((conn, idx) => {
                    const parentId = String(conn.fromId);
                    const parentFile = window.nodeEngine?._getFile(parentId);
                    const parentName = parentFile?.name || `노드 #${parentId.slice(-4)}`;
                    const isChecked = inputToggles[parentId] !== undefined ? !!inputToggles[parentId] : true;

                    return `
                        <div class="dynamic-input-toggle-row" data-parent-id="${this.escapeHtml(parentId)}" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 6px; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
                                <span style="font-size: 12px; flex-shrink: 0;">📌</span>
                                <span style="font-size: 11px; font-weight: 600; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(parentName)}">
                                    ${this.escapeHtml(parentName)}
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                <span class="row-status-text" style="font-size: 10px; font-weight: bold; color: ${isChecked ? '#10b981' : '#6b7280'};">
                                    ${isChecked ? '포함 ON' : '제외 OFF'}
                                </span>
                                <label class="switch" style="position: relative; display: inline-block; width: 34px; height: 18px; margin: 0;">
                                    <input type="checkbox" class="parent-node-toggle-input" data-parent-id="${this.escapeHtml(parentId)}" ${isChecked ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                                    <span class="slider round" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isChecked ? '#10b981' : '#4b5563'}; transition: 0.25s; border-radius: 18px;">
                                        <span class="slider-thumb" style="position: absolute; height: 12px; width: 12px; left: ${isChecked ? '18px' : '3px'}; bottom: 3px; background-color: white; transition: 0.25s; border-radius: 50%;"></span>
                                    </span>
                                </label>
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="widget-item" style="display: flex; flex-direction: column; gap: 8px; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 8px; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="font-size: 11px; font-weight: bold; color: var(--color-text-primary);">
                                🎛️ ${this.escapeHtml(w.label || '연결된 노드별 데이터 선택')}
                            </label>
                            <div style="display: flex; gap: 4px;">
                                <button type="button" class="btn btn-xs toggle-all-on-btn" style="font-size: 9px; padding: 2px 5px;">전체 선택</button>
                                <button type="button" class="btn btn-xs toggle-all-off-btn" style="font-size: 9px; padding: 2px 5px;">전체 해제</button>
                            </div>
                        </div>
                        <div class="dynamic-input-toggle-list" style="display: flex; flex-direction: column; gap: 5px; max-height: 180px; overflow-y: auto;">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
            },
            bindEvents: (container, w, contentData, onUpdate, fileId) => {
                if (!contentData.inputToggles) contentData.inputToggles = {};

                // 개별 토글 스위치 변경 이벤트
                container.querySelectorAll('.parent-node-toggle-input').forEach(chk => {
                    chk.addEventListener('change', () => {
                        const pId = chk.dataset.parentId;
                        const row = chk.closest('.dynamic-input-toggle-row');
                        const statusText = row?.querySelector('.row-status-text');
                        const slider = row?.querySelector('.slider');
                        const thumb = row?.querySelector('.slider-thumb');

                        contentData.inputToggles[pId] = chk.checked;

                        if (statusText) {
                            statusText.textContent = chk.checked ? '포함 ON' : '제외 OFF';
                            statusText.style.color = chk.checked ? '#10b981' : '#6b7280';
                        }
                        if (slider) slider.style.backgroundColor = chk.checked ? '#10b981' : '#4b5563';
                        if (thumb) thumb.style.left = chk.checked ? '18px' : '3px';

                        onUpdate(contentData);
                    });
                });

                // 전체 선택
                container.querySelector('.toggle-all-on-btn')?.addEventListener('click', () => {
                    container.querySelectorAll('.parent-node-toggle-input').forEach(chk => {
                        chk.checked = true;
                        const pId = chk.dataset.parentId;
                        contentData.inputToggles[pId] = true;
                        const row = chk.closest('.dynamic-input-toggle-row');
                        const statusText = row?.querySelector('.row-status-text');
                        const slider = row?.querySelector('.slider');
                        const thumb = row?.querySelector('.slider-thumb');
                        if (statusText) { statusText.textContent = '포함 ON'; statusText.style.color = '#10b981'; }
                        if (slider) slider.style.backgroundColor = '#10b981';
                        if (thumb) thumb.style.left = '18px';
                    });
                    onUpdate(contentData);
                });

                // 전체 해제
                container.querySelector('.toggle-all-off-btn')?.addEventListener('click', () => {
                    container.querySelectorAll('.parent-node-toggle-input').forEach(chk => {
                        chk.checked = false;
                        const pId = chk.dataset.parentId;
                        contentData.inputToggles[pId] = false;
                        const row = chk.closest('.dynamic-input-toggle-row');
                        const statusText = row?.querySelector('.row-status-text');
                        const slider = row?.querySelector('.slider');
                        const thumb = row?.querySelector('.slider-thumb');
                        if (statusText) { statusText.textContent = '제외 OFF'; statusText.style.color = '#6b7280'; }
                        if (slider) slider.style.backgroundColor = '#4b5563';
                        if (thumb) thumb.style.left = '3px';
                    });
                    onUpdate(contentData);
                });
            }
        };

        this.register('input_source_filter', filterHandler);
        this.register('dynamic_input_toggles', filterHandler);
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
    updateWidgetValueInPlace(container, widget, contentData, fileId) {
        if (!container || !widget || !contentData) return;

        if (widget.type === 'text_viewer') {
            const k = widget.key || widget.label || 'displayVal';
            const val = contentData[widget.key] !== undefined ? contentData[widget.key] :
                        (widget.label && contentData[widget.label] !== undefined ? contentData[widget.label] :
                        (contentData[k] !== undefined ? contentData[k] :
                        (contentData.output !== undefined ? contentData.output :
                        (contentData.displayVal !== undefined ? contentData.displayVal : '(결과 데이터 없음)'))));
            const displayStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
            const preEl = container.querySelector(`.widget-text-viewer-pre[data-widget-key="${k}"]`) ||
                          container.querySelector(`.widget-text-viewer-pre[data-widget-key="${widget.key}"]`) ||
                          container.querySelector('.widget-text-viewer-pre') ||
                          container.querySelector('pre');
            if (preEl && preEl.textContent !== displayStr) {
                preEl.textContent = displayStr;
            }
        } else if (widget.type === 'raw_data_viewer') {
            const k = widget.key || widget.label || 'rawVal';
            const val = contentData[widget.key] !== undefined ? contentData[widget.key] :
                        (widget.label && contentData[widget.label] !== undefined ? contentData[widget.label] :
                        (contentData[k] !== undefined ? contentData[k] :
                        (contentData.rawVal !== undefined ? contentData.rawVal :
                        (contentData.rawInputs !== undefined ? contentData.rawInputs :
                        (contentData.output !== undefined ? contentData.output : null)))));

            let typeName = 'null';
            let formattedJson = 'null';
            if (val !== null && val !== undefined) {
                if (Array.isArray(val)) {
                    typeName = `Array(${val.length})`;
                    formattedJson = JSON.stringify(val, null, 2);
                } else if (typeof val === 'object') {
                    typeName = `Object {${Object.keys(val).length}}`;
                    formattedJson = JSON.stringify(val, null, 2);
                } else {
                    typeName = typeof val;
                    formattedJson = String(val);
                }
            } else {
                formattedJson = '(입력된 원형 데이터 없음)';
            }

            const preEl = container.querySelector(`.widget-raw-data-pre[data-widget-key="${k}"]`) ||
                          container.querySelector(`.widget-raw-data-pre[data-widget-key="${widget.key}"]`) ||
                          container.querySelector('.widget-raw-data-pre');
            const badgeEl = container.querySelector('.raw-data-type-badge');

            if (badgeEl && badgeEl.textContent !== typeName) {
                badgeEl.textContent = typeName;
            }
            if (preEl && preEl.textContent !== formattedJson) {
                preEl.textContent = formattedJson;
            }
        } else if (widget.type === 'input_text') {
            const k = widget.key || widget.label || 'val';
            const val = contentData[widget.key] !== undefined ? contentData[widget.key] :
                        (widget.label && contentData[widget.label] !== undefined ? contentData[widget.label] :
                        (contentData[k] !== undefined ? contentData[k] :
                        (contentData.val !== undefined ? contentData.val : (widget.defaultVal || ''))));
            const inputEl = container.querySelector(`.widget-input-field[data-widget-key="${k}"]`) ||
                            container.querySelector(`.widget-input-field[data-widget-key="${widget.key}"]`) ||
                            container.querySelector(`.widget-input-field[data-widget-key="${widget.label}"]`) ||
                            container.querySelector('.widget-input-field');
            if (inputEl && document.activeElement !== inputEl && inputEl.value !== val) {
                inputEl.value = val;
            }
        } else if (widget.type === 'dropdown_select') {
            const k = widget.key || widget.label || 'selectVal';
            const val = contentData[widget.key] !== undefined ? contentData[widget.key] :
                        (widget.label && contentData[widget.label] !== undefined ? contentData[widget.label] :
                        (contentData[k] !== undefined ? contentData[k] :
                        (contentData.selectVal !== undefined ? contentData.selectVal : (widget.defaultVal || ''))));
            const selectEl = container.querySelector(`.widget-dropdown-select[data-widget-key="${k}"]`) ||
                             container.querySelector(`.widget-dropdown-select[data-widget-key="${widget.key}"]`) ||
                             container.querySelector(`.widget-dropdown-select[data-widget-key="${widget.label}"]`) ||
                             container.querySelector('.widget-dropdown-select');
            if (selectEl && String(selectEl.value) !== String(val)) {
                selectEl.value = val;
            }
        } else if (widget.type === 'editor_canvas') {
            const k = widget.key || widget.label || 'editorVal';
            const val = contentData[widget.key] !== undefined ? contentData[widget.key] :
                        (widget.label && contentData[widget.label] !== undefined ? contentData[widget.label] :
                        (contentData[k] !== undefined ? contentData[k] :
                        (contentData.editorVal !== undefined ? contentData.editorVal :
                        (contentData.content !== undefined ? contentData.content :
                        (contentData.text !== undefined ? contentData.text : (widget.defaultVal || ''))))));
            const textarea = container.querySelector(`.widget-editor-textarea[data-widget-key="${k}"]`) ||
                             container.querySelector(`.widget-editor-textarea[data-widget-key="${widget.key}"]`) ||
                             container.querySelector(`.widget-editor-textarea[data-widget-key="${widget.label}"]`) ||
                             container.querySelector('.widget-editor-textarea');
            if (textarea && document.activeElement !== textarea && textarea.value !== val) {
                textarea.value = val;
            }
        } else if (widget.type === 'image_canvas') {
            const k = widget.key || widget.label || 'image_val';
            const imgSrc = contentData[widget.key] || contentData[widget.label] || contentData[k] || contentData.image || widget.defaultSrc || '';
            const imgEl = container.querySelector('.widget-image-preview');
            if (imgEl && imgEl.getAttribute('src') !== imgSrc) {
                if (imgSrc) {
                    imgEl.src = imgSrc;
                }
            }
        } else if (widget.type === 'approval_gate') {
            const isApproved = !!contentData.isApproved;
            const statusLabel = container.querySelector('.approval-gate-status-label') || container.querySelector('.widget-item span[style*="font-weight: bold"]');
            const apprBtn = container.querySelector('.approve-gate-btn');
            if (statusLabel) {
                statusLabel.style.color = isApproved ? '#2ecc71' : '#f39c12';
                statusLabel.textContent = isApproved ? '✅ 검수 승인 완료' : '⏸️ 승인 대기 중';
            }
            if (apprBtn) {
                apprBtn.style.background = isApproved ? '#27ae60' : '#2ecc71';
                apprBtn.textContent = isApproved ? '✅ 승인 상태' : '✅ 승인 및 진행';
            }
        } else if (widget.type === 'continue_gate') {
            const isContinued = !!contentData.isContinued;
            const statusLabel = container.querySelector('.continue-gate-status-label');
            const continueBtn = container.querySelector('.continue-gate-btn');
            if (statusLabel) {
                statusLabel.style.color = isContinued ? '#2ecc71' : '#38bdf8';
                statusLabel.textContent = isContinued ? '✅ 진행 완료' : '⏸️ 진행 대기 중';
            }
            if (continueBtn) {
                continueBtn.style.background = isContinued ? '#27ae60' : 'linear-gradient(135deg, #0284c7, #0ea5e9)';
                continueBtn.textContent = isContinued ? '✅ 다음 단계로 전달됨' : '▶️ 확인 및 계속 진행';
            }
        } else if (widget.type === 'toggle_switch') {
            const k = widget.key || widget.label || 'isEnabled';
            const isChecked = contentData[widget.key] !== undefined ? !!contentData[widget.key] :
                             (widget.label && contentData[widget.label] !== undefined ? !!contentData[widget.label] :
                             (contentData[k] !== undefined ? !!contentData[k] :
                             (contentData.isEnabled !== undefined ? !!contentData.isEnabled : !!widget.defaultVal)));
            const checkbox = container.querySelector(`.widget-toggle-input[data-widget-key="${k}"]`) ||
                             container.querySelector(`.widget-toggle-input[data-widget-key="${widget.key}"]`) ||
                             container.querySelector(`.widget-toggle-input[data-widget-key="${widget.label}"]`) ||
                             container.querySelector('.widget-toggle-input');
            const statusText = container.querySelector('.toggle-status-text');
            const slider = container.querySelector('.slider');
            const thumb = container.querySelector('.slider-thumb');
            if (checkbox && checkbox.checked !== isChecked) {
                checkbox.checked = isChecked;
                if (statusText) {
                    statusText.textContent = isChecked ? (widget.onText || 'ON') : (widget.offText || 'OFF');
                    statusText.style.color = isChecked ? 'var(--color-accent-success, #10b981)' : 'var(--color-text-tertiary)';
                }
                if (slider) slider.style.backgroundColor = isChecked ? '#10b981' : '#4b5563';
                if (thumb) thumb.style.left = isChecked ? '19px' : '3px';
            }
        } else if (widget.type === 'input_source_filter' || widget.type === 'dynamic_input_toggles') {
            const handler = this.widgets.get(widget.type);
            if (handler && fileId) {
                const listWrapper = container.querySelector('.dynamic-input-toggle-list')?.closest('.widget-item') ||
                                    container.querySelector('.widget-item');
                if (listWrapper) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = handler.render(widget, contentData, fileId);
                    const newEl = tempDiv.firstElementChild;
                    if (newEl) {
                        listWrapper.replaceWith(newEl);
                        const onUpdate = (updatedContentData) => {
                            const info = window.windowManager?.getWindowInfo(fileId);
                            if (info && info.file) {
                                info.file.content = JSON.stringify(updatedContentData, null, 2);
                                window.storage?.updateFile(fileId, { content: info.file.content });
                            }
                        };
                        handler.bindEvents(container, widget, contentData, onUpdate, fileId);
                    }
                }
            }
        } else if (widget.type === 'choice_select') {
            const handler = this.widgets.get(widget.type);
            if (handler && fileId) {
                const choiceWrapper = container.querySelector('.choice-select-widget-container')?.closest('.widget-item') ||
                                      container.querySelector('.choice-select-widget-container');
                if (choiceWrapper) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = handler.render(widget, contentData, fileId);
                    const newEl = tempDiv.firstElementChild;
                    if (newEl) {
                        choiceWrapper.replaceWith(newEl);
                        const onUpdate = (updatedContentData) => {
                            const info = window.windowManager?.getWindowInfo(fileId);
                            if (info && info.file) {
                                info.file.content = JSON.stringify(updatedContentData, null, 2);
                                window.storage?.updateFile(fileId, { content: info.file.content });
                            }
                        };
                        handler.bindEvents(container, widget, contentData, onUpdate, fileId);
                    }
                }
            }
        }
    }

    _getFile(fileId) {
        return window.nodeEngine?._getFile?.(fileId) ||
               (Array.isArray(window.fileTreeManager?.files) ? window.fileTreeManager.files.find(f => String(f.id) === String(fileId)) : null);
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
