import { apply as applyOfficial } from '@deepseek-ai/dsh-tool-fs-search';

export { Config, inject, name } from '@deepseek-ai/dsh-tool-fs-search';

// Keep the published search/parser/rendering implementation. Only bound broad discovery.
const caches = ['node_modules', '.artifacts', '.pnpm-store', '.yarn/cache', 'official-release-cache'];
const scopeNote = 'WorkDSH: broad glob discovery excludes dependency and runtime caches (node_modules, .artifacts, .pnpm-store, .yarn/cache, official-release-cache). To inspect a cache, specify its directory in path or pattern. Hidden project context and source remain searchable.';

function scopedArgv(argv) {
  if (!argv.includes('--files')) return argv;
  const separator = argv.indexOf('--');
  const filters = argv.filter(value => value.startsWith('--glob=') && !value.startsWith('--glob=!')).map(value => value.slice(7));
  const explicit = [...filters, ...(separator < 0 ? [] : argv.slice(separator + 1))].map(value => value.replaceAll('\\', '/'));
  if (explicit.some(value => caches.some(cache => ('/' + value + '/').includes('/' + cache + '/')))) return argv;
  const exclusions = caches.flatMap(cache => [`--glob=!**/${cache}`, `--glob=!**/${cache}/**`]);
  const before = separator < 0 ? argv : argv.slice(0, separator);
  const after = separator < 0 ? [] : argv.slice(separator);
  return [...before, ...exclusions, ...after];
}

export function apply(ctx, config) {
  const subprocess = new Proxy(ctx.subprocess, {
    get(target, key, receiver) {
      if (key === 'spawn') return spec => target.spawn({ ...spec, argv: scopedArgv(spec.argv) });
      return Reflect.get(target, key, receiver);
    },
  });
  const tools = new Proxy(ctx.tools, {
    get(target, key, receiver) {
      if (key === 'register') return tool => {
        // Preserve object identity: the official post-execute hook uses it to save complete results.
        if (tool.name === 'glob') tool.description += '\n' + scopeNote;
        return target.register(tool);
      };
      return Reflect.get(target, key, receiver);
    },
  });
  const scoped = new Proxy(ctx, {
    get(target, key) {
      if (key === 'subprocess') return subprocess;
      if (key === 'tools') return tools;
      return Reflect.get(target, key, target);
    },
  });
  applyOfficial(scoped, config);
}
