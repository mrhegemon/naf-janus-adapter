export const SUBSCRIBE_TIMEOUT_MS = 15000

export const OPUS_PARAMETERS = {
  // indicates that we want to enable DTX to elide silence packets
  usedtx: 1,
  // indicates that we prefer to receive mono audio (important for voip profile)
  stereo: 0,
  // indicates that we prefer to send mono audio (important for voip profile)
  'sprop-stereo': 0,
}

export const DEFAULT_PEER_CONNECTION_CONFIG = {
  iceServers: [
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export const WS_NORMAL_CLOSURE = 1000
