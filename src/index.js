import Raven from 'raven-js'
import * as fmw from 'find-my-way'

const router = fmw({ ignoreTrailingSlash: true })

if (app.config.sentry_url) {
  Raven.config(app.config.sentry_url, {
    environment: app.env,
    release: app.version
  }).install()
}

/*
* Set up routes for HTTP requests. Fly Apps have access to a built in 
* [http router](https://fly.io/docs/apps/api/#fly-http).
*
* The most used route in this application matches a Github `/:login/:repo`. We handle 
* requests to those URLs using the `renderRepo` function defined later.
*/
router.on(["GET", "HEAD"], "/:login/:repo", function loginRepoHandler(req, { params }) {
  return renderRepo(params.login, params.repo)
})

/*
* The root `/` path should render the [repository](https://github.com/superfly/documentup.js) 
* for this application.
*/
router.on(["GET", "HEAD"], "/", function rootHandler(req) {
  return renderRepo("superfly", "documentup.js")
})

/*
* Routes can include wildcard parameters that match multiple segments of a URL. 
* Anything to `/superfly/documentup/path/to/file` gets the source code treatment.
*/
router.on(["GET", "HEAD"], "/:login/:repo/*path", function fileHandler(req, { params }) {
  return renderFile(params.login, params.repo, params['*'])
})

/* 
* These are the types and template necessary to render a README file from a repository. 
* The `renderRepo` function will request the a README file from Github's CDN, then render 
* it to HTML from Markdown.
*/
import Renderer from './renderer'
import Repository from './repository'
import pageTpl from './views/page.pug'

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

/*
* Routes to source code get rendered as if they're annotated code. Comments on the left, 
* syntax highlighted code on the right. These are useful modules for extracting code and 
* comments into a template-able format.
*/
import * as commentExtractor from 'multilang-extract-comments'
import * as splitLines from 'split-lines'
import * as arrayToLinkedlist from 'array-to-linkedlist'

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

import codeTpl from './views/code.pug'

async function renderFile(login, repoName, filePath) {
  console.log(login, repoName, filePath)
  const renderFn = async function () {
    const url = `https://raw.githubusercontent.com/${login}/${repoName}/master/${filePath}`
    const response = await fetch(url)
    if (response.status != 200) {
      return false
    }
    if (response.headers.get('content-type').startsWith("image/")) {
      return null
    }

    /*
    * For most request, the extension will match the file format. Sometimes (like with .js) 
    * we need a language mapped from `extensions`.
    */
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

/*
* The `fly.cache` is a volatile, k/v store for keeping data in each edge location. 
* It's useful for storing fully rendered versions of backend data, and can reduce request 
* times by an order of magnitude.
*
* For this application, a generic `tryCache` function is useful. It takes a cache key, 
* which is generated based on the requested file, and a function for generating content 
* when the cache has no data for a given request.
*/
async function tryCache(key, fillFn) {
  let cacheStatus = "MISS"

  /*
  * We may want to apply cache filling logic in multiple places, wrapping it in a 
  * new async function is a convenient way to do that.
  */
  async function fillAndSet() {
    const body = await fillFn();
    if (!body) {
      /*
      * When the fillFn returns nothing, no caching.
      */
      return
    }
    const entry = {
      body: body,
      time: Date.now()
    }
    fly.cache.set(key, JSON.stringify(entry), 3600)
    return entry
  }

  let cached = await fly.cache.getString(key)

  if (!cached) {
    console.log("cache miss:", key)
    cached = await fillAndSet()
  } else {
    console.log("cache hit:", key)
    cacheStatus = "HIT"

    cached = JSON.parse(cached)
    /*
    * If the cached entry is more than 30 seconds old, refresh it in the background.
    *
    * Since `fillAndSet` is an async function, it returns a promise immediately 
    * and doesn't affect response time.
    */
    if (cached.time < (Date.now() - 30000)) {
      fillAndSet().then(function (result) {
        console.log("cache refreshed:", key)
      }).catch(function (err) {
        console.log("error in refresh")
        console.error("cache refresh failed:", err.toString())
      })
      cacheStatus = "HIT+REFRESH"
    }
  }

  if (!cached) { // 404
    return new Response("four-oh-four", { status: 404 })
  }
  /*
  * The response includes an X-cache headers, which is a pseudo standard way of indicating 
  * whether the data comes from the cache, or was generated anew.
  */
  return new Response(cached.body, {
    headers: { 'content-type': 'text/html', 'x-cache': cacheStatus }
  })

}

/*
* Static file handling in fly apps relies is a little odd. There's no file system available
* when this Javascript is executed, so we bundle statis assets using 
* [Webpack](/webpack.config.js). This is similar to the asset compilation steps in most 
* web frameworks.
*
* Webpack loads and processes scss files like 
* [index.scss](/src/stylesheets/index.scss) into string constants.
* We add routes for each of `/screen.css`, and the necessary font files.
*/
const css = require('./stylesheets/index.scss').toString()
router.on(["GET", "HEAD"], "/screen.css", function (req) {
  return new Response(css, { headers: { 'content-type': 'text/css' } })
})
const woff2 = require('./stylesheets/fonts-woff2.css').toString()
router.on(["GET", "HEAD"], "/fonts-woff2.css", function (req) {
  return new Response(woff2, { headers: { 'content-type': 'text/css' } })
})
const woff = require('./stylesheets/fonts-woff.css').toString()
router.on(["GET", "HEAD"], "/fonts-woff.css", function (req) {
  return new Response(woff, { headers: { 'content-type': 'text/css' } })
})

/*
* There are a couple of different images in this project, so we can create a 
* parameterized route to handle all of them.
*/

router.on(["GET", "HEAD"], "/images/:filename(^\\w+).:format", function staticImage(req, { params }) {
  const format = params.format
  const mimeType = format === 'ico' ? "image/x-icon" : `image/${format}`
  try {
    /*
    * Webpack is smart. It recognizes that we might need every image in `/images`/, 
    * so it helpfully bundles all of them up for runtime require calls.
    */
    const img = require(`./images/${params.filename}.${params.format}`)
    return new Response(img, { 'content-type': mimeType })
  } catch (e) {
    console.error(e.toString())
    return new Response("not found", { status: 404 })
  }
})

/*
* This is a default handler when no routes match.
*/
addEventListener('fetch', function (event) {
  const { request } = event
  Raven.setTagsContext({ transaction: `${request.method} ${request.url}` })
  const path = new URL(request.url).pathname
  const match = router.find(request.method, path)
  if (!!match) {
    event.respondWith(async function () {
      try {
        return await match.handler(request, match)
      } catch (e) {
        Raven.captureException(e)
        console.error("error when routing!", e.stack)
        return new Response("Something went wrong in DocumentUp, we've been notified.", { status: 500 })
      }
    })
    return
  }

  event.respondWith(new Response("404", { status: 404 }))
})