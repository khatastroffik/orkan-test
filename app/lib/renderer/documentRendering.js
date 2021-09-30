const hljs = require("highlight.js")

const markdown = require("markdown-it")({
    highlight: (text, language) => {
        // Originated from VS Code
        // File extensions/markdown-language-features/src/markdownEngine.ts
        // Commit ID: 3fbfccad359e278a4fbde106328b2b8e2e2242a7
        if (language && hljs.getLanguage(language)) {
            try {
                return generateCodeText(
                    hljs.highlight(text, {
                        language: language,
                        ignoreIllegals: true,
                    }).value,
                    { isHighlighted: true }
                )
            } catch (err) {
                console.error(`Error at highlighting: ${err}`)
            }
        }
        return generateCodeText(markdown.utils.escapeHtml(text), { isHighlighted: true })
    },
    xhtmlOut: true,
    html: true,
    linkify: true,
    typographer: true,
})

markdown
    .use(require("markdown-it-headinganchor"), {
        slugify: text =>
            text
                .replace(/\[|\]|<.*>|\(.*\)|\.|`|\{|\}/g, "")
                .trim()
                .replace(/\s/g, "-")
                .toLowerCase(),
    })
    .use(require("markdown-it-multimd-table"), {
        headerless: true,
        multiline: true,
    })
    .use(require("markdown-it-abbr"))
    .use(require("markdown-it-container"), "error")
    .use(require("markdown-it-container"), "info")
    .use(require("markdown-it-container"), "warning")
    .use(require("markdown-it-emoji"))
    .use(require("markdown-it-footnote"))
    .use(require("markdown-it-mark"))
    .use(require("markdown-it-new-katex"))
    .use(require("markdown-it-sub"))
    .use(require("markdown-it-sup"))

function generateCodeText(text, options = {}) {
    const defaults = {
        isHighlighted: false,
        isMdRawText: false,
    }
    const actual = Object.assign({}, defaults, options)

    const hljsClass = actual.isHighlighted ? "hljs" : ""
    const mdRawClass = actual.isMdRawText ? "md-raw" : ""

    const preClass =
        actual.isHighlighted || actual.isMdRawText
            ? `class="${[hljsClass, mdRawClass].join(" ").trim()}"`
            : ""
    return `<pre ${preClass}><code>${text}</code></pre>`
}

exports.renderContent = content => markdown.render(content)

exports.renderRawText = content =>
    generateCodeText(markdown.utils.escapeHtml(content), { isMdRawText: true })
