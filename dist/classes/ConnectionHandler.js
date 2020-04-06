var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { debug, error, warn } from '../util';
const NAF = require('networked-aframe');
import { WS_NORMAL_CLOSURE } from '../config';
export default class ConnectionHandler {
    constructor(application) {
        this.reliableTransport = 'datachannel';
        this.unreliableTransport = 'datachannel';
        this.initialReconnectionDelay = 1000 * Math.random();
        this.reconnectionDelay = this.initialReconnectionDelay;
        this.reconnectionTimeout = null;
        this.maxReconnectionAttempts = 10;
        this.reconnectionAttempts = 0;
        this.frozenUpdates = new Map();
        this.setPeerConnectionConfig = (peerConnectionConfig) => (this.peerConnectionConfig = peerConnectionConfig);
        this.setServerConnectListeners = (successListener, failureListener) => {
            this.connectSuccess = successListener;
            this.connectFailure = failureListener;
        };
        this.setWebRtcOptions = (options) => (this.application.webRtcHandler.webRtcOptions = options);
        this.onDataChannelMessage = (e, source) => this.onData(JSON.parse(e.data), source);
        this.toggleFreeze = () => (this.frozen ? this.unfreeze() : this.freeze());
        this.freeze = () => (this.frozen = true);
        this.unfreeze = () => {
            this.frozen = false;
            this.flushPendingUpdates();
        };
        this.onWebsocketMessage = (event) => this.session.receive(JSON.parse(event.data));
        this.dataForUpdateMultiMessage = (networkId, message) => {
            // "d" is an array of entity datas, where each item in the array represents a unique entity and contains
            // metadata for the entity, and an array of components that have been updated on the entity.
            // This method finds the data corresponding to the given networkId.
            for (let i = 0, l = message.data.d.length; i < l; i++)
                if (message.data.d[i].networkId === networkId)
                    return message.data.d[i];
            return null;
        };
        // Used externally
        this.getPendingDataForNetworkId = (networkId) => this.getPendingData(networkId, this.frozenUpdates.get(networkId));
        this.getConnectStatus = (clientId) => this.application.occupantHandler.occupants[clientId] ? NAF.adapters.IS_CONNECTED : NAF.adapters.NOT_CONNECTED;
        this.setServerUrl = (url) => (this.serverUrl = url);
        this.setRoom = (roomName) => (this.room = roomName);
        this.setJoinToken = (joinToken) => (this.joinToken = joinToken);
        this.setClientId = (clientId) => (this.clientId = clientId);
        this.sendJoin = (handle, subscribe) => handle.sendMessage({
            kind: 'join',
            room_id: this.room,
            user_id: this.clientId,
            subscribe,
            token: this.joinToken,
        });
        this.connect = () => {
            debug(`connecting to ${this.serverUrl}`);
            const websocketConnection = new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.serverUrl, 'janus-protocol');
                this.session = new this.application.mj.JanusSession(this.ws.send.bind(this.ws), {
                    timeoutMs: 30000,
                });
                const onError = () => reject(error);
                let onOpen = () => {
                    this.ws.removeEventListener('open', onOpen);
                    this.ws.removeEventListener('error', onError);
                    this.onWebsocketOpen().then(resolve).catch(reject);
                };
                this.ws.addEventListener('close', this.onWebsocketClose);
                this.ws.addEventListener('message', this.onWebsocketMessage);
                this.ws.addEventListener('open', onOpen);
            });
            return Promise.all([websocketConnection, this.application.timehandler.updateTimeOffset()]);
        };
        this.isDisconnected = () => this.ws === null;
        this.application = application;
    }
    onWebsocketOpen() {
        return __awaiter(this, void 0, void 0, function* () {
            // Create the Janus Session
            yield this.session.create();
            // Attach the SFU Plugin and create a RTCPeerConnection for the publisher.
            // The publisher sends audio and opens two bidirectional data channels.
            // One reliable datachannel and one unreliable.
            this.publisher = yield this.application.webRtcHandler.createPublisher();
            // Call the naf connectSuccess callback before we start receiving WebRTC messages.
            this.connectSuccess(this.clientId);
            const addOccupantPromises = [];
            for (const occupantId of this.publisher.initialOccupants)
                if (occupantId !== this.clientId)
                    addOccupantPromises.push(this.application.occupantHandler.addOccupant(occupantId));
            yield Promise.all(addOccupantPromises);
        });
    }
    onWebsocketClose(event) {
        // The connection was closed successfully. Don't try to reconnect.
        if (event.code === WS_NORMAL_CLOSURE)
            return;
        if (this.onReconnecting)
            this.onReconnecting(this.reconnectionDelay);
        this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay);
    }
    sendData(clientId, dataType, data) {
        if (!this.publisher)
            return console.warn('sendData called without a publisher');
        if (this.unreliableTransport == 'websocket')
            this.publisher.handle.sendMessage({
                kind: 'data',
                body: JSON.stringify({ dataType, data }),
                whom: clientId,
            });
        else if (this.unreliableTransport == 'datachannel')
            this.publisher.unreliableChannel.send(JSON.stringify({ clientId, dataType, data }));
        else
            error(`Reached default case on transport`);
    }
    sendDataGuaranteed(clientId, dataType, data) {
        if (!this.publisher)
            return console.warn('sendDataGuaranteed called without a publisher');
        if (this.reliableTransport == 'websocket')
            this.publisher.handle.sendMessage({
                kind: 'data',
                body: JSON.stringify({ dataType, data }),
                whom: clientId,
            });
        else if (this.reliableTransport == 'datachannel')
            this.publisher.reliableChannel.send(JSON.stringify({ clientId, dataType, data }));
        else
            error(`Reached default case on transport`);
    }
    broadcastData(dataType, data) {
        if (!this.publisher)
            return console.warn('broadcastData called without a publisher');
        if (this.unreliableTransport == 'websocket')
            this.publisher.handle.sendMessage({
                kind: 'data',
                body: JSON.stringify({ dataType, data }),
            });
        else if (this.unreliableTransport == 'datachannel')
            this.publisher.unreliableChannel.send(JSON.stringify({ dataType, data }));
        else
            error(`Reached default case on transport`);
    }
    broadcastDataGuaranteed(dataType, data) {
        if (!this.publisher)
            return warn('broadcastDataGuaranteed called without a publisher');
        if (this.reliableTransport == 'websocket')
            this.publisher.handle.sendMessage({
                kind: 'data',
                body: JSON.stringify({ dataType, data }),
            });
        else if (this.reliableTransport == 'datachannel')
            this.publisher.reliableChannel.send(JSON.stringify({ dataType, data }));
        else
            error(`Reached default case on transport`);
    }
    storeMessage(message) {
        if (message.dataType === 'um')
            // UpdateMulti
            for (let i = 0, l = message.data.d.length; i < l; i++)
                this.storeSingleMessage(message, i);
        else
            this.storeSingleMessage(message, 0);
    }
    storeSingleMessage(message, index) {
        const data = index !== undefined ? message.data.d[index] : message.data;
        const networkId = data.networkId;
        if (!this.frozenUpdates.has(networkId)) {
            this.frozenUpdates.set(networkId, message);
            return;
        }
        const storedMessage = this.frozenUpdates.get(networkId);
        const storedData = storedMessage.dataType === 'um' ? this.dataForUpdateMultiMessage(networkId, storedMessage) : storedMessage.data;
        // Avoid updating components if the entity data received did not come from the current owner.
        const isOutdatedMessage = data.lastOwnerTime < storedData.lastOwnerTime;
        const isContemporaneousMessage = data.lastOwnerTime === storedData.lastOwnerTime;
        if (isOutdatedMessage || (isContemporaneousMessage && storedData.owner > data.owner))
            return;
        if (message.dataType === 'r') {
            if (storedData && storedData.isFirstSync)
                this.frozenUpdates.delete(networkId);
            // If the entity was created and deleted while frozen, don't bother conveying anything to the consumer.
            else
                this.frozenUpdates.set(networkId, message); // Delete messages override any other messages for this entity
        }
        else if (storedData.components && data.components)
            Object.assign(storedData.components, data.components);
    }
    onData(message, source) {
        if (debug.enabled)
            debug(`DC in: ${message}`);
        if (!message.dataType)
            return;
        message.source = source;
        if (this.frozen)
            this.storeMessage(message);
        else
            this.application.occupantHandler.onOccupantMessage(null, message.dataType, message.data, message.source);
    }
    getPendingData(networkId, message) {
        if (!message)
            return null;
        let data = message.dataType === 'um' ? this.dataForUpdateMultiMessage(networkId, message) : message.data;
        // Ignore messages relating to users who have disconnected since freezing, their entities
        // will have aleady been removed by NAF.
        // Note that delete messages have no "owner" so we have to check for that as well.
        if (data.owner &&
            (!this.application.occupantHandler.occupants[data.owner] || this.application.occupantHandler.blockedClients.has(data.owner)))
            return null;
        return data;
    }
    flushPendingUpdates() {
        for (const [networkId, message] of this.frozenUpdates) {
            let data = this.getPendingData(networkId, message);
            if (!data)
                continue;
            // Override the data type on "um" messages types, since we extract entity updates from "um" messages into
            // individual frozenUpdates in storeSingleMessage.
            const dataType = message.dataType === 'um' ? 'u' : message.dataType;
            this.application.occupantHandler.onOccupantMessage(null, dataType, data, message.source);
        }
        this.frozenUpdates.clear();
    }
    setReconnectionListeners(reconnectingListener, reconnectedListener, reconnectionErrorListener) {
        // onReconnecting is
        this.onReconnecting = reconnectingListener; // called with number of ms until next reconnection attempt
        this.onReconnected = reconnectedListener; // called when connection reestablished
        this.onReconnectionError = reconnectionErrorListener; // called with an error when maxReconnectionAttempts has been reached
    }
    disconnect() {
        debug(`disconnecting`);
        clearTimeout(this.reconnectionTimeout);
        this.application.occupantHandler.removeAllOccupants();
        this.application.occupantHandler.leftOccupants = new Set();
        if (this.publisher) {
            // Close the publisher peer connection. Which also detaches the plugin handle.
            this.publisher.conn.close();
            this.publisher = null;
        }
        if (this.session) {
            this.session.dispose();
            this.session = null;
        }
        if (!this.ws)
            return;
        this.ws.removeEventListener('open', this.onWebsocketOpen);
        this.ws.removeEventListener('close', this.onWebsocketClose);
        this.ws.removeEventListener('message', this.onWebsocketMessage);
        this.ws.close();
        this.ws = null;
    }
    reconnect() {
        // Dispose of all networked entities and other resources tied to the session.
        this.disconnect();
        this.connect()
            .then(() => {
            this.reconnectionDelay = this.initialReconnectionDelay;
            this.reconnectionAttempts = 0;
            if (this.onReconnected)
                this.onReconnected();
        })
            .catch((error) => {
            this.reconnectionDelay += 1000;
            this.reconnectionAttempts++;
            if (this.reconnectionAttempts > this.maxReconnectionAttempts && this.onReconnectionError)
                return this.onReconnectionError(new Error('Connection could not be reestablished, exceeded maximum attempts.'));
            error(`Error during reconnect, ${error}`);
            if (this.onReconnecting)
                this.onReconnecting(this.reconnectionDelay);
            this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay);
        });
    }
    performDelayedReconnect() {
        if (this.delayedReconnectTimeout)
            clearTimeout(this.delayedReconnectTimeout);
        this.delayedReconnectTimeout = setTimeout(() => {
            this.delayedReconnectTimeout = null;
            this.reconnect();
        }, 10000);
    }
}
