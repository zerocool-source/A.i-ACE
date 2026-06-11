// Video settings: resolution upscaling in the DLSS/FSR architecture, done
// web-native — the game renders its canvas backing store at a reduced
// internal resolution and the compositor upscales to the output resolution,
// with an optional convolution sharpen pass (FSR-1-style spatial upscale).
// Persisted separately from the character save so wiping a run keeps your
// graphics choices. No third-party binaries involved.
const KEY = 'deadzone-settings-v1';

// internal render scale per mode — the standard DLSS/FSR quality ladder
export const UPSCALE_MODES = [
  { id: 'off', name: 'OFF (NATIVE)', scale: 1.0, desc: 'full-resolution rendering' },
  { id: 'quality', name: 'QUALITY', scale: 0.77, desc: '1.3x upscale — near-native look' },
  { id: 'balanced', name: 'BALANCED', scale: 0.67, desc: '1.5x upscale — the sweet spot' },
  { id: 'performance', name: 'PERFORMANCE', scale: 0.5, desc: '2x upscale — big GPU savings' },
  { id: 'ultra', name: 'ULTRA PERFORMANCE', scale: 0.33, desc: '3x upscale — weakest hardware' },
];

export const settings = { upscale: 'off', sharpen: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch {
  /* corrupted or unavailable storage — defaults stand */
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. — session-only settings */
  }
}

export function upscaleMode() {
  return UPSCALE_MODES.find((m) => m.id === settings.upscale) || UPSCALE_MODES[0];
}

// runtime GPU vendor detection via the WebGL renderer string — purely
// informational here (canvas 2D has no vendor-specific upscalers), but it
// tells players what silicon the browser is compositing on
export function detectGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { vendor: 'UNKNOWN', renderer: 'WebGL unavailable' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const r = String(raw || '');
    const vendor = /nvidia|geforce|rtx|gtx/i.test(r) ? 'NVIDIA'
      : /amd|radeon/i.test(r) ? 'AMD'
        : /intel|iris|uhd/i.test(r) ? 'INTEL'
          : /apple|m\d/i.test(r) ? 'APPLE'
            : /adreno|mali|qualcomm/i.test(r) ? 'MOBILE'
              : 'UNKNOWN';
    return { vendor, renderer: r.slice(0, 64) };
  } catch {
    return { vendor: 'UNKNOWN', renderer: 'detection failed' };
  }
}
