var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { debug, isSafari } from '../util';
import { DEFAULT_PEER_CONNECTION_CONFIG, SUBSCRIBE_TIMEOUT_MS } from '../config';
const mj = require('minijanus');
export default class OccupantHandler {
    constructor(application) {
        this.occupants = {};
        this.leftOccupants = new Set();
        this.blockedClients = new Map();
        this.setRoomOccupantListener = (occupantListener) => (this.onOccupantsChanged = occupantListener);
        this.kick = (clientId, permsToken) => this.application.connectionHandler.publisher.handle
            .sendMessage({
            kind: 'kick',
            room_id: this.application.connectionHandler.room,
            user_id: clientId,
            token: permsToken,
        })
            .then(() => {
            document.body.dispatchEvent(new CustomEvent('kicked', { detail: { clientId: clientId } }));
        });
        this.block = (clientId) => this.application.connectionHandler.publisher.handle.sendMessage({ kind: 'block', whom: clientId }).then(() => {
            this.blockedClients.set(clientId, true);
            document.body.dispatchEvent(new CustomEvent('blocked', { detail: { clientId: clientId } }));
        });
        this.unblock = (clientId) => this.application.connectionHandler.publisher.handle.sendMessage({ kind: 'unblock', whom: clientId }).then(() => {
            this.blockedClients.delete(clientId);
            document.body.dispatchEvent(new CustomEvent('unblocked', { detail: { clientId: clientId } }));
        });
        this.removeAllOccupants = () => {
            for (const occupantId of Object.getOwnPropertyNames(this.occupants))
                this.removeOccupant(occupantId);
        };
        this.application = application;
    }
    setDataChannelListeners(openListener, closedListener, messageListener) {
        this.onOccupantConnected = openListener;
        this.onOccupantDisconnected = closedListener;
        this.onOccupantMessage = messageListener;
    }
    addOccupant(occupantId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.occupants[occupantId])
                this.removeOccupant(occupantId);
            this.leftOccupants.delete(occupantId);
            const subscriber = yield this.createSubscriber(occupantId);
            if (!subscriber)
                return;
            this.occupants[occupantId] = subscriber;
            this.application.mediaStreamHandler.setMediaStream(occupantId, subscriber.mediaStream);
            // Call the Networked AFrame callbacks for the new occupant.
            this.onOccupantConnected(occupantId);
            this.onOccupantsChanged(this.occupants);
            return subscriber;
        });
    }
    removeOccupant(occupantId) {
        this.leftOccupants.add(occupantId);
        if (!this.occupants[occupantId])
            return;
        // Close the subscriber peer connection. Which also detaches the plugin handle.
        if (this.occupants[occupantId]) {
            this.occupants[occupantId].conn.close();
            delete this.occupants[occupantId];
        }
        if (this.application.mediaStreamHandler.mediaStreams[occupantId])
            delete this.application.mediaStreamHandler.mediaStreams[occupantId];
        if (this.application.mediaStreamHandler.pendingMediaRequests.has(occupantId)) {
            const msg = 'The user disconnected before the media stream was resolved.';
            this.application.mediaStreamHandler.pendingMediaRequests.get(occupantId).audio.reject(msg);
            this.application.mediaStreamHandler.pendingMediaRequests.get(occupantId).video.reject(msg);
            this.application.mediaStreamHandler.pendingMediaRequests.delete(occupantId);
        }
        // Call the Networked AFrame callbacks for the removed occupant.
        this.onOccupantDisconnected(occupantId);
        this.onOccupantsChanged(this.occupants);
    }
    createSubscriber(occupantId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.leftOccupants.has(occupantId))
                return console.warn(`${occupantId}: cancelled occupant connection, occupant left before subscription negotation.`);
            const handle = new mj.JanusPluginHandle(this.application.connectionHandler.session);
            const conn = new RTCPeerConnection(this.application.connectionHandler.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
            debug(`${occupantId}: sub waiting for sfu`);
            yield handle.attach('janus.plugin.sfu');
            this.application.webRtcHandler.associate(conn, handle);
            debug(`${occupantId}: sub waiting for join`);
            if (this.leftOccupants.has(occupantId)) {
                conn.close();
                console.warn(`${occupantId}: cancelled occupant connection, occupant left after attach`);
                return null;
            }
            let webrtcFailed = false;
            const webrtcup = new Promise((resolve) => {
                const leftInterval = setInterval(() => {
                    if (this.leftOccupants.has(occupantId)) {
                        clearInterval(leftInterval);
                        resolve();
                    }
                }, 1000);
                const timeout = setTimeout(() => {
                    clearInterval(leftInterval);
                    webrtcFailed = true;
                    resolve();
                }, SUBSCRIBE_TIMEOUT_MS);
                handle.on('webrtcup', () => {
                    clearTimeout(timeout);
                    clearInterval(leftInterval);
                    resolve();
                });
            });
            // Send join message to janus. Don't listen for join/leave messages. Subscribe to the occupant's media.
            // Janus should send us an offer for this occupant's media in response to this.
            yield this.application.connectionHandler.sendJoin(handle, { media: occupantId });
            if (this.leftOccupants.has(occupantId)) {
                conn.close();
                console.warn(`${occupantId}: cancelled occupant connection, occupant left after join`);
                return null;
            }
            debug(`${occupantId}: sub waiting for webrtcup`);
            yield webrtcup;
            if (this.leftOccupants.has(occupantId)) {
                conn.close();
                console.warn(`${occupantId}: cancel occupant connection, occupant left during or after webrtcup`);
                return null;
            }
            if (webrtcFailed) {
                conn.close();
                console.warn(`${occupantId}: webrtc up timed out`);
                return null;
            }
            if (isSafari && !this._iOSHackDelayedInitialPeer) {
                // HACK: the first peer on Safari during page load can fail to work if we don't
                // wait some time before continuing here. See: https://github.com/mozilla/hubs/pull/1692
                yield new Promise((resolve) => setTimeout(resolve, 3000));
                this._iOSHackDelayedInitialPeer = true;
            }
            let mediaStream = new MediaStream();
            conn.getReceivers().forEach((receiver) => { var _a; return (_a = receiver.track) !== null && _a !== void 0 ? _a : mediaStream.addTrack(receiver.track); });
            if (mediaStream.getTracks().length === 0)
                mediaStream = null;
            debug(`${occupantId}: subscriber ready`);
            return { handle, mediaStream, conn };
        });
    }
}
