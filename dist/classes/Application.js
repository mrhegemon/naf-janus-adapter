import OccupantHandler from './OccupantHandler';
import ConnectionHandler from './ConnectionHandler';
import WebRtcHandler from './WebRtcHandler';
import TimeHandler from './TimeHandler';
import MediaStreamHandler from './MediaStreamHandler';
const minijanus = require('minijanus');
export default class Application {
    constructor() {
        this.mj = minijanus;
        this.occupantHandler = new OccupantHandler(this);
        this.connectionHandler = new ConnectionHandler(this);
        this.webRtcHandler = new WebRtcHandler(this);
        this.timehandler = new TimeHandler(this);
        this.mediaStreamHandler = new MediaStreamHandler(this);
    }
}
