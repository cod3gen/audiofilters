# @cod3gen/audiofilters

Audio filter design utilities (biquad PEQ/shelves, LP/HP crossover families, RIAA) for Node.js.

- Parametric and shelving EQ (biquad)
- Butterworth, Bessel, Linkwitz–Riley LP/HP crossovers (6–48 dB/oct)
- RIAA equalization (standard/inverse) with optional DC block
- Alias-based generator for ergonomic usage: `generateCoeff(alias, data)`

## Install

```sh
npm install @cod3gen/audiofilters
```

## Usage

```js
import { AudioFilters } from '@cod3gen/audiofilters';

const af = new AudioFilters();

// 1) Biquad: peaking EQ
const peq = af.generateCoeff('peq', { gain: 3, fc: 1000, Q: 1, fs: 48000 });

// 2) Crossover: LR24 low-pass at 2k
const lr24lp = af.generateCoeff('lr24', { mode: 'lowpass', fc: 2000, fs: 48000 });

// 3) RIAA
const riaa = af.generateCoeff('riaa', { sample_rate: 48000, dc_block: true });
```

## API

- `FilterDesigns`: metadata for crossover designs (family, order, slope, sections, aliases)
- `filterDesign`: numeric ids per design (for compatibility)
- `filterLength`: number of biquad sections per design
- `bqFilterDesign`: numeric ids for biquad response types
- `class AudioFilters`:
  - `defaultCoefficients()` → unity biquad
  - `makeParametricEQ(...)`, `makeLowShelv(...)`, `makeHighShelv(...)`, `makeAllpass(...)`
  - `makeHighPass(designId, fc, fs, bypass?)`, `makeLowPass(designId, fc, fs, bypass?)`
  - `makeRIAAEqualization(opts)`
  - `generateCoeff(alias, data)` → alias router (biquad/crossover/RIAA)

## Build

```sh
npm run build
```

## Demo

```sh
npm run demo
```

## Publish

- GitHub: push this folder as a repo/package
- npm: bump version, then `npm publish --access public`

## License

MIT
