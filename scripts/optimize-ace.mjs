/**
 * ACE production optimization pipeline (deterministic).
 *
 * Reads:  assets/source/ACE_EXPORT.glb, assets/source/ACE_ANIMATED.glb
 * Writes: assets/production/ACE_EXPORT_PRODUCTION.glb,
 *         assets/production/ACE_ANIMATED_PRODUCTION.glb
 *
 * Run from the repo root:
 *   npm install @gltf-transform/core @gltf-transform/extensions \
 *               @gltf-transform/functions draco3dgltf meshoptimizer
 *   node scripts/optimize-ace.mjs
 *
 * Steps: strip dead TEXCOORDs -> doubleSided policy -> reparent skinned meshes to
 * scene root -> weld -> (animated) simplify <150k tris -> dedup/prune/reorder ->
 * re-encode Draco. Visual identity is preserved (HeadMat translucency kept; clips
 * and skin untouched).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, reorder, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// material -> doubleSided policy (true = keep double-sided)
const KEEP_DOUBLE = new Set(['ACE_EXPORT_HeadMat', 'ACE_EXPORT_ChipMat']);

function countTris(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const i = p.getIndices();
      t += (i ? i.getCount() : (p.getAttribute('POSITION')?.getCount()||0)) / 3;
    }
  return Math.round(t);
}

async function process(inPath, outPath, { simplifyRatio = null, simplifyError = 0.004 } = {}) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  const log = [];
  log.push(`tris in: ${countTris(doc)}`);

  // 1) Remove all TEXCOORD_n attributes (no textures reference them)
  let uvRemoved = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const sem of prim.listSemantics())
        if (sem.startsWith('TEXCOORD_')) {
          const acc = prim.getAttribute(sem);
          prim.setAttribute(sem, null);
          uvRemoved++;
        }
  log.push(`TEXCOORD attributes removed: ${uvRemoved}`);

  // 2) doubleSided policy
  for (const mat of root.listMaterials()) {
    const keep = KEEP_DOUBLE.has(mat.getName());
    if (!keep && mat.getDoubleSided()) {
      mat.setDoubleSided(false);
      log.push(`doubleSided disabled: ${mat.getName()}`);
    } else if (keep) {
      log.push(`doubleSided kept: ${mat.getName()} (${mat.getAlphaMode()})`);
    }
  }

  // 3) Reparent skinned-mesh nodes to scene root w/ identity transform
  //    Fixes NODE_SKINNED_MESH_NON_ROOT (parent transforms are ignored for skinned meshes).
  const scene = root.getDefaultScene() || root.listScenes()[0];
  let reparented = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && node.getSkin()) {
      const parent = node.getParentNode ? node.getParentNode() : null;
      if (parent) { parent.removeChild(node); }
      node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
      scene.addChild(node);
      reparented++;
    }
  }
  log.push(`skinned-mesh nodes reparented to scene root: ${reparented}`);

  // 4) weld (merge identical verts) — required before simplify, also shrinks data
  await doc.transform(weld({ tolerance: 0.0001 }));

  // 5) simplify (animated only) toward triangle budget
  if (simplifyRatio !== null) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: simplifyError, lockBorder: true }));
    log.push(`simplified ratio=${simplifyRatio} error=${simplifyError} -> tris: ${countTris(doc)}`);
  }

  // 6) dedup + prune (remove orphan accessors/bufferViews/materials/etc.)
  await doc.transform(
    dedup(),
    prune({ keepLeaves: false, keepAttributes: false }),
    reorder({ encoder: MeshoptEncoder, target: 'performance' }),
  );

  // 7) re-apply Draco compression
  await doc.transform(draco());

  await io.write(outPath, doc);
  log.push(`tris out: ${countTris(doc)}`);
  return log;
}

console.log('--- ACE_EXPORT_PRODUCTION ---');
console.log((await process('assets/source/ACE_EXPORT.glb', 'assets/production/ACE_EXPORT_PRODUCTION.glb')).join('\n'));

console.log('\n--- ACE_ANIMATED_PRODUCTION (target <150k tris) ---');
// 255371 -> aim ~0.55 ratio; error bound protects silhouette/skin
console.log((await process('assets/source/ACE_ANIMATED.glb', 'assets/production/ACE_ANIMATED_PRODUCTION.glb', { simplifyRatio: 0.45, simplifyError: 0.008 })).join('\n'));
