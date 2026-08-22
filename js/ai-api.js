/**
 * ai-api.js
 * POV_writer 통합 전역 AI API 클라이언트 엔진 (Universal LLM Dispatcher)
 * Google Gemini, OpenAI, Anthropic Claude, Ollama, DeepSeek 등 모든 플랫폼을 일괄 지원합니다.
 */

class AiApiManager {
    constructor() {
        this.defaultTimeout = 60000;
    }

    /**
     * 통합 AI 호출 함수
     * @param {Object} config - { provider, model, apiKey, temperature, endpoint }
     * @param {string} systemPrompt - AI에게 주입할 시스템 지침/페르소나
     * @param {string} userPrompt - 이번 턴에 요청할 프롬프트
     * @param {Array<{role: string, content: string}>} [history=[]] - 이전 대화 기록
     * @returns {Promise<string>} 생성된 텍스트 응답
     */
    async call(config = {}, systemPrompt = '', userPrompt = '', history = []) {
        const provider = String(config.provider || 'Google (Gemini)').toLowerCase();
        const model = String(config.model || 'gemini-3.6-flash').trim();
        const apiKey = String(config.rawApiKey || config.apiKey || '').trim();
        const temperature = (config.temperature !== undefined && !isNaN(config.temperature)) 
            ? Number(config.temperature) 
            : 0.7;
        const endpoint = String(config.endpoint || '').trim();

        // 1. Google Gemini
        if (provider.includes('google') || provider.includes('gemini') || model.startsWith('gemini')) {
            return await this._callGemini({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, history);
        }

        // 2. Anthropic Claude
        if (provider.includes('anthropic') || provider.includes('claude') || model.startsWith('claude')) {
            return await this._callClaude({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, history);
        }

        // 3. Ollama (로컬 AI)
        if (provider.includes('ollama') || provider.includes('local') || model.includes('llama') || model.includes('qwen') || model.includes('mistral')) {
            return await this._callOllama({ model, temperature, endpoint: endpoint || 'http://localhost:11434/v1/chat/completions' }, systemPrompt, userPrompt, history);
        }

        // 4. OpenAI / DeepSeek / Custom (OpenAI 호환)
        return await this._callOpenAI({ model, apiKey, temperature, endpoint: endpoint || 'https://api.openai.com/v1/chat/completions' }, systemPrompt, userPrompt, history);
    }

    /**
     * Google Gemini API 호출
     */
    async _callGemini({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, history) {
        if (!apiKey || apiKey === '(API Key 미설정)') {
            throw new Error('Google Gemini API Key가 설정되지 않았습니다. [AI 설정 노드]에 API Key를 입력해 주세요.');
        }

        const targetModel = model || 'gemini-3.6-flash';
        const url = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

        const contents = [];
        if (Array.isArray(history) && history.length > 0) {
            history.forEach(msg => {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content || '' }]
                });
            });
        }
        if (userPrompt) {
            contents.push({
                role: 'user',
                parts: [{ text: userPrompt }]
            });
        }

        const bodyPayload = {
            contents: contents,
            generationConfig: {
                temperature: Math.max(0, Math.min(2.0, temperature))
            }
        };

        if (systemPrompt) {
            bodyPayload.system_instruction = {
                parts: [{ text: systemPrompt }]
            };
        }

