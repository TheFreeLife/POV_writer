/**
 * 회차 관리자 (EpisodeManager)
 * 상단 바의 회차 조절 UI를 제어하고 회차 변경 이력(타임라인)을 기록 및 관리합니다.
 */
class EpisodeManager {
    constructor() {
        this.currentProjectId = null;
        this.currentEpisode = 1;
        this.history = [];
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        this.wrapper = document.getElementById('episodeControlWrapper');
        this.prevBtn = document.getElementById('episodePrevBtn');
        this.nextBtn = document.getElementById('episodeNextBtn');
        this.input = document.getElementById('currentEpisodeInput');
        this.historyBtn = document.getElementById('episodeHistoryBtn');
        this.modal = document.getElementById('episodeHistoryModal');
        this.closeModalBtn = document.getElementById('closeEpisodeHistoryModalBtn');
        this.closeModalBtn2 = document.getElementById('closeEpisodeHistoryModalBtn2');
        this.clearHistoryBtn = document.getElementById('clearEpisodeHistoryBtn');
        this.timelineList = document.getElementById('episodeTimelineList');
        this.modalCurrentText = document.getElementById('modalCurrentEpisodeText');
        this.modalTotalCount = document.getElementById('modalTotalEpisodeCount');

        this.bindEvents();
    }

