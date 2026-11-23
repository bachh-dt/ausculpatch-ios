/** Soft clipping adds harmonics (150, 250 Hz...) of the 50 Hz heart sounds, which a phone speaker can play. */
export function speakerBoost(x: Float32Array, drive = 3): Float32Array {
  const norm = Math.tanh(drive);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(drive * x[i]) / norm;
  return out;
}
