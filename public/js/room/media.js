import { MicFx, loadMicSettings, saveMicSettings } from './mic-fx.js';

const ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ]
  }
];

const CHANNEL_KINDS = {
  media: ['audio', 'camera'],
  screen: ['screen']
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

function audioConstraintsFrom(settings) {
  return {
    echoCancellation: Boolean(settings.echoCancellation),
    noiseSuppression: Boolean(settings.noiseSuppression),
    autoGainControl: Boolean(settings.autoGainControl),
    ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {})
  };
}

const NATIVE_MIC_KEYS = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'deviceId'];

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: 'user'
};

function friendlyMediaError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'media.permission';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'media.notFound';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'media.busy';
    case 'OverconstrainedError':
      return 'media.overconstrained';
    default:
      return 'media.generic';
  }
}

/**
 * One RTCPeerConnection pair per remote participant:
 *   media  — microphone + camera (pre-negotiated, sendrecv)
 *   screen — screen share       (pre-negotiated, sendrecv)
 *
 * Both channels pre-create their transceivers so mic, camera, and screen can
 * be switched on later with replaceTrack() and no renegotiation.
 */
export class MediaMesh {
  constructor({ socket, onChange, onSpeaking, onError, audioContainer, translate }) {
    this.socket = socket;
    this.onChange = onChange ?? (() => {});
    this.onSpeaking = onSpeaking ?? (() => {});
    this.onError = onError ?? (() => {});
    this.audioContainer = audioContainer ?? document.body;
    this.translate = translate ?? ((key) => key);

    this.peers = new Map();
    this.tracks = { audio: null, camera: null, screen: null };
    this.localStreams = {
      audio: new MediaStream(),
      camera: new MediaStream(),
      screen: new MediaStream()
    };
    this.monitors = new Map();
    this.audioContext = null;
    this.micSettings = loadMicSettings();
    this.micFx = null;
    this.rawAudioTrack = null;
    this.processedAudioTrack = null;
    this._switchingMic = false;

    this.#bindSignaling();
  }

  /* ---------------- Public media controls ---------------- */

