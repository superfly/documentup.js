/*
* Set up routes for HTTP requests. We're using the
* [npm routes](https://github.com/aaronblohowiak/routes.js) module, which is
* bundled into the app with webpack.
*/

const router = require('routes')()

/*
* In search of a pretty site, use webpack to load CSS from
* [index.css](/src/stylesheets/index.css) into a string constant.
* Then add a route to serve CSS from `/screen.css`
*/
const css = require('./stylesheets/index.scss').toString()
router.addRoute("/screen.css", function (event, match) {
  return new Response(css, { headers: { 'content-type': 'text/css' } })
})
const woff2 = require('./stylesheets/fonts-woff2.css').toString()
router.addRoute("/fonts-woff2.css", function (event, match) {
  return new Response(woff2, { headers: { 'content-type': 'text/css' } })
})
const woff = require('./stylesheets/fonts-woff.css').toString()
router.addRoute("/fonts-woff.css", function (event, match) {
  return new Response(woff, { headers: { 'content-type': 'text/css' } })
})

router.addRoute("/images/:filename.:format", function staticImage(event, match) {
  const format = match.params.format
  const mimeType = format === 'ico' ? "image/x-icon" : `image/${format}`
  try {
    const img = require(`./images/${match.params.filename}.${match.params.format}`)
    return new Response(img, { 'content-type': mimeType })
  } catch (e) {
    return new Response("not found", { status: 404 })
  }
})


router.addRoute("/:login/:repo", async function (event, match) {
  return await renderRepo(match.params.login, match.params.repo)
})
router.addRoute("/", async function (event, match) {
  return await renderRepo("superfly", "documentup.js")
})
router.addRoute("/:login/:repo/*.*", async function (event, match) {
  return await renderCode(match.params.login, match.params.repo, match.splats.join("."))
})

// Someone fix this plz thx - <3 Kyle

const Renderer = require('./renderer')
const Repository = require('./repository')
const pageTpl = require('./views/page.pug')
async function renderRepo(login, repoName) {
  const renderFn = async function () {
    const response = await fetch(`https://raw.githubusercontent.com/${login}/${repoName}/master/README.md`)
    if (response.status != 200) {
      return false
    }
    const repo = new Repository(login, repoName)
    const renderer = new Renderer(login, repoName)
    let raw = await response.text()
    let result = renderer.render(raw)
    return pageTpl({ html: result.body, tableOfContents: result.tableOfContents, repository: repo })
  }

  return tryCache(login + "/" + repoName, renderFn)
}

const commentExtractor = require('multilang-extract-comments')
const splitLines = require('split-lines')
const arrayToLinkedlist = require('array-to-linkedlist')
const extensions = {
  'js': 'javascript',
  'py': 'python',
  'rb': 'ruby',
  'ps1': 'powershell',
  'psm1': 'powershell',
  'sh': 'bash',
  'bat': 'batch',
  'h': 'c',
  'tex': 'latex'
};

const codeTpl = require('./views/code.pug')
async function renderCode(login, repoName, filePath) {
  const renderFn = async function () {
    const response = await fetch(`https://raw.githubusercontent.com/${login}/${repoName}/master/${filePath}`)
    if (response.status != 200) {
      return false
    }
    const ext = (filePath.match(/\.(\w+)$/) || [, ''])[1]
    const language = (extensions[ext] || ext)
    console.log(language)
    const renderer = new Renderer(login, repoName)
    let source = await response.text()
    const comments = commentExtractor(source)
    Object.values(comments).forEach(function (c) {
      c.content = renderer.render(c.content).body
    })
    const lines = splitLines(source)
    console.log("code has lines:", lines.length)
    console.log("found comment blocks:", Object.values(comments).length)

    return codeTpl({ comments: arrayToLinkedlist(Object.values(comments)), source: lines, markdown: renderer, language: language })
  }
  return tryCache(login + "/" + repoName + "/" + filePath, renderFn)
}

async function tryCache(key, fillFn) {
  let cacheStatus = "MISS"

  let body = await fly.cache.getString(key)

  if (!body) {
    console.log("cache miss:", key)
    body = await fillFn()
    if (!body) { // 404
      return new Response("four-oh-four", { status: 404 })
    }
    await fly.cache.set(key, body, 3600)
  } else {
    console.log("cache hit:", key)
    cacheStatus = "HIT"
  }
  return new Response(body, { headers: { 'content-type': 'text/html', 'X-cache': cacheStatus } })

}

addEventListener("fetch", function (event) {
  const { request, respondWith } = event
  const path = new URL(request.url).pathname
  let match = router.match(path)

  if (!match) {
    event.respondWith(new Response("docup not found", { status: 404 }))
  } else {
    event.respondWith(match.fn(event, match))
  }
})