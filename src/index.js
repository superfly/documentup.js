/*
* Set up routes for HTTP requests. Fly Apps have access to a built in 
* [http router](https://fly.io/docs/apps/api/#fly-http).
*
* The most used route in this application matches a Github `/:login/:repo`. We handle 
* requests to those URLs using the `renderRepo` function defined later.
*/
fly.http.route("/:login/:repo", async function (req, route) {
  const params = route.params
  return await renderRepo(params.login, params.repo)
})

/*
* The root `/` path should render the [repository](https://github.com/superfly/documentup.js) 
* for this application.
*/
fly.http.route("/", async function (req) {
  return await renderRepo("superfly", "documentup.js")
})

/*
* Routes can include wildcard parameters that match multiple segments of a URL. 
* Anything to `/superfly/documentup/path/to/file` gets the source code treatment.
*/ 
fly.http.route("/:login/:repo/*path",function (req, route) {
  const params = route.params
  return renderCode(params.login, params.repo, params['*'])
})

/* 
* These are the types and template necessary to render a README file from a repository. 
* The `renderRepo` function will request the a README file from Github's CDN, then render 
* it to HTML from Markdown.
*/
const Renderer = require('./renderer')
const Repository = require('./repository')
const pageTpl = require('./views/page.pug')
async function renderRepo(login, repoName) {
  const renderFn = async function () {
    /*
    * Fly Applications have access to the [HTTP `fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) 
    * function defined by the WhatWG.
    */
    const url = `https://raw.githubusercontent.com/${login}/${repoName}/master/README.md`
    const response = await fetch(url)
    if (response.status != 200) {
      return false
    }
    const repo = new Repository(login, repoName)
    const renderer = new Renderer(login, repoName)
    /*
    * HTTP requests include a body stream. This needs to be read into memory for our Markdown 
    * renderer to work.
    */
    let raw = await response.text()
    let result = renderer.render(raw)
    return pageTpl({
      html: result.body,
      tableOfContents: result.tableOfContents,
      repository: repo
    })
  }
  /*
  * For speed, check the cache before making an HTTP request and rendering markdown.
  */
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
  console.log(login, repoName, filePath)
  const renderFn = async function () {
    const url = `https://raw.githubusercontent.com/${login}/${repoName}/master/${filePath}`
    const response = await fetch(url)
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

    return codeTpl({
      comments: arrayToLinkedlist(Object.values(comments)),
      source: lines,
      markdown: renderer,
      language: language
    })
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
  return new Response(body, {
    headers: { 'content-type': 'text/html', 'X-cache': cacheStatus }
  })

}

/*
* Static file handling in fly apps is a little different. There's no file system available
* when this Javascript is executed, so we need to bundle statis assets using 
* [Webpack](/webpack.config.js). This is similar to the asset compilation steps in most 
* web frameworks.
*
* Webpack loads and processes scss files like 
* [index.scss](/src/stylesheets/index.scss) into string constants.
* We add routes for each of `/screen.css`, and the necessary font files.
*/
const css = require('./stylesheets/index.scss').toString()
fly.http.route("/screen.css", function (req, params) {
  return new Response(css, { headers: { 'content-type': 'text/css' } })
})
const woff2 = require('./stylesheets/fonts-woff2.css').toString()
fly.http.route("/fonts-woff2.css", function (req, params) {
  return new Response(woff2, { headers: { 'content-type': 'text/css' } })
})
const woff = require('./stylesheets/fonts-woff.css').toString()
fly.http.route("/fonts-woff.css", function (req, params) {
  return new Response(woff, { headers: { 'content-type': 'text/css' } })
})

/*
* Serious magic, wtf.
*/

fly.http.route("/images/:filename.:format", function staticImage(req, params) {
  const format = params.format
  const mimeType = format === 'ico' ? "image/x-icon" : `image/${format}`
  try {
    const img = require(`./images/${params.filename}.${params.format}`)
    return new Response(img, { 'content-type': mimeType })
  } catch (e) {
    return new Response("not found", { status: 404 })
  }
})

fly.http.respondWith(function(req){
  return new Response("docup not found", { status: 404 })
})