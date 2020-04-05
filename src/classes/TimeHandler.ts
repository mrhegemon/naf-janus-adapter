import Application from './Application'
import { debug } from '../util'

export default class TimeHandler {
  timeOffsets = []
  serverTimeRequests = 0
  avgTimeOffset = 0

  application: Application
  precision = 1000

  constructor(application: Application) {
    this.application = application
  }

  getServerTime = () => Date.now() + this.avgTimeOffset

  async updateTimeOffset() {
    if (this.application.connectionHandler.isDisconnected()) return

    const clientSentTime = Date.now()

    const res = await fetch(document.location.href, {
      method: 'HEAD',
      cache: 'no-cache',
    })

    const serverTime =
      new Date(res.headers.get('Date')).getTime() +
      this.precision / 2 + // Server receive time
      (Date.now() - clientSentTime) / 2 // Client received time
    const timeOffset = serverTime - Date.now()

    this.serverTimeRequests++

    if (this.serverTimeRequests <= 10) this.timeOffsets.push(timeOffset)
    else this.timeOffsets[this.serverTimeRequests % 10] = timeOffset

    this.avgTimeOffset =
      this.timeOffsets.reduce((acc, offset) => (acc += offset), 0) /
      this.timeOffsets.length

    if (this.serverTimeRequests <= 10) return this.updateTimeOffset()

      debug(`new server time offset: ${this.avgTimeOffset}ms`)
      setTimeout(() => this.updateTimeOffset(), 5 * 60 * 1000) // Sync clock every 5 minutes.
  }
}
