// AudioWorklet processor: batches mic input into ~128 ms Float32 chunks.
// Plain JS on purpose — worklet modules are loaded as standalone files.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.length = 0;
    this.target = 2048; // 128 ms at 16 kHz
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.chunks.push(new Float32Array(channel));
      this.length += channel.length;
      if (this.length >= this.target) {
        const out = new Float32Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        this.chunks = [];
        this.length = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
