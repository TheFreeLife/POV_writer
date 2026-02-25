/**
 * 백업 및 복구 관리자 (독자 바이너리 포맷)
 * 데이터를 바이너리 형식으로 인코딩하여 외부 프로그램에서 읽기 어렵게 처리합니다.
 */
class BackupManager {
    constructor() {
        // 내부 고유 식별자 및 암호화 키 (고정)
        this.HEADER = "POV_WRITER_V1";
        this.SYSTEM_KEY = new Uint8Array([80, 79, 86, 95, 87, 82, 73, 84, 69, 82, 95, 83, 69, 67, 82, 69, 84, 95, 75, 69, 89, 49, 50, 51]); // POV_WRITER_SECRET_KEY123
    }

    // 간단한 XOR 연산을 통한 데이터 마스킹 (바이너리화)
    _scramble(data) {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ this.SYSTEM_KEY[i % this.SYSTEM_KEY.length];
        }
        return result;
    }

    // 데이터 내보내기 (.pov 전용 포맷)
    async exportData(data, defaultName) {
        try {
            const jsonString = JSON.stringify(data);
            const encoder = new TextEncoder();
            const rawBytes = encoder.encode(jsonString);
            
            // 데이터 마스킹
            const scrambled = this._scramble(rawBytes);
            
            // 헤더 추가
            const headerBytes = encoder.encode(this.HEADER);
            const finalData = new Uint8Array(headerBytes.length + scrambled.length);
            finalData.set(headerBytes, 0);
            finalData.set(scrambled, headerBytes.length);

            const blob = new Blob([finalData], { type: 'application/octet-stream' });
            
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: defaultName,
                        types: [{ description: 'POV Writer Backup (.pov)', accept: { 'application/pov': ['.pov'] } }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    window.showToast?.('백업 파일이 저장되었습니다.');
                } catch (e) {
                    // 사용자가 취소한 경우 무시
                }
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = defaultName;
                a.click();
                URL.revokeObjectURL(url);
                window.showToast?.('백업 파일 다운로드가 시작되었습니다.');
            }
        } catch (err) {
            console.error('Export failed:', err);
            alert('파일 생성 중 오류가 발생했습니다.');
        }
    }

    // 파일 읽기 및 복구
    async importData(file) {
        try {
            const buffer = await file.arrayBuffer();
            const data = new Uint8Array(buffer);
            const decoder = new TextDecoder();
            
            // 헤더 확인
            const headerStr = decoder.decode(data.slice(0, this.HEADER.length));
            if (headerStr !== this.HEADER) {
                alert('올바른 .pov 백업 파일이 아닙니다.');
                return null;
            }

            // 마스킹 해제
            const scrambled = data.slice(this.HEADER.length);
            const descrambled = this._scramble(scrambled);
            
            const jsonStr = decoder.decode(descrambled);
            return JSON.parse(jsonStr);
        } catch (err) {
            console.error('Import failed:', err);
            alert('파일을 읽는 중 오류가 발생했습니다. 파일이 손상되었거나 형식이 맞지 않습니다.');
            return null;
        }
    }
}

window.backupManager = new BackupManager();
