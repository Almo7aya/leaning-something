'use strict';
// Mathematical/encoding teaching fixtures only. Not a full RDNA decoder,
// console BVH format, guest result packer, GPU test, or hardware-precision oracle.
const assert = require('node:assert/strict');
let passed = 0;
function test(name, run) {
  try { run(); passed++; }
  catch (error) { throw new Error('Ray-tracing fixture failed: '+name, {cause: error}); }
}
function vector(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new RangeError('Expected a finite three-component vector');
}
function rayBox(origin, direction, minimum, maximum, tMin, tMax) {
  [origin, direction, minimum, maximum].forEach(vector);
  if (![tMin, tMax].every(Number.isFinite) || tMin > tMax || minimum.some((v,i) => v > maximum[i]))
    throw new RangeError('Invalid finite interval or bounds');
  let lo = tMin, hi = tMax;
  for (let axis = 0; axis < 3; axis++) {
    if (direction[axis] === 0) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    const a = (minimum[axis] - origin[axis]) / direction[axis];
    const b = (maximum[axis] - origin[axis]) / direction[axis];
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return null;
  }
  return [lo, hi];
}
const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i) => sum+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function rayTriangle(origin, direction, a, b, c, tMin, tMax) {
  [origin, direction, a, b, c].forEach(vector);
  if (![tMin, tMax].every(Number.isFinite) || tMin > tMax) throw new RangeError('Invalid interval');
  // Simple two-sided Moller-Trumbore reference for well-conditioned fixture data.
  // No claim of watertightness, guest precision, facing policy, or packed results.
  const e1 = sub(b,a), e2 = sub(c,a), p = cross(direction,e2);
  const determinant = dot(e1,p);
  if (determinant === 0) return null;
  const s = sub(origin,a), u = dot(s,p)/determinant;
  if (u < 0 || u > 1) return null;
  const q = cross(s,e1), v = dot(direction,q)/determinant;
  if (v < 0 || u+v > 1) return null;
  const t = dot(e2,q)/determinant;
  return t < tMin || t > tMax ? null : {t,u,v};
}
function inspectMimg(words) {
  if (words.length < 2 || !words.every(w => Number.isInteger(w) && w >= 0 && w <= 0xffffffff))
    throw new RangeError('Truncated or invalid instruction words');
  if ((words[0] >>> 26) !== 0x3c) throw new RangeError('Not MIMG at this boundary');
  const opcode = ((words[0] >>> 18) & 0x7f) | ((words[0] & 1) << 7);
  const nsa = (words[0] >>> 1) & 3;
  if (words.length < 2+nsa) throw new RangeError('Truncated NSA words');
  return {opcode, nsa, bytes: (2+nsa)*4};
}
function toyNodeAddress(base, packed, allocationSize, readSize = 64n) {
  const limit = 1n << 64n;
  if ([base, packed, allocationSize, readSize].some(v => typeof v !== 'bigint' || v < 0n) ||
      base >= limit || packed > 0xffffffffn || allocationSize >= limit)
    throw new RangeError('Invalid toy address input');
  const tag = packed & 3n, index = packed >> 2n, offset = index * 64n;
  if (offset > allocationSize || readSize > allocationSize-offset ||
      base+offset >= limit || readSize > limit-(base+offset))
    throw new RangeError('Toy node read outside its allocation/address space');
  return {tag,index,offset,address:base+offset};
}

