var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { debounce, debug, error, untilDataChannelOpen, isH264VideoSupported } from '../util';
import { DEFAULT_PEER_CONNECTION_CONFIG, OPUS_PARAMETERS } from '../config';
var sdpUtils = require('sdp');
export default class WebRtcHandler {
    constructor(application) {
        this.webRtcOptions = {};
        this.fixSafariIceUFrag = (jsep) => __awaiter(this, void 0, void 0, function* () {
            // Safari produces a \n instead of an \r\n for the ice-ufrag. See https://github.com/meetecho/janus-gateway/issues/1818
            jsep.sdp = jsep.sdp.replace(/[^\r]\na=ice-ufrag/g, '\r\na=ice-ufrag');
            return jsep;
        });
        this.application = application;
    }
    createPublisher() {
        return __awaiter(this, void 0, void 0, function* () {
            const handle = new this.application.mj.JanusPluginHandle(this.application.connectionHandler.session);
            const conn = new RTCPeerConnection(this.application.connectionHandler.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
            debug('pub waiting for sfu');
            yield handle.attach('janus.plugin.sfu');
            this.associate(conn, handle);
            debug('pub waiting for data channels & webrtcup');
            const webrtcup = new Promise((resolve) => handle.on('webrtcup', resolve));
            // Unreliable datachannel: sending and receiving component updates.
            // Reliable datachannel: sending and recieving entity instantiations.
            const reliableChannel = conn.createDataChannel('reliable', { ordered: true });
            const unreliableChannel = conn.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 });
            reliableChannel.addEventListener('message', (e) => this.application.connectionHandler.onDataChannelMessage(e, 'janus-reliable'));
            unreliableChannel.addEventListener('message', (e) => this.application.connectionHandler.onDataChannelMessage(e, 'janus-unreliable'));
            yield webrtcup;
            yield untilDataChannelOpen(reliableChannel);
            yield untilDataChannelOpen(unreliableChannel);
            // doing this here is sort of a hack around chrome renegotiation weirdness --
            // if we do it prior to webrtcup, chrome on gear VR will sometimes put a
            // renegotiation offer in flight while the first offer was still being
            // processed by janus. we should find some more principled way to figure out
            // when janus is done in the future.
            if (this.application.mediaStreamHandler.localMediaStream)
                this.application.mediaStreamHandler.localMediaStream
                    .getTracks()
                    .forEach((track) => conn.addTrack(track, this.application.mediaStreamHandler.localMediaStream));
            // Handle all of the join and leave events.
            handle.on('event', (ev) => {
                const data = ev.plugindata.data;
                if (data.event == 'join' && data.room_id == this.application.connectionHandler.room) {
                    this.application.occupantHandler.addOccupant(data.user_id);
                }
                else if (data.event == 'leave' && data.room_id == this.application.connectionHandler.room) {
                    this.application.occupantHandler.removeOccupant(data.user_id);
                }
                else if (data.event == 'blocked') {
                    document.body.dispatchEvent(new CustomEvent('blocked', { detail: { clientId: data.by } }));
                }
                else if (data.event == 'unblocked') {
                    document.body.dispatchEvent(new CustomEvent('unblocked', { detail: { clientId: data.by } }));
                }
                else if (data.event === 'data') {
                    this.application.connectionHandler.onData(JSON.parse(data.body), 'janus-event');
                }
            });
            debug('pub waiting for join');
            // Send join message to janus. Listen for join/leave messages. Automatically subscribe to all users' WebRTC data.
            const message = yield this.application.connectionHandler.sendJoin(handle, {
                notifications: true,
                data: true,
            });
            if (!message.plugindata.data.success) {
                const err = message.plugindata.data.error;
                console.error(err);
                throw err;
            }
            const initialOccupants = message.plugindata.data.response.users[this.application.connectionHandler.room] || [];
            if (initialOccupants.includes(this.application.connectionHandler.clientId)) {
                console.warn('Janus still has previous session for this client. Reconnecting in 10s.');
                this.application.connectionHandler.performDelayedReconnect();
            }
            debug('publisher ready');
            return {
                handle,
                initialOccupants,
                reliableChannel,
                unreliableChannel,
                conn,
            };
        });
    }
    associate(conn, handle) {
        conn.addEventListener('icecandidate', (ev) => {
            handle.sendTrickle(ev.candidate || null).catch((e) => error('Error trickling ICE: %o', e));
        });
        conn.addEventListener('iceconnectionstatechange', (ev) => {
            if (conn.iceConnectionState === 'failed') {
                console.warn('ICE failure detected. Reconnecting in 10s.');
                this.application.connectionHandler.performDelayedReconnect();
            }
        });
        // we have to debounce these because janus gets angry if you send it a new SDP before
        // it's finished processing an existing SDP. in actuality, it seems like this is maybe
        // too liberal and we need to wait some amount of time after an offer before sending another,
        // but we don't currently know any good way of detecting exactly how long :(
        conn.addEventListener('negotiationneeded', debounce((ev) => {
            debug('Sending new offer for handle: %o', handle);
            const offer = conn.createOffer().then(this.configurePublisherSdp).then(this.fixSafariIceUFrag);
            const local = offer.then((o) => conn.setLocalDescription(o));
            let remote = offer
                .then(this.fixSafariIceUFrag)
                .then((j) => handle.sendJsep(j))
                .then((r) => conn.setRemoteDescription(r.jsep));
            return Promise.all([local, remote]).catch((e) => error('Error negotiating offer: %o', e));
        }));
        handle.on('event', debounce((ev) => {
            const jsep = ev.jsep;
            if (jsep && jsep.type == 'offer') {
                debug('Accepting new offer for handle: %o', handle);
                const answer = conn
                    .setRemoteDescription(this.configureSubscriberSdp(jsep))
                    .then((_) => conn.createAnswer())
                    .then(this.fixSafariIceUFrag);
                const local = answer.then((a) => conn.setLocalDescription(a));
                const remote = answer.then((j) => handle.sendJsep(j));
                return Promise.all([local, remote]).catch((e) => error('Error negotiating answer: %o', e));
            }
            else {
                // some other kind of event, nothing to do
                return null;
            }
        }));
    }
    configurePublisherSdp(jsep) {
        jsep.sdp = jsep.sdp.replace(/a=fmtp:(109|111).*\r\n/g, (line, pt) => {
            const parameters = Object.assign(sdpUtils.parseFmtp(line), OPUS_PARAMETERS);
            return sdpUtils.writeFmtp({ payloadType: pt, parameters: parameters });
        });
        return jsep;
    }
    configureSubscriberSdp(jsep) {
        // todo: consider cleaning up these hacks to use sdputils
        if (!isH264VideoSupported && navigator.userAgent.indexOf('HeadlessChrome') !== -1)
            jsep.sdp = jsep.sdp.replace(/m=video[^]*m=/, 'm=');
        // TODO: Hack to get video working on Chrome for Android. https://groups.google.com/forum/#!topic/mozilla.dev.media/Ye29vuMTpo8
        if (navigator.userAgent.indexOf('Android') === -1)
            jsep.sdp = jsep.sdp.replace('a=rtcp-fb:107 goog-remb\r\n', 'a=rtcp-fb:107 goog-remb\r\na=rtcp-fb:107 transport-cc\r\na=fmtp:107 level-asymmetry-allowed=1packetization-mode=1profile-level-id=42e01f\r\n');
        else
            jsep.sdp = jsep.sdp.replace('a=rtcp-fb:107 goog-remb\r\n', 'a=rtcp-fb:107 goog-remb\r\na=rtcp-fb:107 transport-cc\r\na=fmtp:107 level-asymmetry-allowed=1packetization-mode=1profile-level-id=42001f\r\n');
        return jsep;
    }
}
