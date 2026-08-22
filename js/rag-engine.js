/**
 * js/rag-engine.js
 * POV_writer 통합 로컬 RAG & Function Calling 소설 상태 관리 엔진
 * - Transformers.js (Xenova/multilingual-e5-small) 기반 100% 브라우저 로컬 벡터 임베딩
 * - 전방위 로어북 자동 인덱싱 및 문맥 유사도 검색 (Top 3, 1000자 Truncation)
 * - 3대 Function Calling 도구 지원: searchLorebookRAG, patchLorebookEntry, saveCharacterKnowledge
 * - 캔버스 실시간 인출 시각적 하이라이트 연동
 */

class LoreRAGManager {
    constructor() {
        this.modelName = 'Xenova/multilingual-e5-small';
        this.pipeline = null;
        this.isModelLoading = false;
        this.isModelReady = false;
        this.vectorCache = new Map(); // textKey -> vector

        // 비동기 모델 초기화 시작
        this.init();
    }

    /**
     * Transformers.js 임베딩 모델 초기화
     */
    async init() {
        if (this.pipeline || this.isModelLoading) return;
        this.isModelLoading = true;

        try {
            // ES Module 동적 import로 로드하여 브라우저 스크립트 충돌 방지
            const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
            if (env) {
                env.allowLocalModels = false;
                env.useBrowserCache = true;
            }
            this.pipeline = await pipeline('feature-extraction', this.modelName, {
                quantized: true
            });
            this.isModelReady = true;
            console.log('[LoreRAGManager] Transformers.js E5-small 로컬 임베딩 모델 준비 완료 🚀');
        } catch (err) {
            console.warn('[LoreRAGManager] Transformers.js 로드 실패, 고속 하이브리드 TF-IDF/N-gram 임베딩으로 자동 전환:', err);
        } finally {
            this.isModelLoading = false;
        }
    }

    /**
     * 텍스트를 고차원 벡터로 변환 (E5 규격: passage: / query: 접두사 준수)
     */
    async embedText(text, isQuery = false) {
        if (!text || typeof text !== 'string') return new Float32Array(384);
        const cleanText = text.trim();
        const prefix = isQuery ? 'query: ' : 'passage: ';
        const fullInput = prefix + cleanText;

        // 캐시 확인
        if (this.vectorCache.has(fullInput)) {
            return this.vectorCache.get(fullInput);
        }

        // 1. Transformers.js 로컬 모델 사용
        if (this.pipeline) {
            try {
                const output = await this.pipeline(fullInput, { pooling: 'mean', normalize: true });
                const vector = Array.from(output.data);
                this.vectorCache.set(fullInput, vector);
                return vector;
            } catch (err) {
                console.warn('[LoreRAGManager] 로컬 신경망 임베딩 실패, 폴백 연산:', err);
            }
        }

        // 2. 고속 N-gram / TF-IDF 해시 벡터 폴백 (384차원)
        const vector = this._computeFastHashVector(cleanText, 384);
        this.vectorCache.set(fullInput, vector);
        return vector;
    }

