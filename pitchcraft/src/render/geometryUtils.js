import * as THREE from 'three';

/**
 * Minimal geometry merge (position + normal + index).
 *
 * three.js ships `BufferGeometryUtils.mergeGeometries` in `examples/`, but
 * pulling that in for a handful of primitives costs more than it saves — and
 * nothing merged here carries UVs, because none of these materials use maps.
 *
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
export function mergeGeometries(geometries) {
  const merged = new THREE.BufferGeometry();
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  // Merged rigs comfortably exceed 65k vertices in aggregate only if misused,
  // but pick the index width defensively anyway.
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const index = new IndexArray(indexCount);

  let vOff = 0;
  let iOff = 0;
  for (const g of geometries) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    position.set(pos.array.subarray(0, pos.count * 3), vOff * 3);
    if (nor) normal.set(nor.array.subarray(0, nor.count * 3), vOff * 3);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[iOff + i] = g.index.array[i] + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < pos.count; i++) index[iOff + i] = i + vOff;
      iOff += pos.count;
    }
    vOff += pos.count;
  }

  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}
