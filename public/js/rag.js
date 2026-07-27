const RAG = {};

function elRagOrderSourcesByIndex(sources) {
    if (!Array.isArray(sources)) return [];
    const hasIndex = sources.some((s) => s && s.index != null && s.index !== '');
    if (hasIndex) {
        return [...sources].sort(
            (a, b) => Number(a.index || 0) - Number(b.index || 0)
        );
    }
    return [...sources];
}

function elRagRenderSourcesList(sources) {
    const ordered = elRagOrderSourcesByIndex(sources);
    return ordered.map((src, i) => {
        const n = Number(src && src.index) || (i + 1);
        const title = elRagEscapeHtml((src && src.title) || '');
        const url = (src && src.url) || '#';
        return (
            `<li>` +
            `<span class="rag-source-idx">${n}</span> ` +
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>` +
            `</li>`
        );
    }).join('');
}

function elRagEscapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Convertit [n](url), [n] nu, et exposants legacy en liens <sup><a class="rag-cite">.
 */
function elRagRenderAnswerHtml(text, sources) {
    const raw = String(text || '');
    const byIndex = {};
    const byUrl = {};
    if (Array.isArray(sources)) {
        sources.forEach((s, i) => {
            const idx = Number(s && s.index) || (i + 1);
            byIndex[idx] = s;
            const u = s && s.url ? String(s.url).trim() : '';
            if (u) byUrl[u] = s;
        });
    }

    const SUP_TO_DIGIT = {
        '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
        '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    };

    function citeAnchor(label, url, title) {
        const titleAttr = elRagEscapeHtml(title || label || url);
        const display = elRagEscapeHtml(label);
        return (
            `<sup class="rag-cite-sup">` +
            `<a class="rag-cite" href="${url}" target="_blank" ` +
            `rel="noopener noreferrer" title="${titleAttr}">${display}</a>` +
            `</sup>`
        );
    }

    function citeFromIndex(n) {
        const src = byIndex[n];
        if (!src || !src.url) return null;
        return citeAnchor(String(n), String(src.url).trim(), src.title || String(n));
    }

    let escaped = elRagEscapeHtml(raw);

    // Markdown [n](url) ou [label](url) — un lien = une citation (pas de fusion)
    escaped = escaped.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_, label, url) => {
            const src = byUrl[url];
            const n = parseInt(label, 10);
            const display = Number.isFinite(n) && String(n) === String(label).trim()
                ? String(n)
                : label;
            return citeAnchor(display, url, (src && src.title) || label);
        }
    );

    // Marqueurs [n] non expansés (ex. URL manquante côté stream)
    escaped = escaped.replace(/\[(\d+)\](?!\()/g, (full, nStr) => {
        const html = citeFromIndex(parseInt(nStr, 10));
        return html || full;
    });

    // Legacy exposants : chaque chiffre séparément (évite ²³⁴ → 234)
    escaped = escaped.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => {
        const n = parseInt(SUP_TO_DIGIT[ch] || '', 10);
        if (!n) return ch;
        return citeFromIndex(n) || ch;
    });

    return escaped.replace(/\n/g, '<br>');
}

function elRagPaintAnswer(el, text, sources) {
    if (!el) return;
    el.innerHTML = elRagRenderAnswerHtml(text, sources);
}

// ---- RAG Events (clean SSE event log) ----
RAG.Events = {
    ensureEventDiv() {
        return null;
    },

    push(eventName, data) {
        let label = "";

        if (eventName === 'status') {
            const fromServer = (data && typeof data.message === 'string') ? data.message.trim() : '';
            if (fromServer) {
                label = fromServer;
            } else if (data && data.step === 'analysis') {
                label = 'Analyse en cours…';
            } else if (data && data.step === 'keywords') {
                label = 'Structuration de la réponse…';
            } else if (data && data.step === 'retrieval') {
                label = 'Interrogation des sources…';
            } else if (data && data.step === 'rerank') {
                label = 'Sélection des sources…';
            } else if (data && data.step === 'writing') {
                label = 'Rédaction en cours…';
            } else {
                label = 'Analyse en cours…';
            }
        } else if (eventName === 'keywords') {
            label = 'Structuration de la réponse…';
        } else {
            return;
        }

        if (!label) return;

        RAG.Stream.showIntermediate(label);
    }
};
// ==============================
//  RAG Frontend – Streaming GPT
//  Refactored, robust SSE client
// ==============================

// ---- DOM Manager (panneau home #el-compagnon) ----
RAG.DOM = {
    getContainerBox() {
        return document.getElementById('el-compagnon');
    },

    getResponseContainer() {
        return document.getElementById('el-compagnon-content');
    },

    clearRAG() {},

    showBox() {
        if (window.ELCompagnon && typeof window.ELCompagnon.open === 'function') {
            window.ELCompagnon.open();
            return;
        }
        const box = this.getContainerBox();
        if (box) {
            box.classList.add('is-open');
            box.setAttribute('data-open', 'true');
            const content = this.getResponseContainer();
            if (content) {
                content.hidden = false;
                content.setAttribute('aria-hidden', 'false');
            }
            if (typeof box.scrollIntoView === 'function') {
                box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    },

    openDrawer() {
        this.showBox();
    },

    hideBox() {
        if (window.ELCompagnon && typeof window.ELCompagnon.close === 'function') {
            window.ELCompagnon.close();
        }
    },

    ensureStreamDiv() {
        const container = this.getResponseContainer();
        if (!container) return null;

        let stream = document.getElementById('gpt-stream');
        if (!stream) {
            stream = document.createElement('div');
            stream.id = 'gpt-stream';
            stream.className = 'rag-stream-text gpt-streaming streaming';
            container.appendChild(stream);
        }
        return stream;
    },

    clearStream() {
        const stream = document.getElementById('gpt-stream');
        if (stream) {
            stream.innerHTML = '';
            stream.classList.remove('streaming', 'rag-thinking');
            delete stream.dataset.mode;
        }
    },

    clearSources() {
        const container = this.getResponseContainer();
        if (!container) return;
        const sourcesBlocks = container.querySelectorAll('.rag-sources');
        sourcesBlocks.forEach(el => el.remove());
    },

    showTools() {
        const tools = document.getElementById("ia-tools-actions");
        if (tools) {
            tools.classList.remove("hidden");
        }
    },

    resetAll() {
        this.clearStream();
        this.clearSources();
        if (RAG.Stream) {
            RAG.Stream.currentAnswer = "";
        }
        const tools = document.getElementById("ia-tools-actions");
        if (tools) tools.classList.add("hidden");
    },
};

// ---- SSE Parser ----
RAG.Parser = {
    buffer: '',
    currentEvent: null,
    currentData: '',

    reset() {
        this.buffer = '';
        this.currentEvent = null;
        this.currentData = '';
    },

    flushCurrentFrame(onFrame) {
        const event = this.currentEvent;
        const dataStr = this.currentData;
        this.currentEvent = null;
        this.currentData = '';

        if (!event || !dataStr) return;

        let parsed = null;
        try {
            parsed = JSON.parse(dataStr);
        } catch (e) {
            console.warn('⚠️ Impossible de parser le JSON SSE :', dataStr);
        }

        onFrame({ event, data: parsed });
    },

    processChunk(rawChunk, onFrame) {
        this.buffer += rawChunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('event:')) {
                // Si un frame était en cours, on le flush avant de commencer le suivant
                if (this.currentEvent && this.currentData) {
                    this.flushCurrentFrame(onFrame);
                }
                this.currentEvent = line.replace('event:', '').trim();
                this.currentData = '';
                continue;
            }

            if (line.startsWith('data:')) {
                const part = line.slice('data:'.length);

                // Respect SSE spec: multiple data lines must be joined with \n
                if (this.currentData) {
                    this.currentData += '\n';
                }

                this.currentData += part;
                continue;
            }

            if (line.trim() === '') {
                // Fin d'un frame SSE classique
                if (this.currentEvent && this.currentData) {
                    this.flushCurrentFrame(onFrame);
                }
            }
        }
    },
    finish(onFrame) {
        // Flush any trailing decoder/parser data at end of stream
        if (this.buffer) {
            const trailing = this.buffer;
            this.buffer = '';
            this.processChunk(trailing + '\n', onFrame);
        }

        if (this.currentEvent && this.currentData) {
            this.flushCurrentFrame(onFrame);
        }
    }
};

// ---- Streaming Renderer ----
RAG.Stream = {
    currentAnswer: "",
    currentSources: [],

    showIntermediate(content) {
        if (!content) return;
        RAG.DOM.showBox();
        const stream = RAG.DOM.ensureStreamDiv();
        if (!stream) return;

        stream.dataset.mode = 'intermediate';

        let line = stream.querySelector('.rag-step');
        if (!line) {
            stream.innerHTML = `<div class="rag-step rag-thinking"></div>`;
            line = stream.querySelector('.rag-step');
        }

        line.textContent = content;
        line.style.whiteSpace = 'pre-line';
    },

    appendChunk(chunkText) {
        if (chunkText === undefined || chunkText === null) return;

        RAG.DOM.showBox();
        const stream = RAG.DOM.ensureStreamDiv();
        if (!stream) return;

        stream.classList.add('streaming');

        if (stream.dataset.mode === 'intermediate') {
            stream.innerHTML = '';
            stream.dataset.mode = 'gpt';
            stream.classList.remove('rag-thinking');
        }

        this.currentAnswer += chunkText;
        elRagPaintAnswer(stream, this.currentAnswer, this.currentSources);
    },

    paint(sources) {
        if (Array.isArray(sources)) {
            this.currentSources = sources;
        }
        const stream = document.getElementById('gpt-stream');
        if (stream && this.currentAnswer) {
            elRagPaintAnswer(stream, this.currentAnswer, this.currentSources);
        }
    }
};

// ---- Final Renderer ----
RAG.Final = {
    showFinal(payload) {
        if (!payload) return;
        const sources = elRagOrderSourcesByIndex(payload.sources || []);

        RAG.DOM.showBox();
        RAG.DOM.clearSources();

        const container = RAG.DOM.getResponseContainer();
        if (!container) return;

        const stream = document.getElementById('gpt-stream');
        if (stream) stream.classList.remove('streaming');

        RAG.Stream.paint(sources);
        RAG.DOM.showTools();

        try {
            localStorage.setItem("rag_answer", JSON.stringify({
                answer: RAG.Stream.currentAnswer,
                sources: sources
            }));
        } catch (e) {
            console.warn("⚠️ Failed to persist RAG answer", e);
        }

        if (Array.isArray(sources) && sources.length > 0) {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.className = 'rag-sources';
            sourcesDiv.innerHTML =
                '<br><strong>Sources :</strong><ul>' +
                elRagRenderSourcesList(sources) +
                '</ul>';
            if (stream && stream.parentNode) {
                stream.parentNode.insertBefore(sourcesDiv, stream.nextSibling);
            } else {
                container.appendChild(sourcesDiv);
            }
        }
    }
};

function elRagResolveLanguage() {
    const fromVars =
        typeof electronlibreVars !== 'undefined' && electronlibreVars.currentLanguage
            ? electronlibreVars.currentLanguage
            : '';
    const raw =
        (typeof window.currentLanguage === 'string' && window.currentLanguage.trim()) ||
        (typeof window.language === 'string' && window.language.trim()) ||
        fromVars ||
        'FR';
    return String(raw).toUpperCase();
}

// ---- API Client ----
RAG.API = {
    async ask(question) {
        // S2: proxy local nginx → Node (clé API côté serveur uniquement)
        const response = await fetch('/api/rag/askWeb', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: question,
                language: elRagResolveLanguage(),
                client: 'web',
                inline_citations: true,
            })
        });

        if (response.status === 403) {
            if (typeof window.elRequirePremium === 'function') {
                window.elRequirePremium();
                return null;
            }
            const stream = RAG.DOM.ensureStreamDiv();
            if (stream) {
                stream.dataset.mode = 'gpt';
                stream.classList.remove('streaming');
                stream.innerHTML =
                    'Accès réservé aux abonnés. <a href="/login/">Connexion</a>';
            }
            return null;
        }

        if (!response.ok || !response.body) {
            console.error('❌ Réponse invalide ou vide', response.status, response.statusText);
            return null;
        }

        return response.body.getReader();
    }
};

// ---- RAG Controller ----
RAG.Controller = {
    async run(question) {
        if (window.elAuthReady && typeof window.elAuthReady.then === 'function') {
            await window.elAuthReady;
        }
        if (typeof window.elRequirePremium === 'function' && !window.elRequirePremium()) {
            return;
        }
        if (!RAG.DOM.getResponseContainer()) return;

        // Clean previous UI immediately (avoid flicker during stream)
        RAG.DOM.resetAll();
        RAG.Parser.reset();
        RAG.Stream.currentAnswer = "";
        RAG.Stream.currentSources = [];
        try {
            localStorage.removeItem("rag_answer");
        } catch (e) {
            /* ignore */
        }
        RAG.DOM.showBox();

        const reader = await RAG.API.ask(question);
        if (!reader) return;

        const decoder = new TextDecoder('utf-8');

        const handleFrame = ({ event, data }) => {
            if (!data) return;
            RAG.Events.push(event, data);

            if (event !== 'gpt_chunk' && event !== 'final') {
                RAG.DOM.showBox();

                return;
            }

            if (event === 'gpt_chunk' && typeof data.text === "string") {
                RAG.Stream.appendChunk(data.text);
            }

            if (event === 'final') {
                RAG.Final.showFinal(data);
                document.dispatchEvent(new Event("ai-answer-updated"));
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            RAG.Parser.processChunk(chunk, handleFrame);
        }

        // Flush trailing decoder and parser state to avoid losing the end of the answer
        const trailing = decoder.decode();
        if (trailing) {
            RAG.Parser.processChunk(trailing, handleFrame);
        }
        RAG.Parser.finish(handleFrame);
    }
};

// ---- API publique (compatibilité) ----
window.gpt4oCall = async function gpt4oCall(question) {
    const trimmed = (question || '').trim();
    if (!trimmed) return;
    await RAG.Controller.run(trimmed);
};

// ---- Initialisation formulaire ----
// rag.js est lazy-loadé après DOMContentLoaded (HomeTools) — init immédiat si déjà ready.

function elRagBootForm() {
    const form = document.getElementById('gpt4o-rag-form');
    const input = document.getElementById('question');

    if (!form || !input || form.dataset.ragBound === '1') return;
    form.dataset.ragBound = '1';

    // Évite un reflow inutile
    requestAnimationFrame(() => input.setAttribute('autocomplete', 'off'));

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const question = input.value.trim();
        if (question) {
            window.gpt4oCall(question);
        }
    });

    try {
        const saved = localStorage.getItem("rag_answer");
        if (saved) {
            const data = JSON.parse(saved);
            if (data.answer) {
                RAG.Stream.currentAnswer = data.answer;
                RAG.Stream.currentSources = Array.isArray(data.sources) ? data.sources : [];
                const stream = RAG.DOM.ensureStreamDiv();
                if (stream) {
                    stream.dataset.mode = 'gpt';
                    stream.classList.remove('streaming');
                    elRagPaintAnswer(stream, data.answer, RAG.Stream.currentSources);
                }
            }
            if (data.sources) {
                // Only render sources without triggering full final logic
                const container = RAG.DOM.getResponseContainer();
                if (container && Array.isArray(data.sources) && data.sources.length > 0) {
                    RAG.DOM.clearSources();
                    const sourcesDiv = document.createElement('div');
                    sourcesDiv.className = 'rag-sources';
                    sourcesDiv.innerHTML =
                        '<br><strong>Sources :</strong><ul>' +
                        elRagRenderSourcesList(data.sources) +
                        '</ul>';
                    container.appendChild(sourcesDiv);
                }
            }
        }
    } catch (e) {
        console.warn("⚠️ Failed to restore RAG answer", e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', elRagBootForm);
} else {
    elRagBootForm();
}

window.RAG = RAG;