const minimum = [-1,-1,2], maximum = [1,1,4];
test('non-unit box direction', () => assert.deepEqual(rayBox([0,0,0],[0,0,2],minimum,maximum,0,10),[1,2]));
test('parallel outside', () => assert.equal(rayBox([2,0,0],[0,0,2],minimum,maximum,0,10),null));
test('negative zero inside slab', () => assert.deepEqual(rayBox([0,0,0],[-0,0,2],minimum,maximum,0,10),[1,2]));
test('inside box clips entry', () => assert.deepEqual(rayBox([0,0,3],[0,0,1],minimum,maximum,0,10),[0,1]));
test('reversed direction', () => assert.deepEqual(rayBox([0,0,5],[0,0,-1],minimum,maximum,0,10),[1,3]));
test('exclusive miss beyond fixture interval', () => assert.equal(rayBox([0,0,0],[0,0,2],minimum,maximum,0,0.5),null));
test('fixture inclusive boundary', () => assert.deepEqual(rayBox([0,0,0],[0,0,2],minimum,maximum,0,1),[1,1]));
test('NaN is rejected, not a hardware claim', () => assert.throws(() => rayBox([NaN,0,0],[0,0,2],minimum,maximum,0,10),RangeError));
test('inverted bounds rejected', () => assert.throws(() => rayBox([0,0,0],[0,0,2],maximum,minimum,0,10),RangeError));
const a = [0,0,0], b = [1,0,0], c = [0,1,0];
test('triangle hand solution', () => assert.deepEqual(rayTriangle([0.25,0.25,1],[0,0,-1],a,b,c,0,10),{t:1,u:0.25,v:0.25}));
test('triangle outside', () => assert.equal(rayTriangle([0.75,0.75,1],[0,0,-1],a,b,c,0,10),null));
test('triangle parallel', () => assert.equal(rayTriangle([0.25,0.25,1],[1,0,0],a,b,c,0,10),null));
test('triangle degenerate', () => assert.equal(rayTriangle([0.25,0.25,1],[0,0,-1],a,a,c,0,10),null));
test('triangle clipped', () => assert.equal(rayTriangle([0.25,0.25,1],[0,0,-1],a,b,c,0,0.5),null));
test('affine z scale preserves t', () => assert.deepEqual(rayTriangle([0.25,0.25,2],[0,0,-2],a,b,c,0,10),{t:1,u:0.25,v:0.25}));
test('incorrect normalization changes t', () => assert.equal(rayTriangle([0.25,0.25,2],[0,0,-1],a,b,c,0,10).t,2));
test('contiguous BVH fields', () => assert.deepEqual(inspectMimg([0xf1989f01,0x00081014]),{opcode:230,nsa:0,bytes:8}));
test('contiguous BVH64 fields', () => assert.deepEqual(inspectMimg([0xf19c9f01,0x00081014]),{opcode:231,nsa:0,bytes:8}));
test('NSA BVH fields', () => assert.deepEqual(inspectMimg([0xf1989f07,0x00071001,0x3d3e3c15,0x38095851,0x00003a39]),{opcode:230,nsa:3,bytes:20}));
test('truncated NSA rejected', () => assert.throws(() => inspectMimg([0xf1989f07,0x00071001]),RangeError));
test('missing operand rejected', () => assert.throws(() => inspectMimg([0xf1989f01]),RangeError));
test('different encoding family rejected', () => assert.throws(() => inspectMimg([0xbf810000,0]),RangeError));
test('little endian bytes', () => {
  const word = Buffer.alloc(4); word.writeUInt32LE(0xf1989f01);
  assert.deepEqual([...word],[1,0x9f,0x98,0xf1]);
});
test('toy pointer arithmetic, not PS5 layout', () => assert.deepEqual(toyNodeAddress(0x100000000n,0x49n,2048n),{tag:1n,index:18n,offset:1152n,address:0x100000480n}));
test('toy exact read end', () => assert.equal(toyNodeAddress(0n,0x49n,1216n).address,1152n));
test('toy short extent rejected', () => assert.throws(() => toyNodeAddress(0n,0x49n,1215n),RangeError));
test('toy address overflow rejected', () => assert.throws(() => toyNodeAddress((1n<<64n)-32n,0n,64n),RangeError));
console.log('PASS: '+passed+' ray-tracing teaching fixtures (not guest/GPU conformance).');