    /**
     * 경량 384차원 N-gram 시맨틱 해시 벡터 생성기 (오프라인/다운로드 중 즉시 가동)
     */
    _computeFastHashVector(text, dim = 384) {
        const vec = new Float32Array(dim);
        const normalized = text.toLowerCase().replace(/[\s\p{P}]+/gu, ' ');
        const words = normalized.split(' ').filter(w => w.length > 0);

        // 1) 단어 단위 해시
        words.forEach(w => {
            let h = 0;
            for (let i = 0; i < w.length; i++) {
                h = (Math.imul(31, h) + w.charCodeAt(i)) | 0;
            }
            const idx = Math.abs(h) % dim;
            vec[idx] += 1.0;
        });

        // 2) 2-gram / 3-gram 문자 단위 해시
        for (let i = 0; i < normalized.length - 1; i++) {
            const bigram = normalized.substr(i, 2);
            let h = (bigram.charCodeAt(0) * 31 + bigram.charCodeAt(1)) | 0;
            const idx = Math.abs(h) % dim;
            vec[idx] += 0.5;
        }

        // L2 정규화
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < dim; i++) vec[i] /= norm;
        }
        return Array.from(vec);
    }

    /**
     * 두 벡터 간의 코사인 유사도 계산
     */
    cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom > 0 ? dot / denom : 0;
    }

    /**
     * 파일/노드에서 도메인별 청크 텍스트 분할 추출 (JSON 문법 제거 및 100% 자연어 변환)
     */
    _extractChunksFromFile(file, rawContent) {
        const chunks = [];
        const fileId = file?.id || 'custom';
        let fileName = file?.name || file?.title || '';
        const category = file?.category || file?.template || 'general';

        let domain = 'general';
        if (category === 'character' || fileName.includes('캐릭터') || fileName.includes('인물')) domain = 'character';
        else if (category === 'world' || fileName.includes('세계관') || fileName.includes('설정')) domain = 'world';
        else if (category === 'proper_noun' || fileName.includes('고유명사') || fileName.includes('사전')) domain = 'proper_noun';
        else if (category === 'foreshadowing' || fileName.includes('복선') || fileName.includes('떡밥')) domain = 'foreshadowing';
        else if (fileName.includes('줄거리') || fileName.includes('시놉시스')) domain = 'episode_summary';

        // 1. 데이터 파싱 및 다계층 래퍼 언래핑 (values, data, output, 등장인물 데이터, lore 등)
        let contentData = (typeof rawContent === 'object' && rawContent !== null) ? { ...rawContent } : {};
        if (typeof rawContent === 'string') {
            const trimmed = rawContent.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    contentData = JSON.parse(trimmed);
                } catch (e) {
                    contentData = { rawText: rawContent };
                }
            } else {
                contentData = { rawText: rawContent };
            }
        }

        if (contentData && typeof contentData === 'object') {
            if (contentData.values && typeof contentData.values === 'object') contentData = { ...contentData, ...contentData.values };
            if (contentData.data && typeof contentData.data === 'object') contentData = { ...contentData, ...contentData.data };
            if (contentData.output && typeof contentData.output === 'object') contentData = { ...contentData, ...contentData.output };
            if (contentData['등장인물 데이터'] && typeof contentData['등장인물 데이터'] === 'object') contentData = { ...contentData, ...contentData['등장인물 데이터'] };
            if (contentData.lore && typeof contentData.lore === 'object') contentData = { ...contentData, ...contentData.lore };
        }

        if (!fileName && contentData.title) fileName = contentData.title;
        if (!fileName && contentData.name) fileName = contentData.name;
        if (!fileName) fileName = '소설 원고';

        // 값 정규화 헬퍼 (JSON 문자열 대신 읽기 쉬운 자연어 텍스트로 변환)
        const toReadableText = (val) => {
            if (val === null || val === undefined) return '';
            if (typeof val === 'string') return val.trim();
            if (Array.isArray(val)) return val.filter(Boolean).map(v => typeof v === 'object' ? toReadableText(v) : String(v)).join(', ');
            if (typeof val === 'object') {
                if (val.description) return String(val.description).trim();
                if (val.content) return String(val.content).trim();
                if (val.likes || val.dislikes) {
                    const likes = Array.isArray(val.likes) ? val.likes.join(', ') : (val.likes || '');
                    const dislikes = Array.isArray(val.dislikes) ? val.dislikes.join(', ') : (val.dislikes || '');
                    return `좋아하는 것(${likes || '없음'}) / 싫어하는 것(${dislikes || '없음'})`;
                }
                if (val.tone || val.examples) {
                    const ex = Array.isArray(val.examples) ? val.examples.join(' / ') : (val.examples || '');
                    return `어조(${val.tone || '기본'}) ${ex ? `예시(${ex})` : ''}`;
                }
                return Object.entries(val)
                    .filter(([k]) => !['id', 'schemaVersion', 'createdAt', 'updatedAt'].includes(k))
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? toReadableText(v) : v}`)
                    .join(', ');
            }
            return String(val);
        };

        // 2. 도메인 스마트 자동 판별
        const isCharacter = domain === 'character' || 
            Boolean(contentData.name_role || contentData.profile_summary || contentData.personality || contentData.speech_tone || contentData.appearance || contentData.dialogue_examples || contentData.persona_md);

        const isWorld = domain === 'world' ||
            Boolean(contentData.background_lore || contentData.world_setting || contentData.logline);

        const isProperNoun = domain === 'proper_noun' ||
            Boolean(contentData.term || (contentData.type && contentData.desc));

        const isForeshadowing = domain === 'foreshadowing' ||
            Boolean(contentData.hook_id || contentData.hidden_truth || contentData.observable_clue);

        // 3. 도메인별 청킹 실행
        if (isCharacter) {
            let charName = contentData.name || '';
            let charRole = contentData.role || '';
            if (!charName && contentData.name_role) {
                const parts = String(contentData.name_role).split('/');
                charName = parts[0].trim();
                if (parts.length > 1) charRole = parts.slice(1).join('/').trim();
            }
            if (!charName) {
                charName = fileName.replace(/\.[^/.]+$/, '').replace(/등장인물\s*&?\s*AI\s*페르소나\s*카드/i, '').trim() || fileName;
            }

            const profile = toReadableText(contentData.profile_summary || contentData.profile || charRole);
            const appearance = toReadableText(contentData.appearance);
            const speech = toReadableText(contentData.speech_tone || contentData.speech_style || contentData.speechStyle);
            const personality = toReadableText(contentData.personality);
            const inventory = toReadableText(contentData.inventory || contentData.extra_notes);
            const relationships = toReadableText(contentData.relationships);
            const abilities = toReadableText(contentData.special_ability || contentData.abilities);
            const past = toReadableText(contentData.past_and_motivation || contentData.past_background_and_motivation);
            const memories = toReadableText(contentData.memories);
            const knowledge = toReadableText(contentData.knowledge);
            const preferences = toReadableText(contentData.preferences || (contentData.likes || contentData.dislikes ? { likes: contentData.likes, dislikes: contentData.dislikes } : ''));
            const habits = toReadableText(contentData.behavior_patterns);

            if (profile) chunks.push({ id: `${fileId}_prof`, sourceFileId: fileId, sourceTitle: `${charName} (신분/프로필)`, domain: 'character', text: `[${charName}의 신분/프로필]: ${profile}` });
            if (appearance) chunks.push({ id: `${fileId}_app`, sourceFileId: fileId, sourceTitle: `${charName} (외모/복장)`, domain: 'character', text: `[${charName}의 외모/복장]: ${appearance}` });
            if (speech) chunks.push({ id: `${fileId}_speech`, sourceFileId: fileId, sourceTitle: `${charName} (말투/호칭)`, domain: 'character', text: `[${charName}의 말투/호칭]: ${speech}` });
            if (personality) chunks.push({ id: `${fileId}_pers`, sourceFileId: fileId, sourceTitle: `${charName} (성격/심리)`, domain: 'character', text: `[${charName}의 성격/심리]: ${personality}` });
            if (preferences) chunks.push({ id: `${fileId}_pref`, sourceFileId: fileId, sourceTitle: `${charName} (취향/호불호)`, domain: 'character', text: `[${charName}의 취향/호불호]: ${preferences}` });
            if (habits) chunks.push({ id: `${fileId}_habit`, sourceFileId: fileId, sourceTitle: `${charName} (행동/버릇)`, domain: 'character', text: `[${charName}의 행동/버릇]: ${habits}` });
            if (inventory) chunks.push({ id: `${fileId}_inv`, sourceFileId: fileId, sourceTitle: `${charName} (소지품/장비)`, domain: 'character', text: `[${charName}의 소지품/장비]: ${inventory}` });
            if (relationships) chunks.push({ id: `${fileId}_rel`, sourceFileId: fileId, sourceTitle: `${charName} (인간관계)`, domain: 'character', text: `[${charName}의 인간관계]: ${relationships}` });
            if (abilities) chunks.push({ id: `${fileId}_abi`, sourceFileId: fileId, sourceTitle: `${charName} (능력/스킬)`, domain: 'character', text: `[${charName}의 특수능력/스킬]: ${abilities}` });
            if (past) chunks.push({ id: `${fileId}_past`, sourceFileId: fileId, sourceTitle: `${charName} (과거사/동기)`, domain: 'character', text: `[${charName}의 과거사/행동동기]: ${past}` });
            if (memories) chunks.push({ id: `${fileId}_mem`, sourceFileId: fileId, sourceTitle: `${charName} (핵심 기억)`, domain: 'character', text: `[${charName}의 개인적 기억/경험]: ${memories}` });
            if (knowledge) chunks.push({ id: `${fileId}_know`, sourceFileId: fileId, sourceTitle: `${charName} (보유 지식/정보)`, domain: 'character', text: `[${charName}이 알고 있는 전문 지식/정보]: ${knowledge}` });
        } else if (isWorld) {
            const worldTitle = contentData.title || fileName;
            const logline = toReadableText(contentData.logline);
            const lore = toReadableText(contentData.background_lore || contentData.world_setting || contentData.content);
            if (logline) chunks.push({ id: `${fileId}_logline`, sourceFileId: fileId, sourceTitle: `${worldTitle} (로그라인)`, domain: 'world', text: `[${worldTitle} 로그라인]: ${logline}` });
            if (lore) chunks.push({ id: `${fileId}_lore`, sourceFileId: fileId, sourceTitle: `${worldTitle} (세계관 배경)`, domain: 'world', text: `[${worldTitle} 배경 설정]: ${lore}` });
        } else if (isProperNoun) {
            const term = contentData.term || fileName;
            const desc = toReadableText(contentData.desc || contentData.description || contentData.content);
            const type = contentData.type || '고유명사';
            const isPublic = Boolean(contentData.is_public ?? contentData.isPublic ?? false);
            if (desc) {
                chunks.push({
                    id: `${fileId}_noun`,
                    sourceFileId: fileId,
                    sourceTitle: `[${type}] ${term}`,
                    domain: 'proper_noun',
                    isPublic: isPublic,
                    text: `[${type} - ${term}${isPublic ? ' (공용 지식/상식)' : ' (비밀/전문 지식)'}]: ${desc}`
                });
            }
        } else if (isForeshadowing) {
            const hookId = contentData.hook_id || fileName;
            const clue = toReadableText(contentData.observable_clue);
            const truth = toReadableText(contentData.hidden_truth);
            chunks.push({ id: `${fileId}_hook`, sourceFileId: fileId, sourceTitle: `[복선] ${hookId}`, domain: 'foreshadowing', text: `[복선 ${hookId}]: 연출 단서(${clue || '단서 없음'}) -> 숨겨진 진실(${truth || '미정'})` });
        } else {
            // 🌟 일반 텍스트, 원고 노드(editorVal / content / rawText / output 등) 문단 단위 청킹
            const mainTextCandidate = contentData.editorVal || 
                                      contentData.content || 
                                      contentData['원고 본문'] || 
                                      contentData.output || 
                                      contentData.text || 
                                      contentData.val || 
                                      contentData.rawText || 
                                      (typeof rawContent === 'string' ? rawContent : '');

            const mainText = typeof mainTextCandidate === 'string' ? mainTextCandidate.trim() : (typeof mainTextCandidate === 'object' ? JSON.stringify(mainTextCandidate, null, 2) : String(mainTextCandidate || '').trim());

            if (mainText) {
                // 문단 분할 (빈 줄 또는 줄바꿈 기준)
                const paragraphs = mainText.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0);
                
                if (paragraphs.length > 0) {
                    paragraphs.forEach((p, idx) => {
                        // 너무 긴 문단(1,000자 초과)은 500자 단위로 분할
                        if (p.length > 1000) {
                            const subChunks = p.match(/[^.!?\n]+[.!?\n]+/g) || [p];
                            let currentBuffer = '';
                            let subIdx = 1;
                            subChunks.forEach(sent => {
                                if ((currentBuffer + sent).length > 600 && currentBuffer.length > 0) {
                                    chunks.push({
                                        id: `${fileId}_p${idx + 1}_${subIdx++}`,
                                        sourceFileId: fileId,
                                        sourceTitle: `${fileName} #${idx + 1}-${subIdx - 1}`,
                                        domain: 'general',
                                        text: `[${fileName}]: ${currentBuffer.trim()}`
                                    });
                                    currentBuffer = sent;
                                } else {
                                    currentBuffer += sent;
                                }
                            });
                            if (currentBuffer.trim()) {
                                chunks.push({
                                    id: `${fileId}_p${idx + 1}_${subIdx}`,
                                    sourceFileId: fileId,
                                    sourceTitle: `${fileName} #${idx + 1}-${subIdx}`,
                                    domain: 'general',
                                    text: `[${fileName}]: ${currentBuffer.trim()}`
                                });
                            }
                        } else {
                            chunks.push({
                                id: `${fileId}_raw_${idx}`,
                                sourceFileId: fileId,
                                sourceTitle: paragraphs.length === 1 ? fileName : `${fileName} #${idx + 1}`,
                                domain: 'general',
                                text: `[${fileName}]: ${p}`
                            });
                        }
                    });
                }
            }

            // 그 외 객체 키-값 쌍 중 아직 청킹되지 않은 추가 커스텀 필드 데이터 수집 (시스템 메타데이터 제외)
            const ignoredMetaKeys = new Set([
                'id', 'name', 'title', 'nodeType', 'category', 'template', 'schemaVersion',
                'createdAt', 'updatedAt', 'rawText', 'editorVal', 'content', 'output', 'val',
                'text', '원고 본문', 'isApproved', 'isContinued', 'tags', 'icon', 'color',
                'defaultWidth', 'defaultHeight', 'promptForName', 'promptForDesc', 'widgets',
                'portsConfig', 'code', 'selectVal', 'selectedOption', 'selectedChoice',
                'inputToggles', 'rawInputs', 'rawVal'
            ]);

            for (const [k, v] of Object.entries(contentData)) {
                if (ignoredMetaKeys.has(k)) continue;
                const valText = toReadableText(v);
                if (valText && valText.length >= 10 && valText !== fileName) {
                    chunks.push({ id: `${fileId}_${k}`, sourceFileId: fileId, sourceTitle: `${fileName} (${k})`, domain: 'general', text: `[${fileName} - ${k}]: ${valText}` });
                }
            }
        }

        return chunks;
    }

    /**
     * 입력된 노드/사전 데이터를 온디맨드로 청킹 & 임베딩하여 RAG 지식 패키지로 빌드
     */
    async buildVectorPackageFromInputs(rawInputs, fallbackProjectId) {
        const chunks = [];
        const itemsToProcess = [];

        const collectItems = (obj, keyHint = '') => {
            if (obj === null || obj === undefined) return;

            if (typeof obj === 'string') {
                const trimmed = obj.trim();
                if (trimmed) {
                    itemsToProcess.push({ name: keyHint || '소설 원고', content: trimmed });
                }
                return;
            }

            if (Array.isArray(obj)) {
                obj.forEach((item, idx) => collectItems(item, `${keyHint || '항목'} #${idx + 1}`));
                return;
            }

            if (typeof obj === 'object') {
                if (obj.package_name === 'LoreVectorPackage' && Array.isArray(obj.chunks)) {
                    obj.chunks.forEach(c => chunks.push(c));
                    return;
                }

                // 포트 매핑 래퍼 객체인 경우 (inputs['in_lore_sources'] 등)
                const keys = Object.keys(obj);
                const hasNodeData = Boolean(obj.editorVal || obj.content || obj.text || obj.val || obj.persona_md || obj.lore || obj['원고 본문'] || obj.output);

                if (hasNodeData) {
                    itemsToProcess.push(obj);
                } else if (keys.length > 0) {
                    keys.forEach(k => {
                        if (k !== 'input' && k !== 'rawInputs' && k !== 'displayVal' && k !== 'merged_viewer') {
                            collectItems(obj[k], k);
                        }
                    });
                } else {
                    itemsToProcess.push(obj);
                }
            }
        };

        collectItems(rawInputs);

        // 만약 직접 연결된 노드가 없다면 프로젝트 전체 파일에서 수집
        if (itemsToProcess.length === 0 && chunks.length === 0) {
            const projectId = fallbackProjectId || window.currentProjectId;
            if (projectId && window.storage) {
                const files = await storage.getProjectFiles(projectId);
                files.filter(f => f.type === 'file').forEach(f => {
                    const info = window.windowManager?.windows?.get(f.id);
                    const rawContent = info ? (info.textarea ? info.textarea.value : (info.file?.content || '')) : (f.content || '');
                    const extracted = this._extractChunksFromFile(f, rawContent);
                    extracted.forEach(c => itemsToProcess.push({ chunk: c }));
                });
            }
        }

        for (const item of itemsToProcess) {
            let extracted = [];
            if (item.chunk) {
                extracted = [item.chunk];
            } else {
                extracted = this._extractChunksFromFile({ id: item.id || 'custom', name: item.name || item.title || '로어' }, item);
            }
            for (const c of extracted) {
                if (this.vectorCache.has(c.text)) {
                    c.vector = this.vectorCache.get(c.text);
                } else {
                    c.vector = await this.embedText(c.text, false);
                    this.vectorCache.set(c.text, c.vector);
                }
                chunks.push(c);
            }
        }

        return {
            package_name: 'LoreVectorPackage',
            created_at: Date.now(),
            total_chunks: chunks.length,
            chunks: chunks
        };
    }

    /**
     * RAG 지식 패키지 또는 청크 목록을 대상으로 유사도 검색 (도메인 필터 및 인물 시점 지식 격리 지원)
     */
    async searchVectorPackage(lorePackage, { query, topK = 3, maxChars = 1000, domainFilter = 'all', characterContext = '' } = {}) {
        if (!query || typeof query !== 'string') {
            return { error: 'query string required', results: [], formattedMarkdown: '검색 쿼리가 비어있습니다.' };
        }

        let chunkList = [];
        if (lorePackage && lorePackage.package_name === 'LoreVectorPackage' && Array.isArray(lorePackage.chunks)) {
            chunkList = lorePackage.chunks;
        } else if (Array.isArray(lorePackage)) {
            chunkList = lorePackage;
        } else {
            // 온디맨드 JIT 빌드
            const pkg = await this.buildVectorPackageFromInputs(lorePackage);
            chunkList = pkg.chunks;
        }

        // 1. 도메인 필터링
        let eligibleChunks = chunkList;
        if (domainFilter && domainFilter !== 'all') {
            eligibleChunks = eligibleChunks.filter(c => c.domain === domainFilter);
        }

        // 2. 🛡️ 인물 시점 지식 격리 (Character Knowledge Scoping)
        if (characterContext) {
            const charName = String(characterContext).trim();
            eligibleChunks = eligibleChunks.filter(c => {
                // 본인 캐릭터 데이터는 모두 허용
                if (c.sourceTitle?.includes(charName) || c.text?.includes(charName)) return true;
                
                // 타인 캐릭터 데이터인 경우: 외모/신분만 허용, 내면 심리/과거사/비밀 지식은 엄격 차단
                if (c.domain === 'character') {
                    const isPublic = c.sourceTitle?.includes('외모') || c.sourceTitle?.includes('신분') || c.sourceTitle?.includes('말투');
                    return isPublic;
                }
                
                // 복선 데이터인 경우: 숨겨진 진실은 감추고 허용
                return true;
            });
        }

        // 3. 쿼리 벡터화 및 유사도 계산
        const queryVec = await this.embedText(query, true);
        const scoredChunks = [];

        for (const chunk of eligibleChunks) {
            const vector = chunk.vector || (this.vectorCache.get(chunk.text)) || (await this.embedText(chunk.text, false));
            const sim = this.cosineSimilarity(queryVec, vector);
            scoredChunks.push({
                ...chunk,
                vector,
                score: sim
            });
        }

        scoredChunks.sort((a, b) => b.score - a.score);
        const topResults = scoredChunks.slice(0, Math.max(1, Number(topK) || 3));

        // 4. Truncation 및 마스킹 적용
        const effectiveMaxChars = Number(maxChars) || 1000;
        const finalResults = topResults.map(r => {
            let text = r.text;
            // 인물 시점일 때 복선의 숨겨진 진실 마스킹
            if (characterContext && r.domain === 'foreshadowing') {
                text = text.replace(/->\s*숨겨진 진실\([^)]+\)/g, '-> 숨겨진 진실(미지)');
            }
            if (text.length > effectiveMaxChars) {
                text = text.substring(0, effectiveMaxChars) + '...(중략)';
            }
            return {
                title: r.sourceTitle,
                domain: r.domain,
                score: Math.round(r.score * 100) / 100,
                content: text,
                sourceFileId: r.sourceFileId
            };
        });

        // 캔버스 하이라이트 트리거
        const sourceFileIds = Array.from(new Set(finalResults.map(r => r.sourceFileId).filter(Boolean)));
        this.highlightRetrievedNodes(sourceFileIds);

        // 마크다운 조립
        const formattedMarkdown = finalResults.length > 0 ? (
            `# [참조 배경 로어 지식]\n\n` +
            finalResults.map((r, i) => `### ${i + 1}. ${r.title} (일치율 ${Math.round(r.score * 100)}%)\n${r.content}`).join('\n\n')
        ) : '(관련된 로어 지식이 없습니다)';

        return {
            query,
            count: finalResults.length,
            results: finalResults,
            formattedMarkdown
        };
    }

    /**
     * ① `searchLorebookRAG`: 로어북 벡터 검색
     */
    async searchLorebookRAG({ query, topK, maxChars, domainFilter, characterContext, lorePackage } = {}) {
        return this.searchVectorPackage(lorePackage, { query, topK, maxChars, domainFilter, characterContext });
    }

    /**
     * ② `patchLorebookEntry`: 소설 전방위 로어북 내용 수정/추가/삭제
     */
    async patchLorebookEntry({ domain, targetName, category, action, content }) {
        if (!targetName || !category || !action || content === undefined) {
            return { error: 'Missing required parameters (targetName, category, action, content)' };
        }

        const projectId = window.currentProjectId;
        if (!projectId) return { error: 'No active project' };

        const files = await storage.getProjectFiles(projectId);
        // 대상 노드 검색 (이름 또는 식별자 일치)
        const targetFile = files.find(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase();
            const searchName = targetName.trim().toLowerCase();
            return cleanName === searchName || cleanName.includes(searchName);
        });

        if (!targetFile) {
            return { error: `대상 노드를 찾을 수 없습니다: '${targetName}'` };
        }

        const info = window.windowManager?.windows?.get(targetFile.id);
        let rawContent = info ? (info.textarea ? info.textarea.value : (info.file?.content || '')) : (targetFile.content || '');

        let contentData = {};
        if (typeof rawContent === 'object') {
            contentData = { ...rawContent };
        } else if (typeof rawContent === 'string' && rawContent.startsWith('{')) {
            try { contentData = JSON.parse(rawContent); } catch (e) { contentData = { content: rawContent }; }
        } else {
            contentData = { content: rawContent };
        }

        // 고정 카테고리 내 내용 수정/추가/삭제 수행
        const currentVal = contentData[category];

        if (action === 'replace') {
            contentData[category] = content;
        } else if (action === 'add') {
            if (Array.isArray(currentVal)) {
                if (!currentVal.includes(content)) currentVal.push(content);
                contentData[category] = currentVal;
            } else if (typeof currentVal === 'string' && currentVal.trim()) {
                contentData[category] = `${currentVal}\n• ${content}`;
            } else {
                contentData[category] = [content];
            }
        } else if (action === 'remove') {
            if (Array.isArray(currentVal)) {
                contentData[category] = currentVal.filter(item => !String(item).includes(content));
            } else if (typeof currentVal === 'string') {
                contentData[category] = currentVal.replace(new RegExp(`.*${content}.*(\n)?`, 'g'), '').trim();
            }
        }

        // DB 및 캔버스 UI 동기화
        const updatedContentStr = JSON.stringify(contentData, null, 2);
        await storage.updateFile(targetFile.id, { content: updatedContentStr });

        if (info) {
            info.file.content = updatedContentStr;
            window.windowManager?.refreshNodeUI?.(targetFile.id);
            window.windowManager?.notifyNodeChanged?.(targetFile.id, 'contentChange');
        }

        return {
            success: true,
            domain: domain || 'general',
            targetName,
            category,
            action,
            updatedValue: contentData[category]
        };
    }

    /**
     * ③ `saveCharacterKnowledge`: 하이브리드 인물 지식 저장 (KEYWORD / SENTENCE)
     */
    async saveCharacterKnowledge({ characterName, knowledgeEntry }) {
        if (!characterName || !knowledgeEntry || !knowledgeEntry.type || !knowledgeEntry.content) {
            return { error: 'characterName and knowledgeEntry ({ type, content }) are required' };
        }

        const type = String(knowledgeEntry.type).toUpperCase();
        let content = String(knowledgeEntry.content).trim();

        // 🌟 하이브리드 규칙 검증 및 정제
        if (type === 'KEYWORD') {
            // 단어형: 공백/단락 정리 (단어/고유명사화)
            content = content.replace(/^[[\]"']+|[[\]"']+$/g, '').trim();
        } else if (type === 'SENTENCE') {
            // 문장형: 50자 이내 1문장 압축 보장
            if (content.length > 50) {
                content = content.substring(0, 48) + '..';
            }
        }

        const projectId = window.currentProjectId;
        const files = await storage.getProjectFiles(projectId);
        const targetFile = files.find(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase();
            return cleanName === characterName.trim().toLowerCase() || cleanName.includes(characterName.trim().toLowerCase());
        });

        if (!targetFile) {
            return { error: `캐릭터 노드를 찾을 수 없습니다: '${characterName}'` };
        }

        const info = window.windowManager?.windows?.get(targetFile.id);
        let rawContent = info ? (info.textarea ? info.textarea.value : (info.file?.content || '')) : (targetFile.content || '');

        let contentData = {};
        try {
            contentData = typeof rawContent === 'object' ? rawContent : JSON.parse(rawContent || '{}');
        } catch (e) {
            contentData = {};
        }

        if (!contentData.knowledge || typeof contentData.knowledge !== 'object') {
            contentData.knowledge = { keywords: [], sentences: [] };
        }
        if (!Array.isArray(contentData.knowledge.keywords)) contentData.knowledge.keywords = [];
        if (!Array.isArray(contentData.knowledge.sentences)) contentData.knowledge.sentences = [];

        if (type === 'KEYWORD') {
            if (!contentData.knowledge.keywords.includes(content)) {
                contentData.knowledge.keywords.push(content);
            }
        } else {
            if (!contentData.knowledge.sentences.includes(content)) {
                contentData.knowledge.sentences.push(content);
            }
        }

        const updatedContentStr = JSON.stringify(contentData, null, 2);
        await storage.updateFile(targetFile.id, { content: updatedContentStr });

        if (info) {
            info.file.content = updatedContentStr;
            window.windowManager?.refreshNodeUI?.(targetFile.id);
            window.windowManager?.notifyNodeChanged?.(targetFile.id, 'contentChange');
        }

        return {
            success: true,
            characterName,
            type,
            savedContent: content,
            totalKnowledge: contentData.knowledge
        };
    }

    /**
     * 캔버스 상의 실시간 인출 하이라이트 트리거 (단일 파일 ID 또는 배열 지원)
     */
    highlightRetrievedNodes(sourceFileIds) {
        const ids = Array.isArray(sourceFileIds) ? sourceFileIds : [sourceFileIds].filter(Boolean);
        if (ids.length === 0) return;

        ids.forEach(fileId => {
            const winEl = document.querySelector(`.editor-window[data-file-id="${fileId}"]`);
            if (winEl) {
                winEl.classList.remove('rag-retrieved-glow');
                void winEl.offsetWidth; // Reflow 트리거
                winEl.classList.add('rag-retrieved-glow');
                setTimeout(() => winEl.classList.remove('rag-retrieved-glow'), 2500);
            }
        });
    }

    /**
     * 단일 노드 하이라이트 편의 메서드
     */
    highlightNodeOnCanvas(fileId) {
        this.highlightRetrievedNodes([fileId]);
    }

    /**
     * Function Calling 표준 Tools 스키마 반환
     */
    getStandardTools(readOnly = false) {
        const searchTool = {
            name: "searchLorebookRAG",
            description: "소설 전체 로어북(세계관 설정, 인물 기억, 고유명사 사전, 복선, 지난 줄거리)을 벡터 검색하여 연관된 배경 지식을 인출합니다.",
            parameters: {
                type: "OBJECT",
                properties: {
                    query: { type: "STRING", description: "검색할 상황, 키워드, 의문점 또는 문맥 (예: '마력 폭주 현상', '칼렌의 과거사', '2왕자의 정체')" }
                },
                required: ["query"]
            }
        };

        if (readOnly) {
            return [searchTool];
        }

        const patchTool = {
            name: "patchLorebookEntry",
            description: "소설의 특정 로어북(등장인물, 세계관, 고유명사, 복선, 줄거리) 항목의 내용을 추가, 수정, 삭제합니다.",
            parameters: {
                type: "OBJECT",
                properties: {
                    domain: {
                        type: "STRING",
                        enum: ["character", "world", "proper_noun", "foreshadowing", "episode_summary"],
                        description: "수정할 로어북 영역"
                    },
                    targetName: { type: "STRING", description: "수정 대상의 이름 (예: '칼렌', '루미나스 제국')" },
                    category: { type: "STRING", description: "수정할 고정 카테고리 (예: appearance, speechStyle, personality, inventory, relationships, abilities, memories, knowledge)" },
                    action: { type: "STRING", enum: ["add", "replace", "remove"], description: "수정 방식: add(추가), replace(수정/교체), remove(삭제)" },
                    content: { type: "STRING", description: "반영할 새로운 내용 또는 삭제할 키워드" }
                },
                required: ["domain", "targetName", "category", "action", "content"]
            }
        };

        const saveKnowledgeTool = {
            name: "saveCharacterKnowledge",
            description: "인물이 작중에서 새로 알게 된 비밀, 정체, 고유명사를 하이브리드 규칙(KEYWORD/SENTENCE)에 맞추어 인물 지식에 저장합니다.",
            parameters: {
                type: "OBJECT",
                properties: {
                    characterName: { type: "STRING", description: "지식을 습득한 인물 이름" },
                    knowledgeEntry: {
                        type: "OBJECT",
                        properties: {
                            type: { type: "STRING", enum: ["KEYWORD", "SENTENCE"], description: "단어형 고유명사(KEYWORD) 또는 50자 이내 1문장(SENTENCE)" },
                            content: { type: "STRING", description: "저장할 지식 내용" }
                        },
                        required: ["type", "content"]
                    }
                },
                required: ["characterName", "knowledgeEntry"]
            }
        };

        return [searchTool, patchTool, saveKnowledgeTool];
    }

    /**
     * AI의 Tool 호출을 받아 적절한 RAG/상태 함수를 실행
     */
    async executeTool(name, args) {
        console.log(`[LoreRAGManager] AI Tool 호출 수신: ${name}`, args);

        if (name === 'searchLorebookRAG') {
            return await this.searchLorebookRAG(args || {});
        } else if (name === 'patchLorebookEntry' || name === 'patchCharacterState') {
            return await this.patchLorebookEntry(args || {});
        } else if (name === 'saveCharacterKnowledge') {
            return await this.saveCharacterKnowledge(args || {});
        }

        return { error: `알 수 없는 도구: ${name}` };
    }
}

// 전역 인스턴스 등록
window.LoreRAGManager = LoreRAGManager;
window.ragEngine = new LoreRAGManager();
