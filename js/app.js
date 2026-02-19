/**
 * 애플리케이션 초기화 및 전역 상태 관리
 */

// 전역 상태
window.currentProjectId = null;

/**
 * 프로젝트 화면으로 돌아가는 핵심 로직
 */
async function goBackToProjects(force = false) {
    console.log('[DEBUG] goBackToProjects 실행...', { force });

    // 1. 모든 열린 창 저장 및 정리
    try {
        if (window.windowManager) {
            await window.windowManager.saveAllWindows();
            await window.windowManager.clearAllWindows();
        }
    } catch (e) {
        console.error('창 정리 실패 (무시됨):', e);
    }

    // 2. 화면 전환
    const editorScreen = document.getElementById('editorScreen');
    const projectScreen = document.getElementById('projectScreen');

    if (editorScreen) editorScreen.classList.add('hidden');
    if (projectScreen) projectScreen.classList.remove('hidden');

    // 3. 내부 상태 초기화
    window.currentProjectId = null;
    if (window.editorManager) window.editorManager.hideEditor();
    if (window.fileTreeManager) window.fileTreeManager.clearState();

    // 4. 프로젝트 목록 새로고침
    try {
        if (window.projectManager) {
            await window.projectManager.renderProjectList();
        }
    } catch (e) {
        console.error('목록 갱신 실패:', e);
    }

    console.log('[DEBUG] 프로젝트 화면으로 무사히 돌아옴');
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

    // 애니메이션 종료 후 제거
    setTimeout(() => {
        toast.remove();
        if (container.childNodes.length === 0) container.remove();
    }, 3000);
}

// 전역 노출
window.goBackToProjects = goBackToProjects;
window.showToast = showToast;

/**
 * 앱 초기화
 */
async function initApp() {
    console.log('[DEBUG] 앱 초기화 시작');

    try {
        // 스토리지 초기화
        if (window.storage) await storage.init();

        // 프로젝트 로드
        if (window.projectManager) await projectManager.renderProjectList();

        // 설정 적용
        setTimeout(() => {
            if (window.toolsPanel) {
                const settings = window.toolsPanel.loadSettings();
                window.toolsPanel.applySettings(settings);
            }
        }, 100);

    } catch (error) {
        console.error('초기화 중 예기치 않은 오류:', error);
    }
}

// [핵심] 돌아가기 버튼 이벤트 위임 등록 (버튼의 존재 여부와 상관없이 미리 등록)
document.addEventListener('click', (e) => {
    const backBtn = e.target.closest('#backToProjectsBtn');
    if (backBtn) {
        console.log('[DEBUG] 돌아가기 버튼 클릭 감지(이벤트 위임)');
        e.preventDefault();
        e.stopPropagation();
        goBackToProjects();
    }
});

// 앱 실행
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

/**
 * [추가] 브라우저 기본 컨텍스트 메뉴 차단
 * 에디터 내부(복사/붙여넣기)를 제외한 모든 공간에서 시스템 메뉴를 방지하여 네이티브 앱 느낌을 줌
 */
document.addEventListener('contextmenu', (e) => {
    // 텍스트 에디터에서는 기본 기능을 위해 허용
    if (e.target.id === 'editorTextarea') return;

    // 그 외 모든 곳에서는 기본 메뉴 차단
    e.preventDefault();
}, true);
