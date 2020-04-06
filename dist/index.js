var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const NAF = require('networked-aframe');
import Application from './classes/Application';
class JanusAdapter {
    constructor() {
        // NAF Public interface functions
        this.setServerUrl = (url) => this.application.connectionHandler.setServerUrl(url);
        this.setRoom = (roomName) => this.application.connectionHandler.setRoom(roomName);
        this.setWebRtcOptions = (options) => this.application.connectionHandler.setWebRtcOptions(options);
        this.setServerConnectListeners = (successListener, failureListener) => this.application.connectionHandler.setServerConnectListeners(successListener, failureListener);
        this.setRoomOccupantListener = (occupantListener) => this.application.occupantHandler.setRoomOccupantListener(occupantListener);
        this.setDataChannelListeners = (openListener, closedListener, messageListener) => this.application.occupantHandler.setDataChannelListeners(openListener, closedListener, messageListener);
        this.connect = () => this.application.connectionHandler.connect();
        this.disconnect = () => this.application.connectionHandler.disconnect();
        this.onDataChannelMessage = (e, source) => this.application.connectionHandler.onDataChannelMessage(e, source);
        this.shouldStartConnectionTo = (client) => true;
        this.getConnectStatus = (clientId) => this.application.connectionHandler.getConnectStatus(clientId);
        this.updateTimeOffset = () => __awaiter(this, void 0, void 0, function* () { return this.application.timehandler.updateTimeOffset(); });
        this.getServerTime = () => this.application.timehandler.getServerTime;
        this.getMediaStream = (clientId, type = 'audio') => this.application.mediaStreamHandler.getMediaStream(clientId, type);
        this.sendData = (clientId, dataType, data) => this.application.connectionHandler.sendData(clientId, dataType, data);
        this.sendDataGuaranteed = (clientId, dataType, data) => this.application.connectionHandler.sendDataGuaranteed(clientId, dataType, data);
        this.broadcastData = (dataType, data) => this.application.connectionHandler.broadcastData(dataType, data);
        this.broadcastDataGuaranteed = (dataType, data) => this.application.connectionHandler.broadcastDataGuaranteed(dataType, data);
        this.application = new Application();
    }
    setApp(app) { }
    startStreamConnection(client) { }
    closeStreamConnection(client) { }
}
NAF.adapters.register('janus', JanusAdapter);
export default JanusAdapter;
