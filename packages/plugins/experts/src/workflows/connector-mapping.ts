import { isScalar } from 'yaml';
import { presetDocument, type StageExecution } from './authoring.js';

const namePattern = /^[a-zA-Z0-9_-]{1,64}$/;
function checkNames(from: string, to: string) {
  if (!namePattern.test(from) || !namePattern.test(to)) throw new Error('连接器映射名称无效。');
}

/** Update only connector bindings, including Team scopes; preserve the authored YAML tree. */
export function remapWorkflowConnector(text: string, from: string, to: string): string {
  checkNames(from, to);
  if (from === to) return text;
  const doc = presetDocument(text);
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const raw = doc.toJS({ maxAliasCount: 0 });
  const replace = (path: (string | number)[], value: string | boolean) => {
    const node = doc.getIn(path, true);
    if (isScalar(node)) node.value = value; else doc.setIn(path, value);
  };
  const execution = (value: StageExecution | undefined, path: (string | number)[]) => {
    const rows = value?.connectors?.requirements ?? [], seen = new Map<string, number>(), duplicates: number[] = [];
    rows.forEach((row, index) => {
      const name = row.serverName === from ? to : row.serverName, prior = seen.get(name);
      if (name !== row.serverName) replace([...path, 'connectors', 'requirements', index, 'serverName'], name);
      if (prior === undefined) seen.set(name, index);
      else { if (row.required) replace([...path, 'connectors', 'requirements', prior, 'required'], true); duplicates.push(index); }
    });
    for (const index of duplicates.reverse()) doc.deleteIn([...path, 'connectors', 'requirements', index]);
    value?.team?.members.forEach((member, index) => {
      const names = new Set<string>(), duplicates: number[] = [];
      member.connectors?.forEach((name, i) => {
        const mapped = name === from ? to : name;
        if (mapped !== name) replace([...path, 'team', 'members', index, 'connectors', i], mapped);
        if (names.has(mapped)) duplicates.push(i); else names.add(mapped);
      });
      for (const i of duplicates.reverse()) doc.deleteIn([...path, 'team', 'members', index, 'connectors', i]);
    });
  };
  execution(raw?.execution, ['execution']);
  raw?.stages?.forEach((stage: { execution?: StageExecution }, index: number) => execution(stage.execution, ['stages', index, 'execution']));
  return doc.toString();
}

/** A stage override must also update its effective Team connector scope. */
export function remapStageConnector(value: StageExecution, effective: StageExecution, from: string, to: string): StageExecution {
  checkNames(from, to);
  const rows = new Map<string, { serverName: string; required: boolean }>();
  for (const row of value.connectors?.requirements ?? []) {
    const serverName = row.serverName === from ? to : row.serverName;
    rows.set(serverName, { ...row, serverName, required: row.required || !!rows.get(serverName)?.required });
  }
  const team = value.team ?? effective.team;
  return { ...value, connectors: { mode: 'explicit', requirements: [...rows.values()] }, ...(team ? { team: { ...team, members: team.members.map(member => ({ ...member,
    ...(member.connectors ? { connectors: [...new Set(member.connectors.map(name => name === from ? to : name))] } : {}) })) } } : {}) };
}
