import { debounce, debug, error } from '../util'
import Application from './Application'

export default class InputHandler {
  mediaStreams = {}
  localMediaStream = null
  pendingMediaRequests = new Map()

  application: Application

  constructor(application: Application) {
    this.application = application
  }

  getMediaStream(clientId, type = 'audio') {
    if (this.mediaStreams[clientId]) {
      debug(`Already had ${type} for ${clientId}`)
      return Promise.resolve(this.mediaStreams[clientId][type])
    }

    debug(`Waiting on ${type} for ${clientId}`)
    if (this.pendingMediaRequests.has(clientId)) return this.pendingMediaRequests.get(clientId)[type].promise

    this.pendingMediaRequests.set(clientId, {})

    this.pendingMediaRequests.get(clientId).audio.promise = new Promise(
      (resolve, reject) => (this.pendingMediaRequests.get(clientId).audio = { resolve, reject })
    )

    this.pendingMediaRequests.get(clientId).video.promise = new Promise(
      (resolve, reject) => (this.pendingMediaRequests.get(clientId).video = { resolve, reject })
    )

    return this.pendingMediaRequests.get(clientId)[type].promise
  }

  setMediaStream(clientId, stream) {
    this.localMediaStream = stream

    // Safari doesn't like it when you use single a mixed media stream where one of the tracks is inactive, so we
    // split the tracks into two streams.
    const audioStream = new MediaStream()
    const videoStream = new MediaStream()

    stream.getAudioTracks().forEach((track) => audioStream.addTrack(track))
    stream.getVideoTracks().forEach((track) => videoStream.addTrack(track))

    this.mediaStreams[clientId] = { audio: audioStream, video: videoStream }

    // Resolve the promise for the user's media stream if it exists.
    if (!this.pendingMediaRequests.has(clientId)) return
    this.pendingMediaRequests.get(clientId).audio.resolve(audioStream)
    this.pendingMediaRequests.get(clientId).video.resolve(videoStream)
  }

  async setLocalMediaStream(stream) {
    if (!this.application.connectionHandler.publisher || !this.application.connectionHandler.publisher.conn)
      return this.setMediaStream(this.application.connectionHandler.clientId, stream)

    const existingSenders = this.application.connectionHandler.publisher.conn.getSenders()
    const newSenders = []

    for (const t of stream.getTracks()) {
      const sender = existingSenders.find((s) => s.track != null && s.track.kind == t.kind)

      if (sender != null) {
        if (sender.replaceTrack) {
          await sender.replaceTrack(t)
          t.enabled = false
          setTimeout(() => (t.enabled = true), 1000)
        }

        newSenders.push(sender)
      } else newSenders.push(this.application.connectionHandler.publisher.conn.addTrack(t, stream))
    }

    existingSenders.forEach((s) => (s.track.enabled = !newSenders.includes(s) ? false : s.track.enabled))

    this.localMediaStream = stream
    this.setMediaStream(this.application.connectionHandler.clientId, stream)
  }
}
