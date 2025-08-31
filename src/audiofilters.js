// This file is a copy of the server implementation, packaged for npm consumption.
// Port of the provided Python audiofilters to Node.js (ESM)
// Exposes enums and an AudioFilters class producing biquad coefficients.

// Unified filter design metadata: numeric id + descriptive info
export const FilterDesigns = Object.freeze({
  Bessel6:      { id: 0x00, family: 'Bessel',         order: 1, slopeDbPerOct: 6,  sections: 1, kind: 'crossover', aliases: ['bessel6'] },
  Bessel12:     { id: 0x01, family: 'Bessel',         order: 2, slopeDbPerOct: 12, sections: 1, kind: 'crossover', aliases: ['bessel12'] },
  Bessel18:     { id: 0x02, family: 'Bessel',         order: 3, slopeDbPerOct: 18, sections: 2, kind: 'crossover', aliases: ['bessel18'] },
  Bessel24:     { id: 0x03, family: 'Bessel',         order: 4, slopeDbPerOct: 24, sections: 2, kind: 'crossover', aliases: ['bessel24'] },
  Butterworth12:{ id: 0x04, family: 'Butterworth',    order: 2, slopeDbPerOct: 12, sections: 1, kind: 'crossover', aliases: ['butterworth12','butter12'] },
  Butterworth18:{ id: 0x05, family: 'Butterworth',    order: 3, slopeDbPerOct: 18, sections: 2, kind: 'crossover', aliases: ['butterworth18','butter18'] },
  Butterworth24:{ id: 0x06, family: 'Butterworth',    order: 4, slopeDbPerOct: 24, sections: 2, kind: 'crossover', aliases: ['butterworth24','butter24'] },
  LinkwitzRiley12: { id: 0x07, family: 'Linkwitz-Riley', order: 2, slopeDbPerOct: 12, sections: 1, kind: 'crossover', aliases: ['linkwitz12','lr12'], stageQ: [0.5] },
  LinkwitzRiley24: { id: 0x08, family: 'Linkwitz-Riley', order: 4, slopeDbPerOct: 24, sections: 2, kind: 'crossover', aliases: ['linkwitz24','lr24'], stageQ: [0.71, 0.71] },
  LinkwitzRiley36: { id: 0x09, family: 'Linkwitz-Riley', order: 6, slopeDbPerOct: 36, sections: 3, kind: 'crossover', aliases: ['linkwitz36','lr36'], stageQ: [0.5, 1.0, 1.0] },
  LinkwitzRiley48: { id: 0x0a, family: 'Linkwitz-Riley', order: 8, slopeDbPerOct: 48, sections: 4, kind: 'crossover', aliases: ['linkwitz48','lr48'], stageQ: [0.54, 1.34, 0.54, 1.34] },
});

// Backwards-compatible enums derived from metadata
export const filterDesign = Object.freeze(Object.fromEntries(
  Object.entries(FilterDesigns).map(([k, v]) => [k, v.id])
));

export const filterLength = Object.freeze(Object.fromEntries(
  Object.entries(FilterDesigns).map(([k, v]) => [k, v.sections])
));

export const bqFilterDesign = Object.freeze({
  PEAK: 0x00,
  LOWPASS: 0x01,
  HIGHPASS: 0x02,
  BANDPASS: 0x03,
  NOTCH: 0x04,
  LOWSHELF: 0x05,
  HIGHSHELF: 0x06,
  ALLPASS: 0x07,
  LOWPASS_FO: 0x08,
  HIGHPASS_FO: 0x09,
  LOWSHELF_FO: 0x0a,
  HIGHSHELF_FO: 0x0b,
  ALLPASS_FO: 0x0c,
  NONE: 0x0d,
});

// Internal lookup maps
const DESIGN_BY_ID = Object.freeze(Object.fromEntries(
  Object.entries(FilterDesigns).map(([k, v]) => [v.id, { key: k, ...v }])
));
const DESIGN_BY_ALIAS = Object.freeze(Object.fromEntries(
  Object.entries(FilterDesigns).flatMap(([k, v]) => (
    (v.aliases || []).map(a => [String(a).toLowerCase(), k])
  ))
));

export class AudioFilters {
  constructor() {
    // Define bypass coefficients (unity gain filter)
    this.bypass = { b0: 1.0, b1: 0.0, b2: 0.0, a0: 1.0, a1: 0.0, a2: 0.0 };
  }

  defaultCoefficients() {
  // Return a fresh copy so callers can safely mutate without affecting the shared bypass object
  return { ...this.bypass };
  }

  designMap() {
    // Auto-generate legacy name->id mapping from aliases
    const out = {};
    for (const [key, meta] of Object.entries(FilterDesigns)) {
      const id = meta.id;
      (meta.aliases || []).forEach(alias => { out[String(alias).toLowerCase()] = id; });
    }
    return out;
  }

  filtersRequiredForDesign(design) {
    const key = DESIGN_BY_ALIAS[String(design).toLowerCase()];
    return key ? FilterDesigns[key].sections : 1;
  }

  getLengthForDesign(design) {
    const meta = DESIGN_BY_ID[design];
    return meta?.sections ?? 1;
  }

  // Optional helper to fetch rich metadata by id or alias
  getDesignInfo(identifier) {
    if (typeof identifier === 'number') return DESIGN_BY_ID[identifier] ?? null;
    const key = DESIGN_BY_ALIAS[String(identifier).toLowerCase()];
    return key ? { key, ...FilterDesigns[key] } : null;
  }

