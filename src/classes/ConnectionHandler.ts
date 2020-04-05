import Application from './Application'
import { debug, error, warn } from '../util'
const NAF = require('networked-aframe')
import { WS_NORMAL_CLOSURE } from '../config'

export default class ConnectionHandler {
  publisher: { handle: any; initialOccupants: any; unreliableChannel: any; reliableChannel: any; conn: any }
  session: { create: () => any; receive: (arg0: any) => any; dispose: () => void }

  room: string | number
  clientId: any
  joinToken: any
  serverUrl: string

  configurePublisherSdp: any
  fixSafariIceUFrag: any
  peerConnectionConfig: any

  ws: WebSocket
  reliableTransport: string = 'datachannel'
  unreliableTransport: string = 'datachannel'
  delayedReconnectTimeout: NodeJS.Timeout
  initialReconnectionDelay = 1000 * Math.random()
  reconnectionDelay = this.initialReconnectionDelay
  reconnectionTimeout = null
  maxReconnectionAttempts = 10
  reconnectionAttempts = 0
  onReconnecting: (arg0: number) => void
  onReconnected: () => void
  onReconnectionError: (arg0: Error) => any
  connectSuccess: (arg0: any) => void
  connectFailure: any
  frozenUpdates = new Map()
  frozen: boolean

  setPeerConnectionConfig = (peerConnectionConfig: any) => (this.peerConnectionConfig = peerConnectionConfig)

  setServerConnectListeners = (successListener: any, failureListener: any) => {
    this.connectSuccess = successListener
    this.connectFailure = failureListener
  }

  application: Application

  constructor(application: Application) {
    this.application = application
  }

  setWebRtcOptions = (options: {}) => (this.application.webRtcHandler.webRtcOptions = options)

  async onWebsocketOpen() {
    // Create the Janus Session
    await this.session.create()

    // Attach the SFU Plugin and create a RTCPeerConnection for the publisher.
    // The publisher sends audio and opens two bidirectional data channels.
    // One reliable datachannel and one unreliable.
    this.publisher = await this.application.webRtcHandler.createPublisher()

    // Call the naf connectSuccess callback before we start receiving WebRTC messages.
    this.connectSuccess(this.clientId)

    const addOccupantPromises = []
    for (const occupantId of this.publisher.initialOccupants)
      if (occupantId !== this.clientId) addOccupantPromises.push(this.application.occupantHandler.addOccupant(occupantId))

    await Promise.all(addOccupantPromises)
  }