  async init({ mic, camera }) {
    this.resumeAudio();
    if (!mic && !camera) return { warning: null };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mic ? audioConstraintsFrom(this.micSettings) : false,
        video: camera ? VIDEO_CONSTRAINTS : false
      });
      await this.#adoptStream(stream);
      return { warning: null };
    } catch (error) {
      if (mic && camera) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraintsFrom(this.micSettings)
          });
          await this.#adoptStream(audioOnly);
          return { warning: this.translate('media.cameraOnlyWarning') };
        } catch (secondError) {
          return { warning: this.translate(friendlyMediaError(secondError)) };
        }
      }
      return { warning: this.translate(friendlyMediaError(error)) };
    }
  }

  async enableMic() {
    if (this.tracks.audio) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraintsFrom(this.micSettings)
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('no-audio-track');
      await this.#attachAudioTrack(track);
      this.onChange(null, 'audio');
      this.resumeAudio();
      return true;
    } catch (error) {
      this.onError(this.translate(friendlyMediaError(error)));
      return false;
    }
  }

  disableMic() {
    if (!this.tracks.audio && !this.rawAudioTrack) return;
    this.#stopAudioPipeline();
    if (this.tracks.audio) this.#setTrack('audio', null);
    this.onChange(null, 'audio');
  }

  async enableCamera() {
    if (this.tracks.camera) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: VIDEO_CONSTRAINTS
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('no-video-track');
      this.#watchTrack(track, 'camera');
      this.#setTrack('camera', track);
      this.onChange(null, 'camera');
      return true;
    } catch (error) {
      this.onError(this.translate(friendlyMediaError(error)));
      return false;
    }
  }

  disableCamera() {
    if (!this.tracks.camera) return;
    this.#setTrack('camera', null);
    this.onChange(null, 'camera');
  }

  async startScreen() {
    if (this.tracks.screen) return true;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.onError(this.translate('media.screenUnavailable'));
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 20, max: 30 } },
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('no-display-track');
      track.addEventListener('ended', () => this.stopScreen(), { once: true });
      this.#setTrack('screen', track);
      this.onChange(null, 'screen');
      return true;
    } catch (error) {
      if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') {
        this.onError(this.translate('media.screenStartFailed'));
      }
      return false;
    }
  }

  stopScreen() {
    if (!this.tracks.screen) return;
    this.#setTrack('screen', null);
    this.onChange(null, 'screen');
  }

  resumeAudio() {
    const context = this.#ensureAudioContext();
    if (context && context.state === 'suspended') {
      context.resume().catch(() => {});
    }
    for (const peer of this.peers.values()) {
      const media = peer.channels.media;
      if (media) this.#attachRemoteAudio(peer, media);
      peer.audioEl?.play?.().catch(() => {});
    }
  }

  /* ---------------- Mic voice processing (MicFx) ---------------- */

  getMicSettings() {
    return { ...this.micSettings };
  }

  getMicLevel() {
    return this.micFx?.getLevel() ?? { rms: 0, db: -60, gateOpen: true };
  }

  async listMicDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  /**
   * Update mic settings. Live WebAudio params apply instantly via
   * replaceTrack-free param changes; native (getUserMedia) params need a
   * fresh capture, swapped in place without renegotiation.
   */
  async setMicSettings(partial = {}) {
    const nativeChanged = NATIVE_MIC_KEYS.some(
      (key) => key in partial && partial[key] !== this.micSettings[key]
    );
    const enabledChanged =
      'enabled' in partial && partial.enabled !== this.micSettings.enabled;
    this.micSettings = { ...this.micSettings, ...partial };
    saveMicSettings(this.micSettings);
    if (nativeChanged && this.tracks.audio && !this._switchingMic) {
      await this.#refreshAudioTrack();
    } else if (enabledChanged && this.tracks.audio && this.rawAudioTrack) {
      // Rebuild (or bypass) the WebAudio chain on the same raw capture.
      await this.#attachAudioTrack(this.rawAudioTrack);
    } else {
      this.micFx?.update(this.micSettings);
    }
    return this.getMicSettings();
  }

  async #attachAudioTrack(rawTrack) {
    const previousFx = this.micFx;
    const previousRaw = this.rawAudioTrack;
    const fx = new MicFx(this.micSettings);
    const processed = await fx.process(rawTrack);
    this.micFx = fx;
    this.rawAudioTrack = rawTrack;
    this.processedAudioTrack = processed;
    rawTrack.addEventListener(
      'ended',
      () => {
        if (this.rawAudioTrack !== rawTrack) return; // already swapped
        this.#stopAudioPipeline();
        this.#setTrack('audio', null);
        this.onChange(null, 'audio');
        this.onError(this.translate('media.micDisconnected'));
      },
      { once: true }
    );
    // Swap the sent track, then retire the previous pipeline.
    this.#setTrack('audio', processed);
    if (previousFx && previousFx !== fx) previousFx.teardown(false);
    if (previousRaw && previousRaw !== rawTrack) {
      try { previousRaw.stop(); } catch { /* ignore */ }
    }
    return processed;
  }

  async #refreshAudioTrack() {
    if (this._switchingMic) return;
    this._switchingMic = true;
    const previousRaw = this.rawAudioTrack;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraintsFrom(this.micSettings)
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('no-audio-track');
      await this.#attachAudioTrack(track);
      if (previousRaw && previousRaw !== track) {
        try { previousRaw.stop(); } catch { /* ignore */ }
      }
      this.onChange(null, 'audio');
    } catch (error) {
      this.onError(this.translate(friendlyMediaError(error)));
    } finally {
      this._switchingMic = false;
    }
  }

  #stopAudioPipeline() {
    if (this.micFx) {
      this.micFx.teardown(false);
      this.micFx = null;
    }
    if (this.rawAudioTrack && this.rawAudioTrack !== this.processedAudioTrack) {
      try { this.rawAudioTrack.stop(); } catch { /* ignore */ }
    }
    this.rawAudioTrack = null;
    this.processedAudioTrack = null;
  }

  /* ---------------- Streams ---------------- */

  getLocalStream(kind) {
    return this.localStreams[kind] ?? null;
  }

  getRemoteStream(peerId, kind) {
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    const channelName = kind === 'screen' ? 'screen' : 'media';
    const channel = peer.channels[channelName];
    return channel?.streams?.[kind] ?? null;
  }

  isOn(kind) {
    return Boolean(this.tracks[kind]);
  }

  hasPeer(id) {
    return this.peers.has(id);
  }

  /* ---------------- Peer lifecycle ---------------- */

  async connectToPeer(id) {
    if (!id) return;
    const peer = this.#ensurePeer(id);
    await Promise.allSettled(
      ['media', 'screen'].map((name) => this.#negotiate(peer, name))
    );
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    for (const channel of Object.values(peer.channels)) {
      if (!channel) continue;
      channel.pc.onicecandidate = null;
      channel.pc.ontrack = null;
      channel.pc.onconnectionstatechange = null;
      try {
        channel.pc.close();
      } catch {
        // already closed
      }
    }
    this.#stopMonitor(`remote:${id}`);
    if (peer.audioEl) {
      peer.audioEl.pause?.();
      peer.audioEl.srcObject = null;
      peer.audioEl.remove();
    }
    this.peers.delete(id);
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  dispose() {
    this.closeAll();
    this.#stopAudioPipeline();
    for (const kind of Object.keys(this.tracks)) {
      if (this.tracks[kind]) {
        try {
          this.tracks[kind].stop();
        } catch {
          // ignore
        }
        this.tracks[kind] = null;
      }
    }
    this.#stopMonitor('local');
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  /* ---------------- Signaling ---------------- */

  #bindSignaling() {
    this.socket.on('webrtc:offer', (payload) => this.#handleOffer(payload));
    this.socket.on('webrtc:answer', (payload) => this.#handleAnswer(payload));
    this.socket.on('webrtc:ice', (payload) => this.#handleIce(payload));
  }

  async #handleOffer({ from, channel: channelName, sdp }) {
    if (!from || !CHANNEL_KINDS[channelName] || !sdp) return;
    const peer = this.#ensurePeer(from);
    let channel = peer.channels[channelName];

    try {
      if (!channel) {
        channel = this.#createChannel(peer, channelName, { withTransceivers: false });
      }
      if (channel.pc.signalingState !== 'stable') {
        // A simultaneous offer would be unusual; the joiner is always the
        // initiator, so we simply ignore the duplicate.
        return;
      }
      await channel.pc.setRemoteDescription(sdp);
      this.#configureIncomingTransceivers(peer, channel);
      await this.#flushCandidates(channel);
      const answer = await channel.pc.createAnswer();
      await channel.pc.setLocalDescription(answer);
      this.socket.emit('webrtc:answer', {
        to: from,
        channel: channelName,
        sdp: channel.pc.localDescription
      });
    } catch (error) {
      console.error('WebRTC offer failed', error);
      this.onError(this.translate('media.peerOfferFailed'));
    }
  }

  async #handleAnswer({ from, channel: channelName, sdp }) {
    if (!from || !CHANNEL_KINDS[channelName] || !sdp) return;
    const peer = this.peers.get(from);
    const channel = peer?.channels?.[channelName];
    if (!channel) return;

    try {
      await channel.pc.setRemoteDescription(sdp);
      this.#bindReceivers(peer, channel);
      await this.#flushCandidates(channel);
    } catch (error) {
      console.error('WebRTC answer failed', error);
      this.onError(this.translate('media.peerAnswerFailed'));
    }
  }

  async #handleIce({ from, channel: channelName, candidate }) {
    if (!from || !candidate || !CHANNEL_KINDS[channelName]) return;
    const peer = this.peers.get(from);
    if (!peer) return;
    const channel = peer.channels[channelName];
    if (!channel) {
      peer.iceQueue[channelName].push(candidate);
      return;
    }
    if (!channel.pc.remoteDescription) {
      channel.pendingCandidates.push(candidate);
      return;
    }
    try {
      // Rebuild a real RTCIceCandidate when available; a plain dict also
      // works in most browsers, but the constructor is the portable form.
      const init =
        typeof RTCIceCandidate === 'function'
          ? (() => { try { return new RTCIceCandidate(candidate); } catch { return candidate; } })()
          : candidate;
      await channel.pc.addIceCandidate(init);
    } catch {
      // Candidates arriving after close are harmless.
    }
  }

  async #negotiate(peer, channelName) {
    const channel =
      peer.channels[channelName] ??
      this.#createChannel(peer, channelName, { withTransceivers: true });
    if (channel.pc.signalingState !== 'stable') return;

    try {
      const offer = await channel.pc.createOffer();
      await channel.pc.setLocalDescription(offer);
      this.socket.emit('webrtc:offer', {
        to: peer.id,
        channel: channelName,
        sdp: channel.pc.localDescription
      });
    } catch (error) {
      console.error('WebRTC negotiation failed', error);
    }
  }

  #ensurePeer(id) {
    let peer = this.peers.get(id);
    if (peer) return peer;

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.muted = false;
    audioEl.volume = 1;
    audioEl.dataset.peer = id;
    this.audioContainer.append(audioEl);

    peer = {
      id,
      channels: { media: null, screen: null },
      iceQueue: { media: [], screen: [] },
      audioEl
    };
    this.peers.set(id, peer);
    return peer;
  }

  #createChannel(peer, name, { withTransceivers }) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = {
      name,
      pc,
      kinds: {},
      senders: {},
      streams: {
        audio: new MediaStream(),
        camera: new MediaStream(),
        screen: new MediaStream()
      },
      pendingCandidates: [...peer.iceQueue[name]],
      hasRemoteDescription: false
    };
    peer.iceQueue[name] = [];
    peer.channels[name] = channel;

    if (withTransceivers) {
      for (const kind of CHANNEL_KINDS[name]) {
        const transceiver = pc.addTransceiver(kind === 'audio' ? 'audio' : 'video', {
          direction: 'sendrecv'
        });
        this.#registerTransceiver(peer, channel, kind, transceiver);
        if (this.tracks[kind]) {
          transceiver.sender.replaceTrack(this.tracks[kind]).catch(() => {});
        }
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      // A raw RTCIceCandidate does not always survive Socket.IO's JSON
      // encoding — send a plain object explicitly.
      const candidate =
        typeof event.candidate.toJSON === 'function'
          ? event.candidate.toJSON()
          : event.candidate;
      this.socket.emit('webrtc:ice', {
        to: peer.id,
        channel: name,
        candidate
      });
    };

    pc.ontrack = (event) => {
      const kind = this.#kindFor(channel, event.transceiver);
      if (!kind) return;
      const stream = channel.streams[kind];
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      if (kind === 'audio') this.#attachRemoteAudio(peer, channel);
      this.onChange(peer.id, kind);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && name === 'media') {
        // (Re)bind the audio element once the transport is up — ontrack
        // may have fired before the element was ready to play.
        this.#attachRemoteAudio(peer, channel);
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        const peerId = peer.id;
        const wasFailed = pc.connectionState === 'failed';
        // Tear the dead pair down and try one fresh negotiation so a
        // transient network blip does not mute a peer forever.
        this.closePeer(peerId);
        if (wasFailed) this.onError(this.translate('media.peerFailed'));
        setTimeout(() => {
          if (this.peers.has(peerId) || !this.socket?.connected) return;
          this.connectToPeer(peerId).catch(() => {});
        }, 1500);
      }
    };

    return channel;
  }

  #configureIncomingTransceivers(peer, channel) {
    const transceivers = channel.pc.getTransceivers();
    const kinds = CHANNEL_KINDS[channel.name];
    channel.hasRemoteDescription = true;

    transceivers.forEach((transceiver, index) => {
      const kind = kinds[index];
      if (!kind) return;
      try {
        transceiver.direction = 'sendrecv';
      } catch {
        // Some browsers may lock direction at this point; the answer will
        // still work as recvonly, only the late local track is affected.
      }
      this.#registerTransceiver(peer, channel, kind, transceiver);
      if (this.tracks[kind]) {
        transceiver.sender.replaceTrack(this.tracks[kind]).catch(() => {});
      }
    });

    this.#attachRemoteAudio(peer, channel);
  }

  #registerTransceiver(peer, channel, kind, transceiver) {
    channel.kinds[kind] = transceiver;
    channel.senders[kind] = transceiver.sender;
    const stream = channel.streams[kind];
    const track = transceiver.receiver.track;
    if (track && !stream.getTracks().includes(track)) stream.addTrack(track);
    if (kind === 'audio') this.#attachRemoteAudio(peer, channel);
  }

  #bindReceivers(peer, channel) {
    channel.hasRemoteDescription = true;
    for (const kind of CHANNEL_KINDS[channel.name]) {
      const transceiver = channel.kinds[kind];
      const track = transceiver?.receiver?.track;
      if (track && !channel.streams[kind].getTracks().includes(track)) {
        channel.streams[kind].addTrack(track);
      }
    }
    this.#attachRemoteAudio(peer, channel);
  }

  async #flushCandidates(channel) {
    const pending = channel.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        const init =
          typeof RTCIceCandidate === 'function'
            ? (() => { try { return new RTCIceCandidate(candidate); } catch { return candidate; } })()
            : candidate;
        await channel.pc.addIceCandidate(init);
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  #kindFor(channel, transceiver) {
    for (const [kind, candidate] of Object.entries(channel.kinds)) {
      if (candidate === transceiver) return kind;
    }
    const index = channel.pc.getTransceivers().indexOf(transceiver);
    return CHANNEL_KINDS[channel.name][index] ?? null;
  }

  #attachRemoteAudio(peer, channel) {
    // Only the media channel carries audio. The screen channel has an
    // (empty) audio stream placeholder — assigning it would overwrite the
    // real media stream and silence the peer.
    if (channel.name !== 'media') return;
    if (peer.audioEl.srcObject !== channel.streams.audio) {
      peer.audioEl.srcObject = channel.streams.audio;
    }
    peer.audioEl.muted = false;
    peer.audioEl.volume = 1;
    peer.audioEl.play?.().catch(() => {});
    this.#monitor(`remote:${peer.id}`, channel.streams.audio);
  }

  /* ---------------- Local tracks ---------------- */

  async #adoptStream(stream) {
    for (const track of stream.getTracks()) {
      if (track.kind === 'audio') {
        // Raw mic -> MicFx -> processed track actually sent to peers.
        await this.#attachAudioTrack(track);
      } else if (track.kind === 'video') {
        this.#watchTrack(track, 'camera');
        this.#setTrack('camera', track);
      }
    }
  }

  #setTrack(kind, track) {
    const previous = this.tracks[kind] ?? null;
    if (previous === track) return;

    this.tracks[kind] = track;
    const localStream = this.localStreams[kind];
    for (const existing of localStream.getTracks()) localStream.removeTrack(existing);
    if (track) localStream.addTrack(track);

    for (const peer of this.peers.values()) {
      for (const channel of Object.values(peer.channels)) {
        const sender = channel?.senders?.[kind];
        if (!sender) continue;
        sender.replaceTrack(track).catch(() => {});
      }
    }

    if (previous) {
      try {
        previous.stop();
      } catch {
        // already stopped
      }
    }

    if (kind === 'audio') {
      this.#stopMonitor('local');
      if (track) this.#monitor('local', localStream);
    }
    if (kind === 'camera' || kind === 'screen') this.onChange(null, kind);
  }

  #watchTrack(track, kind) {
    track.addEventListener(
      'ended',
      () => {
        if (this.tracks[kind] !== track) return;
        this.#setTrack(kind, null);
        this.onChange(null, kind);
        this.onError(
          this.translate(
            kind === 'screen'
              ? 'media.screenStopped'
              : kind === 'audio'
                ? 'media.micDisconnected'
                : 'media.cameraDisconnected'
          )
        );
      },
      { once: true }
    );
  }

  /* ---------------- Speaking detection ---------------- */

  #ensureAudioContext() {
    if (this.audioContext) return this.audioContext;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.audioContext = new AudioCtx();
      return this.audioContext;
    } catch {
      return null;
    }
  }

  #monitor(key, stream) {
    if (!stream || !stream.getAudioTracks().length) return;
    this.#stopMonitor(key);

    const context = this.#ensureAudioContext();
    if (!context) return;

    context.resume().catch(() => {});

    let source;
    let analyser;
    try {
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
    } catch {
      return;
    }

    const data = new Uint8Array(analyser.fftSize);
    let speaking = false;
    let frame = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / data.length);
      const isSpeaking = rms > 0.045;
      if (isSpeaking !== speaking) {
        speaking = isSpeaking;
        this.onSpeaking(key === 'local' ? 'self' : key.slice('remote:'.length), isSpeaking);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    this.monitors.set(key, () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
    });
  }

  #stopMonitor(key) {
    const stop = this.monitors.get(key);
    if (!stop) return;
    stop();
    this.monitors.delete(key);
  }
}
