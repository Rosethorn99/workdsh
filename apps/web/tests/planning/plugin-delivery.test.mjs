import assert from 'node:assert/strict';
import test from 'node:test';
import { auditDefaultPluginDelivery, readOwnedManifests, assertDefaultOwnedClosure } from '../../scripts/check-plugin-delivery.mjs';

test('personal default source package closure excludes independently installed enterprise plugins', async () => {
  const proof = await auditDefaultPluginDelivery();
  assert.equal(proof.externalEnterprisePackagesAbsent, true);
  assert.ok(!proof.ownedClosure.includes('workdsh-plugin-office'));
  assert.deepEqual(proof.edges.find(edge=>edge.bundledHelper),{
    from:'workdsh-plugin-library',to:'workdsh-plugin-office',field:'devDependencies',bundledHelper:'workdsh-plugin-office/tabular',
  });
  for (const name of ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration']) {
    assert.ok(!proof.ownedClosure.includes(name), name);
  }
});

test('default delivery rejects external feature peers and build dependencies', async () => {
  const originals = await readOwnedManifests();
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const name of ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration']) {
      const manifests = structuredClone(originals);
      const row = manifests.get('workdsh-plugin-access');
      row.manifest[field] = { ...row.manifest[field], [name]: '0.1.0-alpha.1' };
      assert.throws(() => assertDefaultOwnedClosure(manifests), /Default package closure contains an external feature/);
    }
  }
});

test('tabular build reuse never permits Office runtime activation or unrelated build imports',async()=>{
 const originals=await readOwnedManifests();
 for(const field of ['dependencies','optionalDependencies','peerDependencies']){
  const manifests=structuredClone(originals);
  const row=manifests.get('workdsh-plugin-library');
  row.manifest[field]={...row.manifest[field],'workdsh-plugin-office':'workspace:*'};
  assert.throws(()=>assertDefaultOwnedClosure(manifests),/Default package closure contains an external feature/);
 }
 const other=structuredClone(originals);
 other.get('workdsh-plugin-access').manifest.devDependencies={'workdsh-plugin-office':'workspace:*'};
 assert.throws(()=>assertDefaultOwnedClosure(other),/Default package closure contains an external feature/);
 const missing=structuredClone(originals);
 delete missing.get('workdsh-plugin-office').manifest.exports['./tabular'];
 assert.throws(()=>assertDefaultOwnedClosure(missing),/Bundled helper must have a public export/);
});
