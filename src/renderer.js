import * as marked from 'marked'
import * as prismjs from 'prismjs'

export default class Renderer {
  constructor(login, repo) {
    this.login = login
    this.repo = repo
    this.tableOfContents = []
    this.renderer = new marked.Renderer()
    this.baseUrl = `/${login}/${repo}/`

    this.renderer.heading = (text, level, raw) => {
      raw = raw.replace(/`/g, "")
      const id = raw.toLowerCase().replace(/\s+/, "-").replace(/[^\w-]+/, "")
      if (level > 1)
        this.tableOfContents.push({ id: id, level: level, text: raw })
      return `<h${level} id="${id}">${text}</h${level}>\n`
    }

    this.renderer.image = function (src, title, alt) {
      if (!/(http|https):\/\//.test(src))
        src = new URL(src, `https://cdn.rawgit.com/${login}/${repo}/master/`).toString()
      return `<img src='${src}' alt='${alt}' title='${title}' />`
    }
  }

  render(markdown) {
    const body = marked(markdown, {
      langPrefix: 'language-',
      renderer: this.renderer,
      baseUrl: this.baseUrl,
      highlight: function (code, lang) {
        const language = !lang || lang === 'html' ? 'markup' : lang === 'yml' ? 'yaml' : lang
        if (!Prism.languages[language])
          require('prismjs/components/prism-' + language + '.js')
        return Prism.highlight(code, Prism.languages[language])
      }
    })

    const doc = Document.parse(body)

    for (const el of doc.querySelectorAll(`img[src]`)) {
      let src = el.getAttribute("src")
      console.log("SRC:", src)
      if (!/(http|https):\/\//.test(src)) {
        const newSrc = new URL(src, `https://cdn.rawgit.com/${this.login}/${this.repo}/master/`)
          .toString()
        console.log("NEW SRC:", newSrc)
        el.setAttribute("src", newSrc)
      }
    }

    return {
      tableOfContents: this.tableOfContents,
      body: doc.documentElement.outerHTML
    }
  }
}