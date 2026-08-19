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

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });

        const data = await res.json();
        if (data.error) {
            throw new Error(`[Gemini API 오류] ${data.error.message || JSON.stringify(data.error)}`);
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reply) throw new Error('Gemini로부터 유효한 응답 텍스트를 수신하지 못했습니다.');
        return reply.trim();
    }

    /**
     * OpenAI / DeepSeek API 호출 (Chat Completions)
     */
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
}

if (typeof window !== 'undefined') {
    window.aiApi = new AiApiManager();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AiApiManager;
}