        const data = await this._fetchGeminiRobust(targetModel, apiKey, bodyPayload, endpoint);

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reply) throw new Error('Gemini로부터 유효한 응답 텍스트를 수신하지 못했습니다.');
        return reply.trim();
    }

    /**
     * OpenAI / DeepSeek API 호출 (Chat Completions)
     */
    /**
     * Google Gemini 통신 공통 헬퍼 (지정 모델 호출 및 High Demand 503 재시도)
     */
    async _fetchGeminiRobust(model, apiKey, bodyPayload, endpoint) {
        const targetModel = model || 'gemini-3.6-flash';
        const url = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

        let lastError = null;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyPayload)
                });

                const data = await res.json();
                if (!data.error) {
                    return data;
                }

                const errMsg = (data.error.message || JSON.stringify(data.error)).toLowerCase();
                const isHighDemand = errMsg.includes('high demand') || errMsg.includes('resource_exhausted') || errMsg.includes('quota') || data.error.code === 503 || data.error.code === 429;

                lastError = new Error(`[Gemini API 오류] ${data.error.message || JSON.stringify(data.error)}`);

                if (isHighDemand && attempt < 2) {
                    // 일시적 서버 과부하 시 잠시 대기 후 동일 모델 재시도
                    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
                    continue;
                }

                // 그 외 오류는 즉시 throw
                throw lastError;

            } catch (fetchErr) {
                lastError = fetchErr;
                if (attempt < 2) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        throw lastError || new Error(`[Gemini API 오류] ${targetModel} 모델 서버와 통신할 수 없습니다.`);
    }

    async _callOpenAI({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, history) {
        if (!apiKey || apiKey === '(API Key 미설정)') {
            throw new Error('OpenAI API Key가 설정되지 않았습니다. [AI 설정 노드]에 API Key를 입력해 주세요.');
        }

        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        if (Array.isArray(history) && history.length > 0) {
            history.forEach(msg => {
                messages.push({ role: msg.role || 'user', content: msg.content || '' });
            });
        }
        if (userPrompt) {
            messages.push({ role: 'user', content: userPrompt });
        }

        const res = await fetch(endpoint || 'https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'gpt-4o-mini',
                temperature: Math.max(0, Math.min(2.0, temperature)),
                messages: messages
            })
        });

        const data = await res.json();
        if (data.error) {
            throw new Error(`[OpenAI API 오류] ${data.error.message || JSON.stringify(data.error)}`);
        }

        const reply = data.choices?.[0]?.message?.content;
        if (!reply) throw new Error('OpenAI로부터 유효한 응답 텍스트를 수신하지 못했습니다.');
        return reply.trim();
    }

    /**
     * Anthropic Claude API 호출
     */
    async _callClaude({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, history) {
        if (!apiKey || apiKey === '(API Key 미설정)') {
            throw new Error('Anthropic Claude API Key가 설정되지 않았습니다. [AI 설정 노드]에 API Key를 입력해 주세요.');
        }

        const messages = [];
        if (Array.isArray(history) && history.length > 0) {
            history.forEach(msg => {
                messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content || '' });
            });
        }
        if (userPrompt) {
            messages.push({ role: 'user', content: userPrompt });
        }

        const payload = {
            model: model || 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            temperature: Math.max(0, Math.min(1.0, temperature)),
            messages: messages
        };
        if (systemPrompt) {
            payload.system = systemPrompt;
        }

        const res = await fetch(endpoint || 'https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'dangerously-allow-browser': 'true'
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.error) {
            throw new Error(`[Claude API 오류] ${data.error.message || JSON.stringify(data.error)}`);
        }

        const reply = data.content?.[0]?.text;
        if (!reply) throw new Error('Claude로부터 유효한 응답 텍스트를 수신하지 못했습니다.');
        return reply.trim();
    }

    /**
     * Ollama (로컬 LLM) API 호출
     */
    async _callOllama({ model, temperature, endpoint }, systemPrompt, userPrompt, history) {
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        if (Array.isArray(history)) {
            history.forEach(msg => messages.push({ role: msg.role || 'user', content: msg.content || '' }));
        }
        if (userPrompt) messages.push({ role: 'user', content: userPrompt });

        const url = endpoint || 'http://localhost:11434/v1/chat/completions';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model || 'llama3',
                temperature: temperature,
                messages: messages
            })
        });

        const data = await res.json();
        if (data.error) throw new Error(`[Ollama 오류] ${data.error.message || data.error}`);
        return (data.choices?.[0]?.message?.content || data.response || '').trim();
    }

    /**
     * RAG 및 소설 상태 관리를 위한 Multi-turn Function Calling 실행 루프
     * @param {Object} config - { provider, model, apiKey, temperature, endpoint }
     * @param {string} systemPrompt - AI 시스템 지침
     * @param {string} userPrompt - 사용자 요청
     * @param {Array<Object>} tools - 사용 가능한 Tools 스키마 목록
     * @param {Function} toolExecutor - 도구 실행 콜백: async (name, args) => Object
     * @param {number} maxTurns - 최대 툴 호출 루프 횟수 (기본 5)
     * @returns {Promise<{ finalText: string, ragLogsMarkdown: string, stateChangesReport: string, toolCallsLog: Array }>}
     */
    async callWithTools(config = {}, systemPrompt = '', userPrompt = '', tools = [], toolExecutor = null, maxTurns = 5) {
        const provider = String(config.provider || 'Google (Gemini)').toLowerCase();
        const model = String(config.model || 'gemini-3.6-flash').trim();
        const apiKey = String(config.rawApiKey || config.apiKey || '').trim();
        const temperature = (config.temperature !== undefined && !isNaN(config.temperature)) ? Number(config.temperature) : 0.7;
        const endpoint = String(config.endpoint || '').trim();

        const toolCallsLog = [];
        const ragResults = [];
        const stateChanges = [];

        // 1. Google Gemini Multi-turn Tool Loop
        if (provider.includes('google') || provider.includes('gemini') || model.startsWith('gemini')) {
            return await this._callGeminiWithTools(
                { model, apiKey, temperature, endpoint },
                systemPrompt,
                userPrompt,
                tools,
                toolExecutor,
                maxTurns,
                toolCallsLog,
                ragResults,
                stateChanges
            );
        }

        // 2. OpenAI / DeepSeek / Ollama Tool Loop
        return await this._callOpenAIWithTools(
            { model, apiKey, temperature, endpoint: endpoint || 'https://api.openai.com/v1/chat/completions' },
            systemPrompt,
            userPrompt,
            tools,
            toolExecutor,
            maxTurns,
            toolCallsLog,
            ragResults,
            stateChanges
        );
    }

    /**
     * Gemini Function Calling 2단계 실행 루프
     */
    async _callGeminiWithTools({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, tools, toolExecutor, maxTurns, toolCallsLog, ragResults, stateChanges) {
        if (!apiKey || apiKey === '(API Key 미설정)') {
            throw new Error('Google Gemini API Key가 설정되지 않았습니다. [AI 설정 노드]에 API Key를 입력해 주세요.');
        }

        const targetModel = model || 'gemini-3.6-flash';
        const url = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

        // Gemini Function Declarations 포맷 변환
        const functionDeclarations = (tools || []).map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }));

        const contents = [
            {
                role: 'user',
                parts: [{ text: userPrompt }]
            }
        ];

        let turn = 0;
        let finalText = '';

        while (turn < maxTurns) {
            turn++;
            const bodyPayload = {
                contents: contents,
                generationConfig: {
                    temperature: Math.max(0, Math.min(2.0, temperature))
                },
                tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined
            };

            if (systemPrompt) {
                bodyPayload.system_instruction = { parts: [{ text: systemPrompt }] };
            }

            const data = await this._fetchGeminiRobust(targetModel, apiKey, bodyPayload, endpoint);

            const candidate = data.candidates?.[0];
            const parts = candidate?.content?.parts || [];

            const functionCallParts = parts.filter(p => p.functionCall);
            const textParts = parts.filter(p => p.text).map(p => p.text);

            if (textParts.length > 0) {
                finalText = textParts.join('\n').trim();
            }

            // AI가 Tool 호출을 요청한 경우 실행 및 피드백 전송
            if (functionCallParts.length > 0 && toolExecutor) {
                // 🌟 중요: Gemini는 candidate.content 원본 객체(thought_signature, parts 전체)를 그대로 보존해야 합니다.
                contents.push(candidate.content || {
                    role: 'model',
                    parts: parts
                });

                const responseParts = [];
                for (const fcp of functionCallParts) {
                    const callName = fcp.functionCall.name;
                    const callArgs = fcp.functionCall.args || {};
                    toolCallsLog.push({ turn, name: callName, args: callArgs });

                    // 도구 실행
                    const execResult = await toolExecutor(callName, callArgs);

                    if (callName === 'searchLorebookRAG' && execResult?.results) {
                        ragResults.push(...execResult.results);
                    } else if (callName === 'patchLorebookEntry' || callName === 'patchCharacterState' || callName === 'saveCharacterKnowledge') {
                        stateChanges.push({ tool: callName, args: callArgs, result: execResult });
                    }

                    responseParts.push({
                        functionResponse: {
                            name: callName,
                            response: { output: execResult }
                        }
                    });
                }

                // 사용자의 functionResponse 메시지 추가
                contents.push({
                    role: 'user',
                    parts: responseParts
                });

                // 루프 계속 진행 (AI가 검색 결과를 읽고 답변 작성)
                continue;
            }

            // 더 이상 툴 호출이 없으면 종료
            break;
        }

        // 마크다운 보고서 생성
        const ragLogsMarkdown = this._formatRagLogsMarkdown(ragResults);
        const stateChangesReport = this._formatStateChangesReport(stateChanges);

        return {
            finalText: finalText || '(작성된 본문 내용이 없습니다.)',
            ragLogsMarkdown,
            stateChangesReport,
            toolCallsLog
        };
    }

    /**
     * OpenAI Function Calling 실행 루프
     */
    async _callOpenAIWithTools({ model, apiKey, temperature, endpoint }, systemPrompt, userPrompt, tools, toolExecutor, maxTurns, toolCallsLog, ragResults, stateChanges) {
        if (!apiKey || apiKey === '(API Key 미설정)') {
            throw new Error('OpenAI API Key가 설정되지 않았습니다. [AI 설정 노드]에 API Key를 입력해 주세요.');
        }

        const openAiTools = (tools || []).map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }
        }));

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        let turn = 0;
        let finalText = '';

        while (turn < maxTurns) {
            turn++;
            const payload = {
                model: model || 'gpt-4o-mini',
                temperature: Math.max(0, Math.min(2.0, temperature)),
                messages: messages,
                tools: openAiTools.length > 0 ? openAiTools : undefined
            };

            const res = await fetch(endpoint || 'https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.error) throw new Error(`[OpenAI Tool 오류] ${data.error.message || JSON.stringify(data.error)}`);

            const choice = data.choices?.[0];
            const msg = choice?.message;
            if (!msg) break;

            if (msg.content) {
                finalText = msg.content.trim();
            }

            // Tool Calls 감지
            if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 && toolExecutor) {
                messages.push(msg); // assistant tool_calls 메시지 추가

                for (const tc of msg.tool_calls) {
                    const callName = tc.function.name;
                    let callArgs = {};
                    try { callArgs = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}

                    toolCallsLog.push({ turn, name: callName, args: callArgs });
                    const execResult = await toolExecutor(callName, callArgs);

                    if (callName === 'searchLorebookRAG' && execResult?.results) {
                        ragResults.push(...execResult.results);
                    } else {
                        stateChanges.push({ tool: callName, args: callArgs, result: execResult });
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: JSON.stringify(execResult)
                    });
                }
                continue;
            }

            break;
        }

        const ragLogsMarkdown = this._formatRagLogsMarkdown(ragResults);
        const stateChangesReport = this._formatStateChangesReport(stateChanges);

        return {
            finalText: finalText || '(작성된 본문 내용이 없습니다.)',
            ragLogsMarkdown,
            stateChangesReport,
            toolCallsLog
        };
    }

    _formatRagLogsMarkdown(ragResults) {
        if (!ragResults || ragResults.length === 0) {
            return '🧠 [RAG 검색 내역]: 이번 실행에서는 RAG 검색이 호출되지 않았습니다.';
        }

        const unique = [];
        const seen = new Set();
        ragResults.forEach(r => {
            if (r.title && !seen.has(r.title)) {
                seen.add(r.title);
                unique.push(r);
            }
        });

        return [
            '### 🧠 이번 씬에서 실시간 인출된 RAG 로어 지식',
            ...unique.map((r, i) => `**${i + 1}. ${r.title}** (연관도 ${Math.round((r.score || 0) * 100)}%)\n> ${r.content}`)
        ].join('\n\n');
    }

    _formatStateChangesReport(stateChanges) {
        if (!stateChanges || stateChanges.length === 0) {
            return '🧬 [상태 변동 내역]: 이번 실행에서 변경된 인물 및 로어 상태가 없습니다.';
        }

        return [
            '### 🧬 소설 로어 및 인물 상태 변동 보고서',
            ...stateChanges.map(ch => {
                const a = ch.args;
                if (ch.tool === 'saveCharacterKnowledge') {
                    return `• **[지식 습득]** [${a.characterName}] ${a.knowledgeEntry?.type === 'KEYWORD' ? '🏷️ 고유명사' : '📜 진실'}: "${a.knowledgeEntry?.content}"`;
                }
                return `• **[로어 갱신]** [${a.targetName || a.characterName}] (${a.category}) ${a.action} -> "${a.content}"`;
            })
        ].join('\n');
    }
}

if (typeof window !== 'undefined') {
    window.aiApi = new AiApiManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AiApiManager;
}
