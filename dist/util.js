export const debounce = (...args) => {
    let curr = Promise.resolve();
    return () => curr = curr.then((_) => this.apply(this, Array.prototype.slice.call(args)));
};
export const randomUint = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
export const isH264VideoSupported = (() => {
    const video = document.createElement('video');
    return video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== '';
})();
export const untilDataChannelOpen = (dataChannel) => new Promise((resolve, reject) => {
    if (dataChannel.readyState === 'open')
        return resolve();
    let resolver;
    let rejector;
    const clear = () => {
        dataChannel.removeEventListener('open', resolver);
        dataChannel.removeEventListener('error', rejector);
    };
    resolver = () => {
        clear();
        resolve();
    };
    rejector = () => {
        clear();
        reject();
    };
    dataChannel.addEventListener('open', resolver);
    dataChannel.addEventListener('error', rejector);
});
export const enableMicrophone = (enabled) => { var _a; return (_a = (this.publisher && this.publisher.conn)) !== null && _a !== void 0 ? _a : this.publisher.conn.getSenders().forEach(s => s.track.enabled = s.track.kind === 'audio' ? enabled : s.track.enabled); };
export const debug = require('debug')('naf-janus-adapter:debug');
export const warn = require('debug')('naf-janus-adapter:warn');
export const error = require('debug')('naf-janus-adapter:error');
export const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