  makeParametricEQ(gain, fc, Q, fs, design, bypass = false) {
  if (bypass === true) return this.defaultCoefficients();
    if (design === bqFilterDesign.LOWSHELF) {
      return this.makeLowShelv(gain, fc, Q, fs, bypass);
    } else if (design === bqFilterDesign.HIGHSHELF) {
      return this.makeHighShelv(gain, fc, Q, fs, bypass);
    } else if (design === bqFilterDesign.ALLPASS) {
      return this.makeAllpass(fc, Q, fs, false, bypass);
    }

    const pi = Math.PI;
    const w0 = 2.0 * pi * fc / fs;
    const BW = Math.asinh((1.0 / Q) / 2.0) / (Math.log(2.0) / 2.0);
    let alpha = 0.0;
    if (design === bqFilterDesign.PEAK) {
      alpha = Math.sin(w0) * Math.sinh(Math.log(2.0) / 2.0 * BW * w0 / Math.sin(w0));
    } else {
      alpha = Math.sin(w0) / (2.0 * Q);
    }
    const A = Math.pow(10.0, Math.abs(gain) / 20.0);
    const K = Math.tan(pi * (fc / fs));

    let b0 = 1.0, b1 = 0.0, b2 = 0.0, a0 = 1.0, a1 = 0.0, a2 = 0.0;

    if (design === bqFilterDesign.PEAK) {
      if (gain >= 0) {
        const norm = 1.0 / (1.0 + 1.0 / Q * K + K * K);
        a0 = (1.0 + A / Q * K + K * K) * norm;
        a1 = 2.0 * (K * K - 1.0) * norm;
        a2 = (1.0 - A / Q * K + K * K) * norm;
        b1 = a1;
        b2 = (1.0 - 1.0 / Q * K + K * K) * norm;
      } else {
        const norm = 1.0 / (1.0 + A / Q * K + K * K);
        a0 = (1.0 + 1 / Q * K + K * K) * norm;
        a1 = 2.0 * (K * K - 1.0) * norm;
        a2 = (1.0 - 1.0 / Q * K + K * K) * norm;
        b1 = a1;
        b2 = (1.0 - A / Q * K + K * K) * norm;
      }
    } else if (design === bqFilterDesign.LOWPASS) {
      const norm = 1 / (1 + K / Q + K * K);
      a0 = K * K * norm;
      a1 = 2 * a0;
      a2 = a0;
      b1 = 2 * (K * K - 1) * norm;
      b2 = (1 - K / Q + K * K) * norm;
    } else if (design === bqFilterDesign.HIGHPASS) {
      const norm = 1 / (1 + K / Q + K * K);
      a0 = 1 * norm;
      a1 = -2 * a0;
      a2 = a0;
      b1 = 2 * (K * K - 1) * norm;
      b2 = (1 - K / Q + K * K) * norm;
    } else if (design === bqFilterDesign.BANDPASS) {
      const norm = 1 / (1 + K / Q + K * K);
      a0 = K / Q * norm;
      a1 = 0;
      a2 = -a0;
      b1 = 2 * (K * K - 1) * norm;
      b2 = (1 - K / Q + K * K) * norm;
    } else if (design === bqFilterDesign.NOTCH) {
      const norm = 1 / (1 + K / Q + K * K);
      a0 = (1 + K * K) * norm;
      a1 = 2 * (K * K - 1) * norm;
      a2 = a0;
      b1 = a1;
      b2 = (1 - K / Q + K * K) * norm;
    } else if (design === bqFilterDesign.LOWPASS_FO) {
      const norm = 1 / (1 / K + 1);
      a0 = norm;
      a1 = norm;
      a2 = 0;
      b1 = (1 - 1 / K) * norm;
      b2 = 0;
    } else if (design === bqFilterDesign.HIGHPASS_FO) {
      const norm = 1 / (K + 1);
      a0 = norm;
      a1 = -norm;
      a2 = 0;
      b1 = (K - 1) * norm;
      b2 = 0;
    } else if (design === bqFilterDesign.LOWSHELF_FO) {
      if (gain >= 0) {
        const norm = 1 / (K + 1);
        a0 = (K * A + 1) * norm;
        a1 = (K * A - 1) * norm;
        a2 = 0;
        b1 = (K - 1) * norm;
        b2 = 0;
      } else {
        const norm = 1 / (K * A + 1);
        a0 = (K + 1) * norm;
        a1 = (K - 1) * norm;
        a2 = 0;
        b1 = (K * A - 1) * norm;
        b2 = 0;
      }
    } else if (design === bqFilterDesign.HIGHSHELF_FO) {
      if (gain >= 0) {
        const norm = 1 / (K + 1);
        a0 = (K + A) * norm;
        a1 = (K - A) * norm;
        a2 = 0;
        b1 = (K - 1) * norm;
        b2 = 0;
      } else {
        const norm = 1 / (K + A);
        a0 = (K + 1) * norm;
        a1 = (K - 1) * norm;
        a2 = 0;
        b1 = (K - A) * norm;
        b2 = 0;
      }
    } else if (design === bqFilterDesign.ALLPASS_FO) {
      a0 = (1 - K) / (1 + K);
      a1 = -1;
      a2 = 0;
      b1 = -a0;
      b2 = 0;
    }

    return { a0: 1.0, a1: -b1, a2: -b2, b0: a0, b1: a1, b2: a2 };
  }

