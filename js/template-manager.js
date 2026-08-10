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
        // 노드 템플릿 추가 버튼 (사이드바 + 노드 추가 버튼 바로 아래)
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

    getDefaultNodeTemplates() {
        return [
            {
                id: 'preset_default_character',
                name: '주인공 캐릭터 카드',
                icon: '👤',
                desc: '이름, 소속, 성격, 배경 등 입력값이 미리 채워진 캐릭터 속성 노드',
                template: 'text_fields',
                isTextFieldsNode: true,
                isDefault: true,
                content: JSON.stringify({
                    isTextFieldsNode: true,
                    textFields: [
                        { id: 'f_1', name: '이름', value: '강현우' },
                        { id: 'f_2', name: '소속', value: '중앙 아카데미 3학년' },
                        { id: 'f_3', name: '성격', value: '평소엔 침착하지만 동료를 위해 물불 가리지 않음' },
                        { id: 'f_4', name: '특이사항', value: '10년 전 전생의 기억을 온전히 가지고 회귀함' }
                    ],
                    outputTemplate: `📌 《 {$이름$} 》\n• 소속: {$소속$}\n• 성격: {$성격$}\n• 특이사항: {$특이사항$}`
                }, null, 2),
                portsConfig: { inputs: [], outputs: [{ id: 'out_1', name: '캐릭터 정보', color: '#00ffcc' }] }
            },
            {
                id: 'preset_default_item',
                name: '전설의 무기 정보',
                icon: '⚔️',
                desc: '아이템명, 등급, 고유 효과 등 입력값이 미리 채워진 장비 노드',
                template: 'text_fields',
                isTextFieldsNode: true,
                isDefault: true,
                content: JSON.stringify({
                    isTextFieldsNode: true,
                    textFields: [
                        { id: 'f_1', name: '아이템명', value: '멸망의 성검' },
                        { id: 'f_2', name: '등급', value: '🌟 신화 등급' },
                        { id: 'f_3', name: '고유 효과', value: '모든 언데드/마족 속성 공격 시 300% 추가 치명타 피해' },
                        { id: 'f_4', name: '배경 설화', value: '태초의 구원자가 신의 보혈을 적셔 탄생시킨 성검' }
                    ],
                    outputTemplate: `⚔️ 《 {$아이템명$} 》\n• 등급: {$등급$}\n• 효과: {$고유 효과$}\n• 설화: {$배경 설화$}`
                }, null, 2),
                portsConfig: { inputs: [], outputs: [{ id: 'out_1', name: '아이템 정보', color: '#00ffcc' }] }
            },
            {
                id: 'preset_default_chapter',
                name: '에피소드 개요 템플릿',
                icon: '📜',
                desc: '도입부, 주요 사건, 클라이맥스 전개 입력란이 채워진 노드',
                template: 'text_fields',
                isTextFieldsNode: true,
                isDefault: true,
                content: JSON.stringify({
                    isTextFieldsNode: true,
                    textFields: [
                        { id: 'f_1', name: '에피소드 제목', value: '회귀자의 첫 수업' },
                        { id: 'f_2', name: '도입부', value: '아카데미 입학식 아침으로의 회귀' },
                        { id: 'f_3', name: '주요 사건', value: '전생 라이벌과의 마력 실기 테스트 대결' },
                        { id: 'f_4', name: '클라이맥스', value: '숨겨두었던 가문 전승 마력 기법 개방' }
                    ],
                    outputTemplate: `📜 《 1화: {$에피소드 제목$} 》\n1. 도입: {$도입부$}\n2. 사건: {$주요 사건$}\n3. 클라이맥스: {$클라이맥스$}`
                }, null, 2),
                portsConfig: { inputs: [], outputs: [{ id: 'out_1', name: '에피소드 개요', color: '#00ffcc' }] }
            },
            {
                id: 'preset_default_sysprompt',
                name: '웹소설 AI 집필 프롬프트',
                icon: '🤖',
                desc: '웹소설 에피소드 집필 전용 AI 시스템 프롬프트 노드',
                template: 'system_prompt',
                isSystemPromptNode: true,
                isDefault: true,
                content: JSON.stringify({
                    command: '웹소설 에피소드 집필',
                    text: '당신은 한국 모던 웹소설 스타일 전문 작가입니다. 긴장감 있고 속도감 있는 전개, 생생한 인물 대사로 시나리오를 확장하여 집필하세요.'
                }, null, 2),
                portsConfig: { inputs: [{ id: 'in_1', name: '입력 프롬프트' }], outputs: [{ id: 'out_1', name: '생성 텍스트', color: '#00ffcc' }] }
            }
        ];
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
        const defaultTemplates = this.getDefaultNodeTemplates();

        const templates = [...userTemplates, ...defaultTemplates];

        templates.forEach(tpl => {
            const card = document.createElement('div');
            card.className = 'node-type-card';
            card.style.position = 'relative';

            let typeBadge = '입력 보존';
            if (tpl.isTextFieldsNode || tpl.template === 'text_fields') typeBadge = '속성 보존';
            else if (tpl.isStatNode || tpl.template === 'stat') typeBadge = '수치 보존';
            else if (tpl.isSystemPromptNode || tpl.template === 'system_prompt') typeBadge = 'AI 프롬프트';

            card.innerHTML = `
                <div class="node-type-icon">${tpl.icon || '📄'}</div>
                <div class="node-type-info" style="flex: 1; padding-right: 40px;">
                    <div class="node-type-title" style="display: flex; align-items: center; justify-content: space-between;">
                        <span>${this.escapeHtml(tpl.name)}</span>
                        <span style="font-size: 10px; color: #f1e05a; background: rgba(241, 224, 90, 0.1); padding: 2px 6px; border-radius: 8px;">⭐ ${typeBadge}</span>
                    </div>
                    <div class="node-type-desc">${this.escapeHtml(tpl.desc || '입력 칸이 채워진 노드 템플릿')}</div>
                </div>
                ${!tpl.isDefault ? `
                <div class="preset-card-actions" style="position: absolute; top: 6px; right: 6px;">
                    <button class="delete-template-btn" title="템플릿 삭제" style="background: transparent; border: none; color: var(--color-text-tertiary); cursor: pointer; font-size: 14px; padding: 2px 5px;">✕</button>
                </div>
                ` : ''}
            `;

            if (!tpl.isDefault) {
                card.querySelector('.delete-template-btn')?.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`'${tpl.name}' 노드 템플릿을 삭제할까요?`)) {
                        await window.storage?.deleteTemplate(tpl.id);
                        await this.renderNodeTemplatesInSelectModal();
                        window.showToast?.('템플릿이 삭제되었습니다.');
                    }
                });
            }

            card.addEventListener('click', async () => {
                this.hideTemplateSelectModal();
                await this.spawnNodeFromTemplate(tpl);
            });

            container.appendChild(card);
        });
    }

    async spawnNodeFromTemplate(tpl) {
        let content = tpl.content || '';
        const fileData = {
            name: `${tpl.icon || '📄'} ${tpl.name}`,
            type: 'file',
            template: tpl.template || 'file',
            isTextFieldsNode: !!tpl.isTextFieldsNode,
            isFolderCollectorNode: !!tpl.isFolderCollectorNode,
            isStatNode: !!tpl.isStatNode,
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
        this.templates = await window.storage?.getAllTemplates() || [];
        this.renderTemplateList();
        this.resetEditor();
    }

    renderTemplateList() {
        const list = document.getElementById('templateManagerList');
        if (!list) return;

        list.innerHTML = '';
        this.templates.forEach(tpl => {
            const item = document.createElement('div');
            item.className = `template-item ${this.selectedTemplateId === tpl.id ? 'active' : ''}`;
            item.style.cssText = `
                padding: 12px;
                border: 1px solid var(--color-border);
                border-radius: 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 12px;
                background: ${this.selectedTemplateId === tpl.id ? 'var(--color-bg-tertiary)' : 'var(--color-bg-primary)'};
                border-color: ${this.selectedTemplateId === tpl.id ? 'var(--color-accent-primary)' : 'var(--color-border)'};
                transition: all 0.2s;
            `;
            item.innerHTML = `
                <span style="font-size: 20px;">${tpl.icon || '📄'}</span>
                <span style="font-weight: 600; font-size: 14px; color: var(--color-text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${tpl.name}</span>
            `;
            item.onclick = () => this.selectTemplate(tpl);
            list.appendChild(item);
        });
    }

    prepareNewTemplate() {
        this.selectedTemplateId = null;
        this.renderTemplateList();

        document.getElementById('templateEmptyState').classList.add('hidden');
        document.getElementById('templateEditorArea').classList.remove('hidden');

        document.getElementById('tplName').value = '';
        this.selectIcon('📄');
        document.getElementById('tplContent').value = '';
        document.getElementById('deleteTemplateBtn').style.display = 'none';
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
        document.getElementById('deleteTemplateBtn').style.display = 'block';
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
        if (!confirm('이 노드 템플릿을 삭제할까요?')) return;

        try {
            await window.storage?.deleteTemplate(this.selectedTemplateId);
            window.showToast?.('템플릿이 삭제되었습니다.');
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
