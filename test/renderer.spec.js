require('../src')
global.window = global
const fetchMock = require('fetch-mock')
const { dispatchFetch } = require('./helper')
import { expect } from 'chai'

const complexHeaderName = "Hello world())()+++"

describe('Renderer', () => {
  before(() => {
    fetchMock.mock("*", new Response(`# ${complexHeaderName}`))
  })
  after(() => { fetchMock.restore() })
  it("renders the proper heading id", async function () {
    let res = await dispatchFetch(new Request("http://localhost/blah/blah"))
    let html = await res.text()
    expect(html).to.include(`<h1 id="hello-world">Hello world</h1>`)
  })
})