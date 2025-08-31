#!/usr/bin/env node
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';

const root = resolve(process.cwd());
const src = resolve(root, 'src/index.js');
const outdir = resolve(root, 'dist');

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [src],
  outdir,
  format: 'esm',
  platform: 'node',
  target: ['node18'],
  sourcemap: true,
  bundle: true,
  logLevel: 'info',
});

// Also build CJS wrapper from the ESM output via a tiny shim for Node < ESM consumers
const esmPath = resolve(outdir, 'index.js');
const cjsPath = resolve(outdir, 'index.cjs');
const shim = `module.exports = require('node:module').createRequire(__filename)('./index.js');`;
await writeFile(cjsPath, shim);

// Generate a basic d.ts (hand-rolled minimal types for consumers)
const dts = `
export interface BiquadCoefficients { a0: number; a1: number; a2: number; b0: number; b1: number; b2: number }
export type StagedCoefficients = Record<number, BiquadCoefficients>
export declare const FilterDesigns: Record<string, { id: number; family: string; order: number; slopeDbPerOct: number; sections: number; kind: string; aliases: string[]; stageQ?: number[] }>
export declare const filterDesign: Record<string, number>
export declare const filterLength: Record<string, number>
export declare const bqFilterDesign: Record<string, number>
export declare class AudioFilters {
  constructor()
  defaultCoefficients(): BiquadCoefficients
  designMap(): Record<string, number>
  filtersRequiredForDesign(design: string | number): number
  getLengthForDesign(design: number): number
  getDesignInfo(identifier: string | number): null | ({ key: string } & (typeof FilterDesigns)[string])
  makeParametricEQ(gain: number, fc: number, Q: number, fs: number, design: number, bypass?: boolean): BiquadCoefficients
  makeLowShelv(gain: number, fc: number, Q: number, fs: number, bypass?: boolean): BiquadCoefficients
  makeHighShelv(gain: number, fc: number, Q: number, fs: number, bypass?: boolean): BiquadCoefficients
  makeAllpass(fc: number, Q: number, fs: number, inv?: boolean, bypass?: boolean): BiquadCoefficients
  makeHighPass(design: number, fc: number, fs: number, bypass?: boolean): StagedCoefficients
  makeLowPass(design: number, fc: number, fs: number, bypass?: boolean): StagedCoefficients
  makeRIAAEqualization(opts?: { inverse_riaa?: boolean; dc_block?: boolean; dc_cutoff_freq?: number; sample_rate?: number; input_gain?: number; filter_gain?: number; output_gain?: number }): any
  generateCoeff(alias: string, data?: any): any
}
export default AudioFilters
`;
await writeFile(resolve(outdir, 'index.d.ts'), dts);

console.log('Build complete');
