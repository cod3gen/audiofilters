import { AudioFilters } from '../dist/index.js';

const af = new AudioFilters();
console.log('peq', af.generateCoeff('peq', { gain: 3, fc: 1000, Q: 1, fs: 48000 }));
console.log('lr24 lp', af.generateCoeff('lr24', { mode: 'lowpass', fc: 2000, fs: 48000 }));
console.log('riaa', af.generateCoeff('riaa', { sample_rate: 48000, dc_block: true }));
