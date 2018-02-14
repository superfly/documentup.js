require('../src')
global.window = global
const fetchMock = require('fetch-mock')
const { dispatchFetch } = require('./helper')

import { expect } from 'chai'

describe('documentup', () => {
  before(() => {
    fetchMock.mock("*", new Response(`# Hello world`))
  })
  after(() => { fetchMock.restore() })

  it('fires the event', async () => {
    let res = await dispatchFetch(new Request("http://localhost/blah/blah"))
    let html = await res.text()
    expect(html).to.include(`<h1 id="hello-world">Hello world</h1>`)
  })
})