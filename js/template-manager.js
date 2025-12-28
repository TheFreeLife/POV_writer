/**
 * 템플릿 관리자 - 사용자 정의 집필 양식 관리
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
        // 모달 열기/닫기
        document.addEventListener('click', (e) => {
            if (e.target.id === 'manageTemplatesBtn') {
                this.showModal();
            }
        });

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

        // 직접 입력 시 버튼 업데이트
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
            // 문서 및 집필
            '📄', '📜', '📖', '📝', '🖋️', '✒️', '🎨', '🖌️', '✉️', '📔', '📔', '📓', '📒', '📕', '📗', '📘', '📙',
            // 게임 시스템 및 UI
            '🎮', '🕹️', '🎲', '🎯', '🃏', '🎰', '🧩', '👾', '👾', '🤖', '🔋', '💾', '💿', '💾', '⌨️', '🖱️', '📶', '📡',
            // 퀘스트 및 아이템 (RPG 특화)
            '🎒', '🗺️', '🧭', '🗝️', '🔑', '🔓', '🔒', '🔔', '📢', '🧧', '📜', '⚖️', '💰', '💎', '🪙', '🏺', '📦', '🎁', '🧸',
            // 무기 및 장비
            '🗡️', '⚔️', '🏹', '🔫', '💣', '🛡️', '🪖', '🧤', '👞', '🥋', '💍', '📿', '🦯', '🔨', '⛏️', '🪓', '⚒️', '🔧', '⚙️',
            // 마법 및 스킬 효과
            '🔮', '🧪', '🌡️', '🧬', '⚡', '✨', '🌟', '💥', '🌀', '❄️', '🔥', '💧', '🍃', '☀️', '🌙', '🌑', '🌕', '☣️', '☢️', '🧿',
            // 장소 및 배경 (마을, 던전, 탐험)
            '🏰', '⛪', '🏘️', '🏡', '🏠', '🏛️', '🛖', '⛩️', '🕋', '🎪', '🏰', '🗼', '🎡', '🏟️', '🏛️', '🏢', '🏭', '🏫', '🏨',
            '🏔️', '🌋', '🏜️', '🏝️', '🌊', '🌲', '🌳', '🌴', '🍂', '🌵', '🌻', '🌸', '🌅', '🌃', '🌆', '🚇', '⛺', '🗿',
            // 인물 및 몬스터
            '👤', '👥', '🫂', '🤴', '👸', '👮‍♂️', '🕵️‍♀️', '💂‍♂️', '🦸‍♂️', '🦹‍♂️', '🤵', '🤵‍♀️', '👰', '👼', '👶', '👴', '👵',
            '🐺', '🐗', '🦁', '🐯', '🐴', '🦄', '🦅', '🦉', '🦋', '🐍', '🐙', '🕷️', '🦂', '🐉', '🐲', '🧟‍♂️', '🧛‍♂️', '🧙‍♂️', '🧚‍♀️', '🧜‍♀️', '👺', '👹', '💀', '👻',
            // 소모품 및 음식
            '🍎', '🥩', '🍗', '🍞', '🍕', '🍺', '🍶', '🍼', '💊', '💉', '🍷'
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
                <span style="font-size: 20px;">${tpl.icon}</span>
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
        this.selectIcon('📄'); // 초기 아이콘 설정
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
        this.selectIcon(tpl.icon); // 아이콘 버튼과 히든 인풋 업데이트
        document.getElementById('tplContent').value = tpl.content;
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
                // 기존 수정
                await window.storage?.updateTemplate(this.selectedTemplateId, { name, icon, content });
            } else {
                // 새 생성
                await window.storage?.createTemplate({ name, icon, content });
            }

            window.showToast?.('템플릿이 저장되었습니다.');
            await this.loadTemplates();
        } catch (error) {
            console.error('템플릿 저장 실패:', error);
        }
    }

    async deleteTemplate() {
        if (!this.selectedTemplateId) return;
        if (!confirm('이 템플릿을 정말 삭제할까요?')) return;

        try {
            await window.storage?.deleteTemplate(this.selectedTemplateId);
            window.showToast?.('템플릿이 삭제되었습니다.');
            await this.loadTemplates();
        } catch (error) {
            console.error('템플릿 삭제 실패:', error);
        }
    }
}

window.templateManager = new TemplateManager();
