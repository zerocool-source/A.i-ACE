/**
 * ACE mobile / low-tier LOD generator.
 *
 * Produces aggressively-decimated variants for low-end mobile, reusing the same
 * production cleanup as scripts/optimize-ace.mjs (dead-UV strip, doubleSided
 * policy, skinned-mesh reparent, prune, reorder, Draco) but with a much lower
 * triangle budget. Borders stay locked so the connection tubes never develop
 * holes; visual identity (HeadMat translucency, all 4 clips, skin) is preserved.
 *
 * Reads:  assets/source/*.glb
 * Writes: assets/production/ACE_EXPORT_MOBILE.glb,
 *         assets/production/ACE_ANIMATED_MOBILE.glb
 *
 * Run from repo root:
 *   node scripts/make-mobile-lod.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, reorder, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const KEEP_DOUBLE = new Set(['ACE_EXPORT_HeadMat', 'ACE_EXPORT_ChipMat']);
const tris = (d) => {
  let t = 0;
  for (const m of d.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const i = p.getIndices();
      t += (i ? i.getCount() : (p.getAttribute('POSITION')?.getCount() || 0)) / 3;
    }
  return Math.round(t);
};

async function lod(inPath, outPath, ratio, error) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  const before = tris(doc);

  // strip dead TEXCOORDs
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const sem of prim.listSemantics())
        if (sem.startsWith('TEXCOORD_')) prim.setAttribute(sem, null);

  // doubleSided policy
  for (const mat of root.listMaterials())
    if (!KEEP_DOUBLE.has(mat.getName())) mat.setDoubleSided(false);

  // reparent skinned meshes to scene root
  const scene = root.getDefaultScene() || root.listScenes()[0];
  for (const node of root.listNodes())
    if (node.getMesh() && node.getSkin()) {
      const parent = node.getParentNode ? node.getParentNode() : null;
      if (parent) parent.removeChild(node);
      node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
      scene.addChild(node);
    }

  await doc.transform(
    weld({ tolerance: 0.0001 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: true }),
    dedup(),
    prune({ keepLeaves: false, keepAttributes: false }),
    reorder({ encoder: MeshoptEncoder, target: 'performance' }),
    draco(),
  );

  await io.write(outPath, doc);
  console.log(`${outPath.split('/').pop()}: ${before} -> ${tris(doc)} tris (ratio=${ratio} error=${error})`);
}

const S = 'assets/source/';
const P = 'assets/production/';
await lod(`${S}ACE_EXPORT.glb`, `${P}ACE_EXPORT_MOBILE.glb`, 0.2, 0.04);
await lod(`${S}ACE_ANIMATED.glb`, `${P}ACE_ANIMATED_MOBILE.glb`, 0.16, 0.045);