  makeLowShelv(gain, fc, Q, fs, bypass = false) {
  if (bypass === true) return this.defaultCoefficients();
    const pi = Math.PI;
    const A = Math.pow(10.0, gain / 40.0);
    const w0 = 2.0 * pi * fc / fs;
    const alpha = Math.sin(w0) / (2.0 * Q);
    let a0 = (A + 1.0) + (A - 1.0) * Math.cos(w0) + 2.0 * Math.sqrt(A) * alpha;
    const a1 = -(-2.0 * ((A - 1.0) + (A + 1.0) * Math.cos(w0))) / a0;
    const a2 = -((A + 1.0) + (A - 1.0) * Math.cos(w0) - 2.0 * Math.sqrt(A) * alpha) / a0;
    const b0 = (A * ((A + 1.0) - (A - 1.0) * Math.cos(w0) + 2.0 * Math.sqrt(A) * alpha)) / a0;
    const b1 = (2.0 * A * ((A - 1.0) - (A + 1.0) * Math.cos(w0))) / a0;
    const b2 = (A * ((A + 1.0) - (A - 1.0) * Math.cos(w0) - 2.0 * Math.sqrt(A) * alpha)) / a0;
    a0 = 1.0;
    return { a0, a1, a2, b0, b1, b2 };
  }

  makeHighShelv(gain, fc, Q, fs, bypass = false) {
  if (bypass === true) return this.defaultCoefficients();
    const pi = Math.PI;
    const A = Math.pow(10.0, gain / 40.0);
    const w0 = 2.0 * pi * fc / fs;
    const alpha = Math.sin(w0) / (2.0 * Q);
    let a0 = (A + 1.0) - (A - 1.0) * Math.cos(w0) + 2.0 * Math.sqrt(A) * alpha;
    const a1 = -(2.0 * ((A - 1.0) - (A + 1.0) * Math.cos(w0))) / a0;
    const a2 = -((A + 1.0) - (A - 1.0) * Math.cos(w0) - 2.0 * Math.sqrt(A) * alpha) / a0;
    const b0 = (A * ((A + 1.0) + (A - 1.0) * Math.cos(w0) + 2.0 * Math.sqrt(A) * alpha)) / a0;
    const b1 = (-2.0 * A * ((A - 1.0) + (A + 1.0) * Math.cos(w0))) / a0;
    const b2 = (A * ((A + 1.0) + (A - 1.0) * Math.cos(w0) - 2.0 * Math.sqrt(A) * alpha)) / a0;
    a0 = 1.0;
    return { a0, a1, a2, b0, b1, b2 };
  }

  makeAllpass(fc, Q, fs, inv = false, bypass = false) {
  if (bypass === true) return this.defaultCoefficients();
    const w0 = 2.0 * Math.PI * fc / fs;
    const alpha = Math.sin(w0) / (2.0 * Q);
    const a0tmp = 1.0 + alpha;
    let b0 = (1.0 - alpha) / a0tmp;
    let b1 = -2.0 * Math.cos(w0) / a0tmp;
    let b2 = (1.0 + alpha) / a0tmp;
    const a1 = -(-2.0 * Math.cos(w0)) / a0tmp;
    const a2 = -(1.0 - alpha) / a0tmp;
    const a0 = 1.0;
    if (inv === true) {
      b0 *= -1.0; b1 *= -1.0; b2 *= -1.0;
    }
    return { b0, b1, b2, a0, a1, a2 };
  }

