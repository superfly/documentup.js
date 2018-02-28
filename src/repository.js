export default class Repository {
  constructor(login, repo) {
    this.login = login
    this.repo = repo
  }
  displayName() {
    return this.repo
  }
}