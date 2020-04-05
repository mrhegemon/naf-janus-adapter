import Application from './Application'
import { debug, isSafari } from '../util'
import { DEFAULT_PEER_CONNECTION_CONFIG, SUBSCRIBE_TIMEOUT_MS } from '../config'

const mj = require('minijanus')

export default class OccupantHandler {
  occupants = {}
  leftOccupants = new Set()
  blockedClients = new Map()
  onOccupantsChanged
  onOccupantConnected
  onOccupantDisconnected
  onOccupantMessage

  _iOSHackDelayedInitialPeer: boolean

  application: Application

  constructor(application: Application) {
    this.application = application
  }

  setRoomOccupantListener = (occupantListener) => (this.onOccupantsChanged = occupantListener)

  setDataChannelListeners(openListener, closedListener, messageListener) {
    this.onOccupantConnected = openListener
    this.onOccupantDisconnected = closedListener
    this.onOccupantMessage = messageListener
  }

  kick = (clientId, permsToken) =>
    this.application.connectionHandler.publisher.handle
      .sendMessage({
        kind: 'kick',
        room_id: this.application.connectionHandler.room,
        user_id: clientId,
        token: permsToken,
      })
      .then(() => {
        document.body.dispatchEvent(new CustomEvent('kicked', { detail: { clientId: clientId } }))
      })

  block = (clientId) =>
    this.application.connectionHandler.publisher.handle.sendMessage({ kind: 'block', whom: clientId }).then(() => {
      this.blockedClients.set(clientId, true)
      document.body.dispatchEvent(new CustomEvent('blocked', { detail: { clientId: clientId } }))
    })

  unblock = (clientId) =>
    this.application.connectionHandler.publisher.handle.sendMessage({ kind: 'unblock', whom: clientId }).then(() => {
      this.blockedClients.delete(clientId)
      document.body.dispatchEvent(new CustomEvent('unblocked', { detail: { clientId: clientId } }))
    })

  async addOccupant(occupantId) {
    if (this.occupants[occupantId]) this.removeOccupant(occupantId)

    this.leftOccupants.delete(occupantId)

    const subscriber = await this.createSubscriber(occupantId)

    if (!subscriber) return

    this.occupants[occupantId] = subscriber

    this.application.mediaStreamHandler.setMediaStream(occupantId, subscriber.mediaStream)

    // Call the Networked AFrame callbacks for the new occupant.
    this.onOccupantConnected(occupantId)
    this.onOccupantsChanged(this.occupants)

    return subscriber
  }

  removeAllOccupants = () => {
    for (const occupantId of Object.getOwnPropertyNames(this.occupants)) this.removeOccupant(occupantId)
  }

  removeOccupant(occupantId) {
    this.leftOccupants.add(occupantId)

    if (!this.occupants[occupantId]) return
    // Close the subscriber peer connection. Which also detaches the plugin handle.
    if (this.occupants[occupantId]) {
      this.occupants[occupantId].conn.close()
      delete this.occupants[occupantId]
    }

    if (this.application.mediaStreamHandler.mediaStreams[occupantId]) delete this.application.mediaStreamHandler.mediaStreams[occupantId]

    if (this.application.mediaStreamHandler.pendingMediaRequests.has(occupantId)) {
      const msg = 'The user disconnected before the media stream was resolved.'
      this.application.mediaStreamHandler.pendingMediaRequests.get(occupantId).audio.reject(msg)
      this.application.mediaStreamHandler.pendingMediaRequests.get(occupantId).video.reject(msg)
      this.application.mediaStreamHandler.pendingMediaRequests.delete(occupantId)
    }

    // Call the Networked AFrame callbacks for the removed occupant.
    this.onOccupantDisconnected(occupantId)
    this.onOccupantsChanged(this.occupants)
  }

  async createSubscriber(occupantId) {
    if (this.leftOccupants.has(occupantId))
      return console.warn(`${occupantId}: cancelled occupant connection, occupant left before subscription negotation.`)

    const handle = new mj.JanusPluginHandle(this.application.connectionHandler.session)
    const conn = new RTCPeerConnection(this.application.connectionHandler.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG)

    debug(`${occupantId}: sub waiting for sfu`)
    await handle.attach('janus.plugin.sfu')

    this.application.webRtcHandler.associate(conn, handle)

    debug(`${occupantId}: sub waiting for join`)

    if (this.leftOccupants.has(occupantId)) {
      conn.close()
      console.warn(`${occupantId}: cancelled occupant connection, occupant left after attach`)
      return null
    }

    let webrtcFailed = false

    const webrtcup = new Promise((resolve) => {
      const leftInterval = setInterval(() => {
        if (this.leftOccupants.has(occupantId)) {
          clearInterval(leftInterval)
          resolve()
        }
      }, 1000)

      const timeout = setTimeout(() => {
        clearInterval(leftInterval)
        webrtcFailed = true
        resolve()
      }, SUBSCRIBE_TIMEOUT_MS)

      handle.on('webrtcup', () => {
        clearTimeout(timeout)
        clearInterval(leftInterval)
        resolve()
      })
    })

    // Send join message to janus. Don't listen for join/leave messages. Subscribe to the occupant's media.
    // Janus should send us an offer for this occupant's media in response to this.
    await this.application.connectionHandler.sendJoin(handle, { media: occupantId })

    if (this.leftOccupants.has(occupantId)) {
      conn.close()
      console.warn(`${occupantId}: cancelled occupant connection, occupant left after join`)
      return null
    }

    debug(`${occupantId}: sub waiting for webrtcup`)
    await webrtcup

    if (this.leftOccupants.has(occupantId)) {
      conn.close()
      console.warn(`${occupantId}: cancel occupant connection, occupant left during or after webrtcup`)
      return null
    }

    if (webrtcFailed) {
      conn.close()
      console.warn(`${occupantId}: webrtc up timed out`)
      return null
    }

    if (isSafari && !this._iOSHackDelayedInitialPeer) {
      // HACK: the first peer on Safari during page load can fail to work if we don't
      // wait some time before continuing here. See: https://github.com/mozilla/hubs/pull/1692
      await new Promise((resolve) => setTimeout(resolve, 3000))
      this._iOSHackDelayedInitialPeer = true
    }

    let mediaStream = new MediaStream()
    conn.getReceivers().forEach((receiver) => receiver.track ?? mediaStream.addTrack(receiver.track))
    if (mediaStream.getTracks().length === 0) mediaStream = null

    debug(`${occupantId}: subscriber ready`)
    return { handle, mediaStream, conn }
  }
}
