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

// 전역 유틸리티 등록
window.goBackToProjects = goBackToProjects;
window.showToast = showToast;

/**
 * 앱 초기화
 */
async function initApp() {
    try {
        if (window.storage) await storage.init();
        if (window.projectManager) await projectManager.renderProjectList();

        // 설정 적용 (지연 실행)
        setTimeout(() => {
            if (window.toolsPanel) {
                const settings = window.toolsPanel.loadSettings();
                window.toolsPanel.applySettings(settings);
            }
        }, 100);

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
