/**
 * 템플릿 관리자 - 입력 내용 보존 노드 템플릿 관리
 */
class TemplateManager {
    constructor() {
        this.templates = [];
        this.selectedTemplateId = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 노드 템플릿 추가 버튼 (사이드바)
        document.addEventListener('click', (e) => {
            if (e.target.closest('#newNodeTemplateBtn')) {
                this.showTemplateSelectModal();
            } else if (e.target.id === 'manageTemplatesBtn') {
                this.showModal();
            }
        });

        // 템플릿 선택 모달 닫기 및 관리 모달 연동
        document.getElementById('closeNodeTemplateSelectModal')?.addEventListener('click', () => this.hideTemplateSelectModal());
        document.getElementById('cancelNodeTemplateSelectBtn')?.addEventListener('click', () => this.hideTemplateSelectModal());
        document.getElementById('manageTemplatesFromSelectBtn')?.addEventListener('click', () => {
            this.hideTemplateSelectModal();
            this.showModal();
        });

        // 템플릿 관리 모달 열기/닫기
        document.getElementById('closeTemplateModal')?.addEventListener('click', () => this.hideModal());
        document.getElementById('cancelTplBtn')?.addEventListener('click', () => this.hideModal());

        // 추가/저장/삭제
        document.getElementById('addNewTemplateBtn')?.addEventListener('click', () => this.prepareNewTemplate());
        document.getElementById('saveTemplateBtn')?.addEventListener('click', () => this.saveTemplate());
        document.getElementById('deleteTemplateBtn')?.addEventListener('click', () => this.deleteTemplate());

        // 아이콘 피커 연동
        document.getElementById('tplIconBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleIconPicker();
        });

