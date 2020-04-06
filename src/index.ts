const NAF = require('networked-aframe')

import Application from './classes/Application'

class JanusAdapter {
  application: Application

  constructor() {
    this.application = new Application()
  }

  // NAF Public interface functions
  setServerUrl = (url: any) => this.application.connectionHandler.setServerUrl(url)
  setApp(app: any) {}
  setRoom = (roomName: string | number) => this.application.connectionHandler.setRoom(roomName)
  setWebRtcOptions = (options: {}) => this.application.connectionHandler.setWebRtcOptions(options)
  setServerConnectListeners = (successListener: any, failureListener: any) =>
    this.application.connectionHandler.setServerConnectListeners(successListener, failureListener)
  setRoomOccupantListener = (occupantListener: any) => this.application.occupantHandler.setRoomOccupantListener(occupantListener)
  setDataChannelListeners = (openListener: any, closedListener: any, messageListener: any) =>
    this.application.occupantHandler.setDataChannelListeners(openListener, closedListener, messageListener)
  connect = () => this.application.connectionHandler.connect()
  disconnect = () => this.application.connectionHandler.disconnect()
  onDataChannelMessage = (e: { data: string }, source: any) => this.application.connectionHandler.onDataChannelMessage(e, source)
  shouldStartConnectionTo = (client: any) => true
  startStreamConnection(client: any) {}
  closeStreamConnection(client: any) {}
  getConnectStatus = (clientId: string | number) => this.application.connectionHandler.getConnectStatus(clientId)
  updateTimeOffset = async () => this.application.timehandler.updateTimeOffset()
  getServerTime = () => this.application.timehandler.getServerTime
  getMediaStream = (clientId: any, type = 'audio') => this.application.mediaStreamHandler.getMediaStream(clientId, type)
  sendData = (clientId: any, dataType: any, data: any) => this.application.connectionHandler.sendData(clientId, dataType, data)
  sendDataGuaranteed = (clientId: any, dataType: any, data: any) =>
    this.application.connectionHandler.sendDataGuaranteed(clientId, dataType, data)
  broadcastData = (dataType: any, data: any) => this.application.connectionHandler.broadcastData(dataType, data)
  broadcastDataGuaranteed = (dataType: any, data: any) => this.application.connectionHandler.broadcastDataGuaranteed(dataType, data)
}

NAF.adapters.register('janus', JanusAdapter)

export default JanusAdapter
