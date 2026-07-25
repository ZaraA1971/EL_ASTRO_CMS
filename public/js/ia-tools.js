const IATools = window.IATools || {};
window.IATools = IATools;

IATools.toggleSpinner = function(show, spinnerElement) {
    if (!spinnerElement) return;
    spinnerElement.classList.toggle('hidden', !show);
    spinnerElement.classList.toggle('visible', show);
};

IATools.cleanAIHTML = function(html) {
    if (typeof DOMPurify === 'undefined' || !DOMPurify || !DOMPurify.sanitize) {
        return String(html || '');
    }
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p','ul','ol','li','strong','em','br','a','blockquote','code','pre','h3','h4'],
        ALLOWED_ATTR: { 'a': ['href','title','target','rel'] }
    });
};

window.toggleSpinner = IATools.toggleSpinner;

const LS_KEY = "el_compagnon_last_session";

IATools.findDrawerElement = function(sel) {
    const iaDrawer = document.getElementById('ia-drawer');
    return iaDrawer ? iaDrawer.querySelector(sel) : null;
};

IATools.restoreFromLocalStorage = function() {
    try {
        const saved = JSON.parse(localStorage.getItem(LS_KEY));
        if (!saved) return;

        const q = IATools.findDrawerElement("#question");
        if (q && saved.question) q.value = saved.question;

        const drawerContent = IATools.findDrawerElement("#ia-drawer-content");

        if (drawerContent && saved.answerHTML) {
            let ansBox = drawerContent.querySelector("#final-answer");
            if (!ansBox) {
                ansBox = document.createElement("div");
                ansBox.id = "final-answer";
                ansBox.classList.add("final-answer");
                drawerContent.appendChild(ansBox);
            }
            ansBox.innerHTML = saved.answerHTML;
            if (!ansBox.innerHTML.trim().startsWith("<")) {
                ansBox.innerHTML = `<p>${ansBox.innerHTML}</p>`;
            }
            ansBox.classList.add("final-answer");
        }

        if (drawerContent && saved.sourcesHTML) {
            const existing = drawerContent.querySelector(".rag-sources");
            if (existing) existing.remove();
            const temp = document.createElement("div");
            temp.innerHTML = saved.sourcesHTML;
            const sourcesEl = temp.firstElementChild;
            if (sourcesEl) {
                const finalBox = drawerContent.querySelector("#final-answer");
                if (finalBox && finalBox.parentNode) {
                    finalBox.parentNode.insertBefore(sourcesEl, finalBox.nextSibling);
                } else {
                    drawerContent.appendChild(sourcesEl);
                }
            }
        }
    } catch (e) {
        console.warn("LS restore error", e);
    }
};

IATools.persistToLocalStorage = function() {
    const question = (IATools.findDrawerElement("#question")?.value || "").trim();
    const answerHTML = IATools.findDrawerElement("#final-answer")?.innerHTML || "";
    const sourcesEl = IATools.findDrawerElement(".rag-sources");
    const sourcesHTML = sourcesEl ? sourcesEl.outerHTML : "";
    localStorage.setItem(LS_KEY, JSON.stringify({ question, answerHTML, sourcesHTML }));
};

IATools.getShareableAIResult = function() {
    let question = "";
    let answer = "";
    let sourcesText = "";

    const q = IATools.findDrawerElement("#question");
    if (q && q.value.trim() !== "") {
        question = q.value.trim();
    }

    const ans = document.querySelector('#final-answer');
    const stream = document.querySelector('#gpt-stream');
    if (ans && ans.innerText.trim()) {
        answer = ans.innerText.trim();
    } else if (stream && stream.innerText.trim()) {
        answer = stream.innerText.trim();
    }

    const sources = document.querySelectorAll('#ia-drawer-content .rag-sources li');
    if (sources.length > 0) {
        const list = [];
        sources.forEach((li) => {
            const link = li.querySelector("a");
            if (link) {
                list.push(`– ${link.textContent.trim()} — ${link.getAttribute("href")}`);
            } else {
                list.push(`– ${li.textContent.trim()}`);
            }
        });
        sourcesText = list.join("\n");
    }

    let result = "";
    if (question) result += "Question :\n" + question + "\n\n";
    if (answer) result += "Réponse EL Compagnon :\n" + answer + "\n\n";
    if (sourcesText) result += "Sources :\n" + sourcesText + "\n";
    return result.trim();
};

IATools.getFinalAnswerText = function() {
    return IATools.getShareableAIResult();
};

document.addEventListener('click', (e) => {
    if (e.target.matches("#reset-question")) {
        const input = IATools.findDrawerElement("#question");
        if (input) {
            input.value = "";
            input.focus();
        }
        localStorage.removeItem(LS_KEY);
        return;
    }

    const actionBtn = e.target.closest('[data-ia-action]');
    if (!actionBtn) return;

    const action = actionBtn.dataset.iaAction;
    const text = IATools.getFinalAnswerText();
    if (!text) return;

    if (action === "copy") {
        navigator.clipboard.writeText(text);
    }
    if (action === "email") {
        window.open(
            `mailto:?subject=Réponse EL Compagnon&body=${encodeURIComponent(text)}`,
            "_blank"
        );
    }
    if (action === "share-x") {
        window.open(
            `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
            "_blank"
        );
    }

    IATools.persistToLocalStorage();
});

document.addEventListener("ai-answer-updated", () => {
    IATools.persistToLocalStorage();
});

window.IATools = IATools;