        document.getElementById('tplIcon')?.addEventListener('input', (e) => {
            const btn = document.getElementById('tplIconBtn');
            if (btn) btn.textContent = e.target.value.trim() || '📄';
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.icon-picker-container')) {
                this.hideIconPicker();
            }
        });

        this.initIconPicker();
    }

    initIconPicker() {
        const popover = document.getElementById('iconPickerPopover');
        if (!popover) return;

        const emojis = [
            '📄', '📜', '📖', '📝', '🖋️', '✒️', '🎨', '🖌️', '✉️', '📔', '📓', '📒', '📕', '📗', '📘', '📙',
            '🎮', '🕹️', '🎲', '🎯', '🃏', '🎰', '🧩', '👾', '🤖', '🔋', '💾', '💿', '⌨️', '🖱️',
            '🎒', '🗺️', '🧭', '🗝️', '🔑', '🔓', '🔒', '🔔', '📢', '📜', '⚖️', '💰', '💎', '🪙', '🏺', '📦', '🎁',
            '🗡️', '⚔️', '🏹', '🔫', '💣', '🛡️', '🪖', '🧤', '👞', '🥋', '💍', '📿', '🔨', '⛏️', '🪓', '⚒️', '🔧', '⚙️',
            '🔮', '🧪', '🌡️', '🧬', '⚡', '✨', '🌟', '💥', '🌀', '❄️', '🔥', '💧', '🍃', '☀️', '🌙', '🌑', '🌕',
            '🏰', '⛪', '🏘️', '🏡', '🏠', '🏛️', '🛖', '⛩️', '🎪', '🗼', '🎡', '🏟️', '🏢', '🏭', '🏫', '🏨',
            '🏔️', '🌋', '🏜️', '🏝️', '🌊', '🌲', '🌳', '🌴', '🍂', '🌵', '🌻', '🌸', '🌅', '🌃', '🌆', '🚇', '⛺',
            '👤', '👥', '🫂', '🤴', '👸', '👮‍♂️', '🕵️‍♀️', '💂‍♂️', '🦸‍♂️', '🦹‍♂️', '🤵', '👰', '👼', '👶', '👴', '👵',
            '🐺', '🦁', '🐯', '🐴', '🦅', '🦉', '🦋', '🐍', '🐉', '🐲', '🧟‍♂️', '🧛‍♂️', '🧙‍♂️', '🧚‍♀️', '💀', '👻'
        ];

        popover.innerHTML = '';
        emojis.forEach(emoji => {
            const item = document.createElement('div');
            item.className = 'icon-item';
            item.textContent = emoji;
            item.onclick = () => this.selectIcon(emoji);
            popover.appendChild(item);
        });
    }

    toggleIconPicker() {
        document.getElementById('iconPickerPopover')?.classList.toggle('hidden');
    }

    hideIconPicker() {
        document.getElementById('iconPickerPopover')?.classList.add('hidden');
    }

    selectIcon(emoji) {
        document.getElementById('tplIcon').value = emoji;
        document.getElementById('tplIconBtn').textContent = emoji;
        this.hideIconPicker();
    }

    async getDefaultNodeTemplates() {
        if (this._cachedDefaultNodes) return this._cachedDefaultNodes;
        try {
            const res = await fetch('data/default-nodes.json');
            if (res.ok) {
                this._cachedDefaultNodes = await res.json();
                return this._cachedDefaultNodes;
            }
        } catch (e) {
            console.warn('data/default-nodes.json 로드 실패:', e);
        }
        return [];
    }


    showTemplateSelectModal() {
        const modal = document.getElementById('nodeTemplateSelectModal');
        if (modal) {
            modal.classList.remove('hidden');
            this.renderNodeTemplatesInSelectModal();
        }
    }

    hideTemplateSelectModal() {
        document.getElementById('nodeTemplateSelectModal')?.classList.add('hidden');
    }

    async renderNodeTemplatesInSelectModal() {
        const container = document.getElementById('modalNodeTemplatesContainer');
        if (!container) return;

        container.innerHTML = '';
        const userTemplates = await window.storage?.getAllTemplates() || [];
        const defaultTemplates = await this.getDefaultNodeTemplates();

        // 1. 메인 래퍼 생성
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 20px; width: 100%;';

        // 2. 기본 템플릿 섹션 (상단 배치)
        const defaultSection = document.createElement('div');
        defaultSection.innerHTML = `
            <div style="font-size: 13px; font-weight: 700; color: var(--color-text-secondary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span>📌 시스템 기본 템플릿</span>
                <span style="font-size: 11px; font-weight: 400; color: var(--color-text-tertiary);">(기본 제공 / 삭제 불가)</span>
            </div>
        `;
        const defaultGrid = document.createElement('div');
        defaultGrid.className = 'node-type-grid';

        defaultTemplates.forEach(tpl => {
            const card = this.createTemplateCard(tpl, true);
            defaultGrid.appendChild(card);
        });
        defaultSection.appendChild(defaultGrid);
        wrapper.appendChild(defaultSection);

        // 3. 커스텀 템플릿 섹션 (하단 배치)
        const customSection = document.createElement('div');
        customSection.innerHTML = `
            <div style="font-size: 13px; font-weight: 700; color: #f1e05a; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span>⭐️ 내가 만든 커스텀 템플릿</span>
                <span style="font-size: 11px; font-weight: 400; color: var(--color-text-tertiary);">(노드 ⭐ 버튼으로 저장됨 / 삭제 가능)</span>
            </div>
        `;
        const customGrid = document.createElement('div');
        customGrid.className = 'node-type-grid';

        if (userTemplates.length === 0) {
            customGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--color-text-tertiary); background: var(--color-bg-secondary); border-radius: 12px; border: 1px dashed var(--color-border); font-size: 13px;">
                    아직 저장한 커스텀 템플릿이 없습니다.<br>노드 창 상단 헤더의 <strong style="color: #f1e05a;">⭐</strong> 버튼을 누르면 입력값이 채워진 상태로 저장됩니다!
                </div>
            `;
        } else {
            userTemplates.forEach(tpl => {
                const card = this.createTemplateCard(tpl, false);
                customGrid.appendChild(card);
            });
        }
        customSection.appendChild(customGrid);
        wrapper.appendChild(customSection);

        container.appendChild(wrapper);
    }

    createTemplateCard(tpl, isDefault) {
        const card = document.createElement('div');
        card.className = 'node-type-card';
        card.style.position = 'relative';

        let typeBadge = '입력 보존';
        if (tpl.isTextFieldsNode || tpl.template === 'text_fields') typeBadge = '속성 보존';
        else if (tpl.isSystemPromptNode || tpl.template === 'system_prompt') typeBadge = 'AI 프롬프트';

        const badgeColor = isDefault ? 'var(--color-accent-primary)' : '#f1e05a';
        const badgeBg = isDefault ? 'var(--color-bg-secondary)' : 'rgba(241, 224, 90, 0.12)';

        card.innerHTML = `
            <div class="node-type-icon">${tpl.icon || '📄'}</div>
            <div class="node-type-info" style="flex: 1; padding-right: ${!isDefault ? '40px' : '0px'};">
                <div class="node-type-title" style="display: flex; align-items: center; justify-content: space-between;">
                    <span>${this.escapeHtml(tpl.name)}</span>
                    <span style="font-size: 10px; color: ${badgeColor}; background: ${badgeBg}; padding: 2px 6px; border-radius: 8px;">${isDefault ? '📌' : '⭐'} ${typeBadge}</span>
                </div>
                <div class="node-type-desc">${this.escapeHtml(tpl.desc || '입력 칸이 채워진 노드 템플릿')}</div>
            </div>
            ${!isDefault ? `
            <div class="preset-card-actions" style="position: absolute; top: 6px; right: 6px;">
                <button class="delete-template-btn" title="커스텀 템플릿 삭제" style="background: transparent; border: none; color: var(--color-text-tertiary); cursor: pointer; font-size: 14px; padding: 4px 6px; border-radius: 4px; transition: color 0.15s ease;">✕</button>
            </div>
            ` : ''}
        `;

        if (!isDefault) {
            const delBtn = card.querySelector('.delete-template-btn');
            delBtn?.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`'${tpl.name}' 커스텀 노드 템플릿을 목록에서 완전히 삭제할까요?`)) {
                    await window.storage?.deleteTemplate(tpl.id);
                    await this.renderNodeTemplatesInSelectModal();
                    window.showToast?.('커스텀 템플릿이 삭제되었습니다.');
                }
            });
        }

        card.addEventListener('click', async () => {
            this.hideTemplateSelectModal();
            await this.spawnNodeFromTemplate(tpl);
        });

        return card;
    }

    async spawnNodeFromTemplate(tpl) {
        let content = tpl.content || '';
        const fileData = {
            name: `${tpl.icon || '📄'} ${tpl.name}`,
            type: 'file',
            template: tpl.template || 'file',
            isTextFieldsNode: !!tpl.isTextFieldsNode,
            isSystemPromptNode: !!tpl.isSystemPromptNode,
            isAiMetaNode: !!tpl.isAiMetaNode,
            description: tpl.desc || '템플릿에서 생성된 노드',
            content: typeof content === 'object' ? JSON.stringify(content, null, 2) : content,
            portsConfig: tpl.portsConfig || null
        };

        await window.fileTreeManager?.createNewCustomNode(fileData);
        window.showToast?.(`'${tpl.name}' 템플릿 노드가 생성되었습니다! ⭐`);
    }

    async showModal() {
        const modal = document.getElementById('templateModal');
        if (modal) {
            modal.classList.remove('hidden');
            await this.loadTemplates();
        }
    }

    hideModal() {
        document.getElementById('templateModal')?.classList.add('hidden');
    }

    async loadTemplates() {
        const userTemplates = await window.storage?.getAllTemplates() || [];
        const defaultTemplates = await this.getDefaultNodeTemplates();
        this.templates = [
            ...userTemplates.map(t => ({ ...t, isDefault: false })),
            ...defaultTemplates.map(t => ({ ...t, isDefault: true }))
        ];
        this.renderTemplateList();
        this.resetEditor();
    }

    renderTemplateList() {
        const list = document.getElementById('templateManagerList');
        if (!list) return;

        list.innerHTML = '';
        
        const customTpls = this.templates.filter(t => !t.isDefault);
        const defaultTpls = this.templates.filter(t => t.isDefault);

        const createGroup = (title, items, isCustom) => {
            const groupHeader = document.createElement('div');
            groupHeader.style.cssText = `font-size: 11px; font-weight: 700; color: ${isCustom ? '#f1e05a' : 'var(--color-text-tertiary)'}; margin: 8px 0 4px 0;`;
            groupHeader.textContent = title;
            list.appendChild(groupHeader);

            if (items.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.cssText = 'font-size: 11px; color: var(--color-text-tertiary); padding: 6px 8px;';
                emptyMsg.textContent = '저장된 항목 없음';
                list.appendChild(emptyMsg);
                return;
            }

            items.forEach(tpl => {
                const item = document.createElement('div');
                item.className = `template-item ${this.selectedTemplateId === tpl.id ? 'active' : ''}`;
                item.style.cssText = `
                    padding: 10px 12px;
                    border: 1px solid var(--color-border);
                    border-radius: 10px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    background: ${this.selectedTemplateId === tpl.id ? 'var(--color-bg-tertiary)' : 'var(--color-bg-primary)'};
                    border-color: ${this.selectedTemplateId === tpl.id ? 'var(--color-accent-primary)' : 'var(--color-border)'};
                    transition: all 0.2s;
                `;
                item.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                        <span style="font-size: 18px;">${tpl.icon || '📄'}</span>
                        <span style="font-weight: 600; font-size: 13px; color: var(--color-text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${tpl.name}</span>
                    </div>
                    <span style="font-size: 10px; color: var(--color-text-tertiary); background: var(--color-bg-secondary); padding: 2px 5px; border-radius: 6px; flex-shrink: 0;">${isCustom ? '커스텀' : '기본'}</span>
                `;
                item.onclick = () => this.selectTemplate(tpl);
                list.appendChild(item);
            });
        };

        createGroup('📌 기본 템플릿 (기본 제공)', defaultTpls, false);
        createGroup('⭐️ 커스텀 템플릿 (삭제 가능)', customTpls, true);
    }

    prepareNewTemplate() {
        this.selectedTemplateId = null;
        this.renderTemplateList();

        document.getElementById('templateEmptyState').classList.add('hidden');
        document.getElementById('templateEditorArea').classList.remove('hidden');

        document.getElementById('tplName').value = '';
        this.selectIcon('📄');
        document.getElementById('tplContent').value = '';
        
        const delBtn = document.getElementById('deleteTemplateBtn');
        if (delBtn) delBtn.style.display = 'none';
        document.getElementById('tplName').focus();
    }

    selectTemplate(tpl) {
        this.selectedTemplateId = tpl.id;
        this.renderTemplateList();

        document.getElementById('templateEmptyState').classList.add('hidden');
        document.getElementById('templateEditorArea').classList.remove('hidden');

        document.getElementById('tplName').value = tpl.name;
        this.selectIcon(tpl.icon || '📄');
        document.getElementById('tplContent').value = typeof tpl.content === 'object' ? JSON.stringify(tpl.content, null, 2) : (tpl.content || '');
        
        const delBtn = document.getElementById('deleteTemplateBtn');
        if (delBtn) {
            delBtn.style.display = tpl.isDefault ? 'none' : 'block';
        }
    }

    resetEditor() {
        this.selectedTemplateId = null;
        document.getElementById('templateEmptyState').classList.remove('hidden');
        document.getElementById('templateEditorArea').classList.add('hidden');
    }

    async saveTemplate() {
        const name = document.getElementById('tplName').value.trim();
        const icon = document.getElementById('tplIcon').value.trim() || '📄';
        const content = document.getElementById('tplContent').value;

        if (!name) return alert('템플릿 이름을 입력해주세요.');

        try {
            if (this.selectedTemplateId) {
                const found = this.templates.find(t => t.id === this.selectedTemplateId);
                if (found && found.isDefault) {
                    return alert('시스템 기본 템플릿은 수정할 수 없습니다. 새 템플릿으로 저장해주세요.');
                }
                await window.storage?.updateTemplate(this.selectedTemplateId, { name, icon, content });
            } else {
                await window.storage?.createTemplate({ name, icon, content });
            }

            window.showToast?.('노드 템플릿이 저장되었습니다.');
            await this.loadTemplates();
        } catch (error) {
            console.error('템플릿 저장 실패:', error);
        }
    }

    async deleteTemplate() {
        if (!this.selectedTemplateId) return;
        const found = this.templates.find(t => t.id === this.selectedTemplateId);
        if (found && found.isDefault) {
            return alert('시스템 기본 템플릿은 삭제할 수 없습니다.');
        }

        if (!confirm('이 커스텀 노드 템플릿을 삭제할까요?')) return;

        try {
            await window.storage?.deleteTemplate(this.selectedTemplateId);
            window.showToast?.('커스텀 템플릿이 삭제되었습니다.');
            await this.loadTemplates();
        } catch (error) {
            console.error('템플릿 삭제 실패:', error);
        }
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

window.templateManager = new TemplateManager();