  // Helpers for high/low pass: create a new accumulator with default coeffs for n stages
  #initStages(length) {
    const res = {};
    for (let i = 0; i < length; i++) res[i] = this.defaultCoefficients();
    return res;
  }

  makeHighPass(design, fc, fs, bypass = false) {
    const pi = Math.PI;
    const sa = [0.0, 0.0, 0.0];
    const sb = [0.0, 0.0, 0.0];
    const za = [0.0, 0.0, 0.0];
    const zb = [0.0, 0.0, 0.0];

    const length = this.getLengthForDesign(design);
    const res = this.#initStages(length);
    if (bypass === true) return res;
    if (fc < 1.0 || fc > 22000.0) return res;

    if (design === filterDesign.Bessel6) {
      const Omega = 2.0 * pi * fc / fs;
      const a1 = Math.pow(2.7, -Omega);
      res[0].b0 = a1;
      res[0].b1 = -a1;
      res[0].b2 = 0.0;
      res[0].a0 = 1.0;
      res[0].a1 = a1;
      res[0].a2 = 0.0;
    } else if (design === filterDesign.Bessel12) {
      const T = 1.0 / fs;
      const T2 = T * T;
      const Omega = 2.0 * pi * fc / fs;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      const a0c = 0.6180;
      const a1c = 1.3617;
      const a2c = 1.0;
      const b0c = 0.0, b1c = 0.0, b2c = 1.0;

      sa[0] = a2c;
      sa[1] = a1c * wn;
      sa[2] = a0c * wn * wn;
      sb[0] = b2c;
      sb[1] = b1c;
      sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[0].b0 = zb[0] / za[0];
      res[0].b1 = zb[1] / za[0];
      res[0].b2 = zb[2] / za[0];
      res[0].a0 = 1.0;
      res[0].a1 = -za[1] / za[0];
      res[0].a2 = -za[2] / za[0];
    } else if (design === filterDesign.Bessel18) {
      const T = 1.0 / fs;
      const T2 = T * T;
      const Omega = 2.0 * pi * fc / fs;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      // Stage 1
      let a1 = Math.pow(2.7, -Omega);
      res[0].b0 = a1; res[0].b1 = -a1; res[0].b2 = 0.0;
      res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = 0.0;

      // Stage 2
      const a0c = 0.4772; // bi
      const a1c = 0.9996; // ai
      const a2c = 1.0;
      const b0c = 0.0, b1c = 0.0, b2c = 1.0;

      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[1].b0 = zb[0] / za[0];
      res[1].b1 = zb[1] / za[0];
      res[1].b2 = zb[2] / za[0];
      res[1].a0 = 1.0;
      res[1].a1 = -za[1] / za[0];
      res[1].a2 = -za[2] / za[0];
    } else if (design === filterDesign.Bessel24) {
      const T = 1.0 / fs;
      const T2 = T * T;
      const Omega = 2.0 * pi * fc / fs;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      // Stage 1
      let a0c = 0.4889, a1c = 1.3397, a2c = 1.0;
      let b0c = 0.0, b1c = 0.0, b2c = 1.0;
      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[0].b0 = zb[0] / za[0];
      res[0].b1 = zb[1] / za[0];
      res[0].b2 = zb[2] / za[0];
      res[0].a0 = 1.0;
      res[0].a1 = -za[1] / za[0];
      res[0].a2 = -za[2] / za[0];

      // Stage 2
      a0c = 0.3890; a1c = 0.7743; a2c = 1.0; b0c = 0.0; b1c = 0.0; b2c = 1.0;
      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[1].b0 = zb[0] / za[0];
      res[1].b1 = zb[1] / za[0];
      res[1].b2 = zb[2] / za[0];
      res[1].a0 = 1.0;
      res[1].a1 = -za[1] / za[0];
      res[1].a2 = -za[2] / za[0];
    } else if (design === filterDesign.Butterworth12) {
      const T = 1.0 / fs;
      const T2 = T * T;
      const Omega = 2.0 * pi * fc / fs;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      const a0c = 1.0, a1c = 1.4142, a2c = 1.0;
      const b0c = 0.0, b1c = 0.0, b2c = 1.0;

      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[0].b0 = zb[0] / za[0]; res[0].b1 = zb[1] / za[0]; res[0].b2 = zb[2] / za[0];
      res[0].a0 = 1.0; res[0].a1 = -za[1] / za[0]; res[0].a2 = -za[2] / za[0];
    } else if (design === filterDesign.Butterworth18) {
      const T = 1.0 / fs;
      const T2 = T * T;
      const Omega = 2.0 * pi * fc / fs;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      // Stage 1
      let a1 = Math.pow(2.7, -Omega);
      res[0].b0 = 1.0 - a1; res[0].b1 = 0.0; res[0].b2 = 0.0;
      res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = 0.0;

      // Stage 2
      const a0c = 1.0, a1c = 1.0, a2c = 1.0;
      const b0c = 0.0, b1c = 0.0, b2c = 1.0;

      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[1].b0 = zb[0] / za[0]; res[1].b1 = zb[1] / za[0]; res[1].b2 = zb[2] / za[0];
      res[1].a0 = 1.0; res[1].a1 = -za[1] / za[0]; res[1].a2 = -za[2] / za[0];
    } else if (design === filterDesign.Butterworth24) {
      const T = 1.0 / fs;
      const T2 = T * T;
      const Omega = 2.0 * pi * fc / fs;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      // Stage 1
      let a0c = 1.0, a1c = 1.8478, a2c = 1.0;
      let b0c = 0.0, b1c = 0.0, b2c = 1.0;
      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[0].b0 = zb[0] / za[0]; res[0].b1 = zb[1] / za[0]; res[0].b2 = zb[2] / za[0];
      res[0].a0 = 1.0; res[0].a1 = -za[1] / za[0]; res[0].a2 = -za[2] / za[0];

      // Stage 2
      a0c = 1.0; a1c = 0.7654; a2c = 1.0; b0c = 0.0; b1c = 0.0; b2c = 1.0;
      sa[0] = a2c; sa[1] = a1c * wn; sa[2] = a0c * wn * wn;
      sb[0] = b2c; sb[1] = b1c; sb[2] = b0c;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[1].b0 = zb[0] / za[0]; res[1].b1 = zb[1] / za[0]; res[1].b2 = zb[2] / za[0];
      res[1].a0 = 1.0; res[1].a1 = -za[1] / za[0]; res[1].a2 = -za[2] / za[0];
    } else if (design === filterDesign.LinkwitzRiley12) {
      const w0 = 2.0 * pi * fc / fs;
      const alpha = Math.sin(w0) / (2.0 * 0.5);
      const a0tmp = 1.0 + alpha;
      const b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      const b1 = (-(1.0 + Math.cos(w0))) / a0tmp;
      const b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      const a1 = -(-2.0 * Math.cos(w0)) / a0tmp;
      const a2 = -(1.0 - alpha) / a0tmp;
      res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2;
      res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = a2;
    } else if (design === filterDesign.LinkwitzRiley24) {
      // Stage 1
      let w0 = 2.0 * pi * fc / fs;
      let alpha = Math.sin(w0) / (2.0 * 0.71);
      let a0tmp = 1.0 + alpha;
      let b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      let b1 = (-(1.0 + Math.cos(w0))) / a0tmp;
      let b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      let a1 = -(-2.0 * Math.cos(w0)) / a0tmp;
      let a2 = -(1.0 - alpha) / a0tmp;
      res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = a2;

      // Stage 2
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 0.71); a0tmp = 1.0 + alpha;
      b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; b1 = (-(1.0 + Math.cos(w0))) / a0tmp; b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      a1 = -(-2.0 * Math.cos(w0)) / a0tmp; a2 = -(1.0 - alpha) / a0tmp;
      res[1].b0 = b0; res[1].b1 = b1; res[1].b2 = b2; res[1].a0 = 1.0; res[1].a1 = a1; res[1].a2 = a2;
    } else if (design === filterDesign.LinkwitzRiley36) {
      // Stage 1
      let w0 = 2.0 * pi * fc / fs; let alpha = Math.sin(w0) / (2.0 * 0.5); let a0tmp = 1.0 + alpha;
      let b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; let b1 = (-(1.0 + Math.cos(w0))) / a0tmp; let b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      let a1 = -(-2.0 * Math.cos(w0)) / a0tmp; let a2 = -(1.0 - alpha) / a0tmp;
      res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = a2;

      // Stage 2
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.0); a0tmp = 1.0 + alpha;
      b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; b1 = (-(1.0 + Math.cos(w0))) / a0tmp; b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      a1 = -(-2.0 * Math.cos(w0)) / a0tmp; a2 = -(1.0 - alpha) / a0tmp;
      res[1].b0 = b0; res[1].b1 = b1; res[1].b2 = b2; res[1].a0 = 1.0; res[1].a1 = a1; res[1].a2 = a2;

      // Stage 3
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.0); a0tmp = 1.0 + alpha;
      b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; b1 = (-(1.0 + Math.cos(w0))) / a0tmp; b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      a1 = -(-2.0 * Math.cos(w0)) / a0tmp; a2 = -(1.0 - alpha) / a0tmp;
      res[2].b0 = b0; res[2].b1 = b1; res[2].b2 = b2; res[2].a0 = 1.0; res[2].a1 = a1; res[2].a2 = a2;
    } else if (design === filterDesign.LinkwitzRiley48) {
      // Stage 1
      let w0 = 2.0 * pi * fc / fs; let alpha = Math.sin(w0) / (2.0 * 0.54); let a0tmp = 1.0 + alpha;
      let b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; let b1 = (-(1.0 + Math.cos(w0))) / a0tmp; let b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      let a1 = -(-2.0 * Math.cos(w0)) / a0tmp; let a2 = -(1.0 - alpha) / a0tmp;
      res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = a2;

      // Stage 2
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.34); a0tmp = 1.0 + alpha;
      b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; b1 = (-(1.0 + Math.cos(w0))) / a0tmp; b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      a1 = -(-2.0 * Math.cos(w0)) / a0tmp; a2 = -(1.0 - alpha) / a0tmp;
      res[1].b0 = b0; res[1].b1 = b1; res[1].b2 = b2; res[1].a0 = 1.0; res[1].a1 = a1; res[1].a2 = a2;

      // Stage 3
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 0.54); a0tmp = 1.0 + alpha;
      b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; b1 = (-(1.0 + Math.cos(w0))) / a0tmp; b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      a1 = -(-2.0 * Math.cos(w0)) / a0tmp; a2 = -(1.0 - alpha) / a0tmp;
      res[2].b0 = b0; res[2].b1 = b1; res[2].b2 = b2; res[2].a0 = 1.0; res[2].a1 = a1; res[2].a2 = a2;

      // Stage 4
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.34); a0tmp = 1.0 + alpha;
      b0 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp; b1 = (-(1.0 + Math.cos(w0))) / a0tmp; b2 = ((1.0 + Math.cos(w0)) * 0.5) / a0tmp;
      a1 = -(-2.0 * Math.cos(w0)) / a0tmp; a2 = -(1.0 - alpha) / a0tmp;
      res[3].b0 = b0; res[3].b1 = b1; res[3].b2 = b2; res[3].a0 = 1.0; res[3].a1 = a1; res[3].a2 = a2;
    }

    return res;
  }

  makeLowPass(design, fc, fs, bypass = false) {
    const pi = Math.PI;
    const sa = [0.0, 0.0, 0.0];
    const sb = [0.0, 0.0, 0.0];
    const za = [0.0, 0.0, 0.0];
    const zb = [0.0, 0.0, 0.0];

    const length = this.getLengthForDesign(design);
    const res = this.#initStages(length);
    if (bypass === true) return res;
    if (fc < 1.0 || fc > 22000.0) return res;

    if (design === filterDesign.Bessel6) {
      const Omega = 2.0 * pi * fc / fs;
      const a1 = Math.pow(2.7, -Omega);
      res[0].b0 = 1.0 - a1; res[0].b1 = 0.0; res[0].b2 = 0.0;
      res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = 0.0;
    }

    if (design === filterDesign.Bessel12) {
      const Omega = 2.0 * pi * fc / fs;
      const T = 1.0 / fs;
      const T2 = T * T;
      const wn = 2.0 / T * Math.tan(Omega / 2.0);

      sa[0] = 0.6180 / (wn * wn);
      sa[1] = 1.3617 / wn;
      sa[2] = 1.0;
      sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2;
      zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0];
      zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;

      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2;
      za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0];
      za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[0].b0 = zb[0] / za[0]; res[0].b1 = zb[1] / za[0]; res[0].b2 = zb[2] / za[0];
      res[0].a0 = 1.0; res[0].a1 = -za[1] / za[0]; res[0].a2 = -za[2] / za[0];
    }

    if (design === filterDesign.Bessel18) {
      const T = 1.0 / fs; const T2 = T * T; const Omega = 2.0 * pi * fc / fs; const wn = 2.0 / T * Math.tan(Omega / 2.0);

      // Stage 1
      let a1 = Math.pow(2.7, -Omega);
      res[0].b0 = 1.0 - a1; res[0].b1 = 0.0; res[0].b2 = 0.0; res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = 0.0;

      // Stage 2
      sa[0] = 0.4772 / (wn * wn); sa[1] = 0.9996 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;

      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;

      res[1].b0 = zb[0] / za[0]; res[1].b1 = zb[1] / za[0]; res[1].b2 = zb[2] / za[0];
      res[1].a0 = 1.0; res[1].a1 = -za[1] / za[0]; res[1].a2 = -za[2] / za[0];
    }

    if (design === filterDesign.Bessel24) {
      const T = 1.0 / fs; const T2 = T * T; const Omega = 2.0 * pi * fc / fs; const wn = 2.0 / T * Math.tan(Omega / 2.0);

      // Stage 1
      sa[0] = 0.4889 / (wn * wn); sa[1] = 1.3397 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;
      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;
      res[0].b0 = zb[0] / za[0]; res[0].b1 = zb[1] / za[0]; res[0].b2 = zb[2] / za[0]; res[0].a0 = 1.0; res[0].a1 = -za[1] / za[0]; res[0].a2 = -za[2] / za[0];

      // Stage 2
      sa[0] = 0.3890 / (wn * wn); sa[1] = 0.7743 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;
      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;
      res[1].b0 = zb[0] / za[0]; res[1].b1 = zb[1] / za[0]; res[1].b2 = zb[2] / za[0]; res[1].a0 = 1.0; res[1].a1 = -za[1] / za[0]; res[1].a2 = -za[2] / za[0];
    }

    if (design === filterDesign.Butterworth12) {
      const Omega = 2.0 * pi * fc / fs; const T = 1.0 / fs; const T2 = T * T; const wn = 2.0 / T * Math.tan(Omega / 2.0);
      sa[0] = 1.0 / (wn * wn); sa[1] = 1.4142 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;
      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;
      res[0].b0 = zb[0] / za[0]; res[0].b1 = zb[1] / za[0]; res[0].b2 = zb[2] / za[0]; res[0].a0 = 1.0; res[0].a1 = -za[1] / za[0]; res[0].a2 = -za[2] / za[0];
    }

    if (design === filterDesign.Butterworth18) {
      const T = 1.0 / fs; const T2 = T * T; const Omega = 2.0 * pi * fc / fs; const wn = 2.0 / T * Math.tan(Omega / 2.0);
      // Stage 1
      let a1 = Math.pow(2.7, -Omega); res[0].b0 = 1.0 - a1; res[0].b1 = 0.0; res[0].b2 = 0.0; res[0].a0 = 1.0; res[0].a1 = a1; res[0].a2 = 0.0;
      // Stage 2
      sa[0] = 1.0 / (wn * wn); sa[1] = 1.0 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;
      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;
      res[1].b0 = zb[0] / za[0]; res[1].b1 = zb[1] / za[0]; res[1].b2 = zb[2] / za[0]; res[1].a0 = 1.0; res[1].a1 = -za[1] / za[0]; res[1].a2 = -za[2] / za[0];
    }

    if (design === filterDesign.Butterworth24) {
      const T = 1.0 / fs; const T2 = T * T; const Omega = 2.0 * pi * fc / fs; const wn = 2.0 / T * Math.tan(Omega / 2.0);
      // Stage 1
      sa[0] = 1.0 / (wn * wn); sa[1] = 1.8478 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;
      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;
      res[0].b0 = zb[0] / za[0]; res[0].b1 = zb[1] / za[0]; res[0].b2 = zb[2] / za[0]; res[0].a0 = 1.0; res[0].a1 = -za[1] / za[0]; res[0].a2 = -za[2] / za[0];
      // Stage 2
      sa[0] = 1.0 / (wn * wn); sa[1] = 0.7654 / wn; sa[2] = 1.0; sb[0] = 0.0; sb[1] = 0.0; sb[2] = 1.0;
      zb[0] = 4.0 * sb[0] + 2.0 * sb[1] * T + sb[2] * T2; zb[1] = 2.0 * sb[2] * T2 - 8.0 * sb[0]; zb[2] = 4.0 * sb[0] - 2.0 * sb[1] * T + sb[2] * T2;
      za[0] = 4.0 * sa[0] + 2.0 * sa[1] * T + sa[2] * T2; za[1] = 2.0 * sa[2] * T2 - 8.0 * sa[0]; za[2] = 4.0 * sa[0] - 2.0 * sa[1] * T + sa[2] * T2;
      res[1].b0 = zb[0] / za[0]; res[1].b1 = zb[1] / za[0]; res[1].b2 = zb[2] / za[0]; res[1].a0 = 1.0; res[1].a1 = -za[1] / za[0]; res[1].a2 = -za[2] / za[0];
    }

    if (design === filterDesign.LinkwitzRiley12) {
      const w0 = 2.0 * pi * fc / fs; const alpha = Math.sin(w0) / (2.0 * 0.5); const a0tmp = 1.0 + alpha;
      const b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; const b1 = (1.0 - Math.cos(w0)) / a0tmp; const b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; const a1 = (-2.0 * Math.cos(w0)) / a0tmp; const a2 = (1.0 - alpha) / a0tmp;
      res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = -a1; res[0].a2 = -a2;
    }

    if (design === filterDesign.LinkwitzRiley24) {
      // Stage 1
      let w0 = 2.0 * pi * fc / fs; let alpha = Math.sin(w0) / (2.0 * 0.71); let a0tmp = 1.0 + alpha;
      let b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; let b1 = (1.0 - Math.cos(w0)) / a0tmp; let b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; let a1 = (-2.0 * Math.cos(w0)) / a0tmp; let a2 = (1.0 - alpha) / a0tmp;
      res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = -a1; res[0].a2 = -a2;
      // Stage 2
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 0.71); a0tmp = 1.0 + alpha; b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; b1 = (1.0 - Math.cos(w0)) / a0tmp; b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; a1 = (-2.0 * Math.cos(w0)) / a0tmp; a2 = (1.0 - alpha) / a0tmp;
      res[1].b0 = b0; res[1].b1 = b1; res[1].b2 = b2; res[1].a0 = 1.0; res[1].a1 = -a1; res[1].a2 = -a2;
    }

    if (design === filterDesign.LinkwitzRiley36) {
      // Stage 1
      let w0 = 2.0 * pi * fc / fs; let alpha = Math.sin(w0) / (2.0 * 0.50); let a0tmp = 1.0 + alpha; let b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; let b1 = (1.0 - Math.cos(w0)) / a0tmp; let b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; let a1 = (-2.0 * Math.cos(w0)) / a0tmp; let a2 = (1.0 - alpha) / a0tmp; res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = -a1; res[0].a2 = -a2;
      // Stage 2
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.00); a0tmp = 1.0 + alpha; b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; b1 = (1.0 - Math.cos(w0)) / a0tmp; b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; a1 = (-2.0 * Math.cos(w0)) / a0tmp; a2 = (1.0 - alpha) / a0tmp; res[1].b0 = b0; res[1].b1 = b1; res[1].b2 = b2; res[1].a0 = 1.0; res[1].a1 = -a1; res[1].a2 = -a2;
      // Stage 3
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.00); a0tmp = 1.0 + alpha; b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; b1 = (1.0 - Math.cos(w0)) / a0tmp; b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; a1 = (-2.0 * Math.cos(w0)) / a0tmp; a2 = (1.0 - alpha) / a0tmp; res[2].b0 = b0; res[2].b1 = b1; res[2].b2 = b2; res[2].a0 = 1.0; res[2].a1 = -a1; res[2].a2 = -a2;
    }

    if (design === filterDesign.LinkwitzRiley48) {
      // Stage 1
      let w0 = 2.0 * pi * fc / fs; let alpha = Math.sin(w0) / (2.0 * 0.54); let a0tmp = 1.0 + alpha; let b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; let b1 = (1.0 - Math.cos(w0)) / a0tmp; let b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; let a1 = (-2.0 * Math.cos(w0)) / a0tmp; let a2 = (1.0 - alpha) / a0tmp; res[0].b0 = b0; res[0].b1 = b1; res[0].b2 = b2; res[0].a0 = 1.0; res[0].a1 = -a1; res[0].a2 = -a2;
      // Stage 2
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.34); a0tmp = 1.0 + alpha; b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; b1 = (1.0 - Math.cos(w0)) / a0tmp; b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; a1 = (-2.0 * Math.cos(w0)) / a0tmp; a2 = (1.0 - alpha) / a0tmp; res[1].b0 = b0; res[1].b1 = b1; res[1].b2 = b2; res[1].a0 = 1.0; res[1].a1 = -a1; res[1].a2 = -a2;
      // Stage 3
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 0.54); a0tmp = 1.0 + alpha; b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; b1 = (1.0 - Math.cos(w0)) / a0tmp; b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; a1 = (-2.0 * Math.cos(w0)) / a0tmp; a2 = (1.0 - alpha) / a0tmp; res[2].b0 = b0; res[2].b1 = b1; res[2].b2 = b2; res[2].a0 = 1.0; res[2].a1 = -a1; res[2].a2 = -a2;
      // Stage 4
      w0 = 2.0 * pi * fc / fs; alpha = Math.sin(w0) / (2.0 * 1.34); a0tmp = 1.0 + alpha; b0 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; b1 = (1.0 - Math.cos(w0)) / a0tmp; b2 = ((1.0 - Math.cos(w0)) * 0.5) / a0tmp; a1 = (-2.0 * Math.cos(w0)) / a0tmp; a2 = (1.0 - alpha) / a0tmp; res[3].b0 = b0; res[3].b1 = b1; res[3].b2 = b2; res[3].a0 = 1.0; res[3].a1 = -a1; res[3].a2 = -a2;
    }

    return res;
  }

  makeRIAAEqualization({
    inverse_riaa = false,
    dc_block = true,
    dc_cutoff_freq = 1.0,
    sample_rate = 48000,
    input_gain = 0.3,
    filter_gain = 1.0,
    output_gain = 1.0,
  } = {}) {
    const result = {
      config: {
        inverse_riaa,
        dc_block,
        dc_cutoff_freq,
        sample_rate,
        input_gain,
        filter_gain,
        output_gain,
      },
    };

    if (dc_block) {
      const beta = Math.PI * 2.0 * dc_cutoff_freq / sample_rate;
      const alpha = (2.0 - beta) / 2.0;
      result.dc_block = {
        enabled: true,
        coefficients: [alpha, -0.99999, 1.0 - beta],
        description: 'High-pass DC blocking filter',
      };
    } else {
      result.dc_block = { enabled: false, coefficients: [], description: 'DC blocking disabled' };
    }

    let riaaCoefficients;
    if (!inverse_riaa) {
      riaaCoefficients = [
        input_gain,
        filter_gain * 0.07936507857142856,
        filter_gain * -0.059964452380952375,
        1.7327655,
        filter_gain * -0.013065532642857144,
        -0.7345534436,
        1,
      ];
    } else {
      riaaCoefficients = [
        input_gain,
        filter_gain * 0.07936507857142856,
        filter_gain * -0.13752107142857142,
        0.7555521,
        filter_gain * 0.05829789234920635,
        0.1646257113,
        1,
      ];
    }

    result.riaa = {
      type: inverse_riaa ? 'inverse' : 'standard',
      coefficients: riaaCoefficients,
      description: `${inverse_riaa ? 'Inverse' : 'Standard'} RIAA equalization filter`,
    };

    const combined = [];
    if (dc_block) combined.push(...result.dc_block.coefficients);
    combined.push(...riaaCoefficients);
    result.combined = { coefficients: combined, total_count: combined.length };

    result.usage_notes = {
      purpose: 'RIAA equalization for vinyl/phono preamp applications',
      frequency_response: 'Standard RIAA curve (75μs + 318μs + 3180μs time constants)',
      typical_use: 'ADC input processing for analog audio signals',
      dc_blocking: dc_block ? 'Removes DC offset from analog sources' : 'No DC blocking applied',
    };

    return result;
  }

  // Unified entry using aliases (see README)
  generateCoeff(alias, data = {}) {
    if (!alias || typeof alias !== 'string') throw new Error('alias must be a non-empty string');
    const a = alias.toLowerCase();

    const designKey = DESIGN_BY_ALIAS[a];
    if (designKey) {
      const meta = FilterDesigns[designKey];
      const id = meta.id;
      const { mode, fc, fs, bypass = false } = data;
      if (mode !== 'lowpass' && mode !== 'highpass') {
        throw new Error(`Crossover alias '${alias}' requires data.mode to be 'lowpass' or 'highpass'`);
      }
      if (!(fc > 0) || !(fs > 0)) throw new Error(`Crossover alias '${alias}' requires positive fc and fs`);
      return mode === 'lowpass'
        ? this.makeLowPass(id, fc, fs, bypass)
        : this.makeHighPass(id, fc, fs, bypass);
    }

    if (['riaa', 'riaa_std', 'riaa-standard'].includes(a)) {
      return this.makeRIAAEqualization({ ...data, inverse_riaa: false });
    }
    if (['riaa_inv', 'riaa-inv', 'riaa_inverse', 'riaa-inverse'].includes(a)) {
      return this.makeRIAAEqualization({ ...data, inverse_riaa: true });
    }

    const biquadMap = {
      peq: bqFilterDesign.PEAK,
      peak: bqFilterDesign.PEAK,
      peaking: bqFilterDesign.PEAK,
      lpf: bqFilterDesign.LOWPASS,
      lowpass: bqFilterDesign.LOWPASS,
      hpf: bqFilterDesign.HIGHPASS,
      highpass: bqFilterDesign.HIGHPASS,
      bp: bqFilterDesign.BANDPASS,
      bandpass: bqFilterDesign.BANDPASS,
      notch: bqFilterDesign.NOTCH,
      ls: bqFilterDesign.LOWSHELF,
      lowshelf: bqFilterDesign.LOWSHELF,
      hs: bqFilterDesign.HIGHSHELF,
      highshelf: bqFilterDesign.HIGHSHELF,
      ap: bqFilterDesign.ALLPASS,
      allpass: bqFilterDesign.ALLPASS,
      lpfo: bqFilterDesign.LOWPASS_FO,
      lpf1: bqFilterDesign.LOWPASS_FO,
      'lp_fo': bqFilterDesign.LOWPASS_FO,
      hpfo: bqFilterDesign.HIGHPASS_FO,
      hpf1: bqFilterDesign.HIGHPASS_FO,
      'hp_fo': bqFilterDesign.HIGHPASS_FO,
      lsfo: bqFilterDesign.LOWSHELF_FO,
      lowshelf1: bqFilterDesign.LOWSHELF_FO,
      'lowshelf_fo': bqFilterDesign.LOWSHELF_FO,
      hsfo: bqFilterDesign.HIGHSHELF_FO,
      highshelf1: bqFilterDesign.HIGHSHELF_FO,
      'highshelf_fo': bqFilterDesign.HIGHSHELF_FO,
      apfo: bqFilterDesign.ALLPASS_FO,
      allpass1: bqFilterDesign.ALLPASS_FO,
      'allpass_fo': bqFilterDesign.ALLPASS_FO,
    };

    const d = biquadMap[a];
    if (d !== undefined) {
      const { gain = 0, fc, Q = 0.707, fs, bypass = false, inv = false } = data;
      if (!(fc > 0) || !(fs > 0)) throw new Error(`Biquad alias '${alias}' requires positive fc and fs`);
      if (d === bqFilterDesign.LOWSHELF) return this.makeLowShelv(gain, fc, Q, fs, bypass);
      if (d === bqFilterDesign.HIGHSHELF) return this.makeHighShelv(gain, fc, Q, fs, bypass);
      if (d === bqFilterDesign.ALLPASS || d === bqFilterDesign.ALLPASS_FO) return this.makeAllpass(fc, Q, fs, inv, bypass);
      return this.makeParametricEQ(gain, fc, Q, fs, d, bypass);
    }

    throw new Error(`Unknown filter alias: '${alias}'`);
  }
}

export default AudioFilters;
