import OccupantHandler from './OccupantHandler'
import ConnectionHandler from './ConnectionHandler'
import WebRtcHandler from './WebRtcHandler'
import TimeHandler from './TimeHandler';
import MediaStreamHandler from './MediaStreamHandler';
const minijanus = require('minijanus')

export default class Application {
  mj = minijanus
  occupantHandler: OccupantHandler
  connectionHandler: ConnectionHandler
  timehandler : TimeHandler
  webRtcHandler : WebRtcHandler
  mediaStreamHandler : MediaStreamHandler

  constructor(){
    this.occupantHandler = new OccupantHandler(this)
    this.connectionHandler = new ConnectionHandler(this)
    this.webRtcHandler = new WebRtcHandler(this)
    this.timehandler = new TimeHandler(this)
    this.mediaStreamHandler = new MediaStreamHandler(this)
  }
}
