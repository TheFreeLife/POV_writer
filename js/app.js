/**
 * 애플리케이션 초기화 및 전역 상태 관리
 */

// 전역 상태
window.currentProjectId = null;

/**
 * 프로젝트 목록 화면으로 복귀
 */
async function goBackToProjects(force = false) {
    try {
        if (window.windowManager) {
            await window.windowManager.saveAllWindows();
            await window.windowManager.clearAllWindows();
        }
    } catch (e) {
        console.warn('창 정리 중 오류 발생 (무시됨):', e);
    }

    const editorScreen = document.getElementById('editorScreen');
    const projectScreen = document.getElementById('projectScreen');

    if (editorScreen) editorScreen.classList.add('hidden');
    if (projectScreen) projectScreen.classList.remove('hidden');

    window.currentProjectId = null;
    if (window.fileTreeManager) window.fileTreeManager.clearState();

    try {
        if (window.projectManager) {
            await window.projectManager.renderProjectList();
        }
    } catch (e) {
        console.error('프로젝트 목록 갱신 실패:', e);
    }
}

/**
 * 전역 토스트 알림 표시
 */
function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '✅' : '❌'}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
        if (container.childNodes.length === 0) container.remove();
    }, 3000);
}

/**
 * 🌟 프로젝트 진입 시 단일 통합 세션 초기화 (Single Orchestration Pipeline)
 * 프로젝트 진입 시 필요한 모든 초기화 작업(설정 로드, UI 렌더링, 캔버스 복원, 폰트/색상 스타일 동기화)을 한눈에 관리합니다.
 */
async function initProjectSession(projectId) {
    console.log(`[AppInitializer] 🚀 프로젝트 세션 통합 초기화 시작 (ID: ${projectId})`);

    try {
        window.currentProjectId = projectId;

        // 1. 전역 설정(에디터 폰트, 색상, 테마) 최신 상태 동기화
        if (window.toolsPanel) {
            const settings = window.toolsPanel.loadSettingsSync() || window.toolsPanel.settings;
            if (settings) {
                window.toolsPanel.applySettings(settings);
                console.log(`[AppInitializer] ⚙️ 1. 에디터 글로벌 설정 적용 완료`);
            }
        }

        // 2. 프로젝트 데이터 및 사이드바 파일 트리 로드
        if (window.fileTreeManager) {
            await window.fileTreeManager.loadProjectFiles(projectId);
            await window.fileTreeManager.renderCustomNodePresets();
            console.log(`[AppInitializer] 📁 2. 프로젝트 파일 트리 및 커스텀 노드 프리셋 로드 완료`);
        }

        // 3. 노드 캔버스 및 저장된 노드 창/연결선 세션 복원
        if (window.windowManager) {
            await window.windowManager.restoreSession(projectId);
            console.log(`[AppInitializer] 📌 3. 노드 캔버스 창 복원 및 핀 연결선 동기화 완료`);
        }

        // 4. 복원 완료된 노드 윈도우 위젯에 에디터 스타일 final 주입
        if (window.toolsPanel?.currentSettings) {
            window.toolsPanel.applySettings(window.toolsPanel.currentSettings);
            console.log(`[AppInitializer] 🎨 4. 원고 위젯 글자색/배경색 최종 동기화 완료`);
        }

        // 5. 회차 관리자 동기화 (현재 작업 회차 및 타임라인 이력)
        if (window.episodeManager) {
            await window.episodeManager.loadProjectEpisode(projectId);
            console.log(`[AppInitializer] 📖 5. 프로젝트 회차 정보 로드 완료`);
        }

        // 6. On-Demand RAG 시스템 준비 완료 (노드 실행 시점에만 즉시 인덱싱)
        console.log(`[AppInitializer] 🧠 6. On-Demand JIT RAG 시스템 대기 완료`);

        console.log(`[AppInitializer] ✅ 프로젝트 세션 통합 초기화 완수!`);
    } catch (err) {
        console.error(`[AppInitializer] ❌ 프로젝트 세션 초기화 중 오류 발생:`, err);
    }
}

// 전역 유틸리티 및 오케스트레이터 등록
window.goBackToProjects = goBackToProjects;
window.showToast = showToast;
window.initProjectSession = initProjectSession;

/**
 * 앱 전체 초기화
 */
async function initApp() {
    try {
        if (window.storage) await storage.init();
        if (window.projectManager) {
            await projectManager.renderProjectList();
            projectManager.setupBackupEventListeners();
        }

        // 글로벌 환경설정 초기 1회 적용
        if (window.toolsPanel) {
            const settings = window.toolsPanel.loadSettingsSync();
            window.toolsPanel.applySettings(settings);
        }

    } catch (error) {
        console.error('앱 초기화 오류:', error);
    }
}

// 전역 이벤트 위임 (돌아가기 버튼 등)
document.addEventListener('click', (e) => {
    const backBtn = e.target.closest('#backToProjectsBtn');
    if (backBtn) {
        e.preventDefault();
        goBackToProjects();
    }
});

// 앱 실행 및 기본 메뉴 차단
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
}, true);