    bindEvents() {
        if (this.prevBtn) {
            this.prevBtn.addEventListener('click', () => {
                const target = Math.max(1, (this.currentEpisode || 1) - 1);
                if (target !== this.currentEpisode) {
                    this.changeEpisode(target, '이전 회차(◀)로 전환');
                }
            });
        }

        if (this.nextBtn) {
            this.nextBtn.addEventListener('click', () => {
                const target = (this.currentEpisode || 1) + 1;
                this.changeEpisode(target, '다음 회차(▶)로 전환');
            });
        }

        if (this.input) {
            this.input.addEventListener('change', () => {
                let val = parseInt(this.input.value, 10);
                if (isNaN(val) || val < 1) val = 1;
                if (val !== this.currentEpisode) {
                    this.changeEpisode(val, '직접 번호 입력');
                } else {
                    this.input.value = this.currentEpisode;
                }
            });

            this.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.input.blur();
                }
            });
        }

        if (this.historyBtn) {
            this.historyBtn.addEventListener('click', () => this.showHistoryModal());
        }

        if (this.closeModalBtn) {
            this.closeModalBtn.addEventListener('click', () => this.hideHistoryModal());
        }

        if (this.closeModalBtn2) {
            this.closeModalBtn2.addEventListener('click', () => this.hideHistoryModal());
        }

        if (this.clearHistoryBtn) {
            this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        }
    }

    /**
     * 프로젝트 전환 시 회차 데이터 로드
     */
    async loadProjectEpisode(projectId) {
        this.currentProjectId = projectId;
        if (!projectId || !window.storage) return;

        try {
            const project = await storage.getProject(projectId);
            if (!project) return;

            this.currentEpisode = project.currentEpisode || 1;
            this.history = Array.isArray(project.episodeHistory) ? project.episodeHistory : [];

            // 이력이 비어있으면 초기 1회차 기록 생성
            if (this.history.length === 0) {
                this.history = [{
                    id: 'ep_' + Date.now(),
                    episode: this.currentEpisode,
                    prevEpisode: null,
                    timestamp: project.createdAt || Date.now(),
                    note: '프로젝트 생성 시점'
                }];
                await storage.updateProject(projectId, {
                    currentEpisode: this.currentEpisode,
                    episodeHistory: this.history
                });
            }

            this.updateHeaderUI();
        } catch (err) {
            console.error('[EpisodeManager] 회차 데이터 로드 실패:', err);
        }
    }

    updateHeaderUI() {
        if (this.input) {
            this.input.value = this.currentEpisode || 1;
        }
    }

    /**
     * 회차 변경 및 이력 저장
     */
    async changeEpisode(newEpisode, note = '') {
        const projectId = this.currentProjectId || window.currentProjectId;
        if (!projectId) return;

        newEpisode = parseInt(newEpisode, 10);
        if (isNaN(newEpisode) || newEpisode < 1) newEpisode = 1;

        const prevEpisode = this.currentEpisode || 1;
        if (newEpisode === prevEpisode) {
            this.updateHeaderUI();
            return;
        }

        const newRecord = {
            id: 'ep_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            episode: newEpisode,
            prevEpisode: prevEpisode,
            timestamp: Date.now(),
            note: note || `제 ${newEpisode}화로 변경`
        };

        this.currentEpisode = newEpisode;
        this.history.unshift(newRecord); // 최신순 앞에 추가

        try {
            await storage.updateProject(projectId, {
                currentEpisode: this.currentEpisode,
                episodeHistory: this.history
            });

            // 🌟 회차 변경 시 프로젝트 내 모든 노드의 현재 상태를 타임라인 체크포인트로 자동 기록!
            if (window.windowManager) {
                await window.windowManager.createAutoCheckpointForAllNodes(prevEpisode, newEpisode);
            }

            this.updateHeaderUI();
            window.showToast?.(`📖 작업 회차가 '제 ${newEpisode}화'로 변경되었습니다. (노드 타임라인 자동 기록 완료 ✨)`);

            // 모달이 열려있다면 갱신
            if (this.modal && !this.modal.classList.contains('hidden')) {
                this.renderHistoryTimeline();
            }
        } catch (err) {
            console.error('[EpisodeManager] 회차 업데이트 실패:', err);
        }
    }

    /**
     * 회차 이력 모달 표시
     */
    async showHistoryModal() {
        if (!this.modal) return;
        const projectId = this.currentProjectId || window.currentProjectId;
        if (projectId) {
            const project = await storage.getProject(projectId);
            if (project) {
                this.currentEpisode = project.currentEpisode || 1;
                this.history = Array.isArray(project.episodeHistory) ? project.episodeHistory : [];
            }
        }

        this.renderHistoryTimeline();
        this.modal.classList.remove('hidden');
    }

    hideHistoryModal() {
        if (this.modal) {
            this.modal.classList.add('hidden');
        }
    }

    /**
     * 이력 타임라인 렌더링
     */
    renderHistoryTimeline() {
        if (!this.timelineList) return;

        if (this.modalCurrentText) {
            this.modalCurrentText.textContent = `제 ${this.currentEpisode}화`;
        }
        if (this.modalTotalCount) {
            this.modalTotalCount.textContent = `총 ${this.history.length}개의 진행 기록`;
        }

        this.timelineList.innerHTML = '';

        if (this.history.length === 0) {
            this.timelineList.innerHTML = `
                <div style="text-align: center; padding: 30px; color: var(--color-text-tertiary); font-size: 13px;">
                    기록된 회차 변경 이력이 없습니다.
                </div>
            `;
            return;
        }

        // 시간 포맷 및 경과 시간 계산 유틸
        this.history.forEach((record, idx) => {
            const item = document.createElement('div');
            item.className = 'episode-timeline-item';
            item.style.cssText = `
                display: flex;
                gap: 12px;
                padding: 12px 14px;
                background: var(--color-surface-2);
                border: 1px solid var(--color-border);
                border-radius: 8px;
                position: relative;
                transition: all 0.2s ease;
            `;

            const date = new Date(record.timestamp);
            const dateStr = date.toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // 다음(더 과거) 기록과의 시간 차이 계산
            let durationText = '';
            const nextPastRecord = this.history[idx + 1];
            if (nextPastRecord) {
                const diffMs = Math.abs(record.timestamp - nextPastRecord.timestamp);
                const diffMins = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMins / 60);
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays > 0) {
                    durationText = `⏱️ 이전 회차로부터 ${diffDays}일 ${diffHours % 24}시간 경과`;
                } else if (diffHours > 0) {
                    durationText = `⏱️ 이전 회차로부터 ${diffHours}시간 ${diffMins % 60}분 경과`;
                } else if (diffMins > 0) {
                    durationText = `⏱️ 이전 회차로부터 ${diffMins}분 경과`;
                } else {
                    durationText = `⏱️ 직전 전환`;
                }
            }

            const isCurrent = record.episode === this.currentEpisode && idx === 0;

            item.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 60px; padding: 6px 10px; background: ${isCurrent ? 'rgba(0, 255, 204, 0.15)' : 'var(--color-bg-primary)'}; border: 1px solid ${isCurrent ? '#00ffcc' : 'var(--color-border)'}; border-radius: 6px;">
                    <div style="font-size: 10px; color: ${isCurrent ? '#00ffcc' : 'var(--color-text-tertiary)'}; font-weight: 600;">회차</div>
                    <div style="font-size: 15px; font-weight: 800; color: ${isCurrent ? '#00ffcc' : 'var(--color-text-primary)'};">${record.episode}화</div>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 3px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 12px; font-weight: 600; color: var(--color-text-primary); display: flex; align-items: center; gap: 6px;">
                            ${record.prevEpisode ? `제 ${record.prevEpisode}화 ➔ 제 ${record.episode}화 전환` : `제 ${record.episode}화 시작`}
                            ${isCurrent ? '<span style="font-size: 10px; background: #00ffcc; color: #0f141d; padding: 1px 6px; border-radius: 10px; font-weight: 800;">현재</span>' : ''}
                        </span>
                        <span style="font-size: 11px; color: var(--color-text-tertiary);">${dateStr}</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--color-text-secondary);">
                        <span>${this.escapeHtml(record.note || '')}</span>
                        ${durationText ? `<span style="font-size: 10px; color: var(--color-accent-warning); opacity: 0.9;">${durationText}</span>` : ''}
                    </div>
                </div>
            `;

            this.timelineList.appendChild(item);
        });
    }

    /**
     * 이력 전체 초기화 (회차 이력 + 프로젝트 내 모든 노드 타임라인 일괄 삭제)
     */
    async clearHistory() {
        const warningMsg = '⚠️ [경고: 영구 삭제 주의]\n\n' +
            '회차 진행 이력과 함께 현재 프로젝트 내 "모든 노드의 타임라인(버전 기록)"이 영구적으로 삭제되고 현재 상태로 초기화됩니다.\n\n' +
            '정말로 모든 회차 및 노드 타임라인 이력을 초기화할까요?';

        if (!confirm(warningMsg)) return;
        const projectId = this.currentProjectId || window.currentProjectId;
        if (!projectId) return;

        this.history = [{
            id: 'ep_' + Date.now(),
            episode: this.currentEpisode,
            prevEpisode: null,
            timestamp: Date.now(),
            note: '이력 전체 초기화'
        }];

        try {
            // 1. 프로젝트 회차 이력 초기화
            await storage.updateProject(projectId, {
                episodeHistory: this.history
            });

            // 2. 🌟 프로젝트 내 모든 노드의 타임라인 기록 일괄 삭제
            if (storage.clearProjectVersions) {
                await storage.clearProjectVersions(projectId);
            }

            this.renderHistoryTimeline();
            window.showToast?.('회차 이력 및 모든 노드의 타임라인 기록이 초기화되었습니다.');
        } catch (err) {
            console.error('[EpisodeManager] 이력 초기화 실패:', err);
            alert('이력 초기화 중 오류가 발생했습니다.');
        }
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

// 전역 인스턴스 등록
window.EpisodeManager = EpisodeManager;
window.episodeManager = new EpisodeManager();
