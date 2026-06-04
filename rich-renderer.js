(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderMath(formula, displayMode) {
    if (!window.katex) return `<code>${escapeHtml(formula || "")}</code>`;
    try {
      return window.katex.renderToString(String(formula || "").trim(), {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        output: "html"
      });
    } catch {
      return `<code>${escapeHtml(formula || "")}</code>`;
    }
  }

  function renderRichText(text) {
    if (!window.marked || !window.DOMPurify) return escapeHtml(text || "");

    const mathBlocks = [];
    const mathInlines = [];
    const source = String(text || "")
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, formula) => {
        const token = `@@MATH_BLOCK_${mathBlocks.length}@@`;
        mathBlocks.push(formula);
        return `\n\n${token}\n\n`;
      })
      .replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula) => {
        const token = `@@MATH_BLOCK_${mathBlocks.length}@@`;
        mathBlocks.push(formula);
        return `\n\n${token}\n\n`;
      })
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, formula) => {
        const token = `@@MATH_INLINE_${mathInlines.length}@@`;
        mathInlines.push(formula);
        return token;
      })
      .replace(/(^|[^$])\$([^$\n]+?)\$/g, (_match, prefix, formula) => {
        const token = `@@MATH_INLINE_${mathInlines.length}@@`;
        mathInlines.push(formula);
        return `${prefix}${token}`;
      });

    window.marked.setOptions({
      breaks: true,
      gfm: true,
      highlight(code, language) {
        if (!window.hljs) return escapeHtml(code);
        if (language && window.hljs.getLanguage(language)) {
          return window.hljs.highlight(code, { language }).value;
        }
        return window.hljs.highlightAuto(code).value;
      }
    });

    let html = window.marked.parse(source);
    html = html.replace(/@@MATH_BLOCK_(\d+)@@/g, (_match, index) => renderMath(mathBlocks[Number(index)], true));
    html = html.replace(/@@MATH_INLINE_(\d+)@@/g, (_match, index) => renderMath(mathInlines[Number(index)], false));

    return window.DOMPurify.sanitize(html, {
      ADD_TAGS: ["math", "semantics", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "annotation"],
      ADD_ATTR: ["class", "style", "aria-hidden", "focusable", "xmlns", "encoding"]
    });
  }

  function enhanceRichContent(root) {
    if (!root || !window.hljs) return;
    root.querySelectorAll("pre code").forEach((block) => {
      window.hljs.highlightElement(block);
    });
  }

  window.DeskchatRichRenderer = {
    escapeHtml,
    renderRichText,
    enhanceRichContent
  };
})();