  onWebsocketClose(event: { code: number }) {
    // The connection was closed successfully. Don't try to reconnect.
    if (event.code === WS_NORMAL_CLOSURE) return

    if (this.onReconnecting) this.onReconnecting(this.reconnectionDelay)

    this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay)
  }

  sendData(clientId: any, dataType: any, data: any) {
    if (!this.publisher) return console.warn('sendData called without a publisher')

    if (this.unreliableTransport == 'websocket')
      this.publisher.handle.sendMessage({
        kind: 'data',
        body: JSON.stringify({ dataType, data }),
        whom: clientId,
      })
    else if (this.unreliableTransport == 'datachannel') this.publisher.unreliableChannel.send(JSON.stringify({ clientId, dataType, data }))
    else error(`Reached default case on transport`)
  }

  sendDataGuaranteed(clientId: any, dataType: any, data: any) {
    if (!this.publisher) return console.warn('sendDataGuaranteed called without a publisher')

    if (this.reliableTransport == 'websocket')
      this.publisher.handle.sendMessage({
        kind: 'data',
        body: JSON.stringify({ dataType, data }),
        whom: clientId,
      })
    else if (this.reliableTransport == 'datachannel') this.publisher.reliableChannel.send(JSON.stringify({ clientId, dataType, data }))
    else error(`Reached default case on transport`)
  }

  broadcastData(dataType: any, data: any) {
    if (!this.publisher) return console.warn('broadcastData called without a publisher')

    if (this.unreliableTransport == 'websocket')
      this.publisher.handle.sendMessage({
        kind: 'data',
        body: JSON.stringify({ dataType, data }),
      })
    else if (this.unreliableTransport == 'datachannel') this.publisher.unreliableChannel.send(JSON.stringify({ dataType, data }))
    else error(`Reached default case on transport`)
  }

  broadcastDataGuaranteed(dataType: any, data: any) {
    if (!this.publisher) return warn('broadcastDataGuaranteed called without a publisher')

    if (this.reliableTransport == 'websocket')
      this.publisher.handle.sendMessage({
        kind: 'data',
        body: JSON.stringify({ dataType, data }),
      })
    else if (this.reliableTransport == 'datachannel') this.publisher.reliableChannel.send(JSON.stringify({ dataType, data }))
    else error(`Reached default case on transport`)
  }

  storeMessage(message: { dataType: string; data: { d: string | any[] } }) {
    if (message.dataType === 'um')
      // UpdateMulti
      for (let i = 0, l = message.data.d.length; i < l; i++) this.storeSingleMessage(message, i)
    else this.storeSingleMessage(message, 0)
  }

  storeSingleMessage(message: { data: { d: { [x: number]: any } }; dataType }, index: number) {
    const data = index !== undefined ? message.data.d[index] : message.data
    const networkId = data.networkId

    if (!this.frozenUpdates.has(networkId)) {
      this.frozenUpdates.set(networkId, message)
      return
    }
    const storedMessage = this.frozenUpdates.get(networkId)
    const storedData = storedMessage.dataType === 'um' ? this.dataForUpdateMultiMessage(networkId, storedMessage) : storedMessage.data

    // Avoid updating components if the entity data received did not come from the current owner.
    const isOutdatedMessage = data.lastOwnerTime < storedData.lastOwnerTime
    const isContemporaneousMessage = data.lastOwnerTime === storedData.lastOwnerTime
    if (isOutdatedMessage || (isContemporaneousMessage && storedData.owner > data.owner)) return

    if (message.dataType === 'r') {
      if (storedData && storedData.isFirstSync) this.frozenUpdates.delete(networkId)
      // If the entity was created and deleted while frozen, don't bother conveying anything to the consumer.
      else this.frozenUpdates.set(networkId, message) // Delete messages override any other messages for this entity
    } else if (storedData.components && data.components) Object.assign(storedData.components, data.components)
  }

  onDataChannelMessage = (e: { data: string }, source: any) => this.onData(JSON.parse(e.data), source)

  onData(message: { dataType: any; source: any; data: any }, source: string) {
    if (debug.enabled) debug(`DC in: ${message}`)

    if (!message.dataType) return

    message.source = source

    if (this.frozen) this.storeMessage(message)
    else this.application.occupantHandler.onOccupantMessage(null, message.dataType, message.data, message.source)
  }

  toggleFreeze = () => (this.frozen ? this.unfreeze() : this.freeze())

  freeze = () => (this.frozen = true)

  unfreeze = () => {
    this.frozen = false
    this.flushPendingUpdates()
  }

  onWebsocketMessage = (event: { data: string }) => this.session.receive(JSON.parse(event.data))

  dataForUpdateMultiMessage = (networkId: any, message: { data: { d: string | any[] } }) => {
    // "d" is an array of entity datas, where each item in the array represents a unique entity and contains
    // metadata for the entity, and an array of components that have been updated on the entity.
    // This method finds the data corresponding to the given networkId.
    for (let i = 0, l = message.data.d.length; i < l; i++) if (message.data.d[i].networkId === networkId) return message.data.d[i]

    return null
  }

  getPendingData(networkId: any, message: { dataType: string; data: any }) {
    if (!message) return null

    let data = message.dataType === 'um' ? this.dataForUpdateMultiMessage(networkId, message) : message.data

    // Ignore messages relating to users who have disconnected since freezing, their entities
    // will have aleady been removed by NAF.
    // Note that delete messages have no "owner" so we have to check for that as well.
    if (
      data.owner &&
      (!this.application.occupantHandler.occupants[data.owner] || this.application.occupantHandler.blockedClients.has(data.owner))
    )
      return null

    return data
  }

  // Used externally
  getPendingDataForNetworkId = (networkId: any) => this.getPendingData(networkId, this.frozenUpdates.get(networkId))

  flushPendingUpdates() {
    for (const [networkId, message] of this.frozenUpdates) {
      let data = this.getPendingData(networkId, message)
      if (!data) continue

      // Override the data type on "um" messages types, since we extract entity updates from "um" messages into
      // individual frozenUpdates in storeSingleMessage.
      const dataType = message.dataType === 'um' ? 'u' : message.dataType

      this.application.occupantHandler.onOccupantMessage(null, dataType, data, message.source)
    }
    this.frozenUpdates.clear()
  }

  getConnectStatus = (clientId: string | number) =>
    this.application.occupantHandler.occupants[clientId] ? NAF.adapters.IS_CONNECTED : NAF.adapters.NOT_CONNECTED

  setServerUrl = (url: any) => (this.serverUrl = url)

  setRoom = (roomName: string | number) => (this.room = roomName)

  setJoinToken = (joinToken: any) => (this.joinToken = joinToken)

  setClientId = (clientId: any) => (this.clientId = clientId)

  setReconnectionListeners(reconnectingListener: any, reconnectedListener: any, reconnectionErrorListener: any) {
    // onReconnecting is
    this.onReconnecting = reconnectingListener // called with number of ms until next reconnection attempt
    this.onReconnected = reconnectedListener // called when connection reestablished
    this.onReconnectionError = reconnectionErrorListener // called with an error when maxReconnectionAttempts has been reached
  }

  sendJoin = (
    handle: { sendMessage: (arg0: { kind: string; room_id: string | number; user_id: any; subscribe: any; token: any }) => any },
    subscribe: any
  ) =>
    handle.sendMessage({
      kind: 'join',
      room_id: this.room,
      user_id: this.clientId,
      subscribe,
      token: this.joinToken,
    })

  connect = () => {
    debug(`connecting to ${this.serverUrl}`)

    const websocketConnection = new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl, 'janus-protocol')
      this.session = new this.application.mj.JanusSession(this.ws.send.bind(this.ws), {
        timeoutMs: 30000,
      })

      const onError = () => reject(error)
      let onOpen = () => {
        this.ws.removeEventListener('open', onOpen)
        this.ws.removeEventListener('error', onError)
        this.onWebsocketOpen().then(resolve).catch(reject)
      }

      this.ws.addEventListener('close', this.onWebsocketClose)
      this.ws.addEventListener('message', this.onWebsocketMessage)
      this.ws.addEventListener('open', onOpen)
    })

    return Promise.all([websocketConnection, this.application.timehandler.updateTimeOffset()])
  }

  disconnect() {
    debug(`disconnecting`)

    clearTimeout(this.reconnectionTimeout)

    this.application.occupantHandler.removeAllOccupants()
    this.application.occupantHandler.leftOccupants = new Set()

    if (this.publisher) {
      // Close the publisher peer connection. Which also detaches the plugin handle.
      this.publisher.conn.close()
      this.publisher = null
    }

    if (this.session) {
      this.session.dispose()
      this.session = null
    }

    if (!this.ws) return

    this.ws.removeEventListener('open', this.onWebsocketOpen)
    this.ws.removeEventListener('close', this.onWebsocketClose)
    this.ws.removeEventListener('message', this.onWebsocketMessage)
    this.ws.close()
    this.ws = null
  }

  isDisconnected = () => this.ws === null

  reconnect() {
    // Dispose of all networked entities and other resources tied to the session.
    this.disconnect()

    this.connect()
      .then(() => {
        this.reconnectionDelay = this.initialReconnectionDelay
        this.reconnectionAttempts = 0

        if (this.onReconnected) this.onReconnected()
      })
      .catch((error) => {
        this.reconnectionDelay += 1000
        this.reconnectionAttempts++

        if (this.reconnectionAttempts > this.maxReconnectionAttempts && this.onReconnectionError)
          return this.onReconnectionError(new Error('Connection could not be reestablished, exceeded maximum attempts.'))

        error(`Error during reconnect, ${error}`)

        if (this.onReconnecting) this.onReconnecting(this.reconnectionDelay)

        this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay)
      })
  }

  performDelayedReconnect() {
    if (this.delayedReconnectTimeout) clearTimeout(this.delayedReconnectTimeout)
    this.delayedReconnectTimeout = setTimeout(() => {
      this.delayedReconnectTimeout = null
      this.reconnect()
    }, 10000)
  }
}
